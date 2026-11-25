import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
const dir=new URL('../web/',import.meta.url);
const files=fs.readdirSync(dir).filter(n=>/\.(js|html|css)$/.test(n));
const mojibake=/ظ…|ط§|ط¨|ط¯|ط±|ط©/;
const offenders=[];
for(const f of files){
 const s=fs.readFileSync(new URL(f,dir),'utf8');
 if(s.includes('\uFFFD'))offenders.push(`${f}: U+FFFD replacement`);
 else if(mojibake.test(s))offenders.push(`${f}: mojibake markers`);
}
assert.deepEqual(offenders,[],`encoding corruption in web assets:\n${offenders.join('\n')}`);
// sanity: key UI strings must be proper Arabic
const app=fs.readFileSync(new URL('app.js',dir),'utf8');
for(const word of ['الفواتير','الرئيسية','المحاسب','تسجيل الدخول','كلمة المرور'])assert.ok(app.includes(word),`missing proper Arabic: ${word}`);
console.log('PASS: web assets are valid UTF-8 Arabic with no mojibake');