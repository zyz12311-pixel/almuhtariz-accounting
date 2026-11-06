import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../server/index.js';
import { untlv, nowRiyadh } from '../server/lib.js';
import { evaluate } from '../server/license.js';
import { INIT_HASH } from '../server/core.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'smartz-'));
const { server, db } = createApp({ dbFile: path.join(dir, 't.db'), licensePath: path.join(dir, 'license.json') });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let cookie = '';
const call = async (m, p, body, ck = cookie, raw = false) => {
  const r = await fetch(base + p, { method: m, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return r;
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { st: r.status, j, r };
};
let n = 0; const ok = (name) => console.log(`  ✓ ${++n}. ${name}`);

assert.equal((await call('GET', '/api/state')).j.setup_needed, true); ok('أول تشغيل يطلب الإعداد');
assert.equal((await call('POST', '/api/setup', { username: 'owner', password: '123', company_name: 'شركة' })).st, 400); ok('كلمة مرور قصيرة مرفوضة');
assert.equal((await call('POST', '/api/setup', { username: 'owner', password: 'password123', company_name: 'محل الاختبار' })).st, 200);
assert.equal((await call('POST', '/api/setup', { username: 'x', password: 'password123', company_name: 'y' })).st, 403); ok('الإعداد مرة واحدة فقط');
assert.equal((await call('GET', '/api/parties')).st, 401); ok('الواجهة محمية بتسجيل الدخول');
assert.equal((await call('POST', '/api/login', { username: 'owner', password: 'wrong' })).st, 401);
const lg = await call('POST', '/api/login', { username: 'owner', password: 'password123' });
cookie = lg.r.headers.get('set-cookie').split(';')[0]; ok('تسجيل الدخول');
assert.equal((await call('POST', '/api/parties', null, cookie, true)).status, 415); ok('رفض الطلبات غير JSON (حماية CSRF)');

const line = [{ description: 'كرسي', qty: 5, unit_price: 100, vat_rate: 15 }, { description: 'تنسيق', qty: 1, unit_price: 1000 }];
let r = await call('POST', '/api/invoices', { lines: line });
assert.equal(r.st, 400); assert.match(r.j.error, /الرقم الضريبي/); ok('لا إصدار قبل إكمال الرقم الضريبي');
assert.equal((await call('PUT', '/api/settings/company', { vat_number: '123' })).st, 400); ok('رقم ضريبي غير صالح مرفوض');
await call('PUT', '/api/settings/company', { name_ar: 'محل الاختبار', vat_number: '300000000000003',cr_number:'1234567890',street:'شارع الاختبار',building_number:'1234',district:'حي الاختبار',city:'الرياض',postal_code:'12345',country_code:'SA' });

const party = (await call('POST', '/api/parties', { name_ar: 'عميل', vat_number: '399999999800003',cr_number:'1234567890',street:'شارع الاختبار',building_number:'1234',district:'حي الاختبار',city:'الرياض',postal_code:'12345',country_code:'SA' })).j.id;
const id1 = (await call('POST', '/api/invoices', { lines: line, party_id: party,supply_date:nowRiyadh().date })).j.id;
let i1 = (await call('GET', '/api/invoices/' + id1)).j;
assert.equal(i1.number, 'A-000001'); assert.equal(i1.subtotal, 150000); assert.equal(i1.vat, 22500); assert.equal(i1.total, 172500);
assert.equal(i1.icv, 1); assert.equal(i1.pih, INIT_HASH); ok('فاتورة: ترقيم، ICV، PIH، مجاميع صحيحة (1500 + 225 = 1725)');
const q = untlv(i1.qr);
assert.equal(q[1], 'محل الاختبار'); assert.equal(q[2], '300000000000003'); assert.equal(q[4], '1725.00'); assert.equal(q[5], '225.00'); ok('QR (TLV): اسم، رقم ضريبي، إجمالي، ضريبة');
const i2 = (await call('GET', '/api/invoices/' + (await call('POST', '/api/invoices', { lines: line })).j.id)).j;
assert.equal(i2.number, 'A-000002'); assert.equal(i2.icv, 2); assert.equal(i2.pih, i1.hash); ok('سلسلة البصمات والعدّاد متصلة');

let tb = (await call('GET', '/api/reports/trial-balance')).j;
assert.equal(tb.balanced, true); assert.equal(tb.total_debit, '3450.00'); ok('ميزان المراجعة متوازن');
assert.throws(() => db.prepare("UPDATE invoices SET total=1 WHERE id=?").run(id1), /غير قابلة للتعديل/);
assert.throws(() => db.prepare("DELETE FROM invoices WHERE id=?").run(id1), /غير قابلة للحذف/);
assert.throws(() => db.prepare("UPDATE journal_lines SET debit=1 WHERE id=1").run(), /غير قابلة/);
assert.throws(() => db.prepare("DELETE FROM invoice_lines WHERE invoice_id=?").run(id1), /مقفلة/); ok('الفاتورة والقيود الصادرة مقفلة على مستوى قاعدة البيانات');

r = await call('POST', `/api/invoices/${id1}/credit-note`, { lines: [{ line_no: 1, qty: 9 }], reason: 'x' });
assert.equal(r.st, 400); assert.match(r.j.error, /أكبر من المتبقي/);
assert.equal((await call('POST', `/api/invoices/${id1}/credit-note`, { lines: [{ line_no: 1, qty: 1 }] })).st, 400); ok('إشعار دائن: سبب مطلوب ولا يتجاوز المتبقي');
const cn = (await call('POST', `/api/invoices/${id1}/credit-note`, { lines: [{ line_no: 1, qty: 2 }], reason: 'إرجاع كرسيين' })).j.id;
const cni = (await call('GET', '/api/invoices/' + cn)).j;
assert.equal(cni.type, '381'); assert.equal(cni.number, 'A-000003'); assert.equal(cni.total, 23000); assert.equal(cni.ref_number, 'A-000001'); ok('إشعار دائن جزئي (كرسيان = 230.00) يرث التسلسل نفسه');
assert.equal((await call('GET', '/api/invoices/' + id1)).j.lines[0].remaining, 3); ok('المتبقي القابل للإرجاع يُحدَّث');

const today = (await call('GET', '/api/state')).j.today;
assert.equal(today, nowRiyadh().date); ok('التاريخ المرجعي بتوقيت الرياض');
const v = (await call('GET', `/api/reports/vat?from=${today}&to=${today}`)).j;
assert.equal(v.output_vat, '420.00'); assert.equal(v.input_vat, '0.00'); assert.equal(v.net_due, '420.00'); ok('تقرير الضريبة بعد الإشعار: 225+225-30 = 420');
assert.equal((await call('GET', '/api/reports/trial-balance')).j.balanced, true);
assert.equal((await call('GET', '/api/dashboard')).j.month, today.slice(0, 7)); ok('لوحة التحكم تستخدم شهر الرياض');

r = await call('POST', '/api/pos', { name: 'نقطة 2', prefix: 'B' });
assert.equal(r.st, 403); assert.match(r.j.error, /الحد المرخّص/); ok('الترخيص التجريبي يمنع نقطة بيع ثانية');

const png = 'data:image/png;base64,iVBORw0KGgo=';
assert.equal((await call('PUT', '/api/settings/invoice', { logo: 'javascript:alert(1)' })).st, 400);
await call('PUT', '/api/settings/invoice', { logo: png, logoPosition: 'left', headerText: 'الرياض - حي النخيل', paper: 'A5', evil: 'x' });
const html = (await call('GET', `/api/invoices/${id1}/html`)).j;
assert.ok(!html.includes(png) && html.includes('الرياض - حي النخيل') && html.includes('row-reverse') && html.includes('size:A5')); ok('قالب الطباعة يتغير وتبقى لقطة شعار الفاتورة القديمة محفوظة');
assert.ok(!JSON.stringify((await call('GET', '/api/settings/invoice')).j).includes('evil')); ok('مفاتيح الإعدادات غير المعروفة تُتجاهل');
const pv = (await call('POST', '/api/invoice-preview', { settings: { title: 'عنوان مخصص', accent: '#ff0000' } })).j;
assert.ok(pv.includes('عنوان مخصص') && pv.includes('#ff0000') && pv.includes('معاينة')); ok('المعاينة الحية تقبل إعدادات غير محفوظة');
assert.ok(pv.includes('data-v='), 'QR موجود دائمًا'); ok('رمز QR لا يمكن إخفاؤه');

assert.equal((await call('POST', '/api/users', { username: 'cashier', password: 'password123', role: 'staff' })).st, 200);
const sl = await call('POST', '/api/login', { username: 'cashier', password: 'password123' });
const sc = sl.r.headers.get('set-cookie').split(';')[0];
assert.equal((await call('PUT', '/api/settings/ui', { theme: 'dark' }, sc)).st, 403);
assert.equal((await call('GET', '/api/backup', null, sc)).st, 403); ok('الموظف لا يغيّر الإعدادات ولا ينزّل النسخ الاحتياطية');
assert.equal((await call('POST', '/api/users', { username: 'c2', password: 'password123', role: 'staff' })).st, 403); ok('حد المستخدمين في الترخيص التجريبي يعمل (2)');

const bk = await call('GET', '/api/backup', null, cookie, true);
assert.equal(Buffer.from(await bk.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3'); ok('نسخة احتياطية صالحة بصيغة SQLite');


// Independent print profiles and fixed invoice fields.
const accountantBefore=(await call('GET','/api/settings/invoice')).j;
assert.equal((await call('PUT','/api/settings/invoice_pos',{paper:'80mm',headerText:'ترويسة نقطة البيع',footerText:'ذيل نقطة البيع',marginLeft:3,marginRight:3})).st,200);
assert.deepEqual((await call('GET','/api/settings/invoice')).j,accountantBefore);
const thermal=(await call('GET',`/api/invoices/${id1}/html?profile=pos`)).j;
assert.ok(thermal.includes('ترويسة نقطة البيع') && thermal.includes('ذيل نقطة البيع') && thermal.includes('80mm'));
assert.ok(!html.includes('ترويسة نقطة البيع'));
assert.equal((await call('GET',`/api/invoices/${id1}/html`,null,sc)).st,403);
assert.equal((await call('PUT','/api/settings/invoice_pos',{paper:'A4'},sc)).st,403);
assert.ok(thermal.includes('الرقم الضريبي')&&thermal.includes('ضريبة القيمة المضافة')&&thermal.includes('data-v=')&&thermal.includes('A-000001'));
assert.equal((await call('PUT','/api/settings/invoice_pos',{fontSize:2})).st,400);
assert.equal((await call('PUT','/api/settings/invoice_pos',{marginLeft:24,marginRight:24})).st,400);
assert.equal((await call('PUT','/api/settings/company',{activity:'events',cr_number:'1234567890',logo:png})).st,200);
assert.equal((await call('GET','/api/state')).j.activity,'events');
assert.equal((await call('PUT','/api/settings/company',{activity:'unknown'})).st,400);
const unsavedPreview=(await call('POST','/api/invoice-preview',{profile:'pos',company:{name_ar:'منشأة المعاينة فقط',cr_number:'1234567890',logo:png},settings:{headerText:'معاينة غير محفوظة'}})).j;
assert.ok(unsavedPreview.includes('منشأة المعاينة فقط')&&unsavedPreview.includes(png)&&unsavedPreview.includes('1234567890'));
assert.notEqual((await call('GET','/api/settings/company')).j.name_ar,'منشأة المعاينة فقط');
assert.equal((await call('GET',`/api/invoices/${id1}/html?profile=wrong`)).st,400);
ok('قالبان مستقلان، مقاييس صحيحة، هوية منشأة مشتركة، وثوابت الفاتورة محفوظة');

// الترخيص الموقّع
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pub = path.join(dir, 'pub.pem'), lp = path.join(dir, 'lic.json');
fs.writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }));
const sign = p => { const b = Buffer.from(JSON.stringify(p)); fs.writeFileSync(lp, JSON.stringify({ payload: b.toString('base64'), sig: crypto.sign(null, b, privateKey).toString('base64') })); };
sign({ customer: 'ع', vat_number: '300000000000003',cr_number:'1234567890',street:'شارع الاختبار',building_number:'1234',district:'حي الاختبار',city:'الرياض',postal_code:'12345',country_code:'SA', max_pos: 3, max_users: 5, expires: '2099-01-01' });
let L = evaluate(lp, '300000000000003', '2026-10-25', pub); assert.equal(L.status, 'valid'); assert.equal(L.max_pos, 3);
assert.equal(evaluate(lp, '399999999999993', '2026-10-25', pub).status, 'mismatch');
sign({ vat_number: '300000000000003',cr_number:'1234567890',street:'شارع الاختبار',building_number:'1234',district:'حي الاختبار',city:'الرياض',postal_code:'12345',country_code:'SA', max_pos: 3, expires: '2020-01-01' }); L = evaluate(lp, '300000000000003', '2026-10-25', pub);
assert.equal(L.status, 'expired'); assert.equal(L.readOnly, true);
const obj = JSON.parse(fs.readFileSync(lp)); obj.payload = Buffer.from(JSON.stringify({ max_pos: 99 })).toString('base64'); fs.writeFileSync(lp, JSON.stringify(obj));
assert.equal(evaluate(lp, '300000000000003', '2026-10-25', pub).status, 'invalid'); ok('الترخيص: صالح، رقم ضريبي مختلف، منتهٍ (قراءة فقط)، ومعدَّل مرفوض');

assert.equal((await call('GET','/api/sync/status')).j.pending,3);
assert.equal((await call('GET','/api/reports/trial-balance',null,sc)).st,403);
assert.equal((await call('POST',`/api/invoices/${id1}/credit-note`,{lines:[{line_no:1,qty:1}],reason:'test'},sc)).st,403);
server.close(); db.close(); console.log(`\nنجحت ${n} مجموعة اختبارات`);
