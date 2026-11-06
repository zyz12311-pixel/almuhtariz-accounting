import crypto from 'node:crypto';
export const toCents = v => Math.round(Number(v) * 100);
export const fromCents = c => (c / 100).toFixed(2);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const sha256b64 = s => crypto.createHash('sha256').update(s).digest('base64');

// ترميز TLV المستخدم في رمز QR للفاتورة (وسم، طول، قيمة UTF-8) ثم Base64
export function tlv(fields) {
  return Buffer.concat(fields.map(([t, v]) => {
    const b = Buffer.from(String(v), 'utf8');
    if (b.length > 255) throw new Error('حقل QR أطول من المسموح');
    return Buffer.concat([Buffer.from([t, b.length]), b]);
  })).toString('base64');
}
export function untlv(b64) {
  const b = Buffer.from(b64, 'base64'), out = {};
  for (let i = 0; i < b.length;) { const t = b[i], l = b[i + 1]; out[t] = b.subarray(i + 2, i + 2 + l).toString('utf8'); i += 2 + l; }
  return out;
}
export function nowRiyadh() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}
export function hashPass(pw) { const s = crypto.randomBytes(16); return s.toString('hex') + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); }
export function checkPass(pw, st) {
  const [s, h] = st.split(':'); const x = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64);
  return crypto.timingSafeEqual(x, Buffer.from(h, 'hex'));
}
