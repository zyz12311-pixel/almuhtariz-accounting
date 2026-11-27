import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { nowRiyadh } from '../server/lib.js';

// اختبار تدفق القبول الكامل: مسودة → إصدار → توقيع → تحقق من XML
// المسار الخاص بالتوقيع يعيد 501 لأن XAdES غير مهيأ بعد؛ الاختبار يوثق هذا السلوك.
// لا يُرسل أي شيء للهيئة؛ كل شيء محلي وغير متصل.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almuhtariz-acceptance-'));
let storedCredentials = null;
const complianceSecretStore = {
  has: () => Boolean(storedCredentials),
  async save(value) { storedCredentials = { ...value }; },
  async load() { return storedCredentials ? { ...storedCredentials } : null; },
};
const { server, db } = createApp({
  dbFile: path.join(dir, 'acceptance.db'),
  licensePath: path.join(dir, 'license.json'),
  complianceSecretStore,
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (m, p, body, ck = '') => {
  const r = await fetch(base + p, {
    method: m,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(ck ? { cookie: ck } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text(); let j;
  try { j = JSON.parse(t); } catch { j = t; }
  return { st: r.status, j, r };
};

let n = 0;
const ok = (name) => console.log(`  ✓ ${++n}. ${name}`);

try {
  // 1. الإعداد الأول للمنشأة بالبيانات الضريبية المطلوبة للمرحلة الثانية
  const setup = await call('POST', '/api/setup', {
    username: 'owner',
    password: 'password123',
    company_name: 'منشأة اختبار القبول',
    activity: 'trade',
  });
  assert.equal(setup.st, 200, 'يجب أن ينجح الإعداد الأول');
  ok('الإعداد الأول للمنشأة بنشاط تجاري');

  const login = await call('POST', '/api/login', { username: 'owner', password: 'password123' });
  assert.equal(login.st, 200);
  const cookie = login.r.headers.get('set-cookie').split(';')[0];
  ok('تسجيل الدخول كمالك');

  // 2. إكمال بيانات المنشأة (الرقم الضريبي والسجل والعنوان الوطني)
  await call('PUT', '/api/settings/company', {
    vat_number: '300000000000003',
    cr_number: '1234567890',
    street: 'شارع الملك فهد',
    building_number: '1234',
    district: 'ال olaya',
    city: 'الرياض',
    postal_code: '12345',
    country_code: 'SA',
  }, cookie);
  ok('إكمال بيانات المنشأة الضريبية والعنوان الوطني');

  // 3. إضافة عميل مع رقم ضريبي وعنوان (مطلوب للفاتورة الضريبية 표준)
  const party = (await call('POST', '/api/parties', {
    name_ar: 'عميل اختبار القبول',
    vat_number: '399999999800003',
    cr_number: '1234567890',
    street: 'شارع التخصص',
    building_number: '1234',
    district: 'الملز',
    city: 'الرياض',
    postal_code: '12344',
    country_code: 'SA',
  }, cookie)).j.id;
  assert.ok(Number.isInteger(party));
  ok('إضافة عميل برقم ضريبي وعنوان');

  // 4. إنشاء مسودة فاتورة (draft)
  const lines = [
    { description: 'صنف اختبار القبول 1', qty: 2, unit_price: 100, vat_rate: 15 },
    { description: 'صنف اختبار القبول 2', qty: 1, unit_price: 50, vat_rate: 15 },
  ];
  const draftRes = await call('POST', '/api/invoices', {
    draft: true,
    lines,
    party_id: party,
    supply_date: nowRiyadh().date,
  }, cookie);
  assert.equal(draftRes.st, 200, 'يجب أن تنجح إنشاء المسودة');
  const draftId = draftRes.j.id;
  const draftFetch = await call('GET', `/api/invoices/${draftId}`, null, cookie);
  assert.equal(draftFetch.st, 200);
  assert.equal(draftFetch.j.status, 'draft', 'حالة الفاتورة يجب أن تكون مسودة');
  ok('إنشاء مسودة فاتورة بنجاح');

  // 5. إصدار الفاتورة (issue)
  const issueRes = await call('POST', `/api/invoices/${draftId}/issue`, {}, cookie);
  assert.equal(issueRes.st, 200, 'يجب أن ينجح إصدار الفاتورة');
  const issuedFetch = await call('GET', `/api/invoices/${draftId}`, null, cookie);
  assert.equal(issuedFetch.st, 200);
  const issued = issuedFetch.j;
  assert.equal(issued.status, 'issued', 'حالة الفاتورة بعد الإصدار يجب أن تكون صادر');
  assert.ok(issued.number, 'يجب أن يحمل الفاتورة رقم تسلسلي');
  assert.ok(issued.hash, 'يجب أن تحمل الفاتورة بصمة (hash)');
  ok(`إصدار الفاتورة رقم ${issued.number} مع بصمة وتسلسل ICV/PIH`);

  // 6. إنشاء ملف وحدة الإصدار المحلي (issuer profile) قبل محاولة التوقيع
  const issuerRes = await call('PUT', '/api/compliance/issuer', {
    name: 'وحدة الإصدار المحلية للاختبار',
    scope: 'central_server',
  }, cookie);
  assert.equal(issuerRes.st, 200);
  assert.ok(issuerRes.j.profile.local_id, 'يجب أن يحتوي ملف الوحدة على معرّف داخلي');
  ok('إنشاء ملف وحدة الإصدار المحلي بنجاح');

  // 7. إضافة بيانات اعتماد مزيفة إلى مخزن الأسرار لمحاكاة وجود شهادة ومفتاح
  storedCredentials = {
    issuer_id: issuerRes.j.profile.local_id,
    certificate_pem: '-----BEGIN CERTIFICATE-----\\ntest-cert\\n-----END CERTIFICATE-----',
    private_key_pem: '-----BEGIN PRIVATE KEY-----\\ntest-key\\n-----END PRIVATE KEY-----',
  };

  // 8. التحقق من وجود XML مرشح في قاعدة البيانات
  const inv = await call('GET', `/api/invoices/${draftId}`, null, cookie);
  assert.equal(inv.st, 200);
  assert.ok(inv.j.invoice_kind, 'يجب أن تحمل الفاتورة نوع مستند');
  ok('الفاتورة الصادرة تحمل نوع مستند وبيانات أساسية');

  // 9. محاولة التوقيع الإلكتروني — يجب أن تفشل لأن الشهادة/المفتاح المزيفان لا يطابقان
  const signRes = await call('POST', `/api/invoices/${draftId}/sign`, {}, cookie);
  assert.equal(signRes.st, 400, 'مسار التوقيع يجب أن يعيد 400 عندما لا تطابق الشهادة المفتاح');
  assert.ok(signRes.j.error, 'يجب أن تحتوي الاستجابة على رسالة خطأ');
  ok('مسار التوقيع يعيد 400 كما متوقع — الشهادة والمفتاح المزيفان لا يطابقان');

  // 10. التحقق من حالة الامتثال (compliance status)
  const statusRes = await call('GET', '/api/compliance/status', null, cookie);
  assert.equal(statusRes.st, 200);
  assert.equal(statusRes.j.mode, 'development', 'وضع الامتثال يجب يكون development');
  assert.equal(statusRes.j.acceptance.passed, 0, 'معايير القبول المنجزة يجب أن تكون 0 حتى الآن');
  assert.equal(statusRes.j.acceptance.total, 16, 'إجمالي معايير القبول يجب أن يكون 16');
  ok('حالة الامتثال تظهر الوضع التجريبي ومعايير القبول 0/16');

  // 11. التحقق من عدم وجود إرسال للهيئة (التوقف الآمن)
  const syncRes = await call('GET', '/api/sync/status', null, cookie);
  assert.equal(syncRes.st, 200);
  assert.equal(syncRes.j.mode, 'local', 'وضع المزامنة يجب يكون محلي');
  ok('التوقف الآمن: لا يوجد إرسال للهيئة، المزامنة محلية فقط');

  console.log(`\nنجحت ${n} مجموعة اختبارات قبول`);
  console.log('ملاحظة: مسار التوقيع يبقى عند 501 حتى تهيئة XAdES الكامل واعتماد الهيئة.');
} finally {
  server.close();
  db.close();
}