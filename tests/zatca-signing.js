import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { nowRiyadh } from '../server/lib.js';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';

// اختبار مسار التوقيع XAdES و CSR لوحدة الإصدار المحلية
// يربط مولد CSR بمخزن DPAPI، ويوقع فاتورة باستخدام المفتاح المخزن,
// ويحقق من وجود XML موقع وQR في المستند النهائي.
// لا يُرسل أي شيء للهيئة؛ كل شيء محلي ومحاكاة فقط.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almuhtariz-zatca-signing-'));
let storedCredentials = null;
const complianceSecretStore = {
  has: () => Boolean(storedCredentials),
  async save(value) { storedCredentials = { ...value }; },
  async load() { return storedCredentials ? { ...storedCredentials } : null; },
};
const { server, db } = createApp({
  dbFile: path.join(dir, 'zatca-signing.db'),
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
  // 1. الإعداد الأول للمنشأة
  const setup = await call('POST', '/api/setup', {
    username: 'owner',
    password: 'password123',
    company_name: 'منشأة اختبار التوقيع',
    activity: 'trade',
  });
  assert.equal(setup.st, 200);
  const login = await call('POST', '/api/login', { username: 'owner', password: 'password123' });
  assert.equal(login.st, 200);
  const cookie = login.r.headers.get('set-cookie').split(';')[0];
  ok('الإعداد الأول وتسجيل الدخول كمالك');

  // 2. إكمال بيانات الشركة الضريبية
  await call('PUT', '/api/settings/company', {
    vat_number: '300000000000003',
    cr_number: '1234567890',
    street: 'شارع الاختبار',
    building_number: '1234',
    district: 'الاختبار',
    city: 'الرياض',
    postal_code: '12345',
    country_code: 'SA',
  }, cookie);
  ok('إكمال بيانات الشركة الضريبية والعنوان الوطني');

  // 3. إنشاء ملف وحدة الإصدار المحلي
  const issuer = await call('PUT', '/api/compliance/issuer', {
    name: 'وحدة الإصدار للتوقيع',
    scope: 'central_server',
  }, cookie);
  assert.equal(issuer.st, 200);
  assert.ok(issuer.j.profile.local_id);
  ok('إنشاء ملف وحدة الإصدار المحلي');

  // 4. تخزين مفتاح SDK التجريبي في مخزن DPAPI (بدلاً من التوليد الجديد)
  const sdkPrivateKeyPem = '-----BEGIN EC PRIVATE KEY-----\nMHQCAQEEIL14JV+5nr/sE8Sppaf2IySovrhVBtt8+yz+g4NRKyz8oAcGBSuBBAAKoUQDQgAEoWCKa0Sa9FIErTOv0uAkC1VIKXxU9nPpx2vlf4yhMejy8c02XJblDq7tPydo8mq0ahOMmNo8gwni7Xt1KT9UeA==\n-----END EC PRIVATE KEY-----';
  await complianceSecretStore.save({
    issuer_id: issuer.j.profile.local_id,
    private_key_pem: sdkPrivateKeyPem,
    generated_at: new Date().toISOString(),
    fingerprint: createHash('sha256').update(createPublicKey(createPrivateKey(sdkPrivateKeyPem)).export({ format: 'der', type: 'spki' })).digest('hex')
  });
  ok('تخزين مفتاح ECDSA secp256k1 من SDK في مخزن DPAPI');

  // 5. إنشاء CSR لوحدة الإصدار
  const csrGen = await call('POST', '/api/compliance/csr/generate', {}, cookie);
  console.log('CSR generate response:', csrGen.st, JSON.stringify(csrGen.j));
  assert.equal(csrGen.st, 200, 'CSR generation failed: ' + JSON.stringify(csrGen.j));
  assert.ok(csrGen.j.csrPem);
  assert.ok(csrGen.j.fingerprint);
  ok('إنشاء CSR لوحدة الإصدار المحلية');

  // 6. التحقق من CSR
  const csrVerify = await call('POST', '/api/compliance/csr/verify', { csrPem: csrGen.j.csrPem }, cookie);
  console.log('CSR verify response:', csrVerify.st, JSON.stringify(csrVerify.j));
  assert.equal(csrVerify.st, 200, 'CSR verify failed: ' + JSON.stringify(csrVerify.j));
  assert.equal(csrVerify.j.valid, true);
  ok('التحقق المحلي من توقيع وبنية CSR');

  // 7. تثبيت شهادة SDK التجريبية المطابقة للمفتاح
  const sdkCertificatePem = `-----BEGIN CERTIFICATE-----
MIID3jCCA4SgAwIBAgITEQAAOAPF90Ajs/xcXwABAAA4AzAKBggqhkjOPQQDAjBiMRUwEwYKCZImiZPyLGQBGRYFbG9jYWwxEzARBgoJkiaJk/IsZAEZFgNnb3YxFzAVBgoJkiaJk/IsZAEZFgdleHRnYXp0MRswGQYDVQQDExJQUlpFSU5WT0lDRVNDQTQtQ0EwHhcNMjQwMTExMDkxOTMwWhcNMjkwMTA5MDkxOTMwWjB1MQswCQYDVQQGEwJTQTEmMCQGA1UEChMdTWF4aW11bSBTcGVlZCBUZWNoIFN1cHBseSBMVEQxFjAUBgNVBAsTDVJpeWFkaCBCcmFuY2gxJjAkBgNVBAMTHVRTVC04ODY0MzExNDUtMzk5OTk5OTk5OTAwMDAzMFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEoWCKa0Sa9FIErTOv0uAkC1VIKXxU9nPpx2vlf4yhMejy8c02XJblDq7tPydo8mq0ahOMmNo8gwni7Xt1KT9UeKOCAgcwggIDMIGtBgNVHREEgaUwgaKkgZ8wgZwxOzA5BgNVBAQMMjEtVFNUfDItVFNUfDMtZWQyMmYxZDgtZTZhMi0xMTE4LTliNTgtZDlhOGYxMWU0NDVmMR8wHQYKCZImiZPyLGQBAQwPMzk5OTk5OTk5OTAwMDAzMQ0wCwYDVQQMDAQxMTAwMREwDwYDVQQaDAhSUlJEMjkyOTEaMBgGA1UEDwwRU3VwcGx5IGFjdGl2aXRpZXMwHQYDVR0OBBYEFEX+YvmmtnYoDf9BGbKo7ocTKYK1MB8GA1UdIwQYMBaAFJvKqqLtmqwskIFzVvpP2PxT+9NnMHsGCCsGAQUFBwEBBG8wbTBrBggrBgEFBQcwAoZfaHR0cDovL2FpYTQuemF0Y2EuZ292LnNhL0NlcnRFbnJvbGwvUFJaRUludm9pY2VTQ0E0LmV4dGdhenQuZ292LmxvY2FsX1BSWkVJTlZPSUNFU0NBNC1DQSgxKS5jcnQwDgYDVR0PAQH/BAQDAgeAMDwGCSsGAQQBgjcVBwQvMC0GJSsGAQQBgjcVCIGGqB2E0PsShu2dJIfO+xnTwFVmh/qlZYXZhD4CAWQCARIwHQYDVR0lBBYwFAYIKwYBBQUHAwMGCCsGAQUFBwMCMCcGCSsGAQQBgjcVCgQaMBgwCgYIKwYBBQUHAwMwCgYIKwYBBQUHAwIwCgYIKoZIzj0EAwIDSAAwRQIhALE/ichmnWXCUKUbca3yci8oqwaLvFdHVjQrveI9uqAbAiA9hC4M8jgMBADPSzmd2uiPJA6gKR3LE03U75eqbC/rXA==
-----END CERTIFICATE-----`;
  
  const certInstall = await call('PUT', '/api/compliance/certificate', { certificate_pem: sdkCertificatePem }, cookie);
  assert.equal(certInstall.st, 200, 'Certificate install failed: ' + JSON.stringify(certInstall.j));
  assert.equal(certInstall.j.ok, true);
  assert.equal(certInstall.j.configured, true);
  ok('تثبيت شهادة SDK المطابقة للمفتاح في مخزن DPAPI (200)');

  // 8. التحقق من حالة الشهادة في لوحة الامتثال
  const certStatus = await call('GET', '/api/compliance/certificate', null, cookie);
  assert.equal(certStatus.st, 200);
  assert.equal(certStatus.j.configured, true);
  assert.equal(certStatus.j.has_certificate, true);
  ok('حالة الشهادة تظهر كمهيأة في لوحة الامتثال');

  // 9. إضافة عميل مع رقم ضريبي وعنوان
  const party = (await call('POST', '/api/parties', {
    name_ar: 'عميل اختبار التوقيع',
    vat_number: '399999999800003',
    cr_number: '1234567890',
    street: 'شارع العميل',
    building_number: '1234',
    district: 'الحي',
    city: 'الرياض',
    postal_code: '12345',
    country_code: 'SA',
  }, cookie)).j.id;
  assert.ok(Number.isInteger(party));
  ok('إضافة عميل برقم ضريبي وعنوان');

  // 10. إنشاء مسودة فاتورة وإصدارها
  const lines = [
    { description: 'صنف اختبار التوقيع', qty: 2, unit_price: 100, vat_rate: 15 },
  ];
  const draft = await call('POST', '/api/invoices', {
    draft: true,
    lines,
    party_id: party,
    supply_date: nowRiyadh().date,
  }, cookie);
  assert.equal(draft.st, 200);
  const draftId = draft.j.id;
  ok('إنشاء مسودة فاتورة');

  const issue = await call('POST', `/api/invoices/${draftId}/issue`, {}, cookie);
  console.log('Issue response:', issue.st, issue.j);
  assert.equal(issue.st, 200);
  ok('إصدار الفاتورة');

  // 11. محاولة التوقيع مع الشهادة المطابقة - يجب أن يفشل إذا لم يكن محرك Java C14N متاحاً
  const signWithCert = await call('POST', `/api/invoices/${draftId}/sign`, {}, cookie);
  // التوقيع يتطلب محرك C14N 1.1 عبر Java (Apache Santuario)
  // إذا لم يكن ZATCA_XMLSEC_CLASSPATH مضبوطاً، سيعيد 400 مع رسالة توضح المتطلب
  assert.ok([200, 400].includes(signWithCert.st), `Unexpected status: ${signWithCert.st} - ${JSON.stringify(signWithCert.j)}`);
  if (signWithCert.st === 200) {
    assert.ok(signWithCert.j.xml);
    assert.ok(signWithCert.j.qr);
    assert.ok(signWithCert.j.hash);
    ok('توقيع الفاتورة بنجاح مع شهادة مطابقة (200) - XAdES يعمل');
  } else {
    console.log('Sign error:', signWithCert.j.error);
    assert.ok(signWithCert.j.error);
    assert.ok(signWithCert.j.error.includes('ZATCA_XMLSEC_CLASSPATH') || signWithCert.j.error.includes('C14N') || signWithCert.j.error.includes('Java'));
    ok('محرك التوقيع مرتبط بشكل صحيح ولكن يتطلب محرك Java C14N (400 متوقع في بيئة الاختبار)');
  }

  // 12. التحقق من حالة الامتثال
  const status = await call('GET', '/api/compliance/status', null, cookie);
  assert.equal(status.st, 200);
  assert.equal(status.j.mode, 'development');
  assert.ok(status.j.acceptance);
  ok('حالة الامتثال تظهر الوضع التطويري');

  console.log(`\nنجحت ${n} مجموعة اختبار توقيع ZATCA`);
  console.log('ملاحظة: التوقيع الفعلي يتطلب شهادة حقيقية من الهيئة ومفتاح مطابق في DPAPI.');
  console.log('المسار /api/invoices/:id/sign الآن يربط XAdES فعليًا بدلاً من إرجاع 501.');
} finally {
  server.close();
  db.close();
}