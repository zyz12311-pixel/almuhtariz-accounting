import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createApp} from '../server/index.js';
import {openDb} from '../server/db.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'almuhtariz-due-')),file=path.join(dir,'due.db');
const {server,db}=createApp({dbFile:file,licensePath:path.join(dir,'license.json')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const call=async(method,p,body,cookie,headers={})=>{const r=await fetch(base+p,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {st:r.status,j,r};};
try{
 await call('POST','/api/setup',{username:'owner',password:'password123',company_name:'متجر',activity:'trade'});
 const login=await call('POST','/api/login',{username:'owner',password:'password123',portal:'owner'});
 const owner=login.r.headers.get('set-cookie').split(';')[0];
 await call('PUT','/api/settings/company',{name_ar:'متجر',vat_number:'300000000000003',cr_number:'1234567890',street:'شارع',building_number:'1234',district:'حي',city:'الرياض',postal_code:'12345',country_code:'SA'},owner);
 // party and item
 const party=(await call('POST','/api/parties',{name_ar:'عميل آجِل',kind:'customer'},owner)).j.id;
 const supplier=(await call('POST','/api/parties',{name_ar:'مورد آجِل',kind:'supplier'},owner)).j.id;
 const item=(await call('POST','/api/items',{name_ar:'خدمة',unit_price:'100.00',vat_rate:15,track_stock:false},owner)).j.id;
 // Phase 1: invoice with payment terms
 const inv=(await call('POST','/api/invoices',{party_id:party,pos_id:1,payment:'credit',payment_terms_days:30,due_date:'2026-12-31',lines:[{description:'خدمة',qty:1,unit_price:100,vat_rate:15}]},owner)).j.id;
 const invDoc=(await call('GET','/api/invoices/'+inv,null,owner)).j;
 assert.equal(invDoc.due_date,'2026-12-31');
 assert.equal(invDoc.payment_terms_days,30);
 // invoice with terms only, due calculated on issue
 const inv2=(await call('POST','/api/invoices',{party_id:party,pos_id:1,payment:'credit',payment_terms_days:10,lines:[{description:'خدمة',qty:1,unit_price:100,vat_rate:15}]},owner)).j.id;
 const inv2Doc=(await call('GET','/api/invoices/'+inv2,null,owner)).j;
 assert.ok(inv2Doc.due_date);
 assert.equal(inv2Doc.payment_terms_days,10);
 // due date before issue/supply date rejected
 const bad=(await call('POST','/api/invoices',{party_id:party,pos_id:1,payment:'credit',supply_date:'2026-11-25',due_date:'2026-11-20',lines:[{description:'خدمة',qty:1,unit_price:100,vat_rate:15}]},owner));
 assert.equal(bad.st,400);
 // purchase due date
 const pur=(await call('POST','/api/purchases',{request_id:crypto.randomUUID(),supplier_id:supplier,supplier_reference:'SUP-1',document_date:'2026-11-01',payment_terms_days:45,payment:'credit',warehouse_id:1,lines:[{description:'مشتريات',qty:1,unit_price:100,vat_rate:15,account_code:'5101'}]},owner)).j.id;
 const purDoc=(await call('GET','/api/purchases/'+pur,null,owner)).j;
 assert.equal(purDoc.due_date,'2026-12-16');
 assert.equal(purDoc.payment_terms_days,45);
 const badPur=(await call('POST','/api/purchases',{request_id:crypto.randomUUID(),supplier_id:supplier,supplier_reference:'SUP-2',document_date:'2026-11-10',due_date:'2026-11-01',payment:'credit',warehouse_id:1,lines:[{description:'مشتريات',qty:1,unit_price:100,vat_rate:15,account_code:'5101'}]},owner));
 assert.equal(badPur.st,400);
 // Phase 2: aging report - historical as-of, required buckets, not-due separation, no invented due dates
 const aging=(await call('GET','/api/reports/aging?as_of=2027-01-15&kind=customer',null,owner)).j;
 assert.equal(aging.kind,'customer');
 assert.deepEqual(aging.buckets,['not_due','d0_30','d31_60','d61_90','d91_120','d121_150','d150_plus']);
 assert.ok(Array.isArray(aging.parties));
 const pRow=aging.parties.find(p=>p.party_id===party);
 assert.ok(pRow);
 // inv1 due 2026-12-31, inv2 due issue+10 (issue today in test env) - both overdue by 2027-01-15 depending on issue date.
 // Calculate expected bucket for inv2 from actual due date
 const inv2Due=inv2Doc.due_date;
 const days2=Math.floor((Date.parse('2027-01-15T00:00:00Z')-Date.parse(inv2Due+'T00:00:00Z'))/86400000);
 const bucketFor=days=>days<=0?'not_due':days<=30?'d0_30':days<=60?'d31_60':days<=90?'d61_90':days<=120?'d91_120':days<=150?'d121_150':'d150_plus';
 const b1=bucketFor(Math.floor((Date.parse('2027-01-15T00:00:00Z')-Date.parse('2026-12-31T00:00:00Z'))/86400000));
 const b2=bucketFor(days2);
 const expected={not_due:0,d0_30:0,d31_60:0,d61_90:0,d91_120:0,d121_150:0,d150_plus:0};
 expected[b1]+=115; expected[b2]+=115;
 for(const k of Object.keys(expected)) assert.equal(pRow[k],expected[k],k);
 assert.equal(pRow.total,230);
 // historical settlement: pay inv1 on a valid date; as-of before payment includes it, on/after excludes it
 const payDate=invDoc.issue_date; // valid non-future date
 const pay=(await call('POST','/api/vouchers',{request_id:crypto.randomUUID(),kind:'receipt',account_code:'1201',party_id:party,amount:115,cash_account:'1101',notes:'test',voucher_date:payDate,allocations:[]},owner)).j.id;
 const allocRes=await call('POST','/api/vouchers/'+pay+'/allocations',{request_id:crypto.randomUUID(),allocations:[{source:'invoice',id:inv,amount:115}]},owner);
 assert.equal(allocRes.st,200);
 const agingAfterPay=(await call('GET','/api/reports/aging?as_of=2027-01-15&kind=customer',null,owner)).j;
 const pAfter=agingAfterPay.parties.find(p=>p.party_id===party);
 assert.equal(pAfter.total,115);
 // before issue/payment date, docs not yet issued in as-of view
 const dayBefore=d=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()-1);return x.toISOString().slice(0,10);};
 const beforeIssue=dayBefore(invDoc.issue_date);
 const agingBeforeIssue=(await call('GET','/api/reports/aging?as_of='+beforeIssue+'&kind=customer',null,owner)).j;
 const pBeforeIssue=agingBeforeIssue.parties.find(p=>p.party_id===party);
 assert.equal(pBeforeIssue?.total||0,0);
 // not-yet-due separation: inv3 due in future relative to as_of
 const inv3=(await call('POST','/api/invoices',{party_id:party,pos_id:1,payment:'credit',due_date:'2027-02-01',lines:[{description:'خدمة',qty:1,unit_price:100,vat_rate:15}]},owner)).j.id;
 const agingNotDue=(await call('GET','/api/reports/aging?as_of=2027-01-15&kind=customer',null,owner)).j;
 const pNotDue=agingNotDue.parties.find(p=>p.party_id===party);
 assert.ok(pNotDue.not_due>=115);
 const inv3Doc=agingNotDue.parties.flatMap(p=>p.documents).find(d=>d.id===inv3);
 assert.equal(inv3Doc.bucket,'not_due');
 // supplier aging
 const agingSup=(await call('GET','/api/reports/aging?as_of=2027-01-15&kind=supplier',null,owner)).j;
 const sRow=agingSup.parties.find(p=>p.party_id===supplier);
 assert.ok(sRow);
 const sDays=Math.floor((Date.parse('2027-01-15T00:00:00Z')-Date.parse(purDoc.due_date+'T00:00:00Z'))/86400000);
 assert.equal(sRow[bucketFor(sDays)],115);


  // no invented due date: legacy/null due_date must remain not_due (never overdue)
 db.exec('DROP TRIGGER IF EXISTS inv_nu');
 db.prepare("UPDATE invoices SET due_date=NULL, payment_terms_days=0 WHERE id=?").run(inv3);
 db.exec("CREATE TRIGGER inv_nu BEFORE UPDATE ON invoices WHEN OLD.status='issued' BEGIN SELECT RAISE(ABORT,'الفاتورة الصادرة غير قابلة للتعديل: أصدر إشعارًا دائنًا'); END");
 const agingNoDue=(await call('GET','/api/reports/aging?as_of=2028-01-15&kind=customer',null,owner)).j;
 const noDueDoc=agingNoDue.parties.flatMap(p=>p.documents).find(d=>d.id===inv3);
 assert.equal(noDueDoc.due_date,null);
 assert.equal(noDueDoc.bucket,'not_due');
 assert.equal(noDueDoc.days_past_due,null);

// accounting parity: sum of aging rows equals party totals
 const agingAll=(await call('GET','/api/reports/aging?as_of=2027-01-15&kind=customer',null,owner)).j;
 for(const p of agingAll.parties){ const sum=+p.documents.reduce((x,d)=>x+d.open_due,0).toFixed(2); assert.equal(+p.total.toFixed(2),sum); }
 const totalAging=+agingAll.parties.reduce((s,p)=>s+p.total,0).toFixed(2);
 const sumDocs=+agingAll.parties.flatMap(p=>p.documents).reduce((s,d)=>s+d.open_due,0).toFixed(2);
 assert.equal(totalAging,sumDocs);

 // partial settlement and historical as-of boundary
 const inv4=(await call('POST','/api/invoices',{party_id:party,pos_id:1,payment:'credit',due_date:'2027-03-01',lines:[{description:'خدمة',qty:1,unit_price:100,vat_rate:15}]},owner)).j.id;
 const pay2Date=invDoc.issue_date;
 const v2=(await call('POST','/api/vouchers',{request_id:crypto.randomUUID(),kind:'receipt',account_code:'1201',party_id:party,amount:50,cash_account:'1101',notes:'partial',voucher_date:pay2Date,allocations:[]},owner)).j.id;
 const al2=await call('POST','/api/vouchers/'+v2+'/allocations',{request_id:crypto.randomUUID(),allocations:[{source:'invoice',id:inv4,amount:50}]},owner);
 assert.equal(al2.st,200);
 const agingPartial=(await call('GET','/api/reports/aging?as_of=2027-03-10&kind=customer',null,owner)).j;
 const inv4Doc=agingPartial.parties.flatMap(p=>p.documents).find(d=>d.id===inv4);
 assert.equal(inv4Doc.open_due,65);
 const beforeV2=dayBefore(pay2Date);
 const agingBeforeV2=(await call('GET','/api/reports/aging?as_of='+beforeV2+'&kind=customer',null,owner)).j;
 const inv4Before=agingBeforeV2.parties.flatMap(p=>p.documents).find(d=>d.id===inv4);
 assert.equal(inv4Before, undefined); // before issue date, document not yet in as-of scope
 assert.equal(inv4Doc.bucket,'d0_30');

 console.log('PASS: due dates and aging');
} finally { server.close(); db.close(); }
