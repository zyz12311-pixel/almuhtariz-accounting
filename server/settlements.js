import crypto from 'node:crypto';
import {tx} from './db.js';import {postEntry} from './core.js';import {scaledInteger} from './money.js';import {appendAudit} from './audit.js';import {validDate} from './dates.js';import {paged,pageQuery} from './paging.js';
const id=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw Error('معرف غير صالح');return n;};
const safe=value=>{if(!Number.isSafeInteger(value))throw Error('المبلغ أكبر من الدقة المسموحة');return value;};
const cents=value=>Number(scaledInteger(value,2,'المبلغ'));
const centsText=value=>{const n=BigInt(value);return(n/100n)+'.'+String(n%100n).padStart(2,'0');};
const normal=(voucher,account)=>(account==='1201'&&voucher.kind==='receipt')||(account==='2101'&&voucher.kind==='payment');
function request(db,table,actor,body,extra={}){const uuid=String(body.request_id||'');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid))throw Error('معرف طلب UUID مطلوب');const hash=crypto.createHash('sha256').update(JSON.stringify({actor,body,...extra})).digest('hex'),old=db.prepare('SELECT * FROM '+table+' WHERE request_id=?').get(uuid);if(old&&old.request_hash!==hash)throw Error('معرف الطلب مستخدم ببيانات مختلفة');return{uuid,hash,old};}
export function partyBalance(db,partyId,account){
 id(partyId);if(!['1201','2101'].includes(account))throw Error('حساب الطرف غير صالح');
 const row=db.prepare(`SELECT COALESCE(SUM(l.debit-l.credit),0) balance FROM journal_lines l JOIN journal_entries e ON e.id=l.entry_id LEFT JOIN journal_party_links x ON x.line_id=l.id LEFT JOIN invoices i ON e.source_type='invoice' AND i.id=e.source_id WHERE l.account_code=? AND (x.party_id=? OR (x.party_id IS NULL AND i.party_id=? AND l.account_code='1201'))`).get(account,partyId,partyId);return safe(row.balance);
}
export function voucherDetails(db,voucherId){
 const voucher=db.prepare('SELECT v.*,c.party_account,c.party_snapshot,c.legacy_snapshot FROM cash_vouchers v JOIN voucher_context c ON c.voucher_id=v.id WHERE v.id=?').get(id(voucherId));if(!voucher)throw Error('السند غير موجود');
 const allocations=db.prepare("SELECT a.*,COALESCE(i.number,p.number) number FROM voucher_allocations a LEFT JOIN invoices i ON i.id=a.invoice_id LEFT JOIN purchases p ON p.id=a.purchase_id WHERE a.voucher_id=? ORDER BY a.rowid").all(voucher.id),allocated=safe(allocations.reduce((s,a)=>s+a.amount,0));
 return{...voucher,party:JSON.parse(voucher.party_snapshot),amount_cents:voucher.amount,amount:voucher.amount/100,allocated:allocated/100,unallocated_cents:voucher.amount-allocated,unallocated:(voucher.amount-allocated)/100,allocations:allocations.map(a=>({...a,amount:a.amount/100}))};
}
export function outstandingDocuments(db,partyId,account,query={}){
 id(partyId);if(!['1201','2101'].includes(account))throw Error('حساب الطرف غير صالح');const p=pageQuery(query),direction=query.direction==='refund'?-1:1;
 const result=paged(db,{select:'d.*',from:'settlement_documents d',where:"d.party_id=? AND d.party_account=? AND d.open_due*?>0 AND d.number LIKE ? ESCAPE '\\'",params:[Number(partyId),account,direction,p.like],order:'d.document_date,d.id',map:d=>({...d,total:d.total/100,net:d.net/100,open_due:d.open_due/100,available:direction*d.open_due/100})},query);
 result.party_balance=partyBalance(db,partyId,account)/100;return result;
}
export function allocateVoucher(db,actor,voucherId,body){return tx(db,()=>{
 const voucher=voucherDetails(db,voucherId),rec=request(db,'allocation_batches',actor,body,{voucher_id:voucher.id});if(rec.old)return{id:rec.old.id,replayed:true};
 if(!Array.isArray(body.allocations)||!body.allocations.length||body.allocations.length>1000)throw Error('حدد مستندات ومبالغ التخصيص');
 const seen=new Set(),lines=body.allocations.map(a=>{if(!['invoice','purchase'].includes(a.source))throw Error('نوع مستند غير صالح');const key=a.source+':'+id(a.id);if(seen.has(key))throw Error('اجمع تخصيص المستند في سطر واحد');seen.add(key);const amount=cents(a.amount);if(amount<=0)throw Error('مبلغ التخصيص يجب أن يكون موجبًا');return{source:a.source,id:Number(a.id),amount};});
 const amount=safe(lines.reduce((s,a)=>s+a.amount,0));if(amount>voucher.unallocated_cents)throw Error('التخصيص يتجاوز المتبقي من السند');
 const batch=Number(db.prepare('INSERT INTO allocation_batches(request_id,request_hash,voucher_id,created_by) VALUES(?,?,?,?)').run(rec.uuid,rec.hash,voucher.id,actor).lastInsertRowid);
 for(const line of lines)db.prepare('INSERT INTO voucher_allocations(voucher_id,invoice_id,purchase_id,amount,batch_id) VALUES(?,?,?,?,?)').run(voucher.id,line.source==='invoice'?line.id:null,line.source==='purchase'?line.id:null,line.amount,batch);
 appendAudit(db,{actor,event:'voucher.allocated',entity_type:'voucher',entity_id:voucher.id,details:{batch,documents:lines.length,amount}});return{id:batch,replayed:false};
});}
export function autoAllocateVoucher(db,actor,voucherId,requestId){
 const v=voucherDetails(db,voucherId),sign=normal(v,v.party_account)?1:-1,documents=db.prepare('SELECT source,id,open_due FROM settlement_documents WHERE party_id=? AND party_account=? AND open_due*?>0 ORDER BY document_date,id LIMIT 1000').all(v.party_id,v.party_account,sign);let remaining=v.amount_cents;const allocations=[];
 for(const d of documents){const amount=Math.min(remaining,safe(sign*d.open_due));if(amount>0){allocations.push({source:d.source,id:d.id,amount:centsText(amount)});remaining-=amount;}if(!remaining)break;}
 if(allocations.length)allocateVoucher(db,actor,voucherId,{request_id:requestId,allocations});
}
export function reverseManualJournal(db,actor,journalId,body){return tx(db,()=>{
 const original=db.prepare('SELECT * FROM journal_entries WHERE id=?').get(id(journalId));if(!original||original.source_type!=='manual')throw Error('العكس هنا للقيود اليدوية فقط');
 const rec=request(db,'journal_reversal_requests',actor,body,{journal_id:original.id});if(rec.old)return{id:rec.old.id,replayed:true};if(db.prepare('SELECT 1 FROM journal_reversals WHERE original_id=?').get(original.id))throw Error('القيد معكوس مسبقًا');
 const date=validDate(body.date),reason=String(body.reason||'').trim();if(date<original.entry_date||!reason||reason.length>500)throw Error('حدد تاريخًا لا يسبق القيد وسبب عكس صحيحًا');
 const lines=db.prepare('SELECT l.*,x.party_id FROM journal_lines l LEFT JOIN journal_party_links x ON x.line_id=l.id WHERE l.entry_id=? ORDER BY l.id').all(original.id).map(l=>({account:l.account_code,debit:l.credit,credit:l.debit,party_id:l.party_id}));
 const reversal=Number(postEntry(db,{date,description:'عكس القيد '+original.entry_no+' · '+reason,source_type:'manual_reversal',source_id:original.id,branch_id:original.branch_id,lines}));
 db.prepare('INSERT INTO journal_reversals(original_id,reversal_id) VALUES(?,?)').run(original.id,reversal);db.prepare('INSERT INTO journal_reversal_requests(request_id,request_hash,id) VALUES(?,?,?)').run(rec.uuid,rec.hash,reversal);
 appendAudit(db,{actor,event:'journal.reversed',entity_type:'journal',entity_id:original.id,details:{reversal,reason}});return{id:reversal,replayed:false};
});}
