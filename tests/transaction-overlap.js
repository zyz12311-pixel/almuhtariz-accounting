import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../server/index.js';
import { openDb, tx } from '../server/db.js';
import { recordStock } from '../server/inventory.js';

// اختبار سلامة المعاملات المتزامنة (async tx isolation)
// يختبر أن معلمتين async على اتصال SQLite واحد لا تتداخلان بشكل يفسد البيانات
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almuhtariz-tx-'));
const file = path.join(dir, 'tx.db');
const { server, db } = createApp({ dbFile: file, licensePath: path.join(dir, 'license.json') });

await new Promise(r => server.listen(0, '127.0.0.1', r));
let n = 0; const ok = (name) => console.log(`  ✓ ${++n}. ${name}`);

// إعداد بيانات أولية: صنف واحد ورصيد أولي عبر recordStock
const insertResult = db.prepare("INSERT INTO items(id,name_ar,unit_price,track_stock,item_kind) VALUES(1,'صنف اختبار',10000,1,'product')").run();
let itemId = insertResult.lastInsertRowid;
if (typeof itemId === 'bigint') itemId = parseInt(itemId.toString(), 10);
else itemId = Number(itemId);
if(!db.prepare('SELECT 1 FROM warehouses WHERE id=1').get()) db.prepare("INSERT INTO warehouses(id,name) VALUES(1,'مستودع 1')").run();
if(!db.prepare('SELECT 1 FROM users WHERE id=1').get()) db.prepare("INSERT INTO users(id,username,pass,role) VALUES(1,'مستخدم اختبار','hash','owner')").run();
recordStock(db, {
  request_id: crypto.randomUUID(),
  item_id: itemId,
  warehouse_id: 1,
  qty: 5,
  unit_cost: 1000,
  tracking: [],
  kind: 'opening',
  reason: 'رصيد افتتاحي للاختبار',
  actor_id: 1
});

// الحالة 1: نجاح معاملتين متداخلتين (كلتاهما تنجح، الرصيد يُجمع بشكل صحيح)
{
  const a = tx(db, async () => {
    await new Promise(r => setTimeout(r, 5));
    db.prepare('UPDATE stock_positions SET qty_micro=qty_micro+1000000 WHERE item_id=1 AND warehouse_id=1').run();
    return 'a';
  });
  const b = tx(db, async () => {
    await new Promise(r => setTimeout(r, 5));
    db.prepare('UPDATE stock_positions SET qty_micro=qty_micro+2000000 WHERE item_id=1 AND warehouse_id=1').run();
    return 'b';
  });
  const ra = await a; const rb = await b;
  const balance = db.prepare('SELECT qty_micro FROM stock_positions WHERE item_id=1 AND warehouse_id=1').get().qty_micro;
  assert.equal(balance, 8000000, 'الرصيد بعد المعلمتين الناجحتين');
  assert.equal(ra, 'a'); assert.equal(rb, 'b');
  ok('نجاح معاملتين متداخلتين');
}

// الحالة 2: المعاملة الأولى تفشل والثانية تنجح (التراجع لا يؤثر على الثانية)
{
  const balanceBefore = db.prepare('SELECT qty_micro FROM stock_positions WHERE item_id=1 AND warehouse_id=1').get().qty_micro;
  const a = tx(db, async () => {
    await new Promise(r => setTimeout(r, 5));
    db.prepare('UPDATE stock_positions SET qty_micro=qty_micro-10000000 WHERE item_id=1 AND warehouse_id=1').run();
    throw new Error('فشل متعمد في المعاملة أ');
  }).catch(() => 'a-failed');
  const b = tx(db, async () => {
    await new Promise(r => setTimeout(r, 2));
    db.prepare('UPDATE stock_positions SET qty_micro=qty_micro+500000 WHERE item_id=1 AND warehouse_id=1').run();
    return 'b-ok';
  });
  const ra = await a; const rb = await b;
  assert.equal(ra, 'a-failed'); assert.equal(rb, 'b-ok');
  const balance = db.prepare('SELECT qty_micro FROM stock_positions WHERE item_id=1 AND warehouse_id=1').get().qty_micro;
  assert.equal(balance, balanceBefore + 500000, 'الرصيد بعد فشل الأولى ونجاح الثانية');
  ok('فشل الأولى ونجاح الثانية');
}

// الحالة 3: الأولى تنجح والثانية تفشل (الرصيد يحتفظ بتغيير الأولى فقط)
{
  const balanceBefore = db.prepare('SELECT qty_micro FROM stock_positions WHERE item_id=1 AND warehouse_id=1').get().qty_micro;
  const a = tx(db, async () => {
    await new Promise(r => setTimeout(r, 5));
    db.prepare('UPDATE stock_positions SET qty_micro=qty_micro+1000000 WHERE item_id=1 AND warehouse_id=1').run();
    return 'a-ok';
  });
  const b = tx(db, async () => {
    await new Promise(r => setTimeout(r, 2));
    throw new Error('فشل متعمد في المعاملة ب');
  }).catch(() => 'b-failed');
  const ra = await a; const rb = await b;
  assert.equal(ra, 'a-ok'); assert.equal(rb, 'b-failed');
  const balance = db.prepare('SELECT qty_micro FROM stock_positions WHERE item_id=1 AND warehouse_id=1').get().qty_micro;
  assert.equal(balance, balanceBefore + 1000000, 'الرصيد بعد نجاح الأولى وفشل الثانية');
  ok('نجاح الأولى وفشل الثانية');
}

// الحالة 4: التحقق من الأرصدة والقيود بعد التراجع (لا بقايا للمعاملة المتراجعة)
{
  const balanceBefore = db.prepare('SELECT qty_micro FROM stock_positions WHERE item_id=1 AND warehouse_id=1').get().qty_micro;
  await tx(db, async () => {
    await new Promise(r => setTimeout(r, 5));
    db.prepare('UPDATE stock_positions SET qty_micro=qty_micro+999999999 WHERE item_id=1 AND warehouse_id=1').run();
    throw new Error('تراجع كامل');
  }).catch(() => {});
  const balance = db.prepare('SELECT qty_micro FROM stock_positions WHERE item_id=1 AND warehouse_id=1').get().qty_micro;
  assert.equal(balance, balanceBefore, 'الرصيد بعد التراجع الكامل');
  ok('التحقق من الأرصدة بعد التراجع');
}

server.close(); db.close();
console.log(`\nنجحت ${n} اختبارًا لمعاملات متزامنة`);
