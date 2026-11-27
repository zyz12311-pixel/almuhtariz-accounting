import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createZatcaCsr, verifyZatcaCsr } from '../server/zatca/csr.js';

const config = {
  commonName: 'TST-886431145-300000000000003',
  serialNumber: '1-TST|2-TST|3-test-issuer',
  organizationIdentifier: '300000000000003',
  organizationUnitName: 'Riyadh Branch',
  organizationName: 'Test Organization',
  countryName: 'SA',
  invoiceType: '1100',
  location: 'RRRD2929',
  industry: 'Test activities',
  template: 'PREZATCA-Code-Signing',
};
const pair = generateKeyPairSync('ec', {
  namedCurve: 'secp256k1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const generated = createZatcaCsr({ privateKeyPem: pair.privateKey, config });
const verified = verifyZatcaCsr(generated.csrPem, config);

assert.equal(verified.valid, true);
assert.equal(verified.template, 'PREZATCA-Code-Signing');
assert.equal(verified.config.organizationIdentifier, config.organizationIdentifier);
assert.equal(verified.publicKeyFingerprint, generated.fingerprint);
assert.equal(Object.hasOwn(generated, 'privateKeyPem'), false);
assert.equal(generated.csrPem.includes('PRIVATE KEY'), false);
assert.throws(
  () => verifyZatcaCsr(generated.csrPem, { ...config, commonName: 'different' }),
  /subject في CSR لا تطابق الإعداد/,
);

const tamperedDer = Buffer.from(generated.csrPem
  .replace(/-----BEGIN CERTIFICATE REQUEST-----|-----END CERTIFICATE REQUEST-----|\s/g, ''), 'base64');
tamperedDer[tamperedDer.length - 1] ^= 1;
const tamperedCsr = `-----BEGIN CERTIFICATE REQUEST-----\n${tamperedDer.toString('base64')}\n-----END CERTIFICATE REQUEST-----\n`;
assert.throws(() => verifyZatcaCsr(tamperedCsr, config), /توقيع CSR/);

const unsupportedCurve = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
assert.throws(
  () => createZatcaCsr({ privateKeyPem: unsupportedCurve.privateKey.export({ type: 'pkcs8', format: 'pem' }), config }),
  /secp256k1/,
);
const configWithoutTemplate = { ...config };
delete configWithoutTemplate.template;
assert.throws(
  () => createZatcaCsr({ privateKeyPem: pair.privateKey, config: configWithoutTemplate }),
  /قالب CSR مطلوب/,
);

console.log('PASS: CSR fields, secp256k1 signature, expected identity, tamper rejection, and private-key non-disclosure');
