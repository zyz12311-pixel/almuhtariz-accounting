import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { hashZatcaInvoiceC14n11 } from '../server/zatca/c14n.js';

const java = process.env.ZATCA_JAVA;
const sdkJar = process.env.ZATCA_SDK_JAR;
const sdkConfig = process.env.SDK_CONFIG;
const invoices = process.argv.slice(2);
if (!java || !path.isAbsolute(java) || !sdkJar || !path.isAbsolute(sdkJar) || !sdkConfig || !path.isAbsolute(sdkConfig)) {
  throw new Error('Set absolute ZATCA_JAVA, ZATCA_SDK_JAR, and SDK_CONFIG paths before running this SDK comparison');
}
if (!invoices.length) throw new Error('Pass one or more local development invoice XML files');
for (const invoicePath of invoices) {
  const absolutePath = path.resolve(invoicePath);
  const xml = fs.readFileSync(absolutePath, 'utf8');
  const localHash = hashZatcaInvoiceC14n11(xml, { javaExecutable: java, classpath: sdkJar });
  const sdk = spawnSync(java, [
    '-Dfile.encoding=UTF-8',
    '-jar',
    sdkJar,
    '-generateHash',
    '-invoice',
    absolutePath,
  ], {
    cwd: path.dirname(sdkJar),
    env: { ...process.env, SDK_CONFIG: sdkConfig },
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (sdk.error) throw new Error(`SDK failed to start: ${sdk.error.message}`, { cause: sdk.error });
  if (sdk.status !== 0) throw new Error(`SDK hash generation failed for ${absolutePath}: ${sdk.stderr}`);
  const output = `${sdk.stdout}\n${sdk.stderr}`;
  const match = output.match(/INVOICE HASH\s*=\s*([A-Za-z0-9+/=]+)/);
  assert.ok(match, `SDK did not return an invoice hash for ${absolutePath}`);
  assert.equal(localHash, match[1], `C14N 1.1 hash mismatch for ${absolutePath}`);
  console.log(`PASS: Apache C14N 1.1 hash matches SDK 3.4.8 for ${path.basename(absolutePath)} (${localHash})`);
}
