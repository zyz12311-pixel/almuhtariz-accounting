import {scaledInteger} from './money.js';
const identifier=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw Error('معرف غير صالح');return n;};
const priceCents=value=>{const n=Number(scaledInteger(value,2,'السعر'));if(!Number.isSafeInteger(n)||n<0)throw Error('السعر غير صالح');return n;};

export function listPriceLevels(db){
 return db.prepare('SELECT id,code,name_ar,active,is_builtin,created_at FROM price_levels ORDER BY is_builtin DESC,code').all();
}

export function createPriceLevel(db,body){
 const code=String(body.code||'').trim();const name_ar=String(body.name_ar||'').trim();
 if(!code||!name_ar)throw Error('كود واسم المستوى مطلوبان');
 if(code.length>30)throw Error('كود المستوى طويل جدًا');
 if(db.prepare('SELECT 1 FROM price_levels WHERE code=?').get(code))throw Error('كود المستوى مستخدم مسبقًا');
 const id=Number(db.prepare('INSERT INTO price_levels(code,name_ar,active,is_builtin) VALUES(?,?,1,0)').run(code,name_ar).lastInsertRowid);
 return{id,code,name_ar,active:1,is_builtin:0};
}

export function updatePriceLevel(db,id,body){
 identifier(id);const row=db.prepare('SELECT * FROM price_levels WHERE id=?').get(id);if(!row)throw Error('المستوى السعري غير موجود');
 const code=String(body.code||row.code).trim();const name_ar=String(body.name_ar||row.name_ar).trim();
 if(!code||!name_ar)throw Error('كود واسم المستوى مطلوبان');
 // المستويات الأساسية (retail/wholesale) لا يُغيَّر كودها ولا تُعطَّل حتى لا يكسر التسعير
 if(row.is_builtin){
  if(code!==row.code)throw Error('لا يمكن تغيير كود المستوى الأساسي');
  if(typeof body.active==='boolean'&&!body.active)throw Error('لا يمكن تعطيل المستوى الأساسي');
 }
 if(code!==row.code&&db.prepare('SELECT 1 FROM price_levels WHERE code=?').get(code))throw Error('كود المستوى مستخدم مسبقًا');
 if(typeof body.active==='boolean')db.prepare('UPDATE price_levels SET active=? WHERE id=?').run(body.active?1:0,id);
 db.prepare('UPDATE price_levels SET code=?,name_ar=? WHERE id=?').run(code,name_ar,id);
 return db.prepare('SELECT id,code,name_ar,active,is_builtin,created_at FROM price_levels WHERE id=?').get(id);
}

export function deletePriceLevel(db,id){
 identifier(id);const row=db.prepare('SELECT * FROM price_levels WHERE id=?').get(id);if(!row)throw Error('المستوى السعري غير موجود');
 if(row.is_builtin)throw Error('لا يمكن حذف مستوى سعري أساسي (التجزئة أو الجملة)');
 const used=db.prepare('SELECT 1 FROM item_price_levels WHERE level_id=? UNION SELECT 1 FROM unit_price_levels WHERE level_id=? UNION SELECT 1 FROM party_price_lists WHERE level_id=? LIMIT 1').get(id,id,id);
 if(used)throw Error('لا يمكن حذف المستوى السعري لأنه مستخدم في أسعار الأصناف أو قوائم العملاء');
 db.prepare('DELETE FROM price_levels WHERE id=?').run(id);return{ok:true};
}

export function listItemPriceLevels(db,itemId){
 identifier(itemId);if(!db.prepare('SELECT 1 FROM items WHERE id=?').get(itemId))throw Error('الصنف غير موجود');
 const itemRows=db.prepare('SELECT pl.id,pl.code,pl.name_ar,ipl.unit_price FROM item_price_levels ipl JOIN price_levels pl ON pl.id=ipl.level_id WHERE ipl.item_id=? ORDER BY pl.code').all(itemId).map(r=>({...r,unit_price:r.unit_price/100}));
 const unitRows=db.prepare('SELECT pl.id,pl.code,pl.name_ar,upl.unit_price,upl.unit_id,iu.name unit_name FROM unit_price_levels upl JOIN price_levels pl ON pl.id=upl.level_id JOIN item_units iu ON iu.id=upl.unit_id WHERE upl.unit_id IN (SELECT id FROM item_units WHERE item_id=?) ORDER BY pl.code,iu.name').all(itemId).map(r=>({...r,unit_price:r.unit_price/100}));
 return {items:itemRows,units:unitRows};
}

