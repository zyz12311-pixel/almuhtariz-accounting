import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { createApp } from '../server/index.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'almuhtariz-pl-')),file=path.join(dir,'pl.db');
const {server,db}=createApp({dbFile:file,licensePath:path.join(dir,'license.json')});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const call=async(method,p,body,cookie='')=>{if(p==='/api/pos/sales'&&body&&!body.request_id)body={...body,request_id:crypto.randomUUID()};const r=await fetch(base+p,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:body?JSON.stringify(body):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return {st:r.status,j,r};};
try{
 await call('POST','/api/setup',{username:'owner',password:'password123',company_name:'متجر',activity:'trade'});
 const login=await call('POST','/api/login',{username:'owner',password:'password123'});const owner=login.r.headers.get('set-cookie').split(';')[0];
 await call('PUT','/api/settings/company',{name_ar:'متجر',vat_number:'300000000000003',cr_number:'1234567890',street:'شارع',building_number:'1234',district:'حي',city:'الرياض',postal_code:'12345',country_code:'SA'},owner);
 // levels seeded by migration
 const levels=(await call('GET','/api/price-levels',null,owner)).j;
 assert.ok(levels.find(l=>l.code==='retail'&&l.is_builtin));
 assert.ok(levels.find(l=>l.code==='wholesale'&&l.is_builtin));
 // create custom level
 const dist=(await call('POST','/api/price-levels',{code:'distributor',name_ar:'الموزع'},owner)).j;
 assert.equal(dist.code,'distributor');
 assert.equal(dist.is_builtin,0);
 // duplicate code rejected
 const dup=(await call('POST','/api/price-levels',{code:'distributor',name_ar:'مكرر'},owner));
 assert.equal(dup.st,400);
 // update level
 const upd=(await call('PUT','/api/price-levels/'+dist.id,{name_ar:'الموزعين',active:true},owner));
 // item
 const item=(await call('POST','/api/items',{name_ar:'منتج اختبار',unit_price:'100.00',wholesale_price:'60.00',vat_rate:15},owner)).j.id;
 // set item price level: distributor 80
 const ipl=(await call('POST','/api/items/'+item+'/price-levels',{level_id:dist.id,unit_price:'80.00'},owner)).j;
 assert.equal(ipl.unit_price,80);
 const ipls=(await call('GET','/api/items/'+item+'/price-levels',null,owner)).j;
 assert.equal(ipls.items.find(l=>l.code==='distributor').unit_price,80);
 // cashier with wholesale permission
 await call('POST','/api/users',{username:'cashier',password:'password123',role:'staff',pos_id:1},owner);
 await call('PUT','/api/users/2/pos-pricing',{discount_limit:0,wholesale:true,manual_price:false,manual_price_cap:0,allowed_price_levels:['distributor']},owner);
 const cashier=(await call('POST','/api/login',{username:'cashier',password:'password123'})).r.headers.get('set-cookie').split(';')[0];
 const sale=(lines,terms={},cookie=cashier)=>call('POST','/api/pos/sales',{pos_id:1,lines,...terms},cookie);
 const totalOf=async(saleRes)=>{const inv=await call('GET','/api/invoices/'+saleRes.j.id,null,cashier);return inv.j.total;};
 // retail -> unit_price 100
 const r=await sale([{item_id:item,qty:1}]);
 assert.equal(r.st,200);
 assert.equal(await totalOf(r),11500); // 100 + 15% vat
 // wholesale -> wholesale_price 60
 const w=await sale([{item_id:item,qty:1}],{price_level:'wholesale'});
 assert.equal(w.st,200);
 assert.equal(await totalOf(w),6900); // 60 + 15% vat
 // distributor -> item price level 80
 const d=await sale([{item_id:item,qty:1}],{price_level:'distributor'});
 assert.equal(d.st,200);
 assert.equal(await totalOf(d),9200); // 80 + 15% vat
 // level not found
 const bad=await sale([{item_id:item,qty:1}],{price_level:'nonexistent'});
 assert.equal(bad.st,400);
 // delete built-in retail blocked
 const delBuilt=(await call('DELETE','/api/price-levels/'+levels.find(l=>l.code==='retail').id,null,owner));
 assert.equal(delBuilt.st,400);
 // delete distributor after used blocked
 const delUsed=(await call('DELETE','/api/price-levels/'+dist.id,null,owner));
 assert.equal(delUsed.st,400);
 // create unused level and delete ok
 const unused=(await call('POST','/api/price-levels',{code:'unused',name_ar:'غير مستخدم'},owner)).j;
 const delUnused=(await call('DELETE','/api/price-levels/'+unused.id,null,owner));
 assert.equal(delUnused.st,200);
 console.log('PASS: price levels');
} finally { server.close(); db.close(); }
