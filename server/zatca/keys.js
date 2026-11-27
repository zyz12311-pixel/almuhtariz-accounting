import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { loadEcdsaPrivateKey } from './node-crypto.js';

const activeStores=new WeakSet();

export class IssuerKeyConflict extends Error {
  constructor(message){super(message);this.status=409;}
}

function publicKeyDetails(privateKeyPem){
  const privateKey=loadEcdsaPrivateKey(privateKeyPem).nodeKey;
  const publicKey=createPublicKey(privateKey).export({format:'der',type:'spki'});
  return{
    fingerprint:createHash('sha256').update(publicKey).digest('hex'),
    publicKey:publicKey.toString('base64'),
  };
}

export async function getIssuerKeyStatus(store,issuerId){
  if(!store)return{available:false,configured:false,state:'unavailable',fingerprint:null,generated_at:null};
  if(!issuerId)return{available:true,configured:false,state:'identity_required',fingerprint:null,generated_at:null};
  if(!store.has())return{available:true,configured:false,state:'missing',fingerprint:null,generated_at:null};
  const value=await store.load();
  if(value.issuer_id!==issuerId)return{available:true,configured:false,state:'identity_mismatch',fingerprint:null,generated_at:null};
  if(typeof value.private_key_pem!=='string'||!value.private_key_pem)return{available:true,configured:false,state:'missing',fingerprint:null,generated_at:null};
  try{
    const details=publicKeyDetails(value.private_key_pem);
    return{available:true,configured:true,state:'generated',fingerprint:details.fingerprint,generated_at:value.key_generated_at||null};
  }catch{
    return{available:true,configured:false,state:'invalid',fingerprint:null,generated_at:value.key_generated_at||null,error:'تعذر قراءة المفتاح المحفوظ؛ أوقف التهيئة وراجع مخزن DPAPI'};
  }
}

export async function generateAndStoreIssuerKey(store,issuerId){
  if(!store||typeof store.has!=='function'||typeof store.load!=='function'||typeof store.save!=='function'){
    throw new TypeError('مخزن مفاتيح وحدة الإصدار غير جاهز');
  }
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(issuerId||'')){
    throw new TypeError('معرّف ملف وحدة الإصدار غير صالح');
  }
  if(activeStores.has(store))throw new IssuerKeyConflict('يجري توليد مفتاح لهذه الوحدة؛ انتظر انتهاء العملية');
  activeStores.add(store);
  try{
    const existing=store.has()?await store.load():null;
    if(existing&&(existing.issuer_id!==issuerId||existing.private_key_pem||existing.certificate_pem)){
      throw new IssuerKeyConflict('يوجد مخزن أو مفتاح مرتبط؛ لم يُستبدل أي مفتاح');
    }
    const pair=generateKeyPairSync('ec',{
      namedCurve:'secp256k1',
      privateKeyEncoding:{type:'pkcs8',format:'pem'},
      publicKeyEncoding:{type:'spki',format:'der'},
    });
    const generatedAt=new Date().toISOString();
    const details=publicKeyDetails(pair.privateKey);
    if(!Buffer.from(pair.publicKey).equals(Buffer.from(details.publicKey,'base64'))){
      throw new Error('لم تتطابق مفاتيح ECDSA التي أُنشئت');
    }
    await store.save({
      ...(existing||{}),
      issuer_id:issuerId,
      private_key_pem:pair.privateKey,
      key_generated_at:generatedAt,
    });
    return{fingerprint:details.fingerprint,generated_at:generatedAt,algorithm:'ECDSA-secp256k1-SHA256'};
  }finally{
    activeStores.delete(store);
  }
}
