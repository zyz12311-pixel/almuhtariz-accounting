// أداة المطوّر (تعمل عندك أنت لا عند العميل):
//   node tools/make-license.js keygen
//   node tools/make-license.js sign --customer "اسم" --vat 300000000000003 --pos 3 --users 5 --expires 2027-10-25 --out license.json
import crypto from 'node:crypto';
import fs from 'node:fs';
const [cmd, ...rest] = process.argv.slice(2);
const arg = k => { const i = rest.indexOf('--' + k); return i >= 0 ? rest[i + 1] : undefined; };
if (cmd === 'keygen') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync('tools/private.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  fs.writeFileSync('server/license-pub.pem', publicKey.export({ type: 'spki', format: 'pem' }));
  console.log('تم: tools/private.pem (سرّي؛ احتفظ بنسخة آمنة ولا ترفعه) و server/license-pub.pem (يُضمَّن في البرنامج)');
} else if (cmd === 'sign') {
  const payload = Buffer.from(JSON.stringify({ customer: arg('customer'), vat_number: arg('vat'), max_pos: Number(arg('pos') || 1),
    max_users: Number(arg('users') || 2), modules: (arg('modules') || '').split(',').filter(Boolean), expires: arg('expires') || null, issued: new Date().toISOString().slice(0, 10) }));
  const sig = crypto.sign(null, payload, crypto.createPrivateKey(fs.readFileSync('tools/private.pem')));
  fs.writeFileSync(arg('out') || 'license.json', JSON.stringify({ payload: payload.toString('base64'), sig: sig.toString('base64') }, null, 2));
  console.log('تم إنشاء ملف الترخيص');
} else console.log('الأوامر: keygen | sign');
