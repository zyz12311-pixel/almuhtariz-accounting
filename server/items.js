import crypto from 'node:crypto';
import {calculateLines,scaledInteger} from './money.js';
import {tx} from './db.js';
import {recordStock,micro} from './inventory.js';
const string=(value,max=150)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/.test(value))throw Error('نص بيانات الصنف غير صالح');return value.trim();};
const barcode=value=>{if(value==null||value==='')return null;const s=string(value,80);if(!/^[\x20-\x7e]+$/.test(s))throw Error('الباركود يجب أن يكون نصًا قابلًا للطباعة');return s;};
const currency=value=>Number(scaledInteger(value,2,'المبلغ'));
const optionalPrice=value=>value==null||value===''?null:currency(value);
const optionalDecimal=value=>{if(value===''||value==null)return '';scaledInteger(value,6,'المقاس أو الوزن');return String(value);};
export function itemRows(db,items){
 if(!items.length)return[];const ids=items.map(i=>i.id),filter=ids.length<=500?' WHERE item_id IN ('+ids.map(()=>'?').join(',')+')':'',args=filter?ids:[];
 const balances=new Map(db.prepare('SELECT item_id,SUM(qty_micro) quantity FROM stock_positions'+filter+' GROUP BY item_id').all(...args).map(r=>[r.item_id,r.quantity]));
 const units=new Map();for(const u of db.prepare('SELECT * FROM item_units'+(filter?filter+' AND active=1':' WHERE active=1')+' ORDER BY id').all(...args)){if(!units.has(u.item_id))units.set(u.item_id,[]);units.get(u.item_id).push({...u,unit_price:u.unit_price/100,wholesale_price:u.wholesale_price===null?null:u.wholesale_price/100,factor:u.factor_micro/1000000});}
 return items.map(item=>({...item,unit_price:item.unit_price/100,wholesale_price:item.wholesale_price===null?null:item.wholesale_price/100,purchase_cost:item.purchase_cost/100,reorder_qty:item.reorder_micro/1000000,stock_qty:(balances.get(item.id)||0)/1000000,units:units.get(item.id)||[]}));
}
export function listItems(db,activity=null){const where=activity?' WHERE activity=? ':' ';const params=activity?[activity]:[];return itemRows(db,db.prepare('SELECT * FROM items'+where+'ORDER BY name_ar,id').all(...params));}
export function saveItem(db,body,itemId=null,actor=null,activity=null){return tx(db,()=>{
  const existing=itemId?db.prepare('SELECT * FROM items WHERE id=?').get(itemId):null;if(itemId&&!existing)throw Error('الصنف غير موجود');
  const b={name_ar:'',unit_price:0,vat_rate:15,item_kind:'product',tracking_mode:'none',expiry_required:false,base_unit:'قطعة',unit_code:'PCE',track_stock:false,sku:'',category:'',brand:'',purchase_cost:0,reorder_qty:0,weight_kg:'',volume_l:'',length_cm:'',width_cm:'',height_cm:'',size_label:'',color:'',notes:'',...(existing?{...existing,unit_price:existing.unit_price/100,wholesale_price:existing.wholesale_price===null?null:existing.wholesale_price/100,purchase_cost:existing.purchase_cost/100,reorder_qty:existing.reorder_micro/1000000}:{}),...body};
  if(!['none','lot','serial'].includes(b.tracking_mode)||![true,false,0,1].includes(b.expiry_required))throw Error('نمط تتبع غير صالح');
  if(!['product','service'].includes(b.item_kind))throw Error('نوع الصنف غير صالح');
  if(![true,false,0,1].includes(b.track_stock))throw Error('خيار المخزون غير صالح');
  if(b.item_kind==='service'&&b.track_stock)throw Error('الخدمة لا تحمل رصيدًا مخزنيًا');
  const checked=calculateLines([{description:b.name_ar,qty:1,unit_price:b.unit_price,vat_rate:b.vat_rate,tax_category:b.tax_category,exemption_code:b.exemption_code,exemption_reason:b.exemption_reason,unit_code:b.unit_code}])[0];
  const values={name_ar:string(b.name_ar),barcode:barcode(b.barcode),unit_price:currency(b.unit_price),wholesale_price:optionalPrice(b.wholesale_price),vat_rate:checked.vat_rate,tax_category:checked.tax_category,exemption_code:checked.exemption_code,exemption_reason:checked.exemption_reason,sku:string(b.sku,80),category:string(b.category),brand:string(b.brand),item_kind:b.item_kind,tracking_mode:b.tracking_mode,expiry_required:b.expiry_required?1:0,base_unit:string(b.base_unit,40),unit_code:b.unit_code,track_stock:b.track_stock?1:0,reorder_micro:micro(b.reorder_qty),purchase_cost:currency(b.purchase_cost),weight_kg:optionalDecimal(b.weight_kg),volume_l:optionalDecimal(b.volume_l),length_cm:optionalDecimal(b.length_cm),width_cm:optionalDecimal(b.width_cm),height_cm:optionalDecimal(b.height_cm),size_label:string(b.size_label,80),color:string(b.color,80),notes:string(b.notes,1000),activity:activity||'trade'};
 if(!values.base_unit)throw Error('الوحدة الأساسية مطلوبة');
 values.scale_plu=b.scale_plu===''||b.scale_plu==null?null:b.scale_plu;
 if(values.scale_plu!==null){
  if(typeof values.scale_plu!=='string'||!/^\d{5}$/.test(values.scale_plu))throw Error('رمز صنف الميزان يجب أن يكون خمسة أرقام');
  if(values.unit_code!=='KGM'||values.item_kind!=='product'||values.tracking_mode==='serial')throw Error('رمز الميزان يتطلب منتجًا بوحدة الكيلوجرام دون تتبع تسلسلي');
  if(db.prepare('SELECT 1 FROM items WHERE scale_plu=? AND id<>?').get(values.scale_plu,itemId||0))throw Error('رمز صنف الميزان مستخدم لصنف آخر');
 }
 if(existing&&(db.prepare('SELECT 1 FROM stock_movements WHERE item_id=? LIMIT 1').get(itemId)||db.prepare('SELECT 1 FROM invoice_lines WHERE item_id=? LIMIT 1').get(itemId)||db.prepare('SELECT 1 FROM stocktake_lines WHERE item_id=? LIMIT 1').get(itemId))&&['base_unit','unit_code','track_stock','item_kind','tracking_mode','expiry_required'].some(k=>values[k]!==existing[k]))throw Error('لا تغيّر نوع الصنف أو وحدة المخزون بعد وجود حركات أو مستندات؛ أنشئ صنفًا جديدًا');
 if(values.barcode&&db.prepare('SELECT 1 FROM items WHERE barcode=? AND id<>?').get(values.barcode,itemId||0))throw Error('الباركود مستخدم لصنف آخر');
 if(values.sku&&db.prepare('SELECT 1 FROM items WHERE sku=? AND id<>?').get(values.sku,itemId||0))throw Error('كود الصنف مستخدم لصنف آخر');
 const deferred=existing&&(values.tracking_mode!==existing.tracking_mode||values.expiry_required!==existing.expiry_required);
 if(deferred)db.prepare("UPDATE items SET tracking_mode='none',expiry_required=0 WHERE id=?").run(itemId);
 const writeValues=deferred?{...values,tracking_mode:'none',expiry_required:0}:values,columns=Object.keys(writeValues);
 if(existing)db.prepare('UPDATE items SET '+columns.map(c=>c+'=?').join(',')+' WHERE id=?').run(...Object.values(writeValues),itemId);
 else itemId=db.prepare('INSERT INTO items('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...Object.values(writeValues)).lastInsertRowid;
 if(Object.hasOwn(body,'units')){
  if(!Array.isArray(body.units)||body.units.length>3)throw Error('يمكن إضافة ثلاث وحدات تحويل للصنف');
  const seen=new Set([values.base_unit]);const incoming=[];
  for(const row of body.units){const name=string(row.name,40);if(!name||seen.has(name))throw Error('أسماء الوحدات يجب أن تكون مختلفة');seen.add(name);const factor=micro(row.factor);if(values.tracking_mode==='serial'&&factor%1000000)throw Error('الوحدة التسلسلية لا تقبل جزءًا من قطعة');if(!factor||factor>1000000000000)throw Error('تعادل الوحدة غير صالح');const code=row.unit_code||values.unit_code;if(!/^[A-Z0-9]{2,3}$/.test(code))throw Error('رمز وحدة التحويل غير صالح');const price=currency(row.unit_price),bc=barcode(row.barcode);const old=row.id?db.prepare('SELECT * FROM item_units WHERE id=? AND item_id=?').get(row.id,itemId):db.prepare('SELECT * FROM item_units WHERE item_id=? AND name=?').get(itemId,name);if(row.id&&!old)throw Error('وحدة لا تخص هذا الصنف');const wholesale=Object.hasOwn(row,'wholesale_price')?optionalPrice(row.wholesale_price):old?.wholesale_price??null;incoming.push({old,name,factor,code,price,bc,wholesale});}
  db.prepare('UPDATE item_units SET active=0 WHERE item_id=?').run(itemId);
  for(const u of incoming){if(u.old)db.prepare('UPDATE item_units SET name=?,factor_micro=?,unit_code=?,unit_price=?,barcode=?,wholesale_price=?,active=1 WHERE id=?').run(u.name,u.factor,u.code,u.price,u.bc,u.wholesale,u.old.id);else db.prepare('INSERT INTO item_units(item_id,name,factor_micro,unit_code,unit_price,barcode,wholesale_price) VALUES(?,?,?,?,?,?,?)').run(itemId,u.name,u.factor,u.code,u.price,u.bc,u.wholesale);}
 }
 if(deferred)db.prepare('UPDATE items SET tracking_mode=?,expiry_required=? WHERE id=?').run(values.tracking_mode,values.expiry_required,itemId);
 if(body.opening_qty!==undefined&&micro(body.opening_qty)>0){if(existing)throw Error('استخدم شاشة حركة المخزون لإضافة رصيد افتتاحي للصنف المحفوظ');recordStock(db,{item_id:itemId,warehouse_id:body.warehouse_id||1,qty:body.opening_qty,unit_cost:body.opening_unit_cost,tracking:body.opening_tracking,kind:'opening',reason:'رصيد افتتاحي عند إنشاء الصنف',request_id:crypto.randomUUID()},actor);}
 return {id:itemId};
});}
