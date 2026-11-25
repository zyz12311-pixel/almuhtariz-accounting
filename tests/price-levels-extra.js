import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { createApp } from '../server/index.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'almuhtariz-plex-')),file=path.join(dir,'plex.db');
const {server,db}=createApp({dbFile:file,licensePath:path.join(dir,'license.json')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const call=async(method,p,body,cookie='')=>{if(p==='/api/pos/sales'&&body&&!body.request_id)body={...body,request_id:crypto.randomUUID()};const r=await fetch(base+p,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {st:r.status,j,r};};
try{
 await call('POST','/api/setup',{username:'owner',password:'password123',company_name:'متجر',activity:'trade'});
 const owner=(await call('POST','/api/login',{username:'owner',password:'password123'})).r.headers.get('set-cookie').split(';')[0];
 await call('PUT','/api/settings/company',{name_ar:'متجر',vat_number:'300000000000003',cr_number:'1234567890',street:'شارع',building_number:'1234',district:'حي',city:'الرياض',postal_code:'12345',country_code:'SA'},owner);
 const levels=(await call('GET','/api/price-levels',null,owner)).j;
 const retail=levels.find(l=>l.code==='retail'), wholesale=levels.find(l=>l.code==='wholesale');
 // built-in protection
 assert.equal((await call('PUT','/api/price-levels/'+retail.id,{code:'retail2'},owner)).st,400);
 assert.equal((await call('PUT','/api/price-levels/'+retail.id,{active:false},owner)).st,400);
 assert.equal((await call('PUT','/api/price-levels/'+wholesale.id,{active:false},owner)).st,400);
 assert.equal((await call('DELETE','/api/price-levels/'+retail.id,null,owner)).st,400);
 // custom level
 const dist=(await call('POST','/api/price-levels',{code:'distributor',name_ar:'الموزع'},owner)).j;
 // item with unit
 const item=(await call('POST','/api/items',{name_ar:'منتج',unit_price:'100.00',wholesale_price:'60.00',vat_rate:15,base_unit:'قطعة',units:[{name:'كرتون',factor:'12',unit_price:'20.00',wholesale_price:'18.00',barcode:'UNIT-12'}]},owner)).j;
 const saved=(await call('GET','/api/items',null,owner)).j.find(i=>i.id===item.id);
 const unitId=saved.units[0].id;
 // set item-level and unit-level distributor prices
 await call('POST','/api/items/'+item.id+'/price-levels',{level_id:dist.id,unit_price:'80.00'},owner);
 await call('POST','/api/items/'+item.id+'/price-levels',{level_id:dist.id,unit_id:unitId,unit_price:'15.00'},owner);
 const ipls=(await call('GET','/api/items/'+item.id+'/price-levels',null,owner)).j;
 assert.equal(ipls.items.find(l=>l.code==='distributor').unit_price,80);
 assert.equal(ipls.units.find(l=>l.code==='distributor').unit_price,15);
 // cashier without custom permission
 await call('POST','/api/users',{username:'cashier',password:'password123',role:'staff',pos_id:1},owner);
 const cashierId=2;
 await call('PUT','/api/users/'+cashierId+'/pos-pricing',{discount_limit:0,wholesale:true,manual_price:false,manual_price_cap:0,allowed_price_levels:[]},owner);
 const cashier=(await call('POST','/api/login',{username:'cashier',password:'password123'})).r.headers.get('set-cookie').split(';')[0];
 const sale=(lines,terms={},cookie=cashier)=>call('POST','/api/pos/sales',{pos_id:1,lines,...terms},cookie);
 const totalOf=async(res)=>{const inv=await call('GET','/api/invoices/'+res.j.id,null,cashier);return inv.j.total;};
 // staff blocked from custom level
 assert.equal((await sale([{item_id:item.id,qty:1}],{price_level:'distributor'})).st,403);
 // grant custom level
 assert.equal((await call('PUT','/api/users/'+cashierId+'/pos-pricing',{discount_limit:0,wholesale:true,manual_price:false,manual_price_cap:0,allowed_price_levels:['distributor']},owner)).st,200);
 // unit-level price applies for unit sale (15 per carton)
 const unitSale=await sale([{item_id:item.id,item_unit_id:unitId,qty:1}],{price_level:'distributor'});
 assert.equal(unitSale.st,200);
 assert.equal(await totalOf(unitSale),1725); // 15 + 15% vat
 // item-level price applies for base unit sale (80)
 const baseSale=await sale([{item_id:item.id,qty:1}],{price_level:'distributor'});
 assert.equal(baseSale.st,200);
 assert.equal(await totalOf(baseSale),9200); // 80 + 15% vat
 // party price list with validity
 const party=(await call('POST','/api/parties',{name_ar:'عميل قائمة',kind:'customer'},owner)).j.id;
 assert.equal((await call('POST','/api/parties/'+party+'/price-lists',{level_id:dist.id,valid_from:'2026-01-01',valid_to:'2026-12-31'},owner)).st,200);
 // sale with party and no explicit level -> uses party list (distributor 80)
 const partySale=await sale([{item_id:item.id,qty:1}],{party_id:party});
 assert.equal(partySale.st,200);
 assert.equal(await totalOf(partySale),9200);
 // expired list (separate party with only expired list) -> falls back to retail (100)
 const party2=(await call('POST','/api/parties',{name_ar:'عميل منتهي',kind:'customer'},owner)).j.id;
 await call('POST','/api/parties/'+party2+'/price-lists',{level_id:dist.id,valid_from:'2020-01-01',valid_to:'2020-12-31'},owner);
 const expiredSale=await sale([{item_id:item.id,qty:1}],{party_id:party2});
 assert.equal(expiredSale.st,200);
 assert.equal(await totalOf(expiredSale),11500); // retail 100 + 15%
 // manual pricing permissions preserved: cap enforced
 await call('PUT','/api/users/'+cashierId+'/pos-pricing',{discount_limit:0,wholesale:false,manual_price:true,manual_price_cap:80,allowed_price_levels:['distributor']},owner);
 const svc=(await call('POST','/api/items',{name_ar:'خدمة',unit_price:100,vat_rate:15,item_kind:'service',track_stock:false},owner)).j.id;
 assert.equal((await sale([{item_id:svc,qty:1,override_price:'90'}])).st,403); // exceeds cap
 assert.equal((await sale([{item_id:svc,qty:1,override_price:'70'}])).st,200); // within cap
 console.log('PASS: price level permissions, per-unit prices, party lists, manual pricing');
} finally { server.close(); db.close(); }