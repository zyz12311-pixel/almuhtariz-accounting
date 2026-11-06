import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {openDb} from '../server/db.js';import {seedCompany} from '../server/core.js';import {branchSnapshot,configureSync,syncBranch,syncInfo} from '../server/sync.js';import {cloudApi} from '../cloudflare/api.js';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'muhtariz-sync-')),db=openDb(path.join(directory,'db')),oldFetch=globalThis.fetch;
try{
 db.exec("INSERT INTO users(id,username,pass,role) VALUES(1,'fixture','PRIVATE_PASSWORD_HASH','owner');INSERT INTO sessions VALUES('PRIVATE_SESSION_TOKEN',1,CURRENT_TIMESTAMP)");seedCompany(db,'نسخة اختبار');
 const id=syncInfo(db).installation_id,secret='x'.repeat(43),credential=id+'.'+secret;
 assert.throws(()=>configureSync(db,{device_token:'wrong',enabled:true}),/رمز/);
 configureSync(db,{device_token:credential,enabled:true});assert.ok(!JSON.stringify(syncInfo(db)).includes(secret));
 const snapshot=branchSnapshot(db);assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_PASSWORD_HASH'));assert.ok(!JSON.stringify(snapshot).includes('PRIVATE_SESSION_TOKEN'));assert.ok(!JSON.stringify(snapshot).includes(secret));
 let calls=0,sequence=0;
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer '+credential);const body=JSON.parse(options.body);sequence=body.sequence;await new Promise(r=>setTimeout(r,10));return Response.json({accepted:true,sequence});};
 const results=await Promise.all([syncBranch(db),syncBranch(db)]);assert.equal(calls,1);assert.equal(results[0].last_sequence,sequence);assert.equal(results[0].last_sequence,results[1].last_sequence);assert.ok(results[0].last_synced_at);
 globalThis.fetch=async()=>{throw Error('NETWORK '+credential);};await assert.rejects(syncBranch(db),/تعذر الاتصال/);assert.ok(!syncInfo(db).last_error.includes(secret));
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fixture'};
 let acceptedSequence=0,acceptedHash=null;
 globalThis.fetch=async(url,options)=>{assert.ok(url.endsWith('/rpc/publish_branch_snapshot'));assert.equal(options.headers.apikey,env.SUPABASE_SERVICE_ROLE_KEY);const input=JSON.parse(options.body);assert.equal(input.p_token_hash.length,64);assert.ok(!input.p_token_hash.includes(secret));if(input.p_sequence<acceptedSequence||(input.p_sequence===acceptedSequence&&input.p_payload_hash!==acceptedHash))return Response.json({}, {status:400});const replayed=input.p_sequence===acceptedSequence;acceptedSequence=input.p_sequence;acceptedHash=input.p_payload_hash;return Response.json({accepted:true,replayed,sequence:input.p_sequence});};
 const send=(data,token=credential)=>cloudApi(new Request('https://app.example/api/sync/snapshot',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(data)}),env);
 assert.equal((await send({sequence:1,snapshot},'invalid')).status,401);
 const published=await send({sequence:1,snapshot});assert.equal(published.status,200);assert.equal((await published.json()).accepted,true);
 assert.equal((await(await send({sequence:1,snapshot})).json()).replayed,true);
 assert.equal((await send({sequence:1,snapshot:{...snapshot,captured_at:'changed'}})).status,401);
 assert.equal((await send({sequence:2,snapshot:{...snapshot,tables:{...snapshot.tables,users:[]}}})).status,400);
 assert.equal((await send({sequence:2,snapshot:{...snapshot,installation_id:'other'}})).status,400);
 console.log('PASS: private-data exclusion, device binding, concurrent sync deduplication, sequence acknowledgments, failure redaction, RPC publication and payload isolation');
}finally{globalThis.fetch=oldFetch;db.close();}
