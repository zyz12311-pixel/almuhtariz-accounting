import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { createComplianceIssuance } from '../server/zatca/issuance.js';
import { hashPass } from '../server/lib.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almuhtariz-zatca-api-'));
const xmlDigest = xml => crypto.createHash('sha256').update(xml, 'utf8').digest('base64');
const apiQr=Buffer.from('api-final-qr','utf8').toString('base64');
const withQr=(xml,qr)=>xml.replace('</Invoice>','<cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject>'+qr+'</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference></Invoice>');
let blockNextClearance=false;
const flow = createComplianceIssuance({
  signer: async ({ invoiceXml, invoiceHash }) => ({ xml: withQr(invoiceXml,apiQr), invoiceHash, qr: apiQr }),
  validateXml: async xml => ({ passed: true, xmlSha256: xmlDigest(xml) }),
  certificateStatus: async () => ({ state: 'valid', expiresAt: '2099-12-31T23:59:59.000Z' }),
  transport: {
    async submit({ operation }) {
      if (operation === 'clearance') {
        if(blockNextClearance)return {state:'blocked',httpStatus:401,reason:'auth: رفضت الهيئة المصادقة'};
        return { state: 'accepted', httpStatus: 200, result: { clearanceStatus: 'CLEARED', clearedInvoice: Buffer.from('<cleared-api/>').toString('base64') } };
      }
      return { state: 'accepted', httpStatus: 200, result: { reportingStatus: 'REPORTED' } };
    },
  },
});
const { server, db } = createApp({
  dbFile: path.join(dir, 'api.db'),
  licensePath: path.join(dir, 'license.json'),
  complianceIssuance: flow,
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, route, body, cookie = '') => {
  const response = await fetch(base + route, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: response.status, json, response };
};

try {
  await call('POST', '/api/setup', { username: 'owner', password: 'password123', company_name: 'منشأة اختبار' });
  const login = await call('POST', '/api/login', { username: 'owner', password: 'password123' });
  const owner = login.response.headers.get('set-cookie').split(';')[0];
  const acceptance=await call('GET','/api/compliance/acceptance',undefined,owner);
  assert.equal(acceptance.status,200);
  assert.equal(acceptance.json.total,16);
  assert.equal(acceptance.json.passed,0);
  assert.ok(acceptance.json.items.every(item=>item.status==='pending'&&item.evidence===null));
  assert.equal((await call('GET','/api/compliance/acceptance')).status,401);
  db.prepare("INSERT INTO users(username,pass,role) VALUES(?,?,'accountant')").run('accountant',hashPass('password123'));
  const accountantLogin=await call('POST','/api/login',{username:'accountant',password:'password123'});
  const accountantCookie=accountantLogin.response.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('GET','/api/compliance/acceptance',undefined,accountantCookie)).status,403);
  assert.equal((await call('GET','/api/compliance/attempts',undefined,accountantCookie)).status,403);
  const dashboard=await call('GET','/api/compliance/status',undefined,owner);
  assert.equal(dashboard.json.issuer_configured,false);
  assert.equal(dashboard.json.acceptance.total,16);
  await call('PUT', '/api/settings/company', {
    name_ar: 'منشأة اختبار',
    vat_number: '300000000000003',
    cr_number: '1234567890',
    street: 'شارع الاختبار',
    building_number: '1234',
    district: 'الاختبار',
    city: 'الرياض',
    postal_code: '12345',
    country_code: 'SA',
  }, owner);
  const item = await call('POST', '/api/items', { name_ar: 'خدمة اختبار', item_kind: 'service', unit_price: '100.00', vat_rate: 15 }, owner);
  assert.equal(item.status, 200);

  const directBody={request_id:crypto.randomUUID(),lines:[{description:'بيع مباشر',qty:1,unit_price:'100.00',vat_rate:15}]};
  const direct = await call('POST', '/api/invoices', directBody, owner);
  assert.equal(direct.status, 200);
  const directReplay=await call('POST','/api/invoices',directBody,owner);
  assert.equal(directReplay.json.id,direct.json.id);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM journal_entries WHERE source_type='invoice' AND source_id=?").get(direct.json.id).n,1);
  assert.equal((await call('GET', `/api/invoices/${direct.json.id}`, undefined, owner)).json.status, 'issued');
  const directXml=(await call('GET', `/api/invoices/${direct.json.id}/xml`, undefined, owner)).json.content;
  assert.equal(directXml.includes('<cbc:ID>QR</cbc:ID>'),true);
  assert.equal(directXml.includes(apiQr),true);

  const requestId = crypto.randomUUID();
  const sale = await call('POST', '/api/pos/sales', {
    request_id: requestId,
    pos_id: 1,
    payment: 'cash',
    lines: [{ item_id: item.json.id, qty: 1 }],
  }, owner);
  assert.equal(sale.status, 200);
  assert.equal((await call('GET', `/api/invoices/${sale.json.id}`, undefined, owner)).json.status, 'issued');
  const replay = await call('POST', '/api/pos/sales', {
    request_id: requestId,
    pos_id: 1,
    payment: 'cash',
    lines: [{ item_id: item.json.id, qty: 1 }],
  }, owner);
  assert.equal(replay.json.id, sale.json.id);

  const returned = await call('POST', '/api/pos/returns', {
    request_id: crypto.randomUUID(),
    invoice_id: sale.json.id,
    reason: 'إرجاع اختبار',
    lines: [{ line_no: 1, qty: 1 }],
  }, owner);
  assert.equal(returned.status, 200);
  assert.equal((await call('GET', `/api/invoices/${returned.json.id}`, undefined, owner)).json.status, 'issued');

  const partyId = Number(db.prepare(`INSERT INTO parties(name_ar,vat_number,entity_type,street,building_number,district,city,postal_code,country_code)
    VALUES(?,?,?,?,?,?,?,?,?)`).run('عميل اختبار', '399999999800003', 'business', 'شارع العميل', '4321', 'الحي', 'الرياض', '54321', 'SA').lastInsertRowid);
  const standard = await call('POST', '/api/invoices', {
    request_id: crypto.randomUUID(),
    party_id: partyId,
    invoice_kind: 'standard',
    supply_date: '2026-11-25',
    lines: [{ description: 'بيع قياسي', qty: 1, unit_price: '100.00', vat_rate: 15 }],
  }, owner);
  assert.equal(standard.status, 200);
  assert.equal((await call('GET', `/api/invoices/${standard.json.id}/xml`, undefined, owner)).json.content, '<cleared-api/>');

  const credit = await call('POST', `/api/invoices/${standard.json.id}/credit-note`, {
    request_id: crypto.randomUUID(),
    lines: [{ line_no: 1, qty: 0.5 }],
    reason: 'إشعار دائن اختباري',
  }, owner);
  assert.equal(credit.status, 200);
  assert.equal((await call('GET', `/api/invoices/${credit.json.id}`, undefined, owner)).json.status, 'issued');

  const debit = await call('POST', `/api/invoices/${standard.json.id}/debit-note`, {
    request_id: crypto.randomUUID(),
    lines: [{ description: 'زيادة', qty: 1, unit_price: '10.00', vat_rate: 15 }],
    reason: 'إشعار مدين اختباري',
  }, owner);
  assert.equal(debit.status, 200);
  assert.equal((await call('GET', `/api/invoices/${debit.json.id}`, undefined, owner)).json.status, 'issued');

  const draft = await call('POST', '/api/invoices', { draft: true, lines: [{ description: 'مسودة', qty: 1, unit_price: 10 }] }, owner);
  assert.equal((await call('GET', `/api/invoices/${draft.json.id}`, undefined, owner)).json.status, 'draft');
  assert.equal((await call('POST', `/api/invoices/${draft.json.id}/issue`, {}, owner)).status, 200);
  assert.equal((await call('GET', `/api/invoices/${draft.json.id}`, undefined, owner)).json.status, 'issued');

  const today = new Date().toISOString().slice(0, 10);
  // استخدام تاريخ صلاحية مستقبلي لتجنب مشاكل المنطقة الزمنية (الرياض UTC+3)
  const futureDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const quotation = await call('POST', '/api/quotations', {
    request_id: crypto.randomUUID(),
    pos_id: 1,
    document_date: today,
    valid_until: futureDate,
    lines: [{ description: 'عرض', qty: 1, unit_price: 10 }],
  }, owner);
  assert.equal(quotation.status, 200);
  const converted = await call('POST', `/api/quotations/${quotation.json.id}/convert`, { payment: 'cash' }, owner);
  assert.equal(converted.status, 200);
  const issueRes = await call('POST', `/api/invoices/${converted.json.id}/issue`, {}, owner);
  assert.equal(issueRes.status, 200);
  assert.equal((await call('GET', `/api/invoices/${converted.json.id}`, undefined, owner)).json.status, 'issued');

  const reporting = await call('POST', '/api/compliance/reporting/run', { limit: 20 }, owner);
  assert.equal(reporting.status, 200);
  assert.ok(reporting.json.results.every(result => result.state === 'accepted'));

  blockNextClearance=true;
  const blocked=await call('POST','/api/invoices',{
    request_id:crypto.randomUUID(),
    party_id:partyId,
    invoice_kind:'standard',
    supply_date:'2026-11-25',
    lines:[{description:'رفض المصادقة',qty:1,unit_price:'20.00',vat_rate:15}],
  },owner);
  assert.equal(blocked.status,200);
  assert.equal(blocked.json.state,'blocked');
  assert.equal(db.prepare('SELECT status FROM invoices WHERE id=?').get(blocked.json.id).status,'draft');
  assert.equal((await call('POST',`/api/compliance/queue/${blocked.json.id}/retry`,{},owner)).json.state,'retry');
  blockNextClearance=false;
  const queued=await call('POST','/api/compliance/queue/run',{limit:20},owner);
  assert.equal(queued.status,200);
  assert.ok(queued.json.clearance.some(result=>result.id===blocked.json.id&&result.state==='issued'));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM journal_entries WHERE source_type='invoice' AND source_id=?").get(blocked.json.id).n,1);
  const attempts=await call('GET','/api/compliance/attempts',undefined,owner);
  assert.equal(attempts.status,200);
  assert.ok(attempts.json.total>=1);
  assert.ok(attempts.json.rows.every(row=>!Object.hasOwn(row,'secret')&&!Object.hasOwn(row,'private_key_pem')));
} finally {
  await new Promise(resolve => server.close(resolve));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('نجحت نقاط API للفواتير المباشرة ونقطة البيع والمرتجعات والإشعارات والمسودات وتحويل العروض مع موفر محاكاة محلي');
