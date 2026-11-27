import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWindowsDpapiStore } from '../server/zatca/windows-dpapi.js';
import { generateAndStoreIssuerKey, getIssuerKeyStatus } from '../server/zatca/keys.js';
import { createZatcaCsr, verifyZatcaCsr } from '../server/zatca/csr.js';

if (process.platform === 'win32') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'almuhtariz-dpapi-'));
  const filePath = path.join(directory, 'simulation-secrets.bin');
  const restoredPath = path.join(directory, 'restored-secrets.bin');
  const keyPath = path.join(directory, 'issuer-key.dpapi');
  const restoredKeyPath = path.join(directory, 'restored-issuer-key.dpapi');
  const store = createWindowsDpapiStore(filePath);
  const testCredentials = { token: 'dummy-simulation-token', secret: 'dummy-simulation-secret' };
  try {
    await store.save(testCredentials);
    const bytes = await readFile(filePath);
    assert.equal(bytes.includes(Buffer.from(testCredentials.secret)), false);
    assert.deepEqual(await store.load(), testCredentials);
    await writeFile(restoredPath,bytes);
    assert.deepEqual(await createWindowsDpapiStore(restoredPath).load(),testCredentials);

    const keyStore=createWindowsDpapiStore(keyPath);
    const issuerId='84a3f801-5f6e-4bd0-8d35-f4e25b8b4e17';
    const generated=await generateAndStoreIssuerKey(keyStore,issuerId);
    assert.equal(generated.algorithm,'ECDSA-secp256k1-SHA256');
    assert.equal(Object.hasOwn(generated,'private_key_pem'),false);
    const keyBytes=await readFile(keyPath);
    assert.equal(keyBytes.includes(Buffer.from('-----BEGIN PRIVATE KEY-----')),false,'private key must not be stored in plaintext');
    assert.equal(keyBytes.includes(Buffer.from('-----BEGIN EC PRIVATE KEY-----')),false,'private key must not be stored in plaintext');
    assert.equal((await getIssuerKeyStatus(keyStore,issuerId)).fingerprint,generated.fingerprint);
    await writeFile(restoredKeyPath,keyBytes);
    const restoredKeyStore=createWindowsDpapiStore(restoredKeyPath);
    assert.deepEqual(await restoredKeyStore.load(),await keyStore.load());
    assert.equal((await getIssuerKeyStatus(restoredKeyStore,issuerId)).fingerprint,generated.fingerprint);
    await assert.rejects(()=>generateAndStoreIssuerKey(restoredKeyStore,issuerId),error=>error.status===409);

    const storedKey=await restoredKeyStore.load();
    const csrConfig={
      commonName:'TST-886431145-300000000000003',
      serialNumber:`1-TST|2-TST|3-${issuerId}`,
      organizationIdentifier:'300000000000003',
      organizationUnitName:'Riyadh Branch',
      organizationName:'Test Organization',
      countryName:'SA',
      invoiceType:'1100',
      location:'RRRD2929',
      industry:'Test activities',
      template:'PREZATCA-Code-Signing',
    };
    const csr=createZatcaCsr({privateKeyPem:storedKey.private_key_pem,config:csrConfig});
    const verifiedCsr=verifyZatcaCsr(csr.csrPem,csrConfig);
    assert.equal(verifiedCsr.valid,true);
    assert.equal(verifiedCsr.publicKeyFingerprint,generated.fingerprint);
    assert.equal(csr.csrPem.includes('PRIVATE KEY'),false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
} else {
  assert.throws(() => createWindowsDpapiStore(path.join(os.tmpdir(), 'dpapi-test')), /Windows فقط/);
}

console.log('PASS: Windows DPAPI store protects test keys, restores them under the current user, and creates a CSR without disclosing the private key');
