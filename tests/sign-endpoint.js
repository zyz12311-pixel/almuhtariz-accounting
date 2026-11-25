import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

// Test sign endpoint: must return 501 when no real XAdES signature exists
const signDir=fs.mkdtempSync(path.join(os.tmpdir(),'almuhtariz-sign-'));
const {server: signServer, db: signDb}=createApp({dbFile: path.join(signDir,'sign.db'), licensePath: path.join(signDir,'license.json')});
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
await signCall('PUT','/api/settings/company',{vat_number:'300000000000003',cr_number:'1234567890',street:'test street',building_number:'1234',district:'test district',city:'Riyadh',postal_code:'12345',country_code:'SA'},ck);
const party=(await signCall('POST','/api/parties',{name_ar:'customer',vat_number:'399999999800003',cr_number:'1234567890',street:'test street',building_number:'1234',district:'test district',city:'Riyadh',postal_code:'12345',country_code:'SA'},ck)).j.id;
const invRes=await signCall('POST','/api/invoices',{lines:[{description:'test item',qty:1,unit_price:'100.00',vat_rate:15}],party_id:party,supply_date:'2026-11-25'},ck);
console.log('invoice response:',invRes.st,invRes.j);
const inv=invRes.j.id;
// Without certificate: must return 400
const noCert=(await signCall('POST',`/api/invoices/${inv}/sign`,{},ck));
assert.equal(noCert.st,400,'must return 400 when certificate missing');
// With valid certificate but no real XAdES signature: must return 501
await signCall('PUT','/api/compliance/certificate',{certificate_pem:'-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',private_key_pem:'-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----\n'},ck);
const withCert=(await signCall('POST',`/api/invoices/${inv}/sign`,{},ck));
assert.equal(withCert.st,501,'must return 501 when no real XAdES signature');
assert.ok(withCert.j.error,'message must contain error');
signServer.close();signDb.close();
console.log('sign endpoint rejection test passed with code 501');
