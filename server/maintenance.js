import {Worker} from 'node:worker_threads';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
export function maintenance(file){
 let lastAudit=null,auditJob=null,backupBusy=false,reports=0;
 const run=(operation,extra={})=>new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./maintenance-worker.js',import.meta.url),{workerData:{file,operation,...extra}});
  let received=false;worker.once('message',result=>{received=true;result.error?reject(Error(result.error)):resolve(result);});
  worker.once('error',reject);worker.once('exit',code=>{if(!received)reject(Error('توقف عامل الصيانة ('+code+')'));});
 });
 return{
  auditStatus(db){const tip=db.prepare('SELECT id,hash FROM audit_events ORDER BY id DESC LIMIT 1').get()||{id:0,hash:'GENESIS'};const current=lastAudit&&lastAudit.tip.id===tip.id&&lastAudit.tip.hash===tip.hash;return{audit_valid:current?lastAudit.valid:null,audit_check:{running:Boolean(auditJob),last:lastAudit,current:Boolean(current)}};},
  audit(){if(auditJob)return auditJob;auditJob=run('audit').then(result=>(lastAudit=result,result)).finally(()=>{auditJob=null;});return auditJob;},
  async report(kind,from,to){if(reports>=2){const error=Error('يجري تجهيز تقارير؛ حاول بعد انتهائها');error.status=409;throw error;}reports++;try{return(await run('report',{kind,from,to})).result;}finally{reports--;}} ,
  async backup(){
   if(backupBusy){const error=Error('يجري تجهيز نسخة احتياطية؛ حاول بعد انتهائها');error.status=409;throw error;}
   backupBusy=true;let folder;
   const dispose=async()=>{try{if(folder)await fs.rm(folder,{recursive:true,force:true});}finally{backupBusy=false;}};
   try{folder=await fs.mkdtemp(path.join(os.tmpdir(),'almuhtariz-backup-'));const destination=path.join(folder,'branch.db');await run('backup',{destination});return{file:destination,dispose};}
   catch(error){await dispose();throw error;}
  }
 };
}
