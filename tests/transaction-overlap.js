import assert from 'node:assert/strict';
import { openDb, tx } from '../server/db.js';
import { seedCompany } from '../server/core.js';

const dir = await (await import('node:fs')).promises.mkdtemp(await (await import('node:path')).join(await (await import('node:os')).tmpdir(), 'almuhtariz-tx-'));
const file = await (await import('node:path')).join(dir, 'tx.db');
const db = openDb(file);

try {
  seedCompany(db, 'QA');
  db.exec('CREATE TABLE IF NOT EXISTS tx_test (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL)');
  db.exec('INSERT INTO tx_test(id, balance) VALUES(1, 1000000)');

  let n = 0; const ok = (name) => console.log(`  ✓ ${++n}. ${name}`);

  // الحالة 1: نجاح معاملة واحدة على اتصال SQLite
  {
    const result = tx(db, () => {
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
      tx(db, () => {
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
    tx(db, () => {
      db.prepare('UPDATE tx_test SET balance = balance + 1000000 WHERE id = 1').run();
    });
    let threw = false;
    try {
      tx(db, () => {
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
      tx(db, () => {
        db.prepare('UPDATE tx_test SET balance = balance + 999999999 WHERE id = 1').run();
        throw new Error('فشل الأولى');
      });
    } catch (e) {
      threw = true;
    }
    assert.equal(threw, true);
    tx(db, () => {
      db.prepare('UPDATE tx_test SET balance = balance + 500000 WHERE id = 1').run();
    });
    const balance = db.prepare('SELECT balance FROM tx_test WHERE id = 1').get().balance;
    assert.equal(balance, balanceBefore + 500000, 'الرصيد بعد فشل الأولى ونجاح الثانية');
    ok('فشل الأولى ونجاح الثانية مع استعادة الرصيد الصحيح');
  }

  // Rejection must happen before the callback or SQLite connection is touched.
  {
    let started = false;
    const callback = async () => {
      started = true;
      await Promise.resolve();
    };
    const untouchedDb = { exec() { assert.fail('tx() opened a savepoint'); } };
    for (const fn of [callback, callback.bind(null)]) {
      assert.throws(() => tx(untouchedDb, fn), {
        name: 'TypeError', message: 'tx() requires a synchronous callback'
      });
    }
    assert.equal(started, false);
    ok('رفض دالة async قبل تشغيلها');
  }

  // A regular callback returning a promise must also roll back its writes.
  {
    const balanceBefore = db.prepare('SELECT balance FROM tx_test WHERE id = 1').get().balance;
    assert.throws(() => tx(db, () => {
      db.exec('UPDATE tx_test SET balance = 0 WHERE id = 1');
      return Promise.reject(new Error('unexpected promise'));
    }), { name: 'TypeError', message: 'tx() requires a synchronous callback' });
    assert.equal(db.prepare('SELECT balance FROM tx_test WHERE id = 1').get().balance, balanceBefore);
    ok('التراجع عن تغييرات دالة تعيد Promise');
  }

  console.log(`\nنجحت ${n} اختبارًا لسلامة المعاملات المتسلسلة على SQLite`);
} finally {
  db.close();
}
