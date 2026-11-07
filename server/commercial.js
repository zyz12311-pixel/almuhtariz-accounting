import {insertStockMovement,trackingInput,movementTracking,remainingTracking} from './tracking.js';
import crypto from 'node:crypto';
import {tx} from './db.js';
import {postEntry,nextCounter} from './core.js';
import {scaledInteger,roundRatio} from './money.js';
import {baseQuantity,balance} from './inventory.js';
import {appendAudit} from './audit.js';
import {valueMovement} from './valuation.js';
import {validDate} from './dates.js';
export {validDate} from './dates.js';
import {partyBalance,allocateVoucher,autoAllocateVoucher} from './settlements.js';
const identifier=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw Error('معرف غير صالح');return n;};
const money=value=>Number(scaledInteger(value,2,'المبلغ'));
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=(value,max,label,required=false)=>{const v=String(value??'').trim();if(v.length>max||(required&&!v))throw Error(label+' غير صالح');return v;};
function receipt(db,table,body,actor){const request=text(body.request_id,36,'معرف الطلب',true);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request))throw Error('معرف طلب UUID مطلوب');const hash=digest({body,actor});const old=db.prepare('SELECT id,request_hash FROM '+table+' WHERE request_id=?').get(request);if(old&&old.request_hash!==hash)throw Error('معرف الطلب مستخدم ببيانات مختلفة');return{request,hash,old};}
function party(db,value,kind){const row=db.prepare('SELECT * FROM parties WHERE id=?').get(identifier(value));if(!row||![kind,'both'].includes(row.kind))throw Error(kind==='supplier'?'اختر موردًا':'اختر عميلًا');return row;}
const addSafe=values=>{const n=values.reduce((s,x)=>s+BigInt(x),0n);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('إجمالي المستند أكبر من المسموح');return Number(n);};
export function createPurchase(db,actor,body){return tx(db,()=>{
 const rec=receipt(db,'purchases',body,actor);if(rec.old)return{id:rec.old.id,replayed:true};
 const supplier=party(db,body.supplier_id,'supplier'),date=validDate(body.document_date),warehouse=identifier(body.warehouse_id);
 if(!db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(warehouse))throw Error('اختر مستودعًا فعالًا');
 const payment=body.payment||'credit';if(!['cash','bank','credit'].includes(payment))throw Error('طريقة الدفع غير صالحة');
 const returning=body.kind==='return';if(body.kind&&!['purchase','return'].includes(body.kind))throw Error('نوع المستند غير صالح');
 const original=returning?db.prepare("SELECT * FROM purchases WHERE id=? AND kind='purchase'").get(identifier(body.ref_purchase_id)):null;
 if(returning&&(!original||original.supplier_id!==supplier.id||original.warehouse_id!==warehouse||original.payment!==payment))throw Error('المرتجع يجب أن يرتبط بالمورد والمستودع وطريقة الدفع الأصلية');
 const reason=text(body.reason,500,'سبب المرتجع',returning),reference=text(body.supplier_reference,100,'مرجع فاتورة المورد',true),notes=text(body.notes,1000,'الملاحظات');
 if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>200)throw Error('اختر من 1 إلى 200 بند');
 const seen=new Set();
 const lines=body.lines.map((input,index)=>{
  const qty=Number(scaledInteger(input.qty,6,'الكمية'));if(!qty)throw Error('الكمية يجب أن تكون أكبر من صفر');
  if(returning){
   const old=db.prepare('SELECT * FROM purchase_lines WHERE purchase_id=? AND line_no=?').get(original.id,identifier(input.line_no));
   if(!old||seen.has(old.line_no))throw Error('بند المرتجع غير صالح أو مكرر');seen.add(old.line_no);
   const returned=db.prepare("SELECT COALESCE(SUM(l.qty_micro),0) qty,COALESCE(SUM(l.net),0) net,COALESCE(SUM(l.vat),0) vat FROM purchase_lines l JOIN purchases p ON p.id=l.purchase_id WHERE p.ref_purchase_id=? AND p.kind='return' AND l.line_no=?").get(original.id,old.line_no);
   if(qty>old.qty_micro-returned.qty)throw Error('كمية المرتجع أكبر من المتبقي');
   // Final return consumes the exact remaining pennies, avoiding rounding drift.
   const last=qty===old.qty_micro-returned.qty;
   const net=last?old.net-returned.net:roundRatio(BigInt(old.net)*BigInt(qty),BigInt(old.qty_micro));
   const vat=last?old.vat-returned.vat:roundRatio(BigInt(old.vat)*BigInt(qty),BigInt(old.qty_micro));
   if(net>old.net-returned.net||vat>old.vat-returned.vat)throw Error('قيمة المرتجع أكبر من المتبقي');
   const stock=old.stock_qty_micro?baseQuantity(input.qty,old.unit_factor_micro):0;
   return{...old,tracking:trackingInput(input.tracking),qty_micro:qty,stock_qty_micro:stock,net,vat};
  }
  const item=input.item_id?db.prepare('SELECT * FROM items WHERE id=? AND active=1').get(identifier(input.item_id)):null;
  if(input.item_id&&!item)throw Error('الصنف غير موجود أو موقوف');
  const unit=input.item_unit_id?db.prepare('SELECT * FROM item_units WHERE id=? AND item_id=? AND active=1').get(identifier(input.item_unit_id),item?.id||0):null;
  if(input.item_unit_id&&!unit)throw Error('الوحدة غير صالحة');
  if(item?.track_stock&&seen.has(item.id))throw Error('اجمع الصنف المخزني في بند واحد');if(item?.track_stock)seen.add(item.id);
  const factor=unit?.factor_micro||1000000,stock=item?.track_stock?baseQuantity(input.qty,factor):0;
  const account=stock?'1401':String(input.account_code||'5299');
  if(!db.prepare("SELECT 1 FROM accounts WHERE code=? AND postable=1 AND type='expense'").get(account)&&!stock)throw Error('اختر حساب مصروف صالحًا للبند غير المخزني');
  const price=money(input.unit_price),rate=Number(scaledInteger(input.vat_rate??15,2,'نسبة الضريبة'));
  if(![0,1500].includes(rate))throw Error('نسبة ضريبة الشراء المدعومة 0 أو 15');
  const net=roundRatio(BigInt(qty)*BigInt(price),1000000n),vat=roundRatio(BigInt(net)*BigInt(rate),10000n);
  if(!Number.isSafeInteger(net)||!Number.isSafeInteger(vat)||!Number.isSafeInteger(net+vat))throw Error('قيمة البند أكبر من المسموح');
  return{line_no:index+1,tracking:trackingInput(input.tracking),item_id:item?.id||null,description:text(input.description||item?.name_ar,500,'الوصف',true),qty_micro:qty,unit_price:price,vat_rate:rate,net,vat,unit_name:unit?.name||item?.base_unit||'خدمة',unit_factor_micro:factor,stock_qty_micro:stock,account_code:account};
 });
 const subtotal=addSafe(lines.map(l=>l.net)),vat=addSafe(lines.map(l=>l.vat)),total=addSafe([subtotal,vat]);if(!total)throw Error('قيمة الشراء يجب أن تكون أكبر من صفر');
 const number=(returning?'PR-':'PU-')+String(nextCounter(db,'purchase')).padStart(6,'0');
 const id=Number(db.prepare('INSERT INTO purchases(uuid,number,kind,supplier_id,supplier_reference,document_date,warehouse_id,payment,ref_purchase_id,subtotal,vat,total,reason,notes,created_by,request_id,request_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),number,returning?'return':'purchase',supplier.id,reference,date,warehouse,payment,original?.id||null,subtotal,vat,total,reason,notes,actor,rec.request,rec.hash).lastInsertRowid);
 db.prepare('INSERT INTO purchase_snapshots(purchase_id,supplier) VALUES(?,?)').run(id,JSON.stringify(supplier));
 for(const l of lines){db.prepare('INSERT INTO purchase_lines(purchase_id,line_no,item_id,description,qty_micro,unit_price,vat_rate,net,vat,unit_name,unit_factor_micro,stock_qty_micro,account_code,tracking_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,l.line_no,l.item_id,l.description,l.qty_micro,l.unit_price,l.vat_rate,l.net,l.vat,l.unit_name,l.unit_factor_micro,l.stock_qty_micro,l.account_code,JSON.stringify(l.tracking||[]));
  if(l.stock_qty_micro){const originalMovement=returning?db.prepare('SELECT id FROM stock_movements WHERE purchase_id=? AND line_no=?').get(original.id,l.line_no):null;const movement=insertStockMovement(db,{event_id:'purchase:'+id+':'+l.line_no,request_hash:rec.hash,item_id:l.item_id,warehouse_id:warehouse,delta_micro:(returning?-1:1)*l.stock_qty_micro,kind:returning?'issue':'receipt',purchase_id:id,line_no:l.line_no,reason:number,actor_id:actor},{tracking:l.tracking,originalMovementId:originalMovement?.id||null});l.stock_value=valueMovement(db,movement,{value:l.net}).value;}
 }
 const settlement={cash:'1101',bank:'1102',credit:'2101'}[payment],entries=lines.filter(l=>l.net||l.stock_value).map(l=>({account:l.account_code,[returning?'credit':'debit']:returning&&l.stock_qty_micro?l.stock_value:l.net}));
 if(returning){const difference=lines.filter(l=>l.stock_qty_micro).reduce((s,l)=>s+l.net-l.stock_value,0);if(difference)entries.push({account:'5298',[difference>0?'credit':'debit']:Math.abs(difference)});}
 if(vat)entries.push({account:'1301',[returning?'credit':'debit']:vat});
 entries.push({account:settlement,[returning?'debit':'credit']:total,...(payment==='credit'?{party_id:supplier.id}:{})});
 postEntry(db,{date,description:(returning?'مرتجع شراء ':'شراء ')+number,source_type:'purchase',source_id:id,branch_id:1,lines:entries});
 appendAudit(db,{actor,event:returning?'purchase.returned':'purchase.posted',entity_type:'purchase',entity_id:id,details:{number,total}});
 return{id,replayed:false};
});}
export function listPurchases(db){return db.prepare('SELECT p.*,s.name_ar supplier FROM purchases p JOIN parties s ON s.id=p.supplier_id ORDER BY p.id DESC').all().map(p=>({...p,subtotal:p.subtotal/100,vat:p.vat/100,total:p.total/100}));}
export function purchaseDetails(db,id){const p=db.prepare('SELECT p.*,s.name_ar supplier FROM purchases p JOIN parties s ON s.id=p.supplier_id WHERE p.id=?').get(identifier(id));if(!p)throw Error('مستند الشراء غير موجود');return{...p,subtotal:p.subtotal/100,vat:p.vat/100,total:p.total/100,lines:db.prepare('SELECT * FROM purchase_lines WHERE purchase_id=? ORDER BY line_no').all(p.id).map(l=>({...l,tracking_mode:l.item_id?db.prepare('SELECT tracking_mode FROM items WHERE id=?').get(l.item_id)?.tracking_mode||'none':'none',tracking:(()=>{const m=db.prepare('SELECT id FROM stock_movements WHERE purchase_id=? AND line_no=?').get(p.id,l.line_no);return m?movementTracking(db,m.id):[];})(),tracking_remaining:(()=>{const m=db.prepare('SELECT id FROM stock_movements WHERE purchase_id=? AND line_no=?').get(p.id,l.line_no);return m?remainingTracking(db,m.id):[];})(),qty:l.qty_micro/1000000,unit_price:l.unit_price/100,vat_rate:l.vat_rate/100,net:l.net/100,vat:l.vat/100,remaining_qty:(l.qty_micro-db.prepare("SELECT COALESCE(SUM(l.qty_micro),0) n FROM purchase_lines l JOIN purchases r ON r.id=l.purchase_id WHERE r.kind='return' AND r.ref_purchase_id=? AND l.line_no=?").get(p.id,l.line_no).n)/1000000}))};}
export function partyLedger(db,id){
 identifier(id);return db.prepare(`SELECT e.entry_date,e.entry_no,e.description,l.account_code,l.debit,l.credit FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id LEFT JOIN journal_party_links x ON x.line_id=l.id LEFT JOIN invoices i ON e.source_type='invoice' AND i.id=e.source_id WHERE x.party_id=? OR (x.party_id IS NULL AND i.party_id=? AND l.account_code='1201') ORDER BY e.entry_date,e.id,l.id`).all(id,id).map(l=>({...l,debit:l.debit/100,credit:l.credit/100}));
}
export function createVoucher(db,actor,body){return tx(db,()=>{
 const rec=receipt(db,'cash_vouchers',body,actor);if(rec.old)return{id:rec.old.id,replayed:true};
 const receiving=body.kind==='receipt';if(!['receipt','payment'].includes(body.kind))throw Error('نوع السند غير صالح');
 const control=body.party_account||(receiving?'1201':'2101');if(!['1201','2101'].includes(control))throw Error('حساب الطرف غير صالح');
 const person=party(db,body.party_id,control==='1201'?'customer':'supplier'),date=validDate(body.voucher_date),amount=money(body.amount),cash=body.cash_account;
 if(!amount||!['1101','1102'].includes(cash))throw Error('المبلغ أو حساب الصندوق غير صالح');
 const due=(receiving?1:-1)*partyBalance(db,person.id,control);
 if(amount>due)throw Error('السند يتجاوز الرصيد المستحق للطرف');
 const number=(receiving?'RC-':'PY-')+String(nextCounter(db,'voucher')).padStart(6,'0'),notes=text(body.notes,500,'البيان',true);
 const journal=postEntry(db,{date,description:number+' '+notes,source_type:'voucher',branch_id:1,lines:[{account:cash,[receiving?'debit':'credit']:amount},{account:control,party_id:person.id,[receiving?'credit':'debit']:amount}]});
 const id=Number(db.prepare('INSERT INTO cash_vouchers(number,kind,party_id,voucher_date,amount,cash_account,notes,created_by,request_id,request_hash,journal_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(number,body.kind,person.id,date,amount,cash,notes,actor,rec.request,rec.hash,journal).lastInsertRowid);
 db.prepare('INSERT INTO voucher_context(voucher_id,party_account,party_snapshot) VALUES(?,?,?)').run(id,control,JSON.stringify(person));
 if(body.allocations===undefined)autoAllocateVoucher(db,actor,id,rec.request);else if(!Array.isArray(body.allocations)||body.allocations.length)allocateVoucher(db,actor,id,{request_id:rec.request,allocations:body.allocations});
 appendAudit(db,{actor,event:'voucher.posted',entity_type:'voucher',entity_id:id,details:{number,amount}});return{id,replayed:false};
});}
export function postManualJournal(db,actor,body){return tx(db,()=>{
 const rec=receipt(db,'manual_journal_requests',body,actor);if(rec.old)return{id:rec.old.id,replayed:true};
 const date=validDate(body.date),description=text(body.description,500,'بيان القيد',true);
 if(!Array.isArray(body.lines)||body.lines.length<2||body.lines.length>100)throw Error('القيد يحتاج من 2 إلى 100 سطر');
 const lines=body.lines.map(l=>{const account=String(l.account),debit=money(l.debit||0),credit=money(l.credit||0);if(account==='1401')throw Error('استخدم مستند المخزون لتعديل حساب المخزون والمحافظة على المطابقة');if((debit&&credit)||(!debit&&!credit))throw Error('اختر مدينًا أو دائنًا لكل سطر');const control=['1201','2101'].includes(account);if(control&&!l.party_id)throw Error('حساب العميل أو المورد يحتاج تحديد الطرف');if(l.party_id)party(db,l.party_id,account==='2101'?'supplier':'customer');return{account,debit,credit,party_id:control?identifier(l.party_id):null};});
 const id=postEntry(db,{date,description,source_type:'manual',branch_id:1,lines});db.prepare('INSERT INTO manual_journal_requests(request_id,request_hash,id) VALUES(?,?,?)').run(rec.request,rec.hash,id);appendAudit(db,{actor,event:'journal.manual',entity_type:'journal',entity_id:id,details:{description}});return{id,replayed:false};
});}
export function financialReport(db,from,to){
 validDate(from);validDate(to);if(from>to)throw Error('بداية الفترة تتجاوز نهايتها');
 const rows=db.prepare(FINANCIAL_SQL).all(from,from,from,to);
 for(const r of rows)if(![r.opening,r.debit,r.credit,r.opening+r.debit-r.credit].every(Number.isSafeInteger))throw Error('إجمالي التقرير أكبر من الدقة المسموحة');
 const revenue=rows.filter(r=>r.type==='revenue').reduce((s,r)=>s+r.credit-r.debit,0),expenses=rows.filter(r=>r.type==='expense').reduce((s,r)=>s+r.debit-r.credit,0);
 const incomplete=Boolean(db.prepare('SELECT 1 FROM stock_values WHERE costed=0 LIMIT 1').get());
 return{from,to,rows:rows.map(r=>({...r,opening:r.opening/100,debit:r.debit/100,credit:r.credit/100,closing:(r.opening+r.debit-r.credit)/100})),revenue:revenue/100,expenses:expenses/100,profit:(revenue-expenses)/100,costing_complete:!incomplete};
}

export const FINANCIAL_SQL=`WITH totals AS (SELECT l.account_code,SUM(CASE WHEN e.entry_date<? THEN l.debit-l.credit ELSE 0 END) opening,SUM(CASE WHEN e.entry_date>=? THEN l.debit ELSE 0 END) debit,SUM(CASE WHEN e.entry_date>=? THEN l.credit ELSE 0 END) credit FROM journal_entries e INDEXED BY journal_entries_by_date CROSS JOIN journal_lines l INDEXED BY journal_lines_by_entry ON l.entry_id=e.id WHERE e.entry_date<=? GROUP BY l.account_code) SELECT a.code,a.name_ar,a.type,COALESCE(t.opening,0) opening,COALESCE(t.debit,0) debit,COALESCE(t.credit,0) credit FROM accounts a LEFT JOIN totals t ON t.account_code=a.code ORDER BY a.code`;
