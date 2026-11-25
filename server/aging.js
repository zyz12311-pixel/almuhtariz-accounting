import {validDate} from './dates.js';
const safe=n=>{if(!Number.isSafeInteger(n))throw Error('مبلغ الذمم أكبر من الدقة المسموحة');return n;};
const BUCKETS=['not_due','d0_30','d31_60','d61_90','d91_120','d121_150','d150_plus'];
function bucket(daysPastDue,hasDue){
 if(!hasDue) return 'not_due';
 if(daysPastDue<=0) return 'not_due';
 if(daysPastDue<=30) return 'd0_30';
 if(daysPastDue<=60) return 'd31_60';
 if(daysPastDue<=90) return 'd61_90';
 if(daysPastDue<=120) return 'd91_120';
 if(daysPastDue<=150) return 'd121_150';
 return 'd150_plus';
}
function emptyParty(row){
 return {party_id:row.party_id,party_name:row.party_name,not_due:0,d0_30:0,d31_60:0,d61_90:0,d91_120:0,d121_150:0,d150_plus:0,total:0,documents:[]};
}
export function agingReport(db,asOf,kind='customer'){
 const date=validDate(asOf,{allowFuture:true});
 const account=kind==='supplier'?'2101':'1201';
 const partyKind=kind==='supplier'?'supplier':'customer';
 const rows=partyKind==='customer'
  ? db.prepare(`
    SELECT 'invoice' source,i.id,i.number,i.issue_date document_date,i.due_date,i.party_id,p.name_ar party_name,i.total,
     i.total
     -COALESCE((SELECT SUM(r.total) FROM invoices r WHERE r.ref_invoice_id=i.id AND r.type='381' AND r.status='issued' AND r.issue_date<=@asOf),0)
     -COALESCE((SELECT SUM(CASE v.kind WHEN 'receipt' THEN a.amount ELSE -a.amount END) FROM voucher_allocations a JOIN cash_vouchers v ON v.id=a.voucher_id WHERE a.invoice_id=i.id AND v.voucher_date<=@asOf),0) open_due
    FROM invoices i JOIN parties p ON p.id=i.party_id
    WHERE i.status='issued' AND i.type='388' AND i.payment='credit' AND i.issue_date<=@asOf
  `).all({asOf:date})
  : db.prepare(`
    SELECT 'purchase' source,pu.id,pu.number,pu.document_date,pu.due_date,pu.supplier_id party_id,p.name_ar party_name,pu.total,
     pu.total
     -COALESCE((SELECT SUM(r.total) FROM purchases r WHERE r.ref_purchase_id=pu.id AND r.kind='return' AND r.document_date<=@asOf),0)
     -COALESCE((SELECT SUM(CASE v.kind WHEN 'payment' THEN a.amount ELSE -a.amount END) FROM voucher_allocations a JOIN cash_vouchers v ON v.id=a.voucher_id WHERE a.purchase_id=pu.id AND v.voucher_date<=@asOf),0) open_due
    FROM purchases pu JOIN parties p ON p.id=pu.supplier_id
    WHERE pu.kind='purchase' AND pu.payment='credit' AND pu.document_date<=@asOf
  `).all({asOf:date});
 const byParty=new Map();
 for(const r of rows){
  const open=safe(Number(r.open_due));
  if(open===0) continue;
  const due=r.due_date;
  const daysPastDue=due?Math.floor((Date.parse(date+'T00:00:00Z')-Date.parse(due+'T00:00:00Z'))/86400000):null;
  const b=bucket(daysPastDue,!!due);
  let p=byParty.get(r.party_id);
  if(!p){p=emptyParty(r);byParty.set(r.party_id,p);}
  p[b]+=open; p.total+=open;
  p.documents.push({id:r.id,source:r.source,number:r.number,document_date:r.document_date,due_date:r.due_date,days_past_due:due?Math.max(0,daysPastDue):null,open_due:open/100,bucket:b});
 }
 const parties=[...byParty.values()].map(p=>{const out={...p}; for(const k of BUCKETS) out[k]=p[k]/100; out.total=p.total/100; out.documents.sort((a,b)=>String(a.document_date).localeCompare(b.document_date)||a.id-b.id); return out;}).sort((a,b)=>a.party_name.localeCompare(b.party_name,'ar')||a.party_id-b.party_id);
 const totals=parties.reduce((a,p)=>{for(const k of BUCKETS)a[k]=+(a[k]+p[k]).toFixed(2); a.total=+(a.total+p.total).toFixed(2); return a;},{not_due:0,d0_30:0,d31_60:0,d61_90:0,d91_120:0,d121_150:0,d150_plus:0,total:0});
 return {as_of:date,kind:partyKind,account,buckets:BUCKETS,totals,parties};
}
