import {scaledInteger} from './money.js';import {nowRiyadh} from './lib.js';
import {pageQuery,paged} from './paging.js';
const micro=value=>Number(scaledInteger(value,6,'كمية التتبع'));
const quantityText=value=>{const n=BigInt(value);return(n/1000000n)+'.'+String(n%1000000n).padStart(6,'0');};
export function expiryDate(value){if(value==null||value==='')return null;const d=String(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)throw Error('تاريخ انتهاء غير صالح');return d;}
export function trackingInput(value){
 if(value==null)return[];if(!Array.isArray(value)||value.length>1000)throw Error('تفاصيل التتبع يجب أن تكون قائمة حتى 1000 هوية');const seen=new Set();
 return value.map(row=>{const code=String(row?.code||'').trim(),qty=micro(row?.qty??1);if(!code||code.length>100||/[\u0000-\u001f]/.test(code)||seen.has(code)||qty<=0)throw Error('هوية تتبع مكررة أو كمية/رمز غير صالح');seen.add(code);return{code,qty:quantityText(qty),expiry_date:expiryDate(row.expiry_date)};});
}
export function movementTracking(db,movementId){return db.prepare('SELECT a.id allocation_id,a.trace_id,t.code,t.expiry_date,a.qty_micro FROM trace_allocations a JOIN trace_units t ON t.id=a.trace_id WHERE a.movement_id=? ORDER BY a.id').all(movementId).map(r=>({...r,qty:quantityText(Math.abs(r.qty_micro))}));}
export function remainingTracking(db,movementId){return db.prepare('SELECT a.id allocation_id,a.trace_id,t.code,t.expiry_date,abs(a.qty_micro)-COALESCE((SELECT SUM(abs(r.qty_micro)) FROM trace_allocations r WHERE r.original_allocation_id=a.id),0) remaining_micro FROM trace_allocations a JOIN trace_units t ON t.id=a.trace_id WHERE a.movement_id=? ORDER BY a.id').all(movementId).map(r=>({...r,qty:quantityText(r.remaining_micro)}));}
function automatic(rows,amount,available){let remaining=amount;const selected=[];for(const row of rows){const qty=Math.min(remaining,available(row));if(qty>0){selected.push({code:row.code,qty:quantityText(qty),expiry_date:row.expiry_date});remaining-=qty;}if(!remaining)break;}if(remaining)throw Error('لا تكفي أرصدة الدفعات المتاحة لهذه الحركة أو تجاوزت 1000 دفعة');return selected;}
function allocate(db,movement,item,entries){
 const source=movement.return_source_movement_id?db.prepare('SELECT * FROM stock_movements WHERE id=?').get(movement.return_source_movement_id):null;
 if(movement.return_source_movement_id&&(!source||source.item_id!==item.id||source.warehouse_id!==movement.warehouse_id))throw Error('حركة المرتجع لا تطابق أصلها');
 const original=source?remainingTracking(db,source.id):[],amount=Math.abs(movement.delta_micro),incoming=movement.delta_micro>0;
 if(item.tracking_mode==='serial'&&amount%1000000)throw Error('الصنف التسلسلي لا يقبل جزءًا من قطعة');
 if(!entries.length){
  if(source){const remaining=original.filter(r=>r.remaining_micro>0);if(remaining.length!==1)throw Error('حدد هويات المرتجع الفعلية من مستند الأصل');entries=automatic(remaining,amount,r=>r.remaining_micro);}
  else if(item.tracking_mode==='serial')throw Error('حدد الأرقام التسلسلية الفعلية للحركة');
  else if(!incoming){const rows=db.prepare("SELECT t.*,p.qty_micro FROM trace_positions p JOIN trace_units t ON t.id=p.trace_id WHERE t.item_id=? AND p.warehouse_id=? AND p.qty_micro>0 AND (?!='sale' OR t.expiry_date IS NULL OR t.expiry_date>=?) ORDER BY COALESCE(t.expiry_date,'9999-12-31'),t.id LIMIT 1000").all(item.id,movement.warehouse_id,movement.kind,nowRiyadh().date);entries=automatic(rows,amount,r=>r.qty_micro);}
  else throw Error('أدخل أرقام الدفعات وكمياتها للاستلام');
 }
 const total=entries.reduce((sum,row)=>sum+BigInt(micro(row.qty)),0n);if(total!==BigInt(amount))throw Error('مجموع كميات التتبع لا يساوي كمية الحركة بالوحدة الأساسية');
 for(const row of entries){
  const qty=micro(row.qty);if(item.tracking_mode==='serial'&&qty!==1000000)throw Error('كل رقم تسلسلي يمثل قطعة واحدة');
  let trace=db.prepare('SELECT * FROM trace_units WHERE item_id=? AND code=?').get(item.id,row.code);
  if(trace&&row.expiry_date&&row.expiry_date!==trace.expiry_date)throw Error('تاريخ الهوية محفوظ ولا يغيّر في حركة لاحقة');
  if(!trace){if(!incoming||source)throw Error('هوية التتبع لا تخص الرصيد أو مستند الأصل');if(item.expiry_required&&!row.expiry_date)throw Error('تاريخ انتهاء الدفعة أو التسلسل مطلوب');const traceId=Number(db.prepare('INSERT INTO trace_units(item_id,code,expiry_date) VALUES(?,?,?)').run(item.id,row.code,row.expiry_date).lastInsertRowid);trace={id:traceId,code:row.code,expiry_date:row.expiry_date};}
  const origin=source?original.find(a=>a.trace_id===trace.id):null;if(source&&(!origin||origin.remaining_micro<qty))throw Error('المرتجع يتجاوز المتبقي لهوية الأصل');
  if(movement.kind==='sale'&&trace.expiry_date&&trace.expiry_date<nowRiyadh().date)throw Error('لا يمكن بيع دفعة أو تسلسل منتهي الصلاحية');
  db.prepare('INSERT INTO trace_allocations(movement_id,trace_id,qty_micro,original_allocation_id) VALUES(?,?,?,?)').run(movement.id,trace.id,incoming?qty:-qty,origin?.allocation_id||null);
 }
 db.prepare('INSERT INTO trace_seals(movement_id) VALUES(?)').run(movement.id);
}
// Every production movement path calls this inside its enclosing financial transaction.
// A deferred FK rejects transaction completion if a tracked movement has no valid seal.
export function insertStockMovement(db,data,{tracking=[],originalMovementId=null}={}){
 const item=db.prepare('SELECT * FROM items WHERE id=?').get(data.item_id);if(!item)throw Error('الصنف غير موجود');const entries=trackingInput(tracking),tracked=item.tracking_mode!=='none';
 if(!tracked&&entries.length)throw Error('الصنف غير مهيأ لتتبع دفعات أو تسلسلات');
 const row={...data,return_source_movement_id:originalMovementId};if(tracked){row.id=db.prepare('SELECT COALESCE(MAX(id),0)+1 next FROM stock_movements').get().next;if(!Number.isSafeInteger(row.id))throw Error('تجاوز تسلسل الحركات المسموح');row.tracking_seal_id=row.id;}
 const columns=Object.keys(row),allowed=new Set(['id','event_id','request_hash','item_id','warehouse_id','delta_micro','kind','invoice_id','purchase_id','line_no','reason','actor_id','return_source_movement_id','tracking_seal_id']);if(columns.some(c=>!allowed.has(c)))throw Error('حقل حركة غير معروف');
 const movementId=Number(db.prepare('INSERT INTO stock_movements('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...columns.map(c=>row[c])).lastInsertRowid);
 if(tracked)allocate(db,{...row,id:movementId},item,entries);return movementId;
}
export function checkTracking(db){
 const quantities=db.prepare("SELECT p.item_id,p.warehouse_id,p.qty_micro expected,COALESCE((SELECT SUM(tp.qty_micro) FROM trace_positions tp JOIN trace_units t ON t.id=tp.trace_id WHERE t.item_id=p.item_id AND tp.warehouse_id=p.warehouse_id),0) actual FROM stock_positions p JOIN items i ON i.id=p.item_id WHERE i.tracking_mode!='none'").all().filter(r=>r.expected!==r.actual);
 const unsealed=db.prepare("SELECT m.id FROM stock_movements m JOIN items i ON i.id=m.item_id LEFT JOIN trace_seals s ON s.movement_id=m.id WHERE i.tracking_mode!='none' AND (s.movement_id IS NULL OR m.delta_micro!=(SELECT SUM(qty_micro) FROM trace_allocations a WHERE a.movement_id=m.id))").all();
 const positions=db.prepare('WITH history AS(SELECT a.trace_id,m.warehouse_id,SUM(a.qty_micro) qty,MAX(a.id) last_id FROM trace_allocations a JOIN stock_movements m ON m.id=a.movement_id GROUP BY a.trace_id,m.warehouse_id) SELECT h.trace_id,h.warehouse_id,h.qty expected,p.qty_micro actual FROM history h LEFT JOIN trace_positions p ON p.trace_id=h.trace_id AND p.warehouse_id=h.warehouse_id WHERE p.trace_id IS NULL OR p.qty_micro!=h.qty OR p.last_allocation_id!=h.last_id UNION ALL SELECT p.trace_id,p.warehouse_id,NULL,p.qty_micro FROM trace_positions p LEFT JOIN history h ON h.trace_id=p.trace_id AND h.warehouse_id=p.warehouse_id WHERE h.trace_id IS NULL').all();
 return{ok:!quantities.length&&!unsealed.length&&!positions.length,quantities,unsealed,positions};
}
export function traceList(db,itemId,warehouseId,query={},forSale=false){
 const item=Number(itemId),warehouse=Number(warehouseId);if(![item,warehouse].every(n=>Number.isSafeInteger(n)&&n>0))throw Error('اختر صنفًا ومستودعًا');const definition=db.prepare('SELECT id,tracking_mode,expiry_required,base_unit FROM items WHERE id=?').get(item);if(!definition)throw Error('الصنف غير موجود');const p=pageQuery(query);
 const where="t.item_id=? AND t.code LIKE ? ESCAPE '\\'"+((forSale||query.include_empty!=='1')?' AND COALESCE(p.qty_micro,0)>0':'')+(forSale?' AND (t.expiry_date IS NULL OR t.expiry_date>=?)':'');
 const result=paged(db,{select:'t.id,t.code,t.expiry_date,COALESCE(p.qty_micro,0) qty_micro,w.id warehouse_id,w.name warehouse',from:'trace_units t LEFT JOIN trace_positions p ON p.trace_id=t.id AND p.warehouse_id=? JOIN warehouses w ON w.id=?',where,params:[warehouse,warehouse,item,p.like,...(forSale?[nowRiyadh().date]:[])],order:"COALESCE(t.expiry_date,'9999-12-31'),t.id",map:r=>({...r,qty:quantityText(r.qty_micro),expired:Boolean(r.expiry_date&&r.expiry_date<nowRiyadh().date)})},query);return{...result,...definition};
}
