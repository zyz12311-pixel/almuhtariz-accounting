import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { hashPass } from '../server/lib.js';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'almuhtariz-issuer-'));
let storedCredentials=null;
const complianceSecretStore={
  has:()=>Boolean(storedCredentials),
  async save(value){storedCredentials={...value};},
  async load(){return storedCredentials&&{...storedCredentials};},
};
const {server,db}=createApp({
  dbFile:path.join(directory,'issuer.db'),
  licensePath:path.join(directory,'license.json'),
  complianceSecretStore,
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const call=async(method,route,body,cookie='')=>{
  const response=await fetch(base+route,{
    method,
    headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},
    body:body?JSON.stringify(body):undefined,
  });
  const text=await response.text();
  return{status:response.status,json:text?JSON.parse(text):null};
};

try{
  await call('POST','/api/setup',{username:'owner',password:'password123',company_name:'منشأة اختبار'});
  const loginResponse=await fetch(base+'/api/login',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({username:'owner',password:'password123'}),
  });
  const ownerCookie=loginResponse.headers.get('set-cookie').split(';')[0];
  db.prepare("INSERT INTO users(username,pass,role) VALUES(?,?,'accountant')").run('accountant',hashPass('password123'));
  const accountantResponse=await fetch(base+'/api/login',{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({username:'accountant',password:'password123'}),
  });
  const accountantCookie=accountantResponse.headers.get('set-cookie').split(';')[0];

  assert.equal((await call('GET','/api/compliance/status',undefined,ownerCookie)).json.issuer_profile,null);
  assert.equal((await call('GET','/api/compliance/status',undefined,accountantCookie)).status,403);
  assert.equal((await call('PUT','/api/compliance/issuer',{name:'الخادم المركزي',scope:'central_server'},accountantCookie)).status,403);
  assert.equal((await call('PUT','/api/compliance/certificate',{
    certificate_pem:'-----BEGIN CERTIFICATE-----x-----END CERTIFICATE-----',
    private_key_pem:'-----BEGIN PRIVATE KEY-----x-----END PRIVATE KEY-----',
  },ownerCookie)).status,409);
  assert.equal(storedCredentials,null);

  await call('PUT','/api/settings/company',{vat_number:'300000000000003'},ownerCookie);
  assert.equal((await call('PUT','/api/compliance/issuer',{name:'الخادم المركزي',scope:'unknown'},ownerCookie)).status,400);
  const created=await call('PUT','/api/compliance/issuer',{name:'خادم المنشأة الرئيسي',scope:'central_server'},ownerCookie);
  assert.equal(created.status,200);
  assert.equal(created.json.created,true);
  assert.match(created.json.profile.local_id,/^[0-9a-f-]{36}$/i);
  assert.equal(created.json.profile.official_identifier,null);
  assert.equal(created.json.profile.registration_status,'not_registered');
  assert.equal(created.json.profile.company_vat_matches,true);

  const replay=await call('PUT','/api/compliance/issuer',{name:'خادم المنشأة الرئيسي',scope:'central_server'},ownerCookie);
  assert.equal(replay.json.created,false);
  assert.equal(replay.json.profile.local_id,created.json.profile.local_id);
  assert.equal((await call('PUT','/api/compliance/issuer',{name:'فرع مستقل',scope:'independent_branch'},ownerCookie)).status,409);
  const generationAttempts=await Promise.all([
    call('POST','/api/compliance/issuer/key/generate',{},ownerCookie),
    call('POST','/api/compliance/issuer/key/generate',{},ownerCookie),
  ]);
  const generated=generationAttempts.find(result=>result.status===200);
  assert.ok(generated,`one concurrent request must generate the key: ${JSON.stringify(generationAttempts)}`);
  assert.equal(generationAttempts.filter(result=>result.status===409).length,1,'the concurrent request must not replace the key');
  assert.equal(generated.json.generated,true);
  assert.equal(generated.json.algorithm,'ECDSA-secp256k1-SHA256');
  assert.ok(generated.json.fingerprint);
  assert.equal(Object.hasOwn(generated.json,'private_key_pem'),false);
  assert.equal(storedCredentials.issuer_id,created.json.profile.local_id);
  assert.ok(storedCredentials.private_key_pem);
  const keyStatus=await call('GET','/api/compliance/issuer/key',undefined,ownerCookie);
  assert.equal(keyStatus.json.configured,true);
  assert.equal(keyStatus.json.fingerprint,generated.json.fingerprint);
  assert.equal((await call('POST','/api/compliance/issuer/key/generate',{},ownerCookie)).status,409);

  const changedVat=await call('PUT','/api/settings/company',{vat_number:'311111111111113'},ownerCookie);
  assert.equal(changedVat.status,200);
  const mismatch=await call('GET','/api/compliance/status',undefined,ownerCookie);
  assert.equal(mismatch.json.issuer_profile.company_vat_matches,false);
  assert.equal((await call('PUT','/api/compliance/certificate',{
    certificate_pem:'-----BEGIN CERTIFICATE-----x-----END CERTIFICATE-----',
    private_key_pem:'-----BEGIN PRIVATE KEY-----x-----END PRIVATE KEY-----',
  },ownerCookie)).status,409);

  await call('PUT','/api/settings/company',{vat_number:'300000000000003'},ownerCookie);
  const saved=await call('PUT','/api/compliance/certificate',{
    certificate_pem:'-----BEGIN CERTIFICATE-----x-----END CERTIFICATE-----',
  },ownerCookie);
  assert.equal(saved.status,400,'certificate installation must reject malformed certificate input');
  const status=await call('GET','/api/compliance/status',undefined,ownerCookie);
  assert.equal(status.json.issuer_configured,false,'a local profile is not official EGS registration');
  assert.equal(status.json.key_configured,true);
  assert.equal(status.json.certificate_configured,false);
  assert.equal(status.json.issuer_status,'local_profile_unregistered');
  console.log('PASS: owner-only local EGS profile, stable identity, VAT binding, and credential-to-issuer binding');
}finally{
  await new Promise(resolve=>server.close(resolve));
  db.close();
  fs.rmSync(directory,{recursive:true,force:true});
}
