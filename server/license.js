import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowRiyadh } from './lib.js';
const here = path.dirname(fileURLToPath(import.meta.url));
export const PUB = path.join(here, 'license-pub.pem');
const TRIAL = { status: 'trial', max_pos: 1, max_users: 2, modules: [], customer: 'نسخة تجريبية', expires: null, readOnly: false };

export function verifyLicenseFile(obj, pubPem) {
  const ok = crypto.verify(null, Buffer.from(obj.payload, 'base64'), crypto.createPublicKey(pubPem), Buffer.from(obj.sig, 'base64'));
  if (!ok) throw new Error('توقيع الترخيص غير صالح');
  return JSON.parse(Buffer.from(obj.payload, 'base64').toString('utf8'));
}
// يقيّم حالة الترخيص: trial | valid | expired | invalid | mismatch. عند expired/mismatch يصبح البرنامج للقراءة فقط.
export function evaluate(licensePath, companyVat, today = nowRiyadh().date, pubPath = PUB) {
  if (!fs.existsSync(licensePath) || !fs.existsSync(pubPath)) return { ...TRIAL };
  try {
    const p = verifyLicenseFile(JSON.parse(fs.readFileSync(licensePath, 'utf8')), fs.readFileSync(pubPath));
    const base = { ...p, status: 'valid', readOnly: false };
    if (p.vat_number && companyVat && p.vat_number !== companyVat) return { ...base, status: 'mismatch', readOnly: true };
    if (p.expires && p.expires < today) return { ...base, status: 'expired', readOnly: true };
    return base;
  } catch (e) { return { ...TRIAL, status: 'invalid', error: e.message }; }
}
