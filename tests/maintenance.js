import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server/index.js';import {seedCompany} from '../server/core.js';import {hashPass} from '../server/lib.js';import {appendAudit,verifyAudit} from '../server/audit.js';import {maintenance} from '../server/maintenance.js';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'muhtariz-maintenance-')),file=path.join(folder,'branch.db');
const {server,db}=createApp({dbFile:file,licensePath:path.join(folder,'absent.json')});
try{
 seedCompany(db,'اختبار صيانة');db.prepare("INSERT INTO users(username,pass,role) VALUES('owner',?,'owner')").run(hashPass('maintenance-test-only!'));
 db.prepare("INSERT INTO items(name_ar,unit_price) VALUES('بيان WAL',100)").run();
 db.exec('BEGIN');for(let i=0;i<10000;i++)appendAudit(db,{event:'fixture',entity_id:i});db.exec('COMMIT');
 const jobs=maintenance(file);assert.equal(jobs.auditStatus(db).audit_valid,null);
 const first=jobs.audit();assert.equal(first,jobs.audit());assert.equal(jobs.auditStatus(db).audit_check.running,true);assert.equal((await first).valid,true);assert.equal(jobs.auditStatus(db).audit_valid,true);
 appendAudit(db,{event:'after-check'});assert.equal(jobs.auditStatus(db).audit_valid,null);
 const backup=jobs.backup();await assert.rejects(jobs.backup(),/تجهيز نسخة/);const download=await backup,restored=path.join(folder,'restored.db');fs.copyFileSync(download.file,restored);await download.dispose();assert.equal(fs.existsSync(download.file),false);
 const copy=new DatabaseSync(restored,{readOnly:true});try{assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(copy.prepare('PRAGMA foreign_key_check').get(),undefined);assert.equal(copy.prepare('SELECT name_ar FROM items').get().name_ar,'بيان WAL');assert.equal(copy.prepare('SELECT COUNT(*) n FROM audit_events').get().n,10001);assert.ok(verifyAudit(copy));}finally{copy.close();}
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'maintenance-test-only!'})});assert.equal(login.status,200);const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
 const state=await fetch(base+'/api/compliance/status',{headers});assert.equal((await state.json()).audit_valid,null);
 for(const route of ['/api/compliance/audit/verify','/api/backup']){
  const responses=await Promise.all([fetch(base+route,{headers}),...Array.from({length:8},()=>fetch(base+'/api/state',{headers}))]);for(const response of responses){assert.equal(response.status,200);await response.arrayBuffer();}
 }
 assert.equal((await (await fetch(base+'/api/compliance/status',{headers})).json()).audit_valid,true);
 assert.equal((await fetch(base+'/app.js')).status,200);assert.equal((await fetch(base+'/missing-file.js')).status,404);
 // Simulate deliberate corruption only in this isolated fixture; the checker must report it.
 db.exec("DROP TRIGGER audit_no_update;UPDATE audit_events SET details='not-json' WHERE id=1");assert.equal((await jobs.audit()).valid,false);
 console.log('PASS: background audit deduplication/staleness/corruption, verified WAL backup restore, concurrent HTTP reads and async static files');
}finally{server.closeAllConnections();if(server.listening)await new Promise(resolve=>server.close(resolve));db.close();}
