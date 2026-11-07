import {prepareTrackingCount,trackingCountAdjustments,fixedQuantity} from './tracking-counts.js';
import crypto from 'node:crypto';import {tx} from './db.js';import {scaledInteger} from './money.js';import {getSetting,createCreditNote} from './core.js';import {balance,recordStock} from './inventory.js';import {appendAudit} from './audit.js';
const fail=message=>{const e=Error(message);e.status=403;throw e;};
const id=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw Error('معرف غير صالح');return n;};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const request=value=>{if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))throw Error('معرف طلب UUID مطلوب');return value;};
function point(db,user,value){const pos=id(value);if(!db.prepare('SELECT 1 FROM pos_points WHERE id=? AND active=1').get(pos))throw Error('نقطة البيع غير مفعلة');if(user.role==='staff'&&!db.prepare('SELECT 1 FROM pos_user_access WHERE user_id=? AND pos_id=?').get(user.id,pos))fail('نقطة البيع غير مسموحة');return pos;}
export function activeShift(db,user,pos,required=getSetting(db,'pos_control').require_shift){
 const shift=db.prepare('SELECT * FROM pos_shifts WHERE user_id=? AND pos_id=? AND closed_at IS NULL').get(user.id,pos);
 if(!shift&&required)throw Error('افتح وردية على نقطة البيع قبل إصدار العملية');return shift;
}
export function openShift(db,user,body){return tx(db,()=>{
 const key=request(body.request_id),fingerprint=hash({user:user.id,body}),old=db.prepare('SELECT * FROM pos_shifts WHERE request_id=?').get(key);
 if(old){if(old.user_id!==user.id||old.request_hash!==fingerprint)fail('معرف الوردية مستخدم ببيانات مختلفة');return{id:old.id,replayed:true};}
 const pos=point(db,user,body.pos_id),opening=Number(scaledInteger(body.opening_cash,2,'عهدة البداية'));
 const shift=Number(db.prepare('INSERT INTO pos_shifts(pos_id,user_id,opening_cash,request_id,request_hash) VALUES(?,?,?,?,?)').run(pos,user.id,opening,key,fingerprint).lastInsertRowid);
 appendAudit(db,{actor:user.id,event:'shift.opened',entity_type:'shift',entity_id:shift,details:{pos,opening}});return{id:shift,replayed:false};
});}
export function shiftSummary(db,shift){
 const totals=db.prepare("SELECT COALESCE(SUM(CASE WHEN i.type='381' THEN -i.total ELSE i.total END),0) total,COALESCE(SUM(CASE WHEN i.payment='cash' THEN CASE WHEN i.type='381' THEN -i.total ELSE i.total END ELSE 0 END),0) cash,COUNT(*) documents FROM pos_shift_invoices x JOIN invoices i ON i.id=x.invoice_id WHERE x.shift_id=?").get(shift.id);
 return{...shift,opening_cash:shift.opening_cash/100,counted_cash:shift.counted_cash===null?null:shift.counted_cash/100,expected_cash:shift.closed_at?shift.expected_cash/100:(shift.opening_cash+totals.cash)/100,variance:shift.variance===null?null:shift.variance/100,sales:totals.total/100,cash_sales:totals.cash/100,documents:totals.documents};
}
export function closeShift(db,user,shiftId,body){return tx(db,()=>{
 const shift=db.prepare('SELECT * FROM pos_shifts WHERE id=?').get(id(shiftId));if(!shift)throw Error('الوردية غير موجودة');if(shift.user_id!==user.id&&user.role!=='owner')fail('لا يمكنك إقفال وردية مستخدم آخر');
 const counted=Number(scaledInteger(body.counted_cash,2,'النقد الفعلي'));
 if(shift.closed_at){if(shift.counted_cash!==counted)throw Error('الوردية مقفلة بقيمة أخرى');return shiftSummary(db,shift);}
 const summary=shiftSummary(db,shift),expected=Math.round(summary.expected_cash*100);if(!Number.isSafeInteger(expected))throw Error('إجمالي الوردية أكبر من المسموح');
 db.prepare('UPDATE pos_shifts SET closed_at=?,counted_cash=?,expected_cash=?,variance=?,closed_by=? WHERE id=?').run(new Date().toISOString(),counted,expected,counted-expected,user.id,shift.id);
 appendAudit(db,{actor:user.id,event:'shift.closed',entity_type:'shift',entity_id:shift.id,details:{expected,counted,variance:counted-expected}});return shiftSummary(db,db.prepare('SELECT * FROM pos_shifts WHERE id=?').get(shift.id));
});}
export function posReturn(db,user,body){return tx(db,()=>{
 const key=request(body.request_id),fingerprint=hash({user:user.id,body}),old=db.prepare('SELECT * FROM pos_return_requests WHERE request_id=?').get(key);
 if(old){if(old.user_id!==user.id||old.request_hash!==fingerprint)fail('طلب مرتجع يخص عملية أخرى');return{id:old.invoice_id,replayed:true};}
 const original=db.prepare('SELECT * FROM invoices WHERE id=?').get(id(body.invoice_id));if(!original)throw Error('فاتورة البيع غير موجودة');
 point(db,user,original.pos_id);if(user.role==='staff'&&original.created_by!==user.id)fail('مرتجع العامل يخص مبيعاته فقط');
 const shift=activeShift(db,user,original.pos_id),invoice=createCreditNote(db,user.id,original.id,body);
 if(shift)db.prepare('INSERT INTO pos_shift_invoices(invoice_id,shift_id) VALUES(?,?)').run(invoice,shift.id);
 db.prepare('INSERT INTO pos_return_requests VALUES(?,?,?,?)').run(key,user.id,fingerprint,invoice);return{id:invoice,replayed:false};
});}
export function createStocktake(db,user,body){return tx(db,()=>{
 const key=request(body.request_id),fingerprint=hash({user:user.id,body}),old=db.prepare('SELECT id,request_hash FROM stocktakes WHERE request_id=?').get(key);
 if(old){if(old.request_hash!==fingerprint)throw Error('معرف الجرد مستخدم ببيانات مختلفة');return{id:old.id,replayed:true};}
 const warehouse=id(body.warehouse_id);if(!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(warehouse))throw Error('اختر مستودعًا فعالًا');
 const notes=String(body.notes||'').trim();if(!notes||notes.length>500||!Array.isArray(body.lines)||!body.lines.length||body.lines.length>1000)throw Error('بيان الجرد وبنوده مطلوبان (حتى 1000 صنف)');
 const seen=new Set(),lines=body.lines.map(l=>{
  const item=db.prepare('SELECT * FROM items WHERE id=? AND active=1 AND track_stock=1').get(id(l.item_id));if(!item||seen.has(item.id))throw Error('صنف الجرد غير صالح أو مكرر');seen.add(item.id);
  const position=db.prepare('SELECT qty_micro,last_movement_id FROM stock_positions WHERE item_id=? AND warehouse_id=?').get(item.id,warehouse),expected=position?.qty_micro||0;
  const traced=item.tracking_mode!=='none'?prepareTrackingCount(db,item,warehouse,l.tracking_counts):null;if(!traced&&l.tracking_counts?.length)throw Error('الصنف ليس متتبعًا');
  const counted=traced?traced.counted:Number(scaledInteger(l.counted_qty,6,'كمية الجرد'));if(traced&&l.counted_qty!==undefined&&l.counted_qty!==''&&Number(scaledInteger(l.counted_qty,6))!==counted)throw Error('إجمالي الجرد لا يطابق الهويات المعدودة');
  return{item:item.id,expected,counted,last:position?.last_movement_id||0,counts:traced?.counts||[],cost:l.unit_cost==null||l.unit_cost===''?null:Number(scaledInteger(l.unit_cost,2,'التكلفة'))};
 });
 const stocktake=Number(db.prepare('INSERT INTO stocktakes(warehouse_id,notes,created_by,request_id,request_hash) VALUES(?,?,?,?,?)').run(warehouse,notes,user.id,key,fingerprint).lastInsertRowid);
 for(const l of lines)db.prepare('INSERT INTO stocktake_lines(stocktake_id,item_id,expected_micro,counted_micro,unit_cost,expected_movement_id,tracking_counts) VALUES(?,?,?,?,?,?,?)').run(stocktake,l.item,l.expected,l.counted,l.cost,l.last,JSON.stringify(l.counts));
 appendAudit(db,{actor:user.id,event:'stocktake.created',entity_type:'stocktake',entity_id:stocktake,details:{warehouse,count:lines.length}});return{id:stocktake,replayed:false};
});}
export function approveStocktake(db,user,stocktakeId){return tx(db,()=>{
 if(user.role!=='owner')fail('اعتماد الجرد للمالك فقط');const draft=db.prepare('SELECT * FROM stocktakes WHERE id=?').get(id(stocktakeId));if(!draft)throw Error('الجرد غير موجود');if(draft.status==='approved')return{id:draft.id,replayed:true};
 const lines=db.prepare('SELECT * FROM stocktake_lines WHERE stocktake_id=? ORDER BY item_id').all(draft.id);
 for(const l of lines){
  const position=db.prepare('SELECT qty_micro,last_movement_id FROM stock_positions WHERE item_id=? AND warehouse_id=?').get(l.item_id,draft.warehouse_id);
  if(l.expected_movement_id===null)throw Error('هذه مسودة جرد قديمة؛ أعد العد قبل الاعتماد');
  if((position?.qty_micro||0)!==l.expected_micro||(position?.last_movement_id||0)!==l.expected_movement_id)throw Error('تغير رصيد صنف أو حركته منذ بدء الجرد. أعد الجرد قبل الاعتماد');
  const tracked=db.prepare('SELECT tracking_mode FROM items WHERE id=?').get(l.item_id).tracking_mode!=='none',difference=l.counted_micro-l.expected_micro,counts=JSON.parse(l.tracking_counts);
  const adjustments=tracked?trackingCountAdjustments(db,l.item_id,draft.warehouse_id,counts):(difference?[{kind:difference>0?'adjust_in':'adjust_out',qty:fixedQuantity(Math.abs(difference)),tracking:[]}]:[]);
  for(const change of adjustments)recordStock(db,{request_id:crypto.randomUUID(),item_id:l.item_id,warehouse_id:draft.warehouse_id,...change,...(l.unit_cost===null?{}:{unit_cost:fixedQuantity(l.unit_cost,2)}),reason:'اعتماد جرد #'+draft.id+' · '+draft.notes},user.id);
 }
 db.prepare("UPDATE stocktakes SET status='approved',approved_by=?,approved_at=? WHERE id=?").run(user.id,new Date().toISOString(),draft.id);
 appendAudit(db,{actor:user.id,event:'stocktake.approved',entity_type:'stocktake',entity_id:draft.id,details:{lines:lines.length}});return{id:draft.id,replayed:false};
});}
