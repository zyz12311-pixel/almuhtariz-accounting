import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almuhtariz-manual-price-'));
const { server, db } = createApp({ dbFile: path.join(dir, 'manual.db'), licensePath: path.join(dir, 'license.json') });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const call = async (method, p, body, cookie = '') => {
  const r = await fetch(base + p, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { st: r.status, j, cookie: r.headers.get('set-cookie')?.split(';')[0] || '' };
};

try {
  assert.equal((await call('POST','/api/setup',{ username:'owner', password:'password123', company_name:'اختبار', activity:'trade' })).st, 200);
  const owner = (await call('POST','/api/login',{ username:'owner', password:'password123', portal:'owner' })).cookie;
  assert.equal((await call('PUT','/api/settings/company',{ name_ar:'اختبار', vat_number:'300000000000003', cr_number:'1010101010', street:'شارع', building_number:'1234', district:'حي', city:'الرياض', postal_code:'12345', country_code:'SA', seller_id_scheme:'CRN', seller_id:'1010101010' }, owner)).st, 200);
  assert.equal((await call('POST','/api/users',{ username:'cash', password:'password123', role:'staff', pos_id:1 }, owner)).st, 200);
  const serviceId = (await call('POST','/api/items',{ name_ar:'خدمة تركيب', item_kind:'service', track_stock:false, unit_price:50, vat_rate:15 }, owner)).j.id;
  const productId = (await call('POST','/api/items',{ name_ar:'سلعة', item_kind:'product', track_stock:false, unit_price:20, vat_rate:15 }, owner)).j.id;
  const staff = (await call('POST','/api/login',{ username:'cash', password:'password123', portal:'staff' })).cookie;

  const denied = await call('POST','/api/pos/sales',{ request_id: crypto.randomUUID(), pos_id:1, payment:'cash', lines:[{ item_id:serviceId, qty:1, override_price:60 }] }, staff);
  assert.equal(denied.st, 403);

  const capSet = await call('PUT','/api/users/2/pos-pricing',{ discount_limit:0, wholesale:false, manual_price:true, manual_price_cap:80 }, owner);
  assert.equal(capSet.st, 200);

  const ok = await call('POST','/api/pos/sales',{ request_id: crypto.randomUUID(), pos_id:1, payment:'cash', lines:[{ item_id:serviceId, qty:1, override_price:60 }] }, staff);
  assert.equal(ok.st, 200, JSON.stringify(ok.j));

  const over = await call('POST','/api/pos/sales',{ request_id: crypto.randomUUID(), pos_id:1, payment:'cash', lines:[{ item_id:serviceId, qty:1, override_price:81 }] }, staff);
  assert.equal(over.st, 403);

  const product = await call('POST','/api/pos/sales',{ request_id: crypto.randomUUID(), pos_id:1, payment:'cash', lines:[{ item_id:productId, qty:1, override_price:30 }] }, staff);
  assert.equal(product.st, 403);

  const audit = db.prepare("SELECT event,details FROM audit_events WHERE event='pos.sale.pricing' ORDER BY id DESC LIMIT 1").get();
  assert.equal(audit.event, 'pos.sale.pricing');
  assert.match(String(audit.details), /override/);

  console.log('PASS: delegated manual service pricing enforces permission, cap, service-only, and audit');
} finally {
  server.close();
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
