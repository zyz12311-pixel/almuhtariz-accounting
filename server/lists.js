import {pageQuery,paged} from './paging.js';
import {itemRows} from './items.js';
import {validDate} from './commercial.js';
import {shiftSummary} from './operations.js';
const search=(fields)=>'('+fields.map(f=>f+" LIKE ? ESCAPE '\\'").join(' OR ')+')';
export function commercialList(db,kind,query={}){
 const p=pageQuery(query);let config;
 if(kind==='invoices'){
  const conditions=[search(['i.number','p.name_ar',"'مسودة '||i.id"])],params=[p.like,p.like,p.like];
  if(query.status&&query.status!=='all'){if(!['draft','issued','credit'].includes(query.status))throw Error('حالة غير صالحة');conditions.push(query.status==='credit'?"i.type='381'":'i.status=?');if(query.status!=='credit')params.push(query.status);}
  for(const [key,operator] of [['from','>='],['to','<=']])if(query[key]){validDate(query[key]);conditions.push('i.issue_date'+operator+'?');params.push(query[key]);}
  config={select:'i.id,i.number,i.type,i.document_code,i.invoice_kind,i.environment,i.status,i.issue_date,i.total,p.name_ar party',from:'invoices i LEFT JOIN parties p ON p.id=i.party_id',where:conditions.join(' AND '),params,order:'i.id DESC',map:r=>({...r,total:r.total/100})};
 }else if(kind==='items'){
  const where='('+search(['i.name_ar','i.sku','i.barcode'])+" OR EXISTS(SELECT 1 FROM item_units u WHERE u.item_id=i.id AND u.active=1 AND u.barcode LIKE ? ESCAPE '\\'))"+(query.track_stock==='1'?' AND i.track_stock=1':'')+(query.active==='1'?' AND i.active=1':'');
  const result=paged(db,{select:'i.*',from:'items i',where,params:[p.like,p.like,p.like,p.like],order:'i.name_ar,i.id'},query);result.rows=itemRows(db,result.rows);
  result.summary=db.prepare('SELECT COUNT(*) total,COALESCE(SUM(i.track_stock),0) tracked,COALESCE(SUM(CASE WHEN i.track_stock=1 AND COALESCE(q.qty,0)<=i.reorder_micro THEN 1 ELSE 0 END),0) low FROM items i LEFT JOIN (SELECT item_id,SUM(qty_micro) qty FROM stock_positions GROUP BY item_id) q ON q.item_id=i.id').get();return result;
 }else if(kind==='journals'){
  const result=paged(db,{select:'e.*',from:'journal_entries e',where:search(['e.description','CAST(e.entry_no AS TEXT)']),params:[p.like,p.like],order:'e.id DESC'},query),ids=result.rows.map(e=>e.id);
  result.rows=ids.length?db.prepare('SELECT e.*,l.account_code,a.name_ar account,l.debit,l.credit,x.party_id,p.name_ar party FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.code=l.account_code LEFT JOIN journal_party_links x ON x.line_id=l.id LEFT JOIN parties p ON p.id=x.party_id WHERE e.id IN ('+ids.map(()=>'?').join(',')+') ORDER BY e.id DESC,l.id').all(...ids).map(l=>({...l,debit:l.debit/100,credit:l.credit/100})):[];return result;
 }else if(kind==='stocktakes')config={select:'s.*,w.name warehouse',from:'stocktakes s JOIN warehouses w ON w.id=s.warehouse_id',where:search(['CAST(s.id AS TEXT)','s.notes','w.name']),params:[p.like,p.like,p.like],order:'s.id DESC'};
 else if(kind==='purchases')config={select:'p.*,s.name_ar supplier',from:'purchases p JOIN parties s ON s.id=p.supplier_id',where:search(['p.number','p.supplier_reference','s.name_ar']),params:[p.like,p.like,p.like],order:'p.id DESC',map:r=>({...r,subtotal:r.subtotal/100,vat:r.vat/100,total:r.total/100})};
 else if(kind==='quotations')config={select:'q.id,q.number,q.document_date,q.valid_until,q.status,q.total,q.invoice_id',from:'quotations q',where:search(['q.number','q.notes']),params:[p.like,p.like],order:'q.id DESC'};
 else if(kind==='vouchers')config={select:'v.*,p.name_ar party',from:'cash_vouchers v JOIN parties p ON p.id=v.party_id',where:search(['v.number','v.notes','p.name_ar']),params:[p.like,p.like,p.like],order:'v.id DESC',map:r=>({...r,amount:r.amount/100})};
 else if(kind==='movements'){
  const id=Number(query.item_id);if(!Number.isSafeInteger(id)||id<1)throw Error('اختر صنفًا');
  config={select:'m.*,w.name warehouse,i.number invoice_number',from:'stock_movements m JOIN warehouses w ON w.id=m.warehouse_id LEFT JOIN invoices i ON i.id=m.invoice_id',where:'m.item_id=? AND '+search(['m.reason','i.number','w.name']),params:[id,p.like,p.like,p.like],order:'m.id DESC',map:r=>({...r,qty:r.delta_micro/1000000})};
 }else throw Error('قائمة غير معروفة');
 return paged(db,config,query);
}
export function shiftList(db,user,query={}){
 const p=pageQuery(query),scoped=user.role==='staff',result=paged(db,{select:'s.*',from:'pos_shifts s',where:(scoped?'s.user_id=? AND ':'')+search(['CAST(s.id AS TEXT)']),params:[...(scoped?[user.id]:[]),p.like],order:'s.id DESC',map:s=>shiftSummary(db,s)},query);
 result.open=db.prepare('SELECT id FROM pos_shifts WHERE user_id=? AND closed_at IS NULL').all(user.id);return result;
}
export function complianceList(db,kind,query={}){
 const p=pageQuery(query);
 if(kind==='queue')return paged(db,{select:'q.*,i.number,i.invoice_kind,i.environment',from:'regulatory_queue q JOIN invoices i ON i.id=q.invoice_id',where:search(['i.number','q.state','q.last_error']),params:[p.like,p.like,p.like],order:'i.id DESC'},query);
 if(kind==='audit')return paged(db,{select:'a.id,a.actor_id,a.event,a.entity_type,a.entity_id,a.hash,a.created_at',from:'audit_events a',where:search(['a.event','a.entity_type','a.entity_id']),params:[p.like,p.like,p.like],order:'a.id DESC'},query);
 throw Error('قائمة غير معروفة');
}
export function posHistoryList(db,user,query={}){
 const p=pageQuery(query),scoped=user.role==='staff';
 return paged(db,{select:'i.id,i.number,i.total,i.type,i.document_code',from:'invoices i',where:"i.status='issued' AND i.type='388' AND i.document_code='388' AND "+(scoped?'i.created_by=? AND i.pos_id IN (SELECT pos_id FROM pos_user_access WHERE user_id=?) AND ':'')+search(['i.number']),params:[...(scoped?[user.id,user.id]:[]),p.like],order:'i.id DESC'},query);
}
