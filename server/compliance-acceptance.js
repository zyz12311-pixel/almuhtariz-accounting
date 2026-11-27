const items = [
  ['standard-invoice', 'فاتورة ضريبية — 388', 'محلي ورسمي'],
  ['standard-credit-note', 'إشعار دائن ضريبي — 381', 'محلي ورسمي'],
  ['standard-debit-note', 'إشعار مدين ضريبي — 383', 'محلي ورسمي'],
  ['simplified-invoice', 'فاتورة مبسطة — 388', 'محلي ورسمي'],
  ['simplified-credit-note', 'إشعار دائن مبسط — 381', 'محلي ورسمي'],
  ['simplified-debit-note', 'إشعار مدين مبسط — 383', 'محلي ورسمي'],
  ['xml-hash', 'تطابق بصمة XML مع SDK', 'رسمي'],
  ['digital-signature', 'التحقق من التوقيع الرقمي', 'محلي ورسمي'],
  ['qr-code', 'التحقق من QR', 'محلي ورسمي'],
  ['icv-pih', 'تسلسل ICV وPIH', 'محلي ورسمي'],
  ['concurrent-issuance', 'اختبار الإصدار المتزامن', 'محلي'],
  ['network-interruption', 'اختبار انقطاع الاتصال', 'محلي'],
  ['certificate-expiry', 'اختبار الشهادة المنتهية والملغاة', 'محلي'],
  ['backup-restore', 'اختبار النسخ والاستعادة', 'محلي'],
  ['entity-isolation', 'اختبار استقلال منشأتين', 'محلي'],
  ['accounting-regression', 'إعادة الاختبارات المحاسبية الشاملة', 'محلي'],
].map(([id, label, scope]) => Object.freeze({ id, label, scope, status: 'pending', evidence: null }));

export function complianceAcceptance() {
  return { total: items.length, passed: 0, pending: items.length, items };
}