export function setItemPriceLevel(db,itemId,body){
 identifier(itemId);if(!db.prepare('SELECT 1 FROM items WHERE id=?').get(itemId))throw Error('الصنف غير موجود');
 const level=identifier(body.level_id);const price=priceCents(body.unit_price);
 const levelRow=db.prepare('SELECT * FROM price_levels WHERE id=? AND active=1').get(level);if(!levelRow)throw Error('المستوى السعري غير مفعل أو غير موجود');
 const unitId=body.unit_id==null||body.unit_id===''?null:identifier(body.unit_id);
 if(unitId){
  if(!db.prepare('SELECT 1 FROM item_units WHERE id=? AND item_id=?').get(unitId,itemId))throw Error('الوحدة لا تخص هذا الصنف');
  const existing=db.prepare('SELECT 1 FROM unit_price_levels WHERE unit_id=? AND level_id=?').get(unitId,level);
  if(existing)db.prepare('UPDATE unit_price_levels SET unit_price=? WHERE unit_id=? AND level_id=?').run(price,unitId,level);
  else db.prepare('INSERT INTO unit_price_levels(unit_id,level_id,unit_price) VALUES(?,?,?)').run(unitId,level,price);
  const row=db.prepare('SELECT pl.id,pl.code,pl.name_ar,upl.unit_price,upl.unit_id FROM unit_price_levels upl JOIN price_levels pl ON pl.id=upl.level_id WHERE upl.unit_id=? AND pl.id=?').get(unitId,level);
  return{...row,unit_price:row.unit_price/100};
 }
 const existing=db.prepare('SELECT 1 FROM item_price_levels WHERE item_id=? AND level_id=?').get(itemId,level);
 if(existing)db.prepare('UPDATE item_price_levels SET unit_price=? WHERE item_id=? AND level_id=?').run(price,itemId,level);
 else db.prepare('INSERT INTO item_price_levels(item_id,level_id,unit_price) VALUES(?,?,?)').run(itemId,level,price);
 const row=db.prepare('SELECT pl.id,pl.code,pl.name_ar,ipl.unit_price FROM item_price_levels ipl JOIN price_levels pl ON pl.id=ipl.level_id WHERE ipl.item_id=? AND pl.id=?').get(itemId,level);
 return{...row,unit_price:row.unit_price/100};
}

// resolve selling price for a product (item or unit) at a given level (cents)
// priceLabel=true (سعر مغلف من الميزان) يُحفظ السعر الأساسي ولا يُطبّق أي تجاوز للمستوى
export function itemPriceAtLevel(db,itemId,product,level,priceLabel=false,unitId=null){
 if(priceLabel)return product.unit_price;
 if(unitId){
  const u=db.prepare('SELECT unit_price FROM unit_price_levels WHERE unit_id=? AND level_id=(SELECT id FROM price_levels WHERE code=? AND active=1 LIMIT 1)').get(unitId,level);
  if(u&&u.unit_price!==null)return u.unit_price;
 }
 const row=db.prepare('SELECT ipl.unit_price level_price FROM item_price_levels ipl WHERE ipl.item_id=? AND ipl.level_id=(SELECT id FROM price_levels WHERE code=? AND active=1 LIMIT 1)').get(itemId,level);
 if(row&&row.level_price!==null)return row.level_price;
 if(level==='wholesale'&&product.wholesale_price!==null)return product.wholesale_price;
 return product.unit_price;
}

// ===== قوائم أسعار العملاء =====
export function listPartyPriceLists(db,partyId){
 identifier(partyId);
 return db.prepare('SELECT ppl.id,ppl.party_id,ppl.level_id,pl.code,pl.name_ar,ppl.valid_from,ppl.valid_to FROM party_price_lists ppl JOIN price_levels pl ON pl.id=ppl.level_id WHERE ppl.party_id=? ORDER BY ppl.valid_from DESC').all(partyId);
}

export function createPartyPriceList(db,partyId,body){
 identifier(partyId);if(!db.prepare("SELECT 1 FROM parties WHERE id=? AND kind IN ('customer','both')").get(partyId))throw Error('العميل غير موجود');
 const level=identifier(body.level_id);
 if(!db.prepare('SELECT 1 FROM price_levels WHERE id=? AND active=1').get(level))throw Error('المستوى السعري غير مفعل أو غير موجود');
 const validFrom=String(body.valid_from||'').trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(validFrom))throw Error('تاريخ بداية الصلاحية مطلوب');
 const validTo=body.valid_to?String(body.valid_to).trim():null;if(validTo&&!/^\d{4}-\d{2}-\d{2}$/.test(validTo))throw Error('تاريخ نهاية الصلاحية غير صالح');
 if(validTo&&validTo<validFrom)throw Error('نهاية الصلاحية تسبق بدايتها');
 const id=Number(db.prepare('INSERT INTO party_price_lists(party_id,level_id,valid_from,valid_to) VALUES(?,?,?,?)').run(partyId,level,validFrom,validTo).lastInsertRowid);
 return{id,party_id:partyId,level_id:level,valid_from:validFrom,valid_to:validTo};
}

export function deletePartyPriceList(db,id){
 identifier(id);const row=db.prepare('SELECT 1 FROM party_price_lists WHERE id=?').get(id);if(!row)throw Error('قائمة السعر غير موجودة');
 db.prepare('DELETE FROM party_price_lists WHERE id=?').run(id);return{ok:true};
}

// إرجاع كود المستوى السعري النشط للعميل في تاريخ معين (أحدث قائمة صالحة) أو null
export function resolvePartyLevel(db,partyId,date){
 if(!partyId)return null;
 const row=db.prepare("SELECT pl.code FROM party_price_lists ppl JOIN price_levels pl ON pl.id=ppl.level_id WHERE ppl.party_id=? AND ppl.valid_from<=? AND (ppl.valid_to IS NULL OR ppl.valid_to>=?) AND pl.active=1 ORDER BY ppl.valid_from DESC LIMIT 1").get(partyId,date,date);
 return row?row.code:null;
}