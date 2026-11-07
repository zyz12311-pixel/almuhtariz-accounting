import {trackingInput} from './tracking.js';
import crypto from 'node:crypto';
import { createInvoice } from './core.js';
import { tx } from './db.js';
import {scaledInteger} from './money.js';
import {activeShift} from './operations.js';
export function normalizeBarcode(value) {
 if(value==null||value==='')return null;
 if(typeof value!=='string')throw Error('أدخل الباركود كنص للحفاظ على الأصفار في بدايته');
 const code=value.trim();if(!code)return null;
 if(!/^[\x20-\x7e]{1,80}$/.test(code))throw Error('الباركود يجب أن يكون 1–80 حرفًا قابلًا للطباعة');
 return code;
}
export function canonicalPosSale(db,user,body) {
 const pos=Number(body.pos_id);if(!Number.isSafeInteger(pos)||pos<1)throw Error('اختر نقطة بيع');
 if(!db.prepare('SELECT 1 FROM pos_points WHERE id=? AND active=1').get(pos))throw Error('نقطة البيع غير مفعلة');
 if(user.role==='staff'&&!db.prepare('SELECT 1 FROM pos_user_access WHERE user_id=? AND pos_id=?').get(user.id,pos)) {const e=Error('نقطة البيع غير مسموحة لهذا العامل');e.status=403;throw e;}
 if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>200)throw Error('اختر من 1 إلى 200 بند');
 const quantities=new Map();
 for(const row of body.lines){const id=Number(row.item_id),unit=row.item_unit_id==null||row.item_unit_id===''?null:Number(row.item_unit_id),qty=Number(row.qty);if(!Number.isSafeInteger(id)||(unit!==null&&(!Number.isSafeInteger(unit)||unit<1))||!Number.isFinite(qty)||qty<=0||qty>1000000)throw Error('الصنف أو الكمية غير صالح');const key=id+':'+(unit||0),prior=quantities.get(key),amount=(prior?.quantityMicro||0n)+scaledInteger(row.qty,6,'الكمية');if(amount>1000000000000n)throw Error('الكمية أكبر من المسموح');quantities.set(key,{id,unit,qty:Number(amount)/1000000,quantityMicro:amount,tracking:[...(prior?.tracking||[]),...trackingInput(row.tracking)]});}
 if(body.party_id&&!db.prepare("SELECT 1 FROM parties WHERE id=? AND kind IN ('customer','both')").get(body.party_id))throw Error('العميل غير موجود');
 const lines=[];for(const {id,unit,qty,tracking} of [...quantities.values()].sort((a,b)=>a.id-b.id||(a.unit||0)-(b.unit||0))){const item=db.prepare('SELECT * FROM items WHERE id=? AND active=1').get(id);if(!item)throw Error('صنف غير موجود أو موقوف');const chosen=unit?db.prepare('SELECT * FROM item_units WHERE id=? AND item_id=? AND active=1').get(unit,id):null;if(unit&&!chosen)throw Error('وحدة الصنف غير موجودة أو موقوفة');lines.push({tracking,item_id:item.id,item_unit_id:unit,description:item.name_ar+(chosen?' — '+chosen.name:''),qty,unit_price:(chosen?.unit_price??item.unit_price)/100,vat_rate:item.vat_rate,tax_category:item.tax_category,exemption_code:item.exemption_code,exemption_reason:item.exemption_reason});}
 return {pos_id:pos,party_id:body.party_id||null,payment:body.payment||'cash',supply_date:body.supply_date||null,lines};
}

export function createPosSale(db,user,body) {
 const key=body.request_id;if(typeof key!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key))throw Error('معرّف طلب البيع مطلوب');
 const request={pos_id:Number(body.pos_id),party_id:Number(body.party_id)||null,payment:body.payment||'cash',supply_date:body.supply_date||null,lines:Array.isArray(body.lines)?body.lines.map(l=>({item_id:Number(l.item_id),item_unit_id:Number(l.item_unit_id)||null,qty:Number(l.qty),...(trackingInput(l.tracking).length?{tracking:trackingInput(l.tracking)}:{})})).sort((a,b)=>a.item_id-b.item_id||(a.item_unit_id||0)-(b.item_unit_id||0)):null};
 const hash=crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex');
 return tx(db,()=>{
  const previous=db.prepare('SELECT * FROM pos_sale_requests WHERE request_id=?').get(key);
  if(previous){if(previous.user_id!==user.id){const e=Error('طلب بيع يخص مستخدمًا آخر');e.status=403;throw e;}if(previous.request_hash!==hash){const e=Error('هذا الطلب سبق إصداره ببيانات مختلفة؛ ابدأ سلة جديدة');e.status=409;throw e;}return previous.invoice_id;}
  const sale=canonicalPosSale(db,user,body),shift=activeShift(db,user,sale.pos_id),id=createInvoice(db,user.id,sale);
  if(shift)db.prepare('INSERT INTO pos_shift_invoices(invoice_id,shift_id) VALUES(?,?)').run(id,shift.id);
  db.prepare('INSERT INTO pos_sale_requests VALUES(?,?,?,?,?,?)').run(key,user.id,sale.pos_id,id,hash,new Date().toISOString());return id;
 });
}
