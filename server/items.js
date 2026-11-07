import crypto from 'node:crypto';
import {calculateLines,scaledInteger} from './money.js';
import {tx} from './db.js';
import {recordStock,micro} from './inventory.js';
const string=(value,max=150)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/.test(value))throw Error('نص بيانات الصنف غير صالح');return value.trim();};
const barcode=value=>{if(value==null||value==='')return null;const s=string(value,80);if(!/^[\x20-\x7e]+$/.test(s))throw Error('الباركود يجب أن يكون نصًا قابلًا للطباعة');return s;};
const currency=value=>Number(scaledInteger(value,2,'المبلغ'));
const optionalDecimal=value=>{if(value===''||value==null)return '';scaledInteger(value,6,'المقاس أو الوزن');return String(value);};
export function listItems(db){return db.prepare('SELECT * FROM items ORDER BY name_ar').all().map(item=>({...item,unit_price:item.unit_price/100,purchase_cost:item.purchase_cost/100,reorder_qty:item.reorder_micro/1000000,stock_qty:db.prepare('SELECT COALESCE(SUM(qty_micro),0) quantity FROM stock_positions WHERE item_id=?').get(item.id).quantity/1000000,units:db.prepare('SELECT * FROM item_units WHERE item_id=? AND active=1 ORDER BY id').all(item.id).map(u=>({...u,unit_price:u.unit_price/100,factor:u.factor_micro/1000000}))}));}
export function saveItem(db,body,itemId=null,actor=null){return tx(db,()=>{
 const existing=itemId?db.prepare('SELECT * FROM items WHERE id=?').get(itemId):null;if(itemId&&!existing)throw Error('الصنف غير موجود');
 const b={name_ar:'',unit_price:0,vat_rate:15,item_kind:'product',base_unit:'قطعة',unit_code:'PCE',track_stock:false,sku:'',category:'',brand:'',purchase_cost:0,reorder_qty:0,weight_kg:'',volume_l:'',length_cm:'',width_cm:'',height_cm:'',size_label:'',color:'',notes:'',...(existing?{...existing,unit_price:existing.unit_price/100,purchase_cost:existing.purchase_cost/100,reorder_qty:existing.reorder_micro/1000000}:{}),...body};
 if(!['product','service'].includes(b.item_kind))throw Error('نوع الصنف غير صالح');
 if(![true,false,0,1].includes(b.track_stock))throw Error('خيار المخزون غير صالح');
 if(b.item_kind==='service'&&b.track_stock)throw Error('الخدمة لا تحمل رصيدًا مخزنيًا');
 const checked=calculateLines([{description:b.name_ar,qty:1,unit_price:b.unit_price,vat_rate:b.vat_rate,tax_category:b.tax_category,exemption_code:b.exemption_code,exemption_reason:b.exemption_reason,unit_code:b.unit_code}])[0];
 const values={name_ar:string(b.name_ar),barcode:barcode(b.barcode),unit_price:currency(b.unit_price),vat_rate:checked.vat_rate,tax_category:checked.tax_category,exemption_code:checked.exemption_code,exemption_reason:checked.exemption_reason,sku:string(b.sku,80),category:string(b.category),brand:string(b.brand),item_kind:b.item_kind,base_unit:string(b.base_unit,40),unit_code:b.unit_code,track_stock:b.track_stock?1:0,reorder_micro:micro(b.reorder_qty),purchase_cost:currency(b.purchase_cost),weight_kg:optionalDecimal(b.weight_kg),volume_l:optionalDecimal(b.volume_l),length_cm:optionalDecimal(b.length_cm),width_cm:optionalDecimal(b.width_cm),height_cm:optionalDecimal(b.height_cm),size_label:string(b.size_label,80),color:string(b.color,80),notes:string(b.notes,1000)};
 if(!values.base_unit)throw Error('الوحدة الأساسية مطلوبة');
 if(existing&&(db.prepare('SELECT 1 FROM stock_movements WHERE item_id=? LIMIT 1').get(itemId)||db.prepare('SELECT 1 FROM invoice_lines WHERE item_id=? LIMIT 1').get(itemId))&&['base_unit','unit_code','track_stock','item_kind'].some(k=>values[k]!==existing[k]))throw Error('لا تغيّر نوع الصنف أو وحدة المخزون بعد وجود حركات أو مستندات؛ أنشئ صنفًا جديدًا');
 if(values.barcode&&db.prepare('SELECT 1 FROM items WHERE barcode=? AND id<>?').get(values.barcode,itemId||0))throw Error('الباركود مستخدم لصنف آخر');
 if(values.sku&&db.prepare('SELECT 1 FROM items WHERE sku=? AND id<>?').get(values.sku,itemId||0))throw Error('كود الصنف مستخدم لصنف آخر');
 const columns=Object.keys(values);
 if(existing)db.prepare('UPDATE items SET '+columns.map(c=>c+'=?').join(',')+' WHERE id=?').run(...Object.values(values),itemId);
 else itemId=db.prepare('INSERT INTO items('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...Object.values(values)).lastInsertRowid;
 if(Object.hasOwn(body,'units')){
  if(!Array.isArray(body.units)||body.units.length>3)throw Error('يمكن إضافة ثلاث وحدات تحويل للصنف');
  const seen=new Set([values.base_unit]);const incoming=[];
  for(const row of body.units){const name=string(row.name,40);if(!name||seen.has(name))throw Error('أسماء الوحدات يجب أن تكون مختلفة');seen.add(name);const factor=micro(row.factor);if(!factor||factor>1000000000000)throw Error('تعادل الوحدة غير صالح');const code=row.unit_code||values.unit_code;if(!/^[A-Z0-9]{2,3}$/.test(code))throw Error('رمز وحدة التحويل غير صالح');const price=currency(row.unit_price),bc=barcode(row.barcode);const old=row.id?db.prepare('SELECT * FROM item_units WHERE id=? AND item_id=?').get(row.id,itemId):db.prepare('SELECT * FROM item_units WHERE item_id=? AND name=?').get(itemId,name);if(row.id&&!old)throw Error('وحدة لا تخص هذا الصنف');incoming.push({old,name,factor,code,price,bc});}
  db.prepare('UPDATE item_units SET active=0 WHERE item_id=?').run(itemId);
  for(const u of incoming){if(u.old)db.prepare('UPDATE item_units SET name=?,factor_micro=?,unit_code=?,unit_price=?,barcode=?,active=1 WHERE id=?').run(u.name,u.factor,u.code,u.price,u.bc,u.old.id);else db.prepare('INSERT INTO item_units(item_id,name,factor_micro,unit_code,unit_price,barcode) VALUES(?,?,?,?,?,?)').run(itemId,u.name,u.factor,u.code,u.price,u.bc);}
 }
 if(body.opening_qty!==undefined&&micro(body.opening_qty)>0){if(existing)throw Error('استخدم شاشة حركة المخزون لإضافة رصيد افتتاحي للصنف المحفوظ');recordStock(db,{item_id:itemId,warehouse_id:body.warehouse_id||1,qty:body.opening_qty,unit_cost:body.opening_unit_cost,kind:'opening',reason:'رصيد افتتاحي عند إنشاء الصنف',request_id:crypto.randomUUID()},actor);}
 return {id:itemId};
});}
export function posCatalog(db){return db.prepare('SELECT id,name_ar,unit_price,vat_rate,barcode,tax_category,exemption_code,exemption_reason,sku,base_unit,unit_code,track_stock,size_label,color,weight_kg,volume_l FROM items WHERE active=1 ORDER BY name_ar').all().map(i=>({...i,unit_price:i.unit_price/100,units:db.prepare('SELECT id,name,unit_price,barcode,unit_code,factor_micro FROM item_units WHERE item_id=? AND active=1 ORDER BY id').all(i.id).map(u=>({...u,unit_price:u.unit_price/100,factor:u.factor_micro/1000000}))}));}
