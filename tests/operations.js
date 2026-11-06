import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {openDb} from '../server/db.js';import {seedCompany,setSetting,trialBalance} from '../server/core.js';import {saveItem} from '../server/items.js';import {createPosSale} from '../server/pos.js';import {balance,recordStock} from '../server/inventory.js';import {openShift,closeShift,shiftSummary,posReturn,createStocktake,approveStocktake} from '../server/operations.js';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'muhtariz-ops-')),db=openDb(path.join(folder,'db')),owner={id:1,role:'owner'},staff={id:2,role:'staff'},other={id:3,role:'staff'},key=()=>crypto.randomUUID();
try{
 db.exec("INSERT INTO users(id,username,pass,role) VALUES(1,'o','fixture','owner'),(2,'s','fixture','staff'),(3,'x','fixture','staff');");seedCompany(db,'وردية');setSetting(db,'company',{name_ar:'وردية',vat_number:'300000000000003',cr_number:'1010010000',street:'شارع',building_number:'1234',district:'حي',city:'الرياض',postal_code:'12345',country_code:'SA'});db.exec('INSERT INTO pos_user_access VALUES(2,1);INSERT INTO pos_user_access VALUES(3,1);');
 const item=saveItem(db,{name_ar:'صنف',unit_price:10,track_stock:true,opening_qty:20,opening_unit_cost:3},null,1).id;
 setSetting(db,'pos_control',{require_shift:true});const sale={request_id:key(),pos_id:1,payment:'cash',lines:[{item_id:item,qty:2}]};
 assert.throws(()=>createPosSale(db,staff,sale),/وردية/);
 const shiftBody={request_id:key(),pos_id:1,opening_cash:100},shift=openShift(db,staff,shiftBody);assert.equal(openShift(db,staff,shiftBody).id,shift.id);
 assert.throws(()=>openShift(db,other,{...shiftBody,request_id:key()}),/UNIQUE/);
 const invoice=createPosSale(db,staff,sale);createPosSale(db,staff,{request_id:key(),pos_id:1,payment:'bank',lines:[{item_id:item,qty:1}]});
 const returning={request_id:key(),invoice_id:invoice,reason:'مرتجع كاشير',lines:[{line_no:1,qty:1}]};
 const returned=posReturn(db,staff,returning);assert.equal(posReturn(db,staff,returning).id,returned.id);assert.throws(()=>posReturn(db,other,{...returning,request_id:key()}),/مبيعاته/);
 const summary=shiftSummary(db,db.prepare('SELECT * FROM pos_shifts WHERE id=?').get(shift.id));assert.equal(summary.expected_cash,111.5);assert.equal(summary.documents,3);
 assert.throws(()=>closeShift(db,other,shift.id,{counted_cash:111.5}),/مستخدم آخر/);
 const closed=closeShift(db,staff,shift.id,{counted_cash:110});assert.equal(closed.variance,-1.5);assert.equal(createPosSale(db,staff,sale),invoice);
 assert.throws(()=>createPosSale(db,staff,{...sale,request_id:key()}),/وردية/);
 assert.throws(()=>closeShift(db,staff,shift.id,{counted_cash:111.5}),/أخرى/);
 const draft=createStocktake(db,owner,{request_id:key(),warehouse_id:1,notes:'جرد اختبار',lines:[{item_id:item,counted_qty:17}]});
 assert.throws(()=>approveStocktake(db,staff,draft.id),/للمالك/);
 approveStocktake(db,owner,draft.id);assert.equal(balance(db,item,1),17000000);assert.ok(approveStocktake(db,owner,draft.id).replayed);
 const stale=createStocktake(db,owner,{request_id:key(),warehouse_id:1,notes:'مسودة قديمة',lines:[{item_id:item,counted_qty:16}]});
 recordStock(db,{request_id:key(),item_id:item,warehouse_id:1,kind:'receipt',qty:1,unit_cost:3,reason:'وارد لاحق'},1);
 assert.throws(()=>approveStocktake(db,owner,stale.id),/تغير رصيد/);assert.equal(balance(db,item,1),18000000);assert.equal(trialBalance(db).balanced,true);
 console.log('PASS: shift access, required opening, cash/bank separation, linked returns, closing variance, closed replay, stocktake approval and stale-count rollback');
}finally{db.close();}
