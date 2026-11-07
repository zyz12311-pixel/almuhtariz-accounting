const COOKIE = '__Host-almuhtariz';
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers } });
function config(env) {
  const url = new URL(env.SUPABASE_URL || 'https://invalid.invalid');
  if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !env.SUPABASE_PUBLISHABLE_KEY) throw new ApiError(503, 'إعدادات الاتصال السحابي غير مكتملة.');
  const key=String(env.SUPABASE_PUBLISHABLE_KEY).trim();
  if (!/^(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+)$/.test(key)) throw new ApiError(503, 'قيمة SUPABASE_PUBLISHABLE_KEY غير صالحة. أدخل المفتاح العام نفسه دون اسم المتغير أو علامات اقتباس.');
  return { url: url.origin, key };
}
async function upstream(env, path, { token, method = 'GET', body, admin=false } = {}) {
  const c = config(env); let response;
  const key=admin?String(env.SUPABASE_SERVICE_ROLE_KEY||'').trim():c.key;
  if(admin&&!/^(sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+)$/.test(key))throw new ApiError(503,'مفتاح الخدمة الخلفية غير مهيأ.');
  try { response = await fetch(c.url + path, { method, redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { apikey: key, ...(token ? { Authorization: 'Bearer ' + token } : admin&&key.startsWith('eyJ')?{Authorization:'Bearer '+key}:{}), ...(body ? { 'Content-Type': 'application/json',Prefer:'return=representation' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  catch (error) { const failure=new ApiError(503, 'تعذر الاتصال بالخدمة السحابية. حاول مجددًا.'); failure.code=error.name==='TimeoutError'?'UPSTREAM_TIMEOUT':'UPSTREAM_NETWORK_ERROR';throw failure; }
  if (!response.ok) {
    if(path.startsWith('/rest/v1/rpc/cloud_')){
      const details=await response.json().catch(()=>null);
      if(['PT400','PT404','PT409'].includes(details?.code))throw new ApiError(Number(details.code.slice(2)),details.message);
      if(response.status===403)throw new ApiError(403,'لا توجد صلاحية لهذه العملية داخل المنشأة.');
      if(response.status===404)throw new ApiError(503,'إدارة المنشآت تحتاج ترحيل قاعدة البيانات.');
    }
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
async function body(request,max=16384) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new ApiError(415, 'الطلب يجب أن يكون JSON.');
  const reader = request.body?.getReader(); if (!reader) throw new ApiError(400, 'طلب غير صالح.');
  const chunks = []; let length = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > max) { await reader.cancel(); throw new ApiError(413, 'الطلب أكبر من المسموح.'); } chunks.push(value); }
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
const uuid = value => typeof value==='string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const rpc = (env,token,name,args) => upstream(env,'/rest/v1/rpc/'+name,{token,method:'POST',body:args});
function managementCommand(input, org) {
  const { action, id, name, activity, address, active, branch_id, prefix, role, email, pos_ids, end_sessions } = input;
  if(!uuid(org)||(id!=null&&!uuid(id)))throw new ApiError(400,'معرف المنشأة أو السجل غير صالح.');
  if(action==='organization'&&typeof name==='string'&&typeof activity==='string'){
    return ['cloud_update_organization',{p_org:org,p_name:name,p_activity:activity}];
  }
  if(action==='branch'&&typeof name==='string'&&(address==null||typeof address==='string')&&typeof active==='boolean'){
    return ['cloud_save_branch',{p_org:org,p_id:id??null,p_name:name,p_address:address??null,p_active:active}];
  }
  if(action==='point'&&uuid(branch_id)&&typeof name==='string'&&typeof prefix==='string'&&typeof active==='boolean'){
    return ['cloud_save_pos',{p_org:org,p_id:id??null,p_branch:branch_id,p_name:name,p_prefix:prefix,p_active:active}];
  }
  if(action==='member'&&(id||typeof email==='string')&&typeof role==='string'&&typeof active==='boolean'
    &&Array.isArray(pos_ids)&&pos_ids.length<=100&&pos_ids.every(uuid)&&typeof end_sessions==='boolean'){
    return ['cloud_save_member',{p_org:org,p_user:id??null,p_email:id?null:email,p_role:role,p_active:active,p_pos_ids:pos_ids,p_end_sessions:end_sessions}];
  }
  throw new ApiError(400,'بيانات الإدارة غير صالحة.');
}
export async function cloudApi(request, env) {
  const url = new URL(request.url), path = url.pathname;
  try {
    if (!['GET', 'POST'].includes(request.method)) throw new ApiError(405, 'طريقة الطلب غير مدعومة.');
    if (request.method === 'POST' && path!=='/api/sync/snapshot' && request.headers.get('Origin') !== url.origin) throw new ApiError(403, 'مصدر الطلب غير مسموح.');
    if(path==='/api/sync/snapshot'&&request.method==='POST'){
      const credential=(request.headers.get('Authorization')||'').match(/^Bearer ([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/i);
      if(!credential)throw new ApiError(401,'رمز جهاز غير صالح.');
      const input=await body(request,4500000),snapshot=input.snapshot;
      if(!Number.isSafeInteger(input.sequence)||input.sequence<1||snapshot?.installation_id!==credential[1]||snapshot.version!==1||!snapshot.tables||!Array.isArray(snapshot.tables.items)||!Array.isArray(snapshot.tables.invoices))throw new ApiError(400,'لقطة الفرع غير صالحة.');
      const allowed=['items','warehouses','valuation','parties','invoices','purchases','vouchers','accounts','journal_entries','journal_lines','stock_movements','shifts'];
      if(Object.keys(snapshot.tables).some(t=>!allowed.includes(t))||Object.keys(snapshot).some(k=>!['version','installation_id','captured_at','company','tables'].includes(k)))throw new ApiError(400,'اللقطة تحتوي بيانات غير مسموح بنقلها.');
      const sha=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
      const result=await upstream(env,'/rest/v1/rpc/publish_branch_snapshot',{admin:true,method:'POST',body:{p_installation:credential[1],p_token_hash:await sha(credential[2]),p_sequence:input.sequence,p_payload_hash:await sha(JSON.stringify(snapshot)),p_payload:snapshot}});
      return json(result);
    }
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
    if(path==='/api/cloud/manage'||path==='/api/cloud/devices'){
      const {members}=await identity(env,token),input=request.method==='POST'?await body(request):{},org=input.organization_id||url.searchParams.get('organization_id')||members[0]?.organization_id;
      if(!members.some(m=>m.organization_id===org&&m.role==='owner'))throw new ApiError(403,'صلاحيات مالك المنشأة مطلوبة.');
      if(path==='/api/cloud/manage'){
        if(request.method==='GET')return json(await rpc(env,token,'cloud_admin_overview',{p_org:org}));
        const [name,args]=managementCommand(input,org);
        const id=await rpc(env,token,name,args);
        return json({ok:true,id});
      }
      if(request.method==='GET')return json(await rpc(env,token,'cloud_devices',{p_org:org}));
      if(!uuid(input.installation_id)||!uuid(input.branch_id))throw new ApiError(400,'اختر الفرع وأدخل معرف النسخة المحلية الصحيح.');
      const secret=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      const tokenHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret))),b=>b.toString(16).padStart(2,'0')).join('');
      await rpc(env,token,'cloud_link_device',{p_org:org,p_branch:input.branch_id,p_installation:input.installation_id,p_token_hash:tokenHash});
      return json({device_token:input.installation_id+'.'+secret,installation_id:input.installation_id});
    }
    if (path === '/api/cloud/overview' && request.method === 'GET') {
      const { members } = await identity(env, token);
      const org = url.searchParams.get('organization_id') || members[0]?.organization_id;
      const member = members.find(m => m.organization_id === org);
      if (!member || !['owner','accountant','staff'].includes(member.role)) throw new ApiError(403, 'حسابك غير مرتبط بمنشأة مفعّلة بعد.');
      const suffix = '&organization_id=eq.' + encodeURIComponent(org);
      const read = query => upstream(env, '/rest/v1/' + query + suffix, { token });
      const selected=url.searchParams.get('installation_id');
      if(selected&&!uuid(selected))throw new ApiError(400,'معرف نسخة الفرع غير صالح.');
      if(member.role==='staff'){
        const catalog=await rpc(env,token,'cloud_staff_catalog',{p_org:org,p_installation:selected});
        return json({role:member.role,organization_id:org,items:catalog.items,branches:catalog.branches,
          installation_id:catalog.installation_id,invoices:[],parties:[],organizations:[],read_only:true});
      }
      const items = await read('items?select=id,name_ar,barcode,unit_price,vat_rate,base_unit,active&active=eq.true&order=name_ar&limit=100');
      const [organizations, invoices, parties] = await Promise.all([
        upstream(env, '/rest/v1/organizations?select=id,name_ar,activity&id=eq.' + encodeURIComponent(org), { token }),
        read('invoices?select=id,number,status,document_code,issue_date,total&order=created_at.desc&limit=100'),
        read('parties?select=id,name_ar,kind&order=name_ar&limit=100')
      ]);
      const snapshots=await upstream(env,'/rest/v1/branch_snapshots?select=installation_id,received_at,payload&organization_id=eq.'+encodeURIComponent(org)+'&order=received_at.desc&limit=20',{token});
      const snapshot=selected?snapshots.find(s=>s.installation_id===selected):snapshots[0];
      if(selected&&!snapshot)throw new ApiError(403,'نسخة الفرع غير متاحة لهذا الحساب.');
      if(snapshot){const tables=snapshot.payload.tables;return json({role:member.role,organization_id:org,items:tables.items.filter(i=>i.active).slice(0,100).map(i=>({id:i.id,name_ar:i.name_ar,barcode:i.barcode,base_unit:i.base_unit,unit_price:Math.round(i.unit_price*100)})),invoices:tables.invoices.slice(-100).reverse(),parties:tables.parties.slice(0,100),organizations,read_only:true,snapshot:{installation_id:snapshot.installation_id,received_at:snapshot.received_at},branches:snapshots.map(s=>({id:s.installation_id,received_at:s.received_at}))});}
      return json({ role: member.role, organization_id: org, items, invoices, parties, organizations, read_only: true });
    }
    throw new ApiError(503, 'هذه العملية لم تُفعّل سحابيًا بعد. استخدم نسخة الفرع المحلية.');
  } catch (error) {
    return json({ error: error instanceof ApiError ? error.message : 'تعذر إكمال الطلب.', ...(error.code ? {code:error.code} : {}) }, error instanceof ApiError ? error.status : 500);
  }
}
