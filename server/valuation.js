import {roundRatio} from './money.js';
const safe=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('قيمة المخزون غير صالحة أو أكبر من المسموح');return n;};
export function valueMovement(db,movementId,{value=null,costed=true}={}){
 const m=db.prepare('SELECT * FROM stock_movements WHERE id=?').get(movementId);if(!m)throw Error('الحركة المخزنية غير موجودة');
 if(db.prepare('SELECT 1 FROM stock_values WHERE movement_id=?').get(movementId))throw Error('الحركة مقيمة مسبقًا');
 const prev=db.prepare('SELECT v.* FROM stock_values v JOIN stock_movements s ON s.id=v.movement_id WHERE s.item_id=? AND s.warehouse_id=? AND s.id<? ORDER BY s.id DESC LIMIT 1').get(m.item_id,m.warehouse_id,m.id)||{quantity_after:0,value_after:0,complete:1};
 const position=db.prepare('SELECT qty_micro,last_movement_id FROM stock_positions WHERE item_id=? AND warehouse_id=?').get(m.item_id,m.warehouse_id);
 if(!position||position.last_movement_id!==m.id)throw Error('الحركة ليست آخر رصيد مشتق؛ أوقف العملية وراجع سلامة المخزون');
 const before=position.qty_micro-m.delta_micro;
 if(prev.quantity_after!==before)throw Error('سلسلة تقييم المخزون غير مكتملة');
 let amount,known;
 if(m.delta_micro>0){amount=value===null?0:safe(value);known=value!==null&&costed;}
 else {if(before< -m.delta_micro)throw Error('الرصيد المخزني غير كاف');amount=-m.delta_micro===before?prev.value_after:roundRatio(BigInt(prev.value_after)*BigInt(-m.delta_micro),BigInt(before));known=Boolean(prev.complete);}
 const after=before+m.delta_micro,delta=m.delta_micro>0?amount:-amount,book=safe(prev.value_after+delta),complete=after===0?true:Boolean(prev.complete&&known);
 db.prepare('INSERT INTO stock_values(movement_id,value_delta,quantity_after,value_after,complete,costed) VALUES(?,?,?,?,?,?)').run(m.id,delta,after,book,complete?1:0,known?1:0);
 return{value:amount,delta,complete,costed:known};
}
export function stockValuation(db){return db.prepare(`SELECT i.id item_id,i.name_ar,i.base_unit,w.id warehouse_id,w.name warehouse,v.quantity_after,v.value_after,v.complete FROM stock_positions p JOIN stock_values v ON v.movement_id=p.last_movement_id JOIN items i ON i.id=p.item_id JOIN warehouses w ON w.id=p.warehouse_id ORDER BY i.name_ar,w.id`).all().map(r=>({...r,qty:r.quantity_after/1000000,value:r.value_after/100,average_cost:r.quantity_after?r.value_after*10000/r.quantity_after:0}));}
