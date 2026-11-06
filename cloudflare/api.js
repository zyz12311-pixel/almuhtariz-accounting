const COOKIE = '__Host-almuhtariz';
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
function config(env) {
  const url = new URL(env.SUPABASE_URL || 'https://invalid.invalid');
  if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !env.SUPABASE_PUBLISHABLE_KEY) throw new ApiError(503, 'إعدادات الاتصال السحابي غير مكتملة.');
  return { url: url.origin, key: env.SUPABASE_PUBLISHABLE_KEY };
}
async function upstream(env, path, { token, method = 'GET', body } = {}) {
  const c = config(env); let response;
  try { response = await fetch(c.url + path, { method, redirect: 'error', signal: AbortSignal.timeout(12000), headers: { apikey: c.key, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  catch { throw new ApiError(503, 'تعذر الاتصال بالخدمة السحابية. حاول مجددًا.'); }
  if (!response.ok) {
    if ([400,401].includes(response.status)) throw new ApiError(401, 'تعذر تسجيل الدخول أو انتهت الجلسة. تحقق من البريد وكلمة المرور.');
    if (response.status === 403) throw new ApiError(403, 'لا توجد صلاحية لهذه العملية.');
    if (response.status === 429) throw new ApiError(429, 'محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.');
    throw new ApiError(503, 'الخدمة السحابية غير متاحة حاليًا.');
  }
  return response.status === 204 ? null : response.json();
}
function session(request) {
  const matches = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).filter(x => x.startsWith(COOKIE + '='));
  if (matches.length !== 1) return null;
  const value = matches[0].slice(COOKIE.length + 1);
  return /^[a-zA-Z0-9._-]{1,3800}$/.test(value) ? value : null;
}
const cookie = (value, seconds) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
async function body(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new ApiError(415, 'الطلب يجب أن يكون JSON.');
  const reader = request.body?.getReader(); if (!reader) throw new ApiError(400, 'طلب غير صالح.');
  const chunks = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 16384) { await reader.cancel(); throw new ApiError(413, 'الطلب أكبر من المسموح.'); } chunks.push(value); }
  try { const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; }
  catch { throw new ApiError(400, 'طلب غير صالح.'); }
}
async function identity(env, token) {
  if (!token) throw new ApiError(401, 'سجّل الدخول للمتابعة.');
  const user = await upstream(env, '/auth/v1/user', { token });
  if (!user?.id) throw new ApiError(401, 'جلسة غير صالحة.');
  const members = await upstream(env, '/rest/v1/organization_members?select=organization_id,role&user_id=eq.' + encodeURIComponent(user.id) + '&active=eq.true', { token });
  return { user, members };
}
export async function cloudApi(request, env) {
  const url = new URL(request.url), path = url.pathname;
  try {
    if (!['GET', 'POST'].includes(request.method)) throw new ApiError(405, 'طريقة الطلب غير مدعومة.');
    if (request.method === 'POST' && request.headers.get('Origin') !== url.origin) throw new ApiError(403, 'مصدر الطلب غير مسموح.');
    if (path === '/api/cloud/health' && request.method === 'GET') {
      await upstream(env, '/auth/v1/settings');
      return json({ connected: true, mode: 'cloud', sync_enabled: false });
    }
    if (path === '/api/login' && request.method === 'POST') {
      const input = await body(request);
      if (typeof input.username !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.username.trim()) || typeof input.password !== 'string' || !input.password || input.password.length > 1024) throw new ApiError(400, 'أدخل البريد الإلكتروني وكلمة المرور.');
      const result = await upstream(env, '/auth/v1/token?grant_type=password', { method: 'POST', body: { email: input.username.trim(), password: input.password } });
      if (!/^[a-zA-Z0-9._-]{1,3800}$/.test(result.access_token || '')) throw new ApiError(503, 'تعذر إنشاء الجلسة.');
      return json({ ok: true }, 200, { 'Set-Cookie': cookie(result.access_token, Math.min(Number(result.expires_in) || 3600, 3600)) });
    }
    const token = session(request);
    if (path === '/api/logout' && request.method === 'POST') {
      if (token) { try { await upstream(env, '/auth/v1/logout?scope=local', { token, method: 'POST' }); } catch {} }
      return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
    }
    if (path === '/api/state' && request.method === 'GET') {
      config(env);
      if (!token) return json({ mode: 'cloud', setup_needed: false, user: null, activity: '' });
      try {
        const { user, members } = await identity(env, token);
        return json({ mode: 'cloud', setup_needed: false, user: { id: user.id, username: user.email, role: members[0]?.role || null }, memberships: members, activity: '' });
      } catch (error) {
        if (error.status !== 401) throw error;
        return json({ mode: 'cloud', setup_needed: false, user: null, activity: '' }, 200, { 'Set-Cookie': cookie('', 0) });
      }
    }
    if (path === '/api/cloud/overview' && request.method === 'GET') {
      const { members } = await identity(env, token);
      const org = url.searchParams.get('organization_id') || members[0]?.organization_id;
      const member = members.find(m => m.organization_id === org);
      if (!member || !['owner','accountant','staff'].includes(member.role)) throw new ApiError(403, 'حسابك غير مرتبط بمنشأة مفعّلة بعد.');
      const suffix = '&organization_id=eq.' + encodeURIComponent(org);
      const read = query => upstream(env, '/rest/v1/' + query + suffix, { token });
      const items = await read('items?select=id,name_ar,barcode,unit_price,vat_rate,base_unit,active&active=eq.true&order=name_ar&limit=100');
      if (member.role === 'staff') return json({ role: member.role, organization_id: org, items, invoices: [], parties: [], organizations: [], read_only: true });
      const [organizations, invoices, parties] = await Promise.all([
        upstream(env, '/rest/v1/organizations?select=id,name_ar,activity&id=eq.' + encodeURIComponent(org), { token }),
        read('invoices?select=id,number,status,document_code,issue_date,total&order=created_at.desc&limit=100'),
        read('parties?select=id,name_ar,kind&order=name_ar&limit=100')
      ]);
      return json({ role: member.role, organization_id: org, items, invoices, parties, organizations, read_only: true });
    }
    throw new ApiError(503, 'هذه العملية لم تُفعّل سحابيًا بعد. استخدم نسخة الفرع المحلية.');
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.message : 'تعذر إكمال الطلب.' }, error instanceof ApiError ? error.status : 500);
  }
}
