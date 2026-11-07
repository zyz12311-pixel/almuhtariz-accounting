import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almuhtariz-catalog-'));
const { server, db } = createApp({ dbFile: path.join(dir, 'catalog.db'), licensePath: path.join(dir, 'license.json') });
let cookie;
try {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/`;
  async function call(endpoint, body, status = 200) {
    const start = performance.now();
    const response = await fetch(base + endpoint, {
      method: body ? 'POST' : 'GET',
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.text();
    assert.equal(response.status, status, endpoint + ' ' + payload.slice(0, 300));
    return { data: JSON.parse(payload), bytes: Buffer.byteLength(payload), ms: performance.now() - start, response };
  }

  await call('setup', { username: 'owner', password: 'password123', company_name: 'اختبار', activity: 'trade' });
  const login = async username => {
    const { response } = await call('login', { username, password: 'password123' });
    cookie = response.headers.get('set-cookie').split(';')[0];
  };
  await call('pos/catalog', null, 401);
  await login('owner');
  await call('users', { username: 'cashier', password: 'password123', role: 'staff', pos_id: 1 });
  await login('cashier');

  db.exec(`
    WITH RECURSIVE series(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM series WHERE n<50001)
    INSERT INTO items(id,name_ar,sku,unit_price,barcode,active)
    SELECT n,printf('صنف %05d',n),printf('SKU-%05d',n),200,printf('%013d',n),n<=50000 FROM series;
    INSERT INTO item_units(id,item_id,name,unit_price,factor_micro,barcode,active)
    VALUES (1,50000,'كرتون اختبار',2000,12000000,'009900001',1),
           (2,50000,'وحدة معطلة',2000,12000000,'009900002',0),
           (3,50001,'صنف معطل',2000,12000000,'009900003',1);
  `);

  const catalog = 'pos/catalog';
  const first = await call(catalog);
  assert.deepEqual({ total: first.data.total, page: first.data.page, pages: first.data.pages }, { total: 50000, page: 1, pages: 2084 });
  assert.equal(first.data.rows.length, 24);
  assert.ok(first.bytes < 15_000, 'The initial page must stay small with a large catalog');
  assert.ok(first.data.rows.every(item => !('cost_price' in item) && !('units' in item)));
  const second = await call(catalog + '?page=2');
  assert.equal(second.data.rows[0].id, 25);
  assert.equal(second.data.rows.at(-1).id, 48);
  await call(catalog + '?page_size=51', null, 400);

  const search = q => call(catalog + '?' + new URLSearchParams({ q }));
  const match = await search('صنف 50000');
  assert.equal(match.data.total, 1);
  assert.deepEqual(match.data.rows.map(item => [item.id, item.item_unit_id, item.unit_price]), [[50000, null, 2], [50000, 1, 20]]);
  assert.equal((await search('SKU-50000')).data.total, 1);
  assert.equal((await search('009900001')).data.total, 1);
  assert.equal((await search('وحدة معطلة')).data.total, 0);
  assert.equal((await search('%')).data.total, 0);

  const scan = code => call(catalog + '/barcode?' + new URLSearchParams({ code }));
  const exactBase = await scan('0000000050000');
  assert.equal(exactBase.data.item.id, 50000);
  assert.equal(exactBase.data.item.item_unit_id, null);
  const exactUnit = await scan('009900001');
  assert.equal(exactUnit.data.item.item_unit_id, 1);
  assert.equal(exactUnit.data.item.unit_factor_micro, 12000000);
  for (const code of ['9900001', '009900002', '009900003', '0000000050001']) {
    assert.equal((await scan(code)).data.item, null);
  }

  const selection = await call(catalog + '/selection?keys=50000:1,1:0,1:1,50001:0,50000:2');
  assert.deepEqual(selection.data.rows.map(item => [item.id, item.item_unit_id]), [[50000, 1], [1, null]]);
  await call(catalog + '/selection?keys=50000:x', null, 400);
  console.log(`POS catalog (50,000): first page ${first.bytes} B / ${first.ms.toFixed(1)} ms, search ${match.bytes} B / ${match.ms.toFixed(1)} ms, exact unit ${exactUnit.bytes} B / ${exactUnit.ms.toFixed(1)} ms`);
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
