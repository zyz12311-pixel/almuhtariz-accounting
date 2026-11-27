import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { signInvoiceXml } from '../server/zatca/signature.js';

const [invoiceFile, privateKeyFile, certificateFile, signedOutputFile] = process.argv.slice(2);
if (!invoiceFile || !privateKeyFile || !certificateFile || !signedOutputFile) {
  throw new Error('Usage: node tests/zatca-signature-sdk.js invoice.xml private-key.pem certificate.pem signed-output.xml');
}

const certificatePem = `-----BEGIN CERTIFICATE-----\n${fs.readFileSync(certificateFile, 'utf8').trim()}\n-----END CERTIFICATE-----`;
const result = await signInvoiceXml({
  invoiceXml: fs.readFileSync(invoiceFile, 'utf8'),
  privateKeyPem: `-----BEGIN EC PRIVATE KEY-----\n${fs.readFileSync(privateKeyFile, 'utf8').trim()}\n-----END EC PRIVATE KEY-----`,
  certificatePem,
  signingTime: new Date('2026-11-26T03:47:35Z'),
});

assert.equal(Buffer.from(result.invoiceHash, 'base64').length, 32, 'Invoice reference digest must be SHA-256');
fs.writeFileSync(signedOutputFile, result.xml, 'utf8');

const java=process.env.ZATCA_JAVA;
const classpath=process.env.ZATCA_XMLSEC_CLASSPATH;
if(!java||!path.isAbsolute(java)||!classpath)throw new Error('Set ZATCA_JAVA and ZATCA_XMLSEC_CLASSPATH for independent verification');
const helper=path.resolve('server/zatca/java/build');
const verifyClasspath=[helper,...classpath.split(path.delimiter)].join(path.delimiter);
const verify=spawnSync(java,['-cp',verifyClasspath,'VerifyXades',path.resolve(signedOutputFile)],{encoding:'utf8',shell:false,windowsHide:true,timeout:60000});
assert.equal(verify.status,0,`Independent XAdES verification failed: ${verify.stdout||''} ${verify.stderr||''}`);

const tamperedOutput=signedOutputFile+'.tampered.xml';
fs.writeFileSync(tamperedOutput,result.xml.replace('23.00','230.00'),'utf8');
const tampered=spawnSync(java,['-cp',verifyClasspath,'VerifyXades',path.resolve(tamperedOutput)],{encoding:'utf8',shell:false,windowsHide:true,timeout:60000});
assert.notEqual(tampered.status,0,'Tampered signed XML must be rejected');
fs.unlinkSync(tamperedOutput);

console.log(`PASS: independent XMLDSig/XAdES verification and tamper rejection (${result.invoiceHash})`);
console.log(`Signed XML fixture: ${signedOutputFile}`);
