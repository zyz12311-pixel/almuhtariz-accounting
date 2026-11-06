import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {openDb} from '../server/db.js';import {seedCompany,setSetting,createCreditNote,getInvoice,issueInvoice,createInvoice} from '../server/core.js';
import {saveItem,listItems} from '../server/items.js';import {recordStock,balance} from '../server/inventory.js';import {createPosSale} from '../server/pos.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'almuhtariz-inventory-')),db=openDb(path.join(dir,'db.sqlite')),owner={id:1,role:'owner'};
try{
 db.prepare("INSERT INTO users(id,username,pass,role) VALUES(1,'fixture','test-only','owner')").run();
 seedCompany(db,'اختبار مخزون');setSetting(db,'company',{name_ar:'اختبار مخزون',vat_number:'300000000000003',cr_number:'1010010000',street:'الشارع',building_number:'1234',district:'الحي',city:'الرياض',postal_code:'12345',country_code:'SA'});
 const item=saveItem(db,{name_ar:'ماء 500 مل',sku:'WATER-500',barcode:'000500',unit_price:'2.00',base_unit:'عبوة',unit_code:'PCE',track_stock:true,opening_qty:'24',warehouse_id:1,reorder_qty:'6',weight_kg:'0.52',volume_l:'0.5',length_cm:'6',width_cm:'6',height_cm:'20',size_label:'500 مل',color:'شفاف',units:[{name:'كرتون',factor:'12',unit_price:'20.00',barcode:'000501'}]},null,1).id;
 const card=listItems(db).find(i=>i.id===item),unit=card.units[0].id;
 assert.equal(card.stock_qty,24);assert.equal(card.volume_l,'0.5');assert.equal(card.weight_kg,'0.52');assert.equal(card.units[0].factor,12);
 const request={request_id:crypto.randomUUID(),pos_id:1,lines:[{item_id:item,item_unit_id:unit,qty:1,unit_price:0.01}]};
 const sale=createPosSale(db,owner,request);assert.equal(getInvoice(db,sale).subtotal,2000);assert.equal(balance(db,item,1),12000000);assert.equal(getInvoice(db,sale).lines[0].stock_qty_micro,12000000);
 assert.equal(createPosSale(db,owner,request),sale);assert.equal(balance(db,item,1),12000000);
 const credit=createCreditNote(db,1,sale,{reason:'نصف كرتون مرتجع',lines:[{line_no:1,qty:0.5}]});assert.equal(balance(db,item,1),18000000);assert.equal(getInvoice(db,credit).lines[0].unit_name,'كرتون');
 const counters=db.prepare('SELECT * FROM counters ORDER BY name').all(),outbox=db.prepare('SELECT COUNT(*) n FROM sync_outbox').get().n;
 assert.throws(()=>createPosSale(db,owner,{...request,request_id:crypto.randomUUID(),lines:[{item_id:item,item_unit_id:unit,qty:2}]}),/الرصيد/);
 assert.equal(balance(db,item,1),18000000);assert.deepEqual(db.prepare('SELECT * FROM counters ORDER BY name').all(),counters);assert.equal(db.prepare('SELECT COUNT(*) n FROM sync_outbox').get().n,outbox);
 assert.throws(()=>saveItem(db,{track_stock:false},item,1),/حركات/);
 assert.throws(()=>saveItem(db,{name_ar:'مكرر',sku:'WATER-500',unit_price:1}),/كود/);
 assert.throws(()=>saveItem(db,{name_ar:'باركود وحدة',barcode:'000501',unit_price:1}),/الباركود/);
 assert.throws(()=>saveItem(db,{name_ar:'خدمة',item_kind:'service',track_stock:true,unit_price:1}),/الخدمة/);
 assert.throws(()=>saveItem(db,{name_ar:'وزن خاطئ',weight_kg:'-1',unit_price:1}),/الوزن/);
 db.prepare("INSERT INTO warehouses(name) VALUES('مستودع ثان')").run();const movement={request_id:crypto.randomUUID(),item_id:item,warehouse_id:1,target_warehouse_id:2,kind:'transfer',qty:'6',reason:'تحويل للاختبار'};
 recordStock(db,movement,1);assert.equal(balance(db,item,1),12000000);assert.equal(balance(db,item,2),6000000);assert.ok(recordStock(db,movement,1).replayed);assert.equal(balance(db,item,2),6000000);
 assert.throws(()=>recordStock(db,{...movement,qty:'5'},1),/مختلفة/);
 assert.throws(()=>recordStock(db,{...movement,request_id:crypto.randomUUID(),qty:'99'},1),/الرصيد/);assert.equal(balance(db,item,2),6000000);
 const draft=createInvoice(db,1,{draft:true,pos_id:1,lines:[{item_id:item,description:'ماء',qty:2,unit_price:2}]});assert.equal(balance(db,item,1),12000000);issueInvoice(db,draft);assert.equal(balance(db,item,1),10000000);
 const before=db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n;
 assert.throws(()=>db.exec('DELETE FROM stock_movements'),/ثابتة/);assert.throws(()=>db.exec('UPDATE stock_movements SET delta_micro=0'),/ثابتة/);assert.equal(db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,before);
 // Conversion changes cannot rewrite the quantity returned from an old sale.
 saveItem(db,{units:[{id:unit,name:'كرتون',factor:'10',unit_price:'18',barcode:'000501'}]},item,1);
 createCreditNote(db,1,sale,{reason:'باقي الكرتون',lines:[{line_no:1,qty:0.5}]});assert.equal(balance(db,item,1),16000000);
 assert.throws(()=>createCreditNote(db,1,sale,{reason:'زيادة',lines:[{line_no:1,qty:0.1}]}),/المتبقي/);
 console.log('نجحت اختبارات المخزون والوحدات والخصم والمرتجع ومنع تجاوز الرصيد والتحويل وعدم تكرار الحركة والترقية');
}finally{db.close();}
