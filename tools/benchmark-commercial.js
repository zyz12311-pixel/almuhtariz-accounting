// Isolated synthetic fixtures only. Historical seeding is excluded from timings.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {performance} from 'node:perf_hooks';import {Worker} from 'node:worker_threads';
import {openDb} from '../server/db.js';import {seedCompany} from '../server/core.js';import {hashPass,nowRiyadh} from '../server/lib.js';import {appendAudit,verifyAudit} from '../server/audit.js';import {balance,recordStock} from '../server/inventory.js';import {listItems} from '../server/items.js';import {createPurchase,financialReport} from '../server/commercial.js';import {branchSnapshot} from '../server/sync.js';
const sizes=(process.env.BENCH_SIZES||'1000,10000,100000').split(',').map(Number);if(sizes.some(n=>!Number.isInteger(n)||n<1||n>1000000))throw Error('BENCH_SIZES must contain integers from 1 to 1000000');
const output=fs.mkdtempSync(path.resolve('releases/performance-')),today=nowRiyadh().date,password='benchmark-only-2026!';
const report={created_at:new Date().toISOString(),node:process.version,sqlite:process.versions.sqlite,platform:process.platform,cpu:os.cpus()[0]?.model,logical_cpus:os.cpus().length,total_memory_mb:Math.round(os.totalmem()/1048576),fixture_kind:'synthetic materialized history; not fiscally valid invoices; one hot stock item plus 999 empty items; balanced ledger; real audit chain',historical_seeding_excluded:true,fixtures:[]};
fs.writeFileSync(path.join(output,'RUNNING.txt'),'Synthetic benchmark in progress. Fixtures are isolated and contain no user data.');
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)];
function measure(fn,repeats=9){fn();const times=[];for(let i=0;i<repeats;i++){const start=performance.now();fn();times.push(performance.now()-start);}return{samples:repeats,p50_ms:percentile(times,.5),p95_ms:percentile(times,.95),max_ms:Math.max(...times)};}
function rollback(db,fn){db.exec('SAVEPOINT benchmark');try{return fn();}finally{db.exec('ROLLBACK TO benchmark;RELEASE benchmark');}}
function fixture(file,n){
 const db=openDb(file);db.prepare("INSERT INTO users(id,username,pass,role) VALUES(1,'benchmark',?,'owner')").run(hashPass(password));seedCompany(db,'اختبار ضغط اصطناعي');db.exec("INSERT INTO parties(id,name_ar,kind) VALUES(1,'مورد اصطناعي','supplier')");
 // Suspend SUM guards only while materializing history in this NEW fixture.
 // Restore every original trigger before any timed operation or HTTP request.
 const guards=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='stock_movements'").all();
 db.exec('BEGIN');for(const guard of guards)db.exec('DROP TRIGGER "'+guard.name.replaceAll('"','""')+'"');
 const item=db.prepare("INSERT INTO items(id,name_ar,unit_price,track_stock) VALUES(?,?,2000,1)");for(let i=1;i<=1000;i++)item.run(i,'صنف اختبار '+i);
 const stock=db.prepare("INSERT INTO stock_movements(id,event_id,request_hash,item_id,warehouse_id,delta_micro,kind,reason) VALUES(?,?,?,1,1,1000000,'receipt','historical benchmark fixture')");
 const entry=db.prepare("INSERT INTO journal_entries(id,entry_no,entry_date,description,source_type,source_id,branch_id) VALUES(?,?,?,'قيد اصطناعي','invoice',?,1)"),line=db.prepare('INSERT INTO journal_lines(entry_id,account_code,debit,credit) VALUES(?,?,?,?)'),invoice=db.prepare("INSERT INTO invoices(id,uuid,number,type,status,pos_id,branch_id,payment,issue_date,subtotal,vat,total,created_by) VALUES(?,?,?,'388','issued',1,1,'cash',?,100,15,115,1)");
 for(let i=1;i<=n;i++){stock.run(i,'fixture:'+i,'fixture');invoice.run(i,crypto.randomUUID(),'BENCH-'+i,i%2?today:'2025-01-01');entry.run(i,i,i%2?today:'2025-01-01',i);line.run(i,'1101',115,0);line.run(i,'4101',0,115);appendAudit(db,{actor:1,event:'benchmark.fixture',entity_type:'invoice',entity_id:i,details:{synthetic:true}});}
 db.exec('INSERT INTO journal_seals(entry_id) SELECT id FROM journal_entries;INSERT INTO stock_values(movement_id,value_delta,quantity_after,value_after,complete,costed) SELECT id,0,id*1000000,0,0,0 FROM stock_movements;');
 db.prepare("INSERT INTO counters(name,value) VALUES('entry',?)").run(n);for(const guard of guards)db.exec(guard.sql);db.exec('COMMIT');
 if(balance(db,1,1)!==n*1000000||!verifyAudit(db))throw Error('Fixture integrity failure');
 return db;
}
async function httpMetrics(file){
 const worker=new Worker(new URL('./bench-http-server.js',import.meta.url),{workerData:{dbFile:file,licensePath:path.join(output,'no-license.json')}});
 const {port}=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});const base='http://127.0.0.1:'+port;
 try{
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'benchmark',password})});if(!login.ok)throw Error('Benchmark login failed');const cookie=login.headers.get('set-cookie').split(';')[0];
  const call=async route=>{const start=performance.now(),r=await fetch(base+route,{headers:{Cookie:cookie}}),data=await r.arrayBuffer();if(!r.ok)throw Error('HTTP benchmark failed '+route+' '+r.status);return{elapsed_ms:performance.now()-start,bytes:data.byteLength};};
  const baseline=[];for(let i=0;i<9;i++)baseline.push((await call('/api/state')).elapsed_ms);
  const concurrent=async route=>{const all=await Promise.allSettled([call(route),...Array.from({length:8},()=>call('/api/state'))]);const times=all.slice(1).filter(x=>x.status==='fulfilled').map(x=>x.value.elapsed_ms);return{heavy:all[0].status==='fulfilled'?all[0].value:{error:all[0].reason.message,code:all[0].reason.cause?.code},state_p50_ms:times.length?percentile(times,.5):null,state_p95_ms:times.length?percentile(times,.95):null,failures:all.map((x,i)=>x.status==='rejected'?{request:i,error:x.reason.message,code:x.reason.cause?.code}:null).filter(Boolean)};};
  return{idle_state_p50_ms:percentile(baseline,.5),idle_state_p95_ms:percentile(baseline,.95),during_audit:await concurrent('/api/compliance/status'),during_backup:await concurrent('/api/backup')};
 }finally{worker.postMessage('close');await new Promise(resolve=>worker.once('exit',resolve));}
}
for(const n of sizes){
 const file=path.join(output,'fixture-'+n+'.db'),seedStart=performance.now(),db=fixture(file,n);
 const data={history_rows:n,catalog_items:1000,journal_lines:n*2,seed_ms:performance.now()-seedStart,metrics:{},plans:{}};
 try{
  data.metrics.balance=measure(()=>balance(db,1,1));
  data.metrics.stock_write=measure(()=>rollback(db,()=>recordStock(db,{request_id:crypto.randomUUID(),item_id:1,warehouse_id:1,kind:'receipt',qty:1,unit_cost:1,reason:'benchmark write'},1)));
  data.metrics.purchase_write=measure(()=>rollback(db,()=>createPurchase(db,1,{request_id:crypto.randomUUID(),supplier_id:1,supplier_reference:'BENCH-NEW',warehouse_id:1,payment:'credit',document_date:today,lines:[{item_id:1,qty:1,unit_price:1}]})));
  data.metrics.audit_verify=measure(()=>verifyAudit(db),3);
  data.metrics.catalog=measure(()=>listItems(db),3);
  data.metrics.financial_report=measure(()=>financialReport(db,today,today),3);
  data.metrics.branch_snapshot=measure(()=>branchSnapshot(db),3);
  data.snapshot_bytes=Buffer.byteLength(JSON.stringify(branchSnapshot(db)));
  data.plans.balance=db.prepare('EXPLAIN QUERY PLAN SELECT SUM(delta_micro) FROM stock_movements WHERE item_id=? AND warehouse_id=?').all(1,1);
  data.plans.report=db.prepare('EXPLAIN QUERY PLAN SELECT a.code,SUM(CASE WHEN e.entry_date BETWEEN ? AND ? THEN l.debit ELSE 0 END) FROM accounts a LEFT JOIN journal_lines l ON l.account_code=a.code LEFT JOIN journal_entries e ON e.id=l.entry_id GROUP BY a.code').all(today,today);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');data.database_bytes=fs.statSync(file).size;data.memory_rss_mb=Math.round(process.memoryUsage().rss/1048576);
 }finally{db.close();}
 report.fixtures.push(data);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
 try{data.http=await httpMetrics(file);}catch(error){data.http={error:error.message,code:error.cause?.code};}
 fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({rows:n,balance_p95_ms:data.metrics.balance.p95_ms,stock_write_p95_ms:data.metrics.stock_write.p95_ms,audit_ms:data.metrics.audit_verify.p50_ms,report_ms:data.metrics.financial_report.p50_ms,snapshot_bytes:data.snapshot_bytes,http:data.http}));
}
fs.writeFileSync(path.join(output,'COMPLETE.txt'),'Benchmark completed. See report.json; engineering observations are not production guarantees.');console.log('Report: '+path.join(output,'report.json'));
