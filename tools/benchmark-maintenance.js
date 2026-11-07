// Reuse isolated synthetic fixtures from benchmark-commercial; no reseeding or real branch data.
import fs from 'node:fs';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';import {Worker} from 'node:worker_threads';import {performance} from 'node:perf_hooks';
const source=path.resolve(process.argv[2]||'');
if(!process.argv[2]||!fs.existsSync(path.join(source,'report.json')))throw Error('حدد مجلد قياس اصطناعي مكتمل');
const original=JSON.parse(fs.readFileSync(path.join(source,'report.json'),'utf8'));if(!original.fixture_kind?.startsWith('synthetic'))throw Error('هذه الأداة مخصصة لقواعد القياس الاصطناعية');
const output=fs.mkdtempSync(path.resolve('releases/maintenance-performance-')),report={created_at:new Date().toISOString(),node:process.version,source_fixture:path.basename(source),source_kind:original.fixture_kind,fixtures:[]};
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)];
for(const fixture of original.fixtures){
 const file=path.join(output,'fixture-'+fixture.history_rows+'.db'),db=new DatabaseSync(path.join(source,'fixture-'+fixture.history_rows+'.db'),{readOnly:true});try{db.prepare('VACUUM INTO ?').run(file);}finally{db.close();}
 const worker=new Worker(new URL('./bench-http-server.js',import.meta.url),{workerData:{dbFile:file,licensePath:path.join(output,'absent.json')}});
 const {port}=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});const base='http://127.0.0.1:'+port;
 try{
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'benchmark',password:'benchmark-only-2026!'})});if(!login.ok)throw Error('Fixture login failed');const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
  const call=async route=>{const start=performance.now(),response=await fetch(base+route,{headers}),bytes=Buffer.from(await response.arrayBuffer());if(!response.ok)throw Error('HTTP '+response.status);return{elapsed_ms:performance.now()-start,bytes:bytes.length,...(route==='/api/backup'?{backup:bytes}:{})};};
  const row={history_rows:fixture.history_rows};
  for(const [name,route] of [['status','/api/compliance/status'],['audit','/api/compliance/audit/verify'],['backup','/api/backup']]){
   const all=await Promise.allSettled([call(route),...Array.from({length:8},()=>call('/api/state'))]),times=all.slice(1).filter(x=>x.status==='fulfilled').map(x=>x.value.elapsed_ms),heavy=all[0].status==='fulfilled'?all[0].value:null;
   row[name]={heavy_ms:heavy?.elapsed_ms??null,bytes:heavy?.bytes??null,state_successes:times.length,state_p50_ms:times.length?percentile(times,.5):null,state_p95_ms:times.length?percentile(times,.95):null,failures:all.flatMap((x,i)=>x.status==='rejected'?[{request:i,error:x.reason.message,code:x.reason.cause?.code}]:[])};
   if(heavy?.backup){const restored=path.join(output,'restored-'+fixture.history_rows+'.db');fs.writeFileSync(restored,heavy.backup);const copy=new DatabaseSync(restored,{readOnly:true});try{row.backup.integrity=copy.prepare('PRAGMA integrity_check').get().integrity_check;row.backup.foreign_keys_ok=!copy.prepare('PRAGMA foreign_key_check').get();row.backup.restored_stock_movements=copy.prepare('SELECT COUNT(*) n FROM stock_movements').get().n;}finally{copy.close();}}
  }
  report.fixtures.push(row);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(row));
 }finally{worker.postMessage('close');await new Promise(resolve=>worker.once('exit',resolve));}
}
fs.writeFileSync(path.join(output,'COMPLETE.txt'),'Completed isolated maintenance HTTP benchmark.');console.log('Report: '+path.join(output,'report.json'));
