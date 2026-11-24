import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { tx } from '../server/db.js';

// اختبار سلامة المعاملات المتزامنة (async tx isolation)
// يختبر أن معاملة async على اتصال SQLite تنفذ بشكل صحيح مع rollback صحيح عند الفشل
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almuhtariz-tx-'));
const file = path.join(dir, 'tx.db');
const { server, db } = createApp({ dbFile: file, licensePath: path.join(dir, 'license.json') });

await new Promise(r => server.listen(0, '127.0.0.1', r));
let n = 0; const ok = (name) => console.log(`  ✓ ${++n}. ${name}`);

// إعداد جدول اختبار بسيط وبيانات أولية
db.exec(`CREATE TABLE IF NOT EXISTS tx_test (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL)`);
db.exec(`INSERT INTO tx_test(id, balance) VALUES(1, 1000000)`);

// الحالة 1: نجاح معاملة واحدة
{
  const result = await tx(db, async () => {
    db.prepare('UPDATE tx_test SET balance = balance + 1000000 WHERE id = 1').run();
    return 'ok';
  });
  const balance = db.prepare('SELECT balance FROM tx_test WHERE id = 1').get().balance;
  assert.equal(balance, 2000000, 'الرصيد بعد معاملة ناجحة');
  assert.equal(result, 'ok');
  ok('نجاح معاملة واحدة');
}

// الحالة 2: فشل معاملة مع rollback كامل (الرصيد لا يتغير)
{
  const balanceBefore = db.prepare('SELECT balance FROM tx_test WHERE id = 1').get().balance;
  let threw = false;
  try {
    await tx(db, async () => {
      db.prepare('UPDATE tx_test SET balance = balance + 500000 WHERE id = 1').run();
      throw new Error('فشل متعمد للمعاملة');
    });
  } catch (e) {
    threw = true;
  }
  assert.equal(threw, true, 'يجب أن تُلقِي الاستثناء');
  const balance = db.prepare('SELECT balance FROM tx_test WHERE id = 1').get().balance;
  assert.equal(balance, balanceBefore, 'الرصيد يجب أن يعود لما كان عليه بعد التراجع');
  ok('تراجع معاملة فاشلة واستعادة الرصيد');
}

// الحالة 3: معاملة ناجحة تليها معاملة فاشلة (الرصيد يحتفظ بتغيير الأولى فقط)
{
  const balanceBefore = db.prepare('SELECT balance FROM tx_test WHERE id = 1').get().balance;
  await tx(db, async () => {
    db.prepare('UPDATE tx_test SET balance = balance + 1000000 WHERE id = 1').run();
  });
  let threw = false;
  try {
    await tx(db, async () => {
      db.prepare('UPDATE tx_test SET balance = balance + 2000000 WHERE id = 1').run();
      throw new Error('فشل الثانية');
    });
  } catch (e) {
    threw = true;
  }
  assert.equal(threw, true);
  const balance = db.prepare('SELECT balance FROM tx_test WHERE id = 1').get().balance;
  assert.equal(balance, balanceBefore + 1000000, 'الرصيد يحتفظ بتغيير الأولى فقط');
  ok('نجاح الأولى وفشل الثانية مع الاحتفاظ بتغيير الأولى');
}

// الحالة 4: معاملة فاشلة تليها معاملة ناجحة (الرصيد يبدأ من الحالة بعد التراجع)
{
  const balanceBefore = db.prepare('SELECT balance FROM tx_test WHERE id = 1').get().balance;
  let threw = false;
  try {
    await tx(db, async () => {
      db.prepare('UPDATE tx_test SET balance = balance + 999999999 WHERE id = 1').run();
      throw new Error('فشل الأولى');
    });
  } catch (e) {
    threw = true;
  }
  assert.equal(threw, true);
  await tx(db, async () => {
    db.prepare('UPDATE tx_test SET balance = balance + 500000 WHERE id = 1').run();
  });
  const balance = db.prepare('SELECT balance FROM tx_test WHERE id = 1').get().balance;
  assert.equal(balance, balanceBefore + 500000, 'الرصيد بعد فشل الأولى ونجاح الثانية');
  ok('فشل الأولى ونجاح الثانية مع استعادة الرصيد الصحيح');
}

server.close(); db.close();
console.log(`\nنجحت ${n} اختبارًا لسلامة المعاملات المتزامنة`);
