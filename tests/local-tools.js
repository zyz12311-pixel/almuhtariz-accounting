import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {openDb} from '../server/db.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'almuhtariz-local-tools-'));
const data=path.join(temporary,'data'),backups=path.join(temporary,'backups');
const db=openDb(path.join(data,'smartz.db'));
try{
  // Keep a writer open in WAL mode: backup must include committed WAL content.
  db.prepare('INSERT INTO items(name_ar,unit_price,vat_rate) VALUES(?,?,?)').run('بيان محفوظ في WAL',12345,15);
  const before=db.prepare('SELECT * FROM items').all();
  const run=()=>spawnSync(process.execPath,['--no-warnings',path.join(root,'tools/backup-local.js')],{env:{...process.env,ALMUHTARIZ_DATA:data,ALMUHTARIZ_BACKUPS:backups},encoding:'utf8'});
  const result=run();assert.equal(result.status,0,result.stderr);
  const first=fs.readdirSync(backups).filter(f=>f.endsWith('.db'));assert.equal(first.length,1);
  const snapshot=new DatabaseSync(path.join(backups,first[0]),{readOnly:true});
  try{assert.deepEqual(snapshot.prepare('SELECT * FROM items').all(),before);assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{snapshot.close();}
  assert.deepEqual(db.prepare('SELECT * FROM items').all(),before);
  assert.equal(run().status,0);assert.equal(fs.readdirSync(backups).filter(f=>f.endsWith('.db')).length,2);
  const absent=path.join(temporary,'absent');
  const failed=spawnSync(process.execPath,['--no-warnings',path.join(root,'tools/backup-local.js')],{env:{...process.env,ALMUHTARIZ_DATA:absent,ALMUHTARIZ_BACKUPS:backups},encoding:'utf8'});
  assert.notEqual(failed.status,0);assert.equal(fs.existsSync(absent),false);
  console.log('نجحت اختبارات نسخة WAL المتسقة وعدم تغيير المصدر وعدم استبدال النسخ ورفض قاعدة مفقودة');
}finally{db.close();}
