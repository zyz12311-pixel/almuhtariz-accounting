import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

// Test sign endpoint: must return 501 when no real XAdES signature exists
const signDir=fs.mkdtempSync(path.join(os.tmpdir(),'almuhtariz-sign-'));
let storedCredentials=null;
const complianceSecretStore={has:()=>Boolean(storedCredentials),async save(value){storedCredentials={...value};},async load(){return storedCredentials&&{...storedCredentials};}};
const {server: signServer, db: signDb}=createApp({dbFile: path.join(signDir,'sign.db'), licensePath: path.join(signDir,'license.json'),complianceSecretStore});
await new Promise(r=>signServer.listen(0,'127.0.0.1',r));
const signBase='http://127.0.0.1:'+signServer.address().port;
const signCall=async(m,p,body,ck='')=>{
 const bodyStr=body?JSON.stringify(body):undefined;
 const r=await fetch(signBase+p,{method:m,headers:{...(body?{'content-type':'application/json'}:{}),...(ck?{cookie:ck}:{})},body:bodyStr?new Blob([bodyStr],{type:'application/json'}):undefined});
 const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t;}return{st:r.status,j,r};
};
await signCall('POST','/api/setup',{username:'owner',password:'password123',role:'owner',company_name:'test company'});
const loginRes=await signCall('POST','/api/login',{username:'owner',password:'password123'});
assert.equal(loginRes.st,200,'login must succeed');
const ck=loginRes.r.headers.get('set-cookie').split(';')[0];
await signCall('POST','/api/users',{username:'accountant',password:'password123',role:'accountant'},ck);
const accountantLogin=await signCall('POST','/api/login',{username:'accountant',password:'password123'});
const accountantCookie=accountantLogin.r.headers.get('set-cookie').split(';')[0];
await signCall('PUT','/api/settings/company',{vat_number:'300000000000003',cr_number:'1234567890',street:'test street',building_number:'1234',district:'test district',city:'Riyadh',postal_code:'12345',country_code:'SA'},ck);
const party=(await signCall('POST','/api/parties',{name_ar:'customer',vat_number:'399999999800003',cr_number:'1234567890',street:'test street',building_number:'1234',district:'test district',city:'Riyadh',postal_code:'12345',country_code:'SA'},ck)).j.id;
const invRes=await signCall('POST','/api/invoices',{lines:[{description:'test item',qty:1,unit_price:'100.00',vat_rate:15}],party_id:party,supply_date:'2026-11-25'},ck);
console.log('invoice response:',invRes.st,invRes.j);
const inv=invRes.j.id;
  // Create issuer profile first
  const issuerProfile=(await signCall('PUT','/api/compliance/issuer',{name:'خادم الاختبار',scope:'central_server'},ck)).j.profile;
  assert.ok(issuerProfile.local_id,'local EGS profile must have a stable internal identifier');
  // Without certificate/key: must return 400
  const noCert=(await signCall('POST',`/api/invoices/${inv}/sign`,{},ck));
  assert.equal(noCert.st,400,'must return 400 when certificate/key missing');
  // Legacy PEMs are migrated to the secret store without returning them from the API.
  const legacyCredentials={mode:'development',certificate_pem:'-----BEGIN CERTIFICATE-----\nlegacy-cert\n-----END CERTIFICATE-----',private_key_pem:'-----BEGIN PRIVATE KEY-----\nlegacy-key\n-----END PRIVATE KEY-----'};
signDb.prepare("INSERT INTO settings(key,value) VALUES('compliance',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(legacyCredentials));
assert.equal((await signCall('GET','/api/compliance/certificate',undefined,ck)).j.migration_required,true);
assert.equal((await signCall('PUT','/api/settings/compliance',{mode:'development'},ck)).st,409,'legacy keys must not be silently dropped');
assert.equal((await signCall('POST','/api/compliance/certificate/migrate',{},accountantCookie)).st,403);
const migrated=await signCall('POST','/api/compliance/certificate/migrate',{},ck);
assert.deepEqual(migrated.j,{migrated:true,configured:true});
assert.deepEqual(storedCredentials,{issuer_id:issuerProfile.local_id,certificate_pem:legacyCredentials.certificate_pem,private_key_pem:legacyCredentials.private_key_pem});
const persistedSettings=signDb.prepare("SELECT value FROM settings WHERE key='compliance'").get().value;
assert.equal(persistedSettings.includes('legacy-key'),false,'legacy private keys must be removed from SQLite');
assert.equal(persistedSettings.includes('legacy-cert'),false,'legacy certificates must be removed from SQLite');
assert.deepEqual((await signCall('GET','/api/compliance/certificate',undefined,ck)).j,{configured:true,has_certificate:true,migration_required:false});
// The certificate endpoint must not accept a replacement private key.
const stored=await signCall('PUT','/api/compliance/certificate',{certificate_pem:'-----BEGIN CERTIFICATE-----\nnew-cert\n-----END CERTIFICATE-----\n',private_key_pem:'-----BEGIN PRIVATE KEY-----\nnew-key\n-----END PRIVATE KEY-----\n'},ck);
assert.equal(stored.st,400,'private keys must never be uploaded through the certificate endpoint');
assert.deepEqual(storedCredentials,{issuer_id:issuerProfile.local_id,certificate_pem:legacyCredentials.certificate_pem,private_key_pem:legacyCredentials.private_key_pem});
assert.equal(signDb.prepare("SELECT value FROM settings WHERE key='compliance'").get().value.includes('new-key'),false);
const settings=await signCall('GET','/api/settings/compliance',undefined,accountantCookie);
assert.equal(settings.st,200);
assert.deepEqual(settings.j,{mode:'development'});
assert.deepEqual((await signCall('GET','/api/settings/compliance',undefined,ck)).j,{mode:'development'});
assert.equal((await signCall('GET','/api/compliance/certificate',undefined,accountantCookie)).st,403);
  const saveSettings=await signCall('PUT','/api/settings/compliance',{mode:'development'},ck);
  assert.deepEqual(saveSettings.j,{mode:'development'});
  assert.equal((await signCall('PUT','/api/settings/compliance',{mode:'development',private_key_pem:'leak'},ck)).st,400);
  // With migrated legacy certificate (doesn't match key): must return 400
  const withCert=(await signCall('POST',`/api/invoices/${inv}/sign`,{},ck));
  assert.equal(withCert.st,400,`must return 400 when certificate doesn't match key: ${JSON.stringify(withCert.j)}`);
  assert.ok(withCert.j.error,'message must contain error');
  signServer.close();signDb.close();
  console.log('sign endpoint rejection test passed with code 400 (cert/key mismatch)');
