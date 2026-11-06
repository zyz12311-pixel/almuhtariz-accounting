import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {openDb} from '../server/db.js';import {seedCompany,setSetting,createInvoice,createCreditNote,trialBalance,getInvoice} from '../server/core.js';
import {saveItem} from '../server/items.js';import {recordStock,balance} from '../server/inventory.js';import {createPurchase} from '../server/commercial.js';import {stockValuation} from '../server/valuation.js';import {nowRiyadh} from '../server/lib.js';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'muhtariz-cost-')),db=openDb(path.join(directory,'db'));
try{
 db.exec("INSERT INTO users(id,username,pass,role) VALUES(1,'owner','fixture','owner');INSERT INTO parties(id,name_ar,kind) VALUES(1,'مورد','supplier');");seedCompany(db,'تكلفة');
 setSetting(db,'company',{name_ar:'تكلفة',vat_number:'300000000000003',cr_number:'1010010000',street:'شارع',building_number:'1234',district:'حي',city:'الرياض',postal_code:'12345',country_code:'SA'});
 const item=saveItem(db,{name_ar:'صنف بتكلفة',unit_price:20,track_stock:true,opening_qty:10,opening_unit_cost:5},null,1).id;
 assert.equal(stockValuation(db)[0].value,50);assert.equal(stockValuation(db)[0].complete,1);
 const buy=(quantity,cost,reference)=>createPurchase(db,1,{request_id:crypto.randomUUID(),supplier_id:1,supplier_reference:reference,document_date:nowRiyadh().date,warehouse_id:1,payment:'credit',lines:[{item_id:item,qty:quantity,unit_price:cost,vat_rate:15}]});
 const p=buy(10,15,'BUY-1');assert.equal(stockValuation(db)[0].value,200);assert.equal(stockValuation(db)[0].average_cost,10);
 const sale=createInvoice(db,1,{pos_id:1,payment:'cash',lines:[{item_id:item,description:'بيع',qty:5,unit_price:20}]});
 assert.equal(stockValuation(db)[0].value,150);assert.equal(balance(db,item,1),15000000);
 assert.equal(db.prepare("SELECT SUM(debit-credit) n FROM journal_lines WHERE account_code='5101'").get().n,5000);
 buy(5,30,'BUY-2');assert.equal(stockValuation(db)[0].value,300);
 createCreditNote(db,1,sale,{reason:'إرجاع بتكلفة البيع الأصلية',lines:[{line_no:1,qty:2}]});assert.equal(stockValuation(db)[0].value,320);
 assert.equal(db.prepare("SELECT SUM(debit-credit) n FROM journal_lines WHERE account_code='5101'").get().n,3000);
 db.exec("INSERT INTO warehouses(id,name) VALUES(2,'فرعي')");
 recordStock(db,{request_id:crypto.randomUUID(),item_id:item,warehouse_id:1,target_warehouse_id:2,kind:'transfer',qty:11,reason:'نصف الكمية'},1);
 let values=stockValuation(db);assert.equal(values[0].value,160);assert.equal(values[1].value,160);
 createPurchase(db,1,{request_id:crypto.randomUUID(),kind:'return',ref_purchase_id:p.id,supplier_id:1,supplier_reference:'CREDIT-1',document_date:nowRiyadh().date,warehouse_id:1,payment:'credit',reason:'مرتجع مورد',lines:[{line_no:1,qty:1}]});
 values=stockValuation(db);assert.equal(values[0].value,145.45);
 const totalValue=Math.round(values.reduce((s,l)=>s+l.value,0)*100),inventoryAccount=db.prepare("SELECT SUM(debit-credit) n FROM journal_lines WHERE account_code='1401'").get().n;
 assert.equal(totalValue,inventoryAccount);assert.equal(trialBalance(db).balanced,true);
 const unknown=saveItem(db,{name_ar:'قديم بلا تكلفة',unit_price:10,track_stock:true,opening_qty:2},null,1).id;
 assert.equal(stockValuation(db).find(i=>i.item_id===unknown).complete,0);
 assert.throws(()=>db.exec('UPDATE stock_values SET value_after=0'),/ثابتة/);
 console.log('PASS: weighted cost, COGS, original sale return cost, transfer value, purchase-return variance, inventory/GL reconciliation, unvalued stock warning');
}finally{db.close();}
