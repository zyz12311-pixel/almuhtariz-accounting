import { createHash } from 'node:crypto';

const LOOPBACK = new Set(['127.0.0.1','::1','localhost']);
export function isLoopback(host){return LOOPBACK.has(host||'')||/^::ffff:127\.0\.0\.1$/.test(host||'');}
export function localAccess(req){
  const host = (req.headers.host||'').split(':')[0];
  const secure = (req.socket && req.socket.encrypted) === true || req.headers['x-forwarded-proto'] === 'https';
  const allowed = isLoopback(host) || secure;
  return {allowed, secure, writeAllowed: allowed};
}
export function localCookie(token, secure, maxAge){
  return `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure?'; Secure':''}`;
}
export function sessionDigest(token){
  return createHash('sha256').update(token).digest('hex');
}
