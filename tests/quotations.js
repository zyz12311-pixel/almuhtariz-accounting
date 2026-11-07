import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {openDb} from '../server/db.js';import {seedCompany,setSetting,getInvoice,issueInvoice,createCreditNote} from '../server/core.js';import {createQuotation,convertQuotation,quotation,cancelQuotation} from '../server/quotations.js';import {saveItem} from '../server/items.js';import {balance} from '../server/inventory.js';import {nowRiyadh} from '../server/lib.js';import {renderInvoice} from '../server/render.js';import {commercialPrint} from '../server/commercial-print.js';import {calculateLines,taxBreakdown} from '../server/money.js';import {createPosSale} from '../server/pos.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'muhtariz-quotes-')),db=openDb(path.join(dir,'db')),key=()=>crypto.randomUUID(),today=nowRiyadh().date;
try{
 db.exec("INSERT INTO users(id,username,pass,role) VALUES(1,'fixture','fixture','owner');INSERT INTO parties(id,name_ar,kind) VALUES(1,'عميل اختبار','customer')");seedCompany(db,'تجربة عروض');
 setSetting(db,'company',{name_ar:'تجربة عروض',vat_number:'300000000000003',cr_number:'1010010000',street:'الشارع',building_number:'1234',district:'الحي',city:'الرياض',postal_code:'12345',country_code:'SA'});
 const item=saveItem(db,{name_ar:'صنف',unit_price:100,track_stock:true,opening_qty:20,opening_unit_cost:20,units:[{name:'علبة',factor:2,unit_price:200}]},null,1).id;
 const body={request_id:key(),pos_id:1,party_id:1,document_date:today,valid_until:today,notes:'شروط <آمنة>',lines:[{item_id:item,description:'صنف <خاص>',qty:2,unit_price:100,discount_rate:10,vat_rate:15}]};
 const before=db.prepare('SELECT COUNT(*) n FROM journal_entries').get().n,q=createQuotation(db,1,body);assert.equal(quotation(db,q.id).total,20700);assert.equal(balance(db,item,1),20000000);assert.equal(db.prepare('SELECT COUNT(*) n FROM journal_entries').get().n,before);
 assert.equal(createQuotation(db,1,body).id,q.id);assert.throws(()=>createQuotation(db,1,{...body,notes:'تغيير'}),/أخرى/);
 const draft=convertQuotation(db,1,q.id,{payment:'credit'});assert.equal(getInvoice(db,draft.id).status,'draft');assert.equal(getInvoice(db,draft.id).payment,'credit');assert.equal(balance(db,item,1),20000000);assert.equal(convertQuotation(db,1,q.id).id,draft.id);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,1);assert.throws(()=>cancelQuotation(db,1,q.id),/محول/);
 issueInvoice(db,draft.id);const inv=getInvoice(db,draft.id);assert.equal(inv.subtotal,18000);assert.equal(inv.vat,2700);assert.equal(inv.lines[0].unit_price,9000);assert.equal(inv.lines[0].list_price,10000);assert.equal(inv.lines[0].discount_rate,1000);assert.equal(balance(db,item,1),18000000);
 const html=renderInvoice({inv,company:inv.company_snapshot,s:{}});assert.ok(html.includes('خصم 10%'));assert.ok(html.includes('&lt;خاص&gt;'));assert.ok(!html.includes('صنف <خاص>'));
 const credit=createCreditNote(db,1,draft.id,{reason:'رد جزء',lines:[{line_no:1,qty:1}]});assert.equal(getInvoice(db,credit).subtotal,9000);assert.equal(balance(db,item,1),19000000);
 const xml=db.prepare("SELECT content FROM invoice_documents WHERE invoice_id=? AND kind='xml_candidate'").get(draft.id).content;assert.ok(xml.includes('<cbc:PriceAmount currencyID="SAR">90.00</cbc:PriceAmount>'));assert.ok(xml.includes('<cbc:LineExtensionAmount currencyID="SAR">180.00</cbc:LineExtensionAmount>'));
 const cancelled=createQuotation(db,1,{...body,request_id:key()});cancelQuotation(db,1,cancelled.id);assert.throws(()=>convertQuotation(db,1,cancelled.id),/ملغى/);
 const yesterday=new Date(today+'T12:00:00Z');yesterday.setUTCDate(yesterday.getUTCDate()-1);const old=yesterday.toISOString().slice(0,10),expired=createQuotation(db,1,{...body,request_id:key(),document_date:old,valid_until:old});assert.throws(()=>convertQuotation(db,1,expired.id),/انتهت/);
 const unit=db.prepare('SELECT * FROM item_units WHERE item_id=?').get(item),converted=createQuotation(db,1,{...body,request_id:key(),lines:[{...body.lines[0],item_unit_id:unit.id}]});
 db.prepare('UPDATE item_units SET factor_micro=3000000 WHERE id=?').run(unit.id);assert.throws(()=>convertQuotation(db,1,converted.id),/تحويل وحدة/);
 assert.throws(()=>db.prepare("UPDATE quotations SET status='cancelled',valid_until='2099-01-01' WHERE id=?").run(converted.id),/ثابت/);
 assert.throws(()=>createQuotation(db,1,{...body,request_id:key(),valid_until:'2026-02-30'}),/صلاحية/);
 assert.throws(()=>calculateLines([{...body.lines[0],discount_rate:100.01}]),/الخصم/);
 assert.equal(calculateLines([{...body.lines[0],qty:1,unit_price:'0.05',discount_rate:50}])[0].unit_price,3);
 assert.throws(()=>taxBreakdown([{tax_category:'S',vat_rate:15,net:Number.MAX_SAFE_INTEGER},{tax_category:'S',vat_rate:15,net:1}]),/أكبر/);
 const sale=createPosSale(db,{id:1,role:'owner'},{request_id:key(),pos_id:1,lines:[{item_id:item,qty:1,discount_rate:100,unit_price:0}]});assert.equal(getInvoice(db,sale).subtotal,10000);
 const printed=commercialPrint({title:'عرض <سعر>',number:'QT-X',date:today,company:{name_ar:'منشأة'},party:{name_ar:'<script>alert(1)</script>'},headers:['الوصف'],rows:[['<img onerror=alert(1)>']],totals:[['الإجمالي',207]],notes:'<unsafe>'});assert.ok(printed.includes('&lt;script&gt;'));assert.ok(!printed.includes('<script>alert'));assert.ok(printed.includes('ليس بديلًا عن الفاتورة الضريبية'));assert.ok(printed.includes(new Intl.NumberFormat('ar-SA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(207))); 
 console.log('PASS: quote snapshots/no posting, discount/rounding/XML, one-time draft conversion, expiry/unit-change/cancellation guards, POS price authority and escaped print');
}finally{db.close();}
