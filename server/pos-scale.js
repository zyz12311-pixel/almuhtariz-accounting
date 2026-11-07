import { getSetting } from './core.js';
import { roundRatio } from './money.js';

export function validateScaleSettings(settings) {
  const {mode, prefix} = settings;
  if (!['off','weight','price'].includes(mode) || typeof prefix !== 'string' || !/^2[0-9]$/.test(prefix)) {
    throw Error('اختر وضع الميزان وبادئة من 20 إلى 29');
  }
  return { mode, prefix };
}

export function scaleLabel(db, code) {
  const {mode, prefix} = getSetting(db, 'pos_scale');
  if (mode === 'off' || !code?.startsWith(prefix) || !/^\d{13}$/.test(code)) return null;
  const ordinary = db.prepare(`SELECT 1 FROM items WHERE barcode=? AND active=1
    UNION ALL SELECT 1 FROM item_units u JOIN items i ON i.id=u.item_id
    WHERE u.barcode=? AND u.active=1 AND i.active=1 LIMIT 1`).get(code, code);
  if (ordinary) return null;
  const digits = [...code].map(Number);
  const checksum = digits.reduce((sum, digit, index) => sum + digit * (index % 2 ? 3 : 1), 0);
  if (checksum % 10) throw Error('رقم التحقق في ملصق الميزان غير صحيح');
  const item = db.prepare("SELECT id,unit_price FROM items WHERE scale_plu=? AND active=1 AND unit_code='KGM' AND item_kind='product' AND tracking_mode<>'serial'").get(code.slice(2, 7));
  if (!item) throw Error('رمز الصنف في ملصق الميزان غير مسجل لصنف بالكيلوجرام');
  const encoded = BigInt(code.slice(7, 12));
  if (!encoded) throw Error('الوزن أو السعر في ملصق الميزان يساوي صفرًا');
  let quantityMicro = Number(encoded * 1000n);
  if (mode === 'price') {
    if (!item.unit_price) throw Error('حدد سعر التجزئة لكل كيلوجرام لقراءة ملصق السعر');
    const centsPerKg = BigInt(item.unit_price);
    quantityMicro = roundRatio(encoded * 1000000n, centsPerKg);
    if (!quantityMicro || roundRatio(BigInt(quantityMicro) * centsPerKg, 1000000n) !== Number(encoded)) {
      throw Error('تعذر مطابقة قيمة ملصق الميزان مع سعر الكيلوجرام المسجل');
    }
  }
  return { itemId: item.id, qty: quantityMicro / 1000000, mode };
}
