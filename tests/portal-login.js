import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

async function mkApp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const { server, db } = createApp({ dbFile: path.join(dir, 'portal.db'), licensePath: path.join(dir, 'license.json') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (method, p, body, cookie = '') => {
    const r = await fetch(base + p, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { st: r.status, j, cookie: r.headers.get('set-cookie')?.split(';')[0] || '' };
  };
  const close = () => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { call, close };
}

{
  const { call, close } = await mkApp('almuhtariz-portal-owneracc-');
  try {
    assert.equal((await call('POST', '/api/setup', { username: 'owner', password: 'password123', company_name: 'بوابة', activity: 'trade' })).st, 200);
    const ownerLogin = await call('POST', '/api/login', { username: 'owner', password: 'password123', portal: 'owner' });
    assert.equal(ownerLogin.st, 200);
    assert.equal(ownerLogin.j.role, 'owner');
    assert.equal(ownerLogin.j.destination, 'dashboard');
    const owner = ownerLogin.cookie;
    assert.equal((await call('POST', '/api/users', { username: 'acc', password: 'password123', role: 'accountant' }, owner)).st, 200);

    const accOk = await call('POST', '/api/login', { username: 'acc', password: 'password123', portal: 'accountant' });
    assert.equal(accOk.st, 200, JSON.stringify(accOk.j));
    assert.equal(accOk.j.role, 'accountant');
    assert.equal(accOk.j.destination, 'dashboard');
    const accCookie = accOk.cookie;

    for (const bad of [
      ['owner','password123','staff'],
      ['acc','password123','staff'],
      ['acc','password123','owner'],
    ]) {
      const r = await call('POST','/api/login',{ username: bad[0], password: bad[1], portal: bad[2] });
      assert.equal(r.st, 403, JSON.stringify({ bad, got: r.st, body: r.j }));
      assert.equal(r.cookie, '');
    }
    assert.equal((await call('POST','/api/login',{ username:'owner', password:'password123', portal:'unknown' })).st, 400);
    const compat = await call('POST','/api/login',{ username:'owner', password:'password123' });
    assert.equal(compat.st, 200);
    assert.equal(compat.j.role, 'owner');

    assert.equal((await call('GET','/api/state', null, owner)).j.user.role, 'owner');
    const accState = await call('GET','/api/state', null, accCookie);
    assert.equal(accState.j.user.role, 'accountant');
    assert.equal((await call('GET','/api/dashboard', null, accCookie)).st, 200);
    assert.equal((await call('GET','/api/users', null, accCookie)).st, 403);
    assert.equal((await call('GET','/api/backup', null, accCookie)).st, 403);
  } finally { close(); }
}

{
  const { call, close } = await mkApp('almuhtariz-portal-staff-');
  try {
    assert.equal((await call('POST','/api/setup',{ username:'owner', password:'password123', company_name:'بوابة', activity:'trade' })).st, 200);
    const owner = (await call('POST','/api/login',{ username:'owner', password:'password123', portal:'owner' })).cookie;
    assert.equal((await call('POST','/api/users',{ username:'cash', password:'password123', role:'staff', pos_id:1 }, owner)).st, 200);

    const staffOk = await call('POST','/api/login',{ username:'cash', password:'password123', portal:'staff' });
    assert.equal(staffOk.st, 200, JSON.stringify(staffOk.j));
    assert.equal(staffOk.j.role, 'staff');
    assert.equal(staffOk.j.destination, 'pos');
    const staffCookie = staffOk.cookie;
    const bad = await call('POST','/api/login',{ username:'cash', password:'password123', portal:'owner' });
    assert.equal(bad.st, 403);
    assert.equal(bad.cookie, '');

    const staffState = await call('GET','/api/state', null, staffCookie);
    assert.equal(staffState.j.user.role, 'staff');
    assert.equal((await call('GET','/api/pos/points', null, staffCookie)).st, 200);
    assert.equal((await call('GET','/api/pos/catalog', null, staffCookie)).st, 200);
    assert.equal((await call('GET','/api/dashboard', null, staffCookie)).st, 403);
    assert.equal((await call('GET','/api/users', null, staffCookie)).st, 403);
    assert.equal((await call('GET','/api/settings/company', null, staffCookie)).st, 403);
  } finally { close(); }
}

console.log('PASS: portal login split, server role verification, destination routing, and permission boundaries without issuing invoices');
