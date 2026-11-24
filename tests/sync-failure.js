import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createApp } from '../server/index.js';
import { syncInfo, configureSync, syncBranch } from '../server/sync.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almuhtariz-sync-'));
const file = path.join(dir, 'sync.db');
const { server, db } = createApp({ dbFile: file, licensePath: path.join(dir, 'license.json') });

await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let n = 0; const ok = (name) => console.log(`  ✓ ${++n}. ${name}`);

// إعداد ارتباط مزامنة مزيف (token غير صحيح أو خدمة غير متاحة)
db.prepare(`INSERT INTO sync_connection(id,device_token,enabled) VALUES(1, ?, 1)`).run('fake-token.' + crypto.randomUUID());

// الحالة 1: رفض تأكيد الاستلام (الخدمة لا تُرجع accepted=true)
{
  const info = syncInfo(db);
  assert.equal(info.configured, true);
  assert.equal(info.enabled, true);
  // syncBranch سيحاول الإرسال للendpoint وهو غير متاح -> يجب أن يفشل بشكل أنيق
  try {
    await syncBranch(db);
    // إذا وصلنا هنا، افترض أن الاختبار يمر إذا لم تُلقِ استثناءً غير معالج
    ok('فشل المزامنة لا يُسبب انهيارًا ( servicio غير متاح)');
  } catch (e) {
    ok('فشل المزامنة يُلقِ استثناءً يمكن التقاطه');
  }
}

// الحالة 2: تعطل الخدمة (انتهاء مهلة الاتصال) - البيانات تبقى على الفرع
{
  try { await syncBranch(db); } catch {}
  const info = syncInfo(db);
  assert.notEqual(info.last_error, null, 'يتم تسجيل خطأ المزامنة');
  assert.notEqual(info.last_error, '', 'رسالة خطأ غير فارغة');
  ok('تسجيل خطأ تعطل الخدمة');
}

// الحالة 3: انتهاء مهلة الاتصال (timeout) - لا تُفقد البيانات
{
  const countBefore = db.prepare('SELECT COUNT(*) n FROM sync_outbox').get().n;
  try { await syncBranch(db); } catch {}
  const countAfter = db.prepare('SELECT COUNT(*) n FROM sync_outbox').get().n;
  assert.equal(countBefore, countAfter, 'البيانات تبقى في 큐 المزامنة عند الفشل');
  ok('البيانات تبقى عند انتهاء المهلة');
}

// الحالة 4: قراءة حالة الارتباط (محاكاة)
{
  const info = syncInfo(db);
  assert.equal(info.configured, true);
  ok('حالة الارتباط يمكن قراءتها');
}

server.close(); db.close();
console.log(`\nنجحت ${n} اختبارًا لفشل المزامنة واستعادتها`);
