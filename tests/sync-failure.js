import assert from 'node:assert/strict';
import {openDb} from '../server/db.js';
import {seedCompany} from '../server/core.js';
import {configureSync,syncBranch,syncInfo} from '../server/sync.js';
const db=openDb(':memory:');const original=globalThis.fetch;
try {
 seedCompany(db,'QA');
 configureSync(db,{device_token:syncInfo(db).installation_id+'.'+'x'.repeat(43),enabled:true});
 globalThis.fetch=async()=>Response.json({accepted:true,sequence:-1});
 await assert.rejects(syncBranch(db));assert.equal(syncInfo(db).last_sequence,0);assert.ok(syncInfo(db).last_error);
 globalThis.fetch=async()=>Response.json({accepted:false},{status:503});
 await assert.rejects(syncBranch(db));assert.equal(syncInfo(db).last_sequence,0);
 globalThis.fetch=async()=>{throw new DOMException('timeout','TimeoutError');};
 await assert.rejects(syncBranch(db));assert.match(syncInfo(db).last_error,/مهلة/);
 globalThis.fetch=async(_url,options)=>Response.json({accepted:true,sequence:JSON.parse(options.body).sequence});
 const result=await syncBranch(db);assert.ok(result.last_sequence>0);assert.equal(result.last_error,null);assert.ok(result.last_synced_at);
 console.log('PASS: sync acknowledgment failure, service outage, timeout and recovery');
} finally {globalThis.fetch=original;db.close();}
