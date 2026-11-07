import { pageQuery, paged } from './paging.js';
import { normalizeBarcode } from './pos.js';

// Keep the cashier projection independent of the inventory management endpoint.
const itemFields = 'i.id,i.name_ar,i.unit_price,i.vat_rate,i.barcode,i.tax_category,i.exemption_code,i.exemption_reason,i.sku,i.base_unit,i.unit_code,i.track_stock,i.tracking_mode,i.expiry_required';
const unitFields = 'id,item_id,name,unit_code,factor_micro,unit_price,barcode';
const placeholders = ids => ids.map(() => '?').join(',');

function sellable(item, unit = null) {
  return {
    ...item,
    name_ar: unit ? `${item.name_ar} — ${unit.name}` : item.name_ar,
    base_unit: unit?.name ?? item.base_unit,
    unit_code: unit?.unit_code ?? item.unit_code,
    barcode: unit ? unit.barcode : item.barcode,
    unit_price: (unit?.unit_price ?? item.unit_price) / 100,
    item_unit_id: unit?.id ?? null,
    unit_factor_micro: unit?.factor_micro ?? 1000000,
  };
}

export function posCatalog(db, query) {
  const params = { page_size: 24, ...query };
  const { q, like, page_size } = pageQuery(params);
  if (page_size > 50) throw Error('الحد الأقصى للصفحة 50 صنفًا');
  const result = paged(db, {
    select: itemFields,
    from: 'items i',
    where: `i.active=1${q ? String.raw` AND (i.name_ar LIKE ? ESCAPE '\' OR i.sku LIKE ? ESCAPE '\' OR i.barcode LIKE ? ESCAPE '\' OR EXISTS (
      SELECT 1 FROM item_units u WHERE u.item_id=i.id AND u.active=1 AND (u.barcode LIKE ? ESCAPE '\' OR u.name LIKE ? ESCAPE '\')
    ))` : ''}`,
    params: q ? [like, like, like, like, like] : [],
    order: 'i.name_ar,i.id',
  }, params);
  if (!result.rows.length) return result;

  const ids = result.rows.map(item => item.id);
  const unitsByItem = new Map();
  const units = db.prepare(`SELECT ${unitFields} FROM item_units WHERE active=1 AND item_id IN (${placeholders(ids)}) ORDER BY id`).all(...ids);
  for (const unit of units) {
    if (!unitsByItem.has(unit.item_id)) unitsByItem.set(unit.item_id, []);
    unitsByItem.get(unit.item_id).push(unit);
  }
  return { ...result, rows: result.rows.flatMap(item => [sellable(item), ...(unitsByItem.get(item.id) ?? []).map(unit => sellable(item, unit))]) };
}

export function posBarcode(db, value) {
  const barcode = normalizeBarcode(value);
  if (!barcode) throw Error('أدخل الباركود');
  const base = db.prepare(`SELECT ${itemFields} FROM items i WHERE i.barcode=? AND i.active=1`).get(barcode);
  if (base) return sellable(base);

  const unit = db.prepare(`SELECT ${unitFields} FROM item_units WHERE barcode=? AND active=1`).get(barcode);
  if (!unit) return null;
  const item = db.prepare(`SELECT ${itemFields} FROM items i WHERE i.id=? AND i.active=1`).get(unit.item_id);
  return item ? sellable(item, unit) : null;
}

// Resolve only the item/unit pairs present in an existing browser draft.
export function posSelection(db, keys) {
  const pairs = String(keys ?? '').split(',');
  if (pairs.length > 200 || pairs.some(key => !/^[1-9]\d*:(0|[1-9]\d*)$/.test(key))) throw Error('بنود السلة غير صالحة');
  const selection = [...new Set(pairs)].map(key => key.split(':').map(Number));
  if (selection.some(pair => pair.some(id => !Number.isSafeInteger(id)))) throw Error('بنود السلة غير صالحة');

  const itemIds = [...new Set(selection.map(([item]) => item))];
  const unitIds = [...new Set(selection.map(([, unit]) => unit).filter(Boolean))];
  const items = new Map(db.prepare(`SELECT ${itemFields} FROM items i WHERE i.active=1 AND i.id IN (${placeholders(itemIds)})`).all(...itemIds).map(item => [item.id, item]));
  const units = new Map(unitIds.length ? db.prepare(`SELECT ${unitFields} FROM item_units WHERE active=1 AND id IN (${placeholders(unitIds)})`).all(...unitIds).map(unit => [unit.id, unit]) : []);
  return selection.flatMap(([itemId, unitId]) => {
    const item = items.get(itemId), unit = units.get(unitId);
    return item && (!unitId || unit?.item_id === itemId) ? [sellable(item, unit)] : [];
  });
}
