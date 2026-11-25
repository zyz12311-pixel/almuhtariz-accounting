import {tx} from './db.js';
const identifier=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw Error('معرف غير صالح');return n;};
const priceCents=value=>{const n=Number(scaledInteger(value,2,'السعر'));if(!Number.isSafeInteger(n)||n<0)throw Error('السعر غير صالح');return n;};
import {scaledInteger} from './money.js';

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
 if(code!==row.code&&db.prepare('SELECT 1 FROM price_levels WHERE code=?').get(code))throw Error('كود المستوى مستخدم مسبقًا');
 if(typeof body.active==='boolean')db.prepare('UPDATE price_levels SET active=? WHERE id=?').run(body.active?1:0,id);
 db.prepare('UPDATE price_levels SET code=?,name_ar=? WHERE id=?').run(code,name_ar,id);
 return db.prepare('SELECT id,code,name_ar,active,is_builtin,created_at FROM price_levels WHERE id=?').get(id);
}

export function deletePriceLevel(db,id){
 identifier(id);const row=db.prepare('SELECT * FROM price_levels WHERE id=?').get(id);if(!row)throw Error('المستوى السعري غير موجود');
 if(row.is_builtin)throw Error('لا يمكن حذف مستوى سعري أساسي (التجزئة أو الجملة)');
 const used=db.prepare('SELECT 1 FROM item_price_levels WHERE level_id=? LIMIT 1').get(id);
 if(used)throw Error('لا يمكن حذف المستوى السعري لأنه مستخدم في أسعار الأصناف');
 db.prepare('DELETE FROM price_levels WHERE id=?').run(id);return{ok:true};
}

export function listItemPriceLevels(db,itemId){
 identifier(itemId);if(!db.prepare('SELECT 1 FROM items WHERE id=?').get(itemId))throw Error('الصنف غير موجود');
 return db.prepare('SELECT pl.id,pl.code,pl.name_ar,ipl.unit_price FROM item_price_levels ipl JOIN price_levels pl ON pl.id=ipl.level_id WHERE ipl.item_id=? ORDER BY pl.code').all(itemId).map(r=>({...r,unit_price:r.unit_price/100}));
}

export function setItemPriceLevel(db,itemId,body){
 identifier(itemId);if(!db.prepare('SELECT 1 FROM items WHERE id=?').get(itemId))throw Error('الصنف غير موجود');
 const level=identifier(body.level_id);const price=priceCents(body.unit_price);
 const levelRow=db.prepare('SELECT * FROM price_levels WHERE id=? AND active=1').get(level);if(!levelRow)throw Error('المستوى السعري غير مفعل أو غير موجود');
 const existing=db.prepare('SELECT 1 FROM item_price_levels WHERE item_id=? AND level_id=?').get(itemId,level);
 if(existing)db.prepare('UPDATE item_price_levels SET unit_price=? WHERE item_id=? AND level_id=?').run(price,itemId,level);
 else db.prepare('INSERT INTO item_price_levels(item_id,level_id,unit_price) VALUES(?,?,?)').run(itemId,level,price);
 const row=db.prepare('SELECT pl.id,pl.code,pl.name_ar,ipl.unit_price FROM item_price_levels ipl JOIN price_levels pl ON pl.id=ipl.level_id WHERE ipl.item_id=? AND pl.id=?').get(itemId,level);return{...row,unit_price:row.unit_price/100};
}

// resolve selling price for a product (item or unit) at a given level (cents)
// priceLabel=true (سعر مغلف من الميزان) يُحفظ السعر الأساسي ولا يُطبّق أي تجاوز للمستوى
export function itemPriceAtLevel(db,itemId,product,level,priceLabel=false){
 if(priceLabel)return product.unit_price;
 const row=db.prepare('SELECT ipl.unit_price level_price FROM item_price_levels ipl WHERE ipl.item_id=? AND ipl.level_id=(SELECT id FROM price_levels WHERE code=? AND active=1 LIMIT 1)').get(itemId,level);
 if(row&&row.level_price!==null)return row.level_price;
 if(level==='wholesale'&&product.wholesale_price!==null)return product.wholesale_price;
 return product.unit_price;
}
