import crypto from 'node:crypto';
import {insertStockMovement,trackingInput,movementTracking} from './tracking.js';
import {scaledInteger} from './money.js';
import {tx} from './db.js';
import {valueMovement} from './valuation.js';
import {postEntry} from './core.js';
import {nowRiyadh} from './lib.js';
import {roundRatio} from './money.js';
export const micro=value=>Number(scaledInteger(value,6,'الكمية'));
const id=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw Error('معرف غير صالح');return n;};
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function baseQuantity(quantity,factor){const product=BigInt(micro(quantity))*BigInt(factor);if(product%1000000n)throw Error('تحويل الوحدة ينتج كمية بأكثر من 6 منازل عشرية');const q=product/1000000n;if(q>BigInt(Number.MAX_SAFE_INTEGER))throw Error('الكمية أكبر من المسموح');return Number(q);}
export const balance=(db,item,warehouse)=>db.prepare('SELECT qty_micro quantity FROM stock_positions WHERE item_id=? AND warehouse_id=?').get(item,warehouse)?.quantity||0;
export function recordStock(db,body,user){return tx(db,()=>{
 const itemId=id(body.item_id),warehouseId=id(body.warehouse_id),quantity=micro(body.qty),kind=body.kind;
 if(!quantity)throw Error('الكمية يجب أن تكون أكبر من صفر');
 const item=db.prepare('SELECT * FROM items WHERE id=? AND active=1').get(itemId);if(!item||!item.track_stock||item.item_kind!=='product')throw Error('اختر صنفًا مخزنيًا فعالًا');
 if(!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(warehouseId))throw Error('المستودع غير موجود أو موقوف');
 if(!['opening','receipt','issue','adjust_in','adjust_out','transfer'].includes(kind))throw Error('نوع الحركة غير صالح');
 const reason=String(body.reason||'').trim();if(!reason||reason.length>500)throw Error('سبب الحركة أو مرجعها مطلوب (حتى 500 حرف)');
 const target=kind==='transfer'?id(body.target_warehouse_id):null;if(target&&(target===warehouseId||!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(target)))throw Error('اختر مستودع استلام مختلفًا وفعالًا');
 const event=String(body.request_id||'');if(!/^[0-9a-f-]{36}$/i.test(event))throw Error('معرف طلب الحركة مطلوب');
 const unitCost=body.unit_cost===undefined||body.unit_cost===''?null:Number(scaledInteger(body.unit_cost,2,'تكلفة الوحدة'));
 const tracking=trackingInput(body.tracking),fingerprint=hash({itemId,warehouseId,quantity,kind,reason,target,user,unitCost,...(tracking.length?{tracking}: {})});
 const previous=db.prepare('SELECT request_hash FROM stock_movements WHERE event_id=? LIMIT 1').get(event);
 if(previous){if(previous.request_hash!==fingerprint)throw Error('طلب الحركة مستخدم ببيانات مختلفة');return {event_id:event,replayed:true};}
 if(kind==='opening'&&db.prepare('SELECT 1 FROM stock_movements WHERE item_id=? AND warehouse_id=?').get(itemId,warehouseId))throw Error('الرصيد الافتتاحي يسبق الحركات؛ استخدم تسوية بمرجع للتصحيح');
 const insert=(warehouse,delta,type,selected=tracking)=>insertStockMovement(db,{event_id:event,request_hash:fingerprint,item_id:itemId,warehouse_id:warehouse,delta_micro:delta,kind:type,reason,actor_id:user},{tracking:selected});
 if(kind==='transfer'){const outgoingId=insert(warehouseId,-quantity,'transfer_out'),outgoing=valueMovement(db,outgoingId);valueMovement(db,insert(target,quantity,'transfer_in',movementTracking(db,outgoingId)),{value:outgoing.value,costed:outgoing.costed});}
 else {const outgoing=['issue','adjust_out'].includes(kind),cost=unitCost===null?null:roundRatio(BigInt(quantity)*BigInt(unitCost),1000000n),valuation=valueMovement(db,insert(warehouseId,outgoing?-quantity:quantity,kind),{value:cost});
  if(valuation.value)postEntry(db,{date:nowRiyadh().date,description:'مخزون: '+reason,source_type:'stock',source_id:null,branch_id:1,lines:[{account:'1401',[outgoing?'credit':'debit']:valuation.value},{account:kind==='opening'?'3101':'5298',[outgoing?'debit':'credit']:valuation.value}]});
 }
 return {event_id:event,replayed:false};
});}
export function prepareItemLines(db,input,posId){const point=db.prepare('SELECT warehouse_id FROM pos_points WHERE id=?').get(posId||1);if(!point)throw Error('نقطة البيع غير موجودة');return input.map(row=>{
 if(!row.item_id)return row;
 const item=db.prepare('SELECT * FROM items WHERE id=? AND active=1').get(id(row.item_id));if(!item)throw Error('الصنف غير موجود أو موقوف');
 const unit=row.item_unit_id?db.prepare('SELECT * FROM item_units WHERE id=? AND item_id=? AND active=1').get(id(row.item_unit_id),item.id):null;if(row.item_unit_id&&!unit)throw Error('وحدة الصنف غير موجودة أو موقوفة');
 const factor=unit?.factor_micro||1000000,quantity=item.track_stock?baseQuantity(row.qty,factor):0,tracking=trackingInput(row.tracking);if(item.tracking_mode==='serial'&&quantity%1000000)throw Error('الكمية التسلسلية قطع كاملة');if(item.tracking_mode==='none'&&tracking.length)throw Error('الصنف غير مهيأ للتتبع');return {...row,tracking,item_id:item.id,unit_name:unit?.name||item.base_unit,unit_code:unit?.unit_code||item.unit_code,unit_factor_micro:factor,stock_qty_micro:quantity,warehouse_id:item.track_stock?point.warehouse_id:null};
 });}
export function postInvoiceStock(db,invoice){
 if(invoice.document_code==='383')return {cost:0,complete:true}; // Monetary debit adjustments do not imply a physical delivery.
 let cost=0,complete=true;
 const lines=db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=?').all(invoice.id);
 for(const line of lines){if(!line.item_id||!line.stock_qty_micro)continue;
  const returning=invoice.type==='381';const quantity=line.stock_qty_micro;
  if(returning){const original=db.prepare("SELECT id,delta_micro,warehouse_id,item_id FROM stock_movements WHERE invoice_id=? AND line_no=? AND kind='sale'").get(invoice.ref_invoice_id,line.line_no);if(!original||original.item_id!==line.item_id||original.warehouse_id!==line.warehouse_id)throw Error('لا توجد حركة بيع أصلية لإعادة هذه الكمية');}
  const event='invoice:'+invoice.uuid+':'+line.line_no;
  let returnedValue=null,returnCosted=true;
  if(returning){const original=db.prepare("SELECT m.delta_micro,v.value_delta,v.costed FROM stock_movements m JOIN stock_values v ON v.movement_id=m.id WHERE m.invoice_id=? AND m.line_no=? AND m.kind='sale'").get(invoice.ref_invoice_id,line.line_no);if(!original)throw Error('تكلفة البيع الأصلية غير موجودة');const prior=db.prepare("SELECT COALESCE(SUM(m.delta_micro),0) qty,COALESCE(SUM(v.value_delta),0) value FROM stock_movements m JOIN stock_values v ON v.movement_id=m.id JOIN invoices i ON i.id=m.invoice_id WHERE i.ref_invoice_id=? AND m.line_no=? AND m.kind='return'").get(invoice.ref_invoice_id,line.line_no);returnedValue=quantity===-original.delta_micro-prior.qty?-original.value_delta-prior.value:roundRatio(BigInt(-original.value_delta)*BigInt(quantity),BigInt(-original.delta_micro));returnCosted=Boolean(original.costed);}
  const originalMovement=returning?db.prepare("SELECT id FROM stock_movements WHERE invoice_id=? AND line_no=? AND kind='sale'").get(invoice.ref_invoice_id,line.line_no):null;
  const movement=insertStockMovement(db,{event_id:event,request_hash:hash({invoice:invoice.uuid,line:line.line_no,quantity}),item_id:line.item_id,warehouse_id:line.warehouse_id,delta_micro:returning?quantity:-quantity,kind:returning?'return':'sale',invoice_id:invoice.id,line_no:line.line_no,reason:returning?'مرتجع مرتبط بالفاتورة':'بيع صادر',actor_id:invoice.created_by},{tracking:JSON.parse(line.tracking_json||'[]'),originalMovementId:originalMovement?.id||null});
  const result=valueMovement(db,movement,{value:returnedValue,costed:returnCosted});cost+=result.value;complete=complete&&result.costed;
 }
 return{cost,complete};
}
