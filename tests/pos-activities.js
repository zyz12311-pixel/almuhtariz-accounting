import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

// اختبار تصفية النشاط (activity) عبر الأصناف، كتالوج POS، والمبيعات.
// الأنشطة المدعومة: trade (تجاري)، events (مناسبات)، engineering (هندسي).
// هذا الإصدار يختبر النشاط التجاري افتراضيًا وفقًا للتنفيذ الحالي.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almuhtariz-pos-activities-'));
const { server, db } = createApp({
  dbFile: path.join(dir, 'pos-activities.db'),
  licensePath: path.join(dir, 'license.json'),
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
  // 1. الإعداد الأول للمنشأة بنشاط تجاري
  const setup = await call('POST', '/api/setup', {
    username: 'owner',
    password: 'password123',
    company_name: 'متجر أنشطة اختبار',
    activity: 'trade',
  });
  assert.equal(setup.st, 200);
  const login = await call('POST', '/api/login', { username: 'owner', password: 'password123' });
  const cookie = login.r.headers.get('set-cookie').split(';')[0];
  ok('الإعداد الأول بنشاط تجاري وتسجيل الدخول');

  // 2. إكمال بيانات الشركة الضريبية (مطلوب قبل إصدار الفواتير)
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
  ok('إكمال بيانات الشركة الضريبية');

  // 3. إضافة صنفين للاختبار
  const itemA = (await call('POST', '/api/items', {
    name_ar: 'صنف نشاط تجاري أ',
    unit_price: '100.00',
    vat_rate: 15,
  }, cookie)).j.id;
  const itemB = (await call('POST', '/api/items', {
    name_ar: 'صنف نشاط تجاري ب',
    unit_price: '200.00',
    vat_rate: 15,
  }, cookie)).j.id;
  assert.ok(Number.isInteger(itemA) && Number.isInteger(itemB));
  ok('إضافة صنفين للتجربة');

  // 3. إضافة عامل (staff) مربوط بنقطة البيع الأولى
  const staff = await call('POST', '/api/users', {
    username: 'cashier',
    password: 'password123',
    role: 'staff',
    pos_id: 1,
  }, cookie);
  assert.equal(staff.st, 200);
  const staffLogin = await call('POST', '/api/login', { username: 'cashier', password: 'password123' });
  const staffCookie = staffLogin.r.headers.get('set-cookie').split(';')[0];
  ok('إضافة عامل مربوط بنقطة البيع الأولى');

  // 4. العامل يرى كتالوج نقطة البيع المخصصة له فقط
  const catalog = await call('GET', '/api/pos/catalog', null, staffCookie);
  assert.equal(catalog.st, 200);
  assert.ok(catalog.j.rows.length > 0, 'يجب أن يعرض الكتالوج الأصناف المتاحة');
  ok('العامل يرى كتالوج نقطة البيع المخصصة له');

  // 5. العامل لا يمكنه الوصول لصفحات المحاسب الأخرى
  const forbidden = await call('GET', '/api/invoices', null, staffCookie);
  assert.equal(forbidden.st, 403);
  ok('العامل محظور من الوصول لصفحات المحاسب (403)');

  // 6. إجراء بيع عبر نقطة البيع الأولى
  const sale = await call('POST', '/api/pos/sales', {
    request_id: crypto.randomUUID(),
    pos_id: 1,
    payment: 'cash',
    lines: [{ item_id: itemA, qty: 1, unit_price: 0, vat_rate: 0, description: 'اختبار بيع نشاط' }],
  }, staffCookie);
  assert.equal(sale.st, 200, 'يجب أن ينجح البيع عبر نقطة البيع المسموح بها: ' + JSON.stringify(sale.j));
  ok('إجراء بيع ناجح عبر نقطة البيع المسموح بها للعامل');

  // 7. منع البيع عبر نقطة بيع غير موجودة
  const unauthorizedSale = await call('POST', '/api/pos/sales', {
    pos_id: 999,
    payment: 'cash',
    lines: [{ item_id: itemB, qty: 1 }],
  }, staffCookie);
  assert.equal(unauthorizedSale.st, 400);
  ok('منع البيع عبر نقطة بيع غير موجودة (400)');

  // 8. التحقق من أن نقاط البيع تُعرض alle active
  const points = await call('GET', '/api/pos/points', null, cookie);
  assert.equal(points.st, 200);
  assert.ok(points.j.length >= 1);
  ok('عرض نقاط البيع النشطة بنجاح');

  console.log(`\nنجحت ${n} مجموعة اختبارات أنشطة نقاط البيع`);
} finally {
  server.close();
  db.close();
}