import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {verifyAudit} from './audit.js';
import {financialReport} from './commercial.js';
import {trialBalance,vatReport} from './core.js';
import {stockValuation} from './valuation.js';
let db;
try{
 db=new DatabaseSync(workerData.file,{readOnly:true});db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
 if(workerData.operation==='audit'){
  db.exec('BEGIN');const tip=db.prepare('SELECT id,hash FROM audit_events ORDER BY id DESC LIMIT 1').get()||{id:0,hash:'GENESIS'};
  const valid=verifyAudit(db);db.exec('COMMIT');parentPort.postMessage({valid,tip,checked_at:new Date().toISOString()});
 }else if(workerData.operation==='report'){
  db.exec('BEGIN');const {kind,from,to}=workerData;
  const result=kind==='financial'?financialReport(db,from,to):kind==='trial'?trialBalance(db):kind==='vat'?vatReport(db,from,to):kind==='valuation'?stockValuation(db):null;if(result===null)throw Error('تقرير غير معروف');db.exec('COMMIT');parentPort.postMessage({result});
 }else if(workerData.operation==='backup'){
  db.prepare('VACUUM INTO ?').run(workerData.destination);
  const copy=new DatabaseSync(workerData.destination,{readOnly:true});
  try{if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||copy.prepare('PRAGMA foreign_key_check').get())throw Error('فشل فحص النسخة الاحتياطية');}finally{copy.close();}
  parentPort.postMessage({ok:true});
 }else throw Error('عملية صيانة غير معروفة');
}catch(error){parentPort.postMessage({error:error.message});}finally{db?.close();}
