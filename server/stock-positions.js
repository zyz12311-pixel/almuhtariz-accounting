import {tx} from './db.js';
export function checkStockPositions(db){
 const rows=db.prepare(`WITH expected AS (SELECT item_id,warehouse_id,SUM(delta_micro) qty,MAX(id) last_id FROM stock_movements GROUP BY item_id,warehouse_id)
 SELECT e.item_id,e.warehouse_id,e.qty expected,p.qty_micro actual,e.last_id expected_last,p.last_movement_id actual_last FROM expected e LEFT JOIN stock_positions p ON p.item_id=e.item_id AND p.warehouse_id=e.warehouse_id WHERE p.item_id IS NULL OR e.qty!=p.qty_micro OR e.last_id!=p.last_movement_id
 UNION ALL SELECT p.item_id,p.warehouse_id,NULL,p.qty_micro,NULL,p.last_movement_id FROM stock_positions p LEFT JOIN expected e ON e.item_id=p.item_id AND e.warehouse_id=p.warehouse_id WHERE e.item_id IS NULL`).all();
 return{ok:rows.length===0,mismatches:rows};
}
// Maintenance only, never called from a normal balance read or public endpoint.
// DDL and rebuild roll back together; writers cannot interleave this transaction.
export function rebuildStockPositions(db){return tx(db,()=>{
 const guards=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='stock_positions' AND name IN ('position_guard_insert','position_guard_update','position_guard_delete')").all();
 if(guards.length!==3)throw Error('تعريف حماية الرصيد غير مكتمل؛ راجع سلامة المخطط قبل إعادة البناء');
 for(const guard of guards)db.exec('DROP TRIGGER "'+guard.name+'"');
 db.exec('DELETE FROM stock_positions;INSERT INTO stock_positions(item_id,warehouse_id,qty_micro,last_movement_id) SELECT item_id,warehouse_id,SUM(delta_micro),MAX(id) FROM stock_movements GROUP BY item_id,warehouse_id');
 for(const guard of guards)db.exec(guard.sql);
 const checked=checkStockPositions(db);if(!checked.ok)throw Error('لم تتطابق الأرصدة المعاد بناؤها');return checked;
});}
