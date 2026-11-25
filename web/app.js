const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { state: null, ui: {}, parties: [], items: [], pos: [] };
function setTrackingItem(row,item){
 const previous=row.trackingItem;
 if(previous?.id!==item?.id||previous?.item_unit_id!==item?.item_unit_id)row.dataset.tracking='[]';
 row.trackingItem=item;const button=$('[data-sale-tracking]',row);button.hidden=!item||!['lot','serial'].includes(item.tracking_mode);
 const count=JSON.parse(row.dataset.tracking||'[]').length;button.textContent=count?'ط§ظ„ظ‡ظˆظٹط§طھ ('+count+')':'ط¯ظپط¹ط§طھ ط£ظˆ طھط³ظ„ط³ظ„ط§طھ';
}
function updatePosPrice(row){
  const item=row.trackingItem;
  if(!item)return;
  const level=$('#pos-price-level')?.value||'retail';
  const base=level==='wholesale'&&item.scale_mode!=='price'?item.wholesale_price??item.unit_price:item.unit_price;
  const cap=Number(S.posPricing?.manual_price_cap||0);
  const canManual=Boolean(S.posPricing?.manual_price) && item.item_kind==='service' && item.scale_mode!=='price';
  const priceCell=$('.u',row)?.parentElement;
  if(priceCell){
    const existing=$('.pos-override',row);
    if(canManual && !existing){
      priceCell.insertAdjacentHTML('beforeend','<label class="line-discount">ط³ط¹ط± ظٹط¯ظˆظٹ ظ„ظ„ط®ط¯ظ…ط©<input class="pos-override" type="number" min="0" step="0.01" max="'+cap+'"></label>');
      $('.pos-override',row).oninput=()=>{$('.q',row).dispatchEvent(new Event('input',{bubbles:true}));};
    } else if(!canManual && existing){
      existing.closest('label')?.remove();
    } else if(existing){
      existing.max=String(cap);
    }
  }
  const override=$('.pos-override',row)?.value;
  $('.u',row).value=override===''||override==null?base:override;
}


async function api(p, o = {}) {
  const r = await fetch('/api/' + p, { method: o.method || 'GET', headers: o.body ? { 'content-type': 'application/json' } : {}, body: o.body ? JSON.stringify(o.body) : undefined, signal: o.signal });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { error: t }; }
  if (!r.ok) throw new Error(j.error || 'ط®ط·ط£');
  return j;
}
const msg = (t, ok) => { const m = $('#msg'); if (m) { m.className = 'msg' + (ok ? ' ok' : ''); m.textContent = t; m.hidden = !t; } };
const newSaleRequestId=()=>{if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();const bytes=new Uint8Array(16);globalThis.crypto.getRandomValues(bytes);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);};
const localScope = () => S.state?.installation_id && S.state?.user ? S.state.installation_id+':'+S.state.user.id : null;
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { msg(e.message); } };

const nf = () => new Intl.NumberFormat('ar-SA-u-nu-' + (S.ui.digits === 'arab' ? 'arab' : 'latn'), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = v => nf().format(Number(v));
const fdate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('ar-SA-u-nu-' + (S.ui.digits === 'arab' ? 'arab' : 'latn') + '-ca-' + (S.ui.calendar === 'hijri' ? 'islamic-umalqura' : 'gregory')) : '';

function applyUI() {
  const u = S.ui, d = document.documentElement, dark = u.theme === 'dark' || (u.theme === 'auto' && matchMedia('(prefers-color-scheme:dark)').matches);
  d.dataset.theme = dark ? 'dark' : 'light'; d.dataset.density = u.density; d.dataset.sidebar = u.sidebar;
  d.style.setProperty('--accent', u.accent); d.style.setProperty('--fs', u.fontScale); d.style.setProperty('--r', u.radius + 'px');
  d.style.setProperty('--font', { system: 'Tahoma,"Segoe UI",Arial,sans-serif', serif: '"Traditional Arabic","Times New Roman",serif', mono: 'Consolas,monospace' }[u.font] || 'Tahoma,sans-serif');
}

const ICONS = { costcenters:'◈', pricelevels:'⇧', dashboard:'â–¦', invoices:'â–¤', new:'ï¼‹', parties:'â™™', items:'â—‡', reports:'â–¥', settings:'âڑ™', pos:'â–£',purchases:'â‡£',vouchers:'â‡„',journals:'â‰،',stocktakes:'âœ“',shifts:'â—·',sync:'â†»',compliance:'â—ˆ',print:'â–§',quotes:'â–±',ledger:'âک·' };
const NAV = [['costcenters', 'مراكز التكلفة'], ['pricelevels', 'مستويات الأسعار'], ['dashboard', 'ظ†ط¸ط±ط© ط¹ط§ظ…ط©'], ['invoices', 'ط§ظ„ظ…ط¨ظٹط¹ط§طھ ظˆط§ظ„ظپظˆط§طھظٹط±'], ['quotes','ط¹ط±ظˆط¶ ط§ظ„ط£ط³ط¹ط§ط±'], ['new', 'ظپط§طھظˆط±ط© ط¬ط¯ظٹط¯ط©'], ['pos', 'ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹'], ['parties', 'ط§ظ„ط¹ظ…ظ„ط§ط، ظˆط§ظ„ظ…ظˆط±ط¯ظˆظ†'], ['items', 'ط§ظ„ط£طµظ†ط§ظپ ظˆط§ظ„ط®ط¯ظ…ط§طھ'], ['purchases','ط§ظ„ظ…ط´طھط±ظٹط§طھ'], ['vouchers','ط§ظ„ظ‚ط¨ط¶ ظˆط§ظ„طµط±ظپ'], ['journals','ط§ظ„ظ‚ظٹظˆط¯ المحاسبظٹط©'], ['ledger','ط¯ظپطھط± ط§ظ„ط£ط³طھط§ط° ظˆظƒط´ظپ ط§ظ„ط·ط±ظپ'], ['stocktakes','ط§ظ„ط¬ط±ط¯'], ['shifts','ط§ظ„ظˆط±ط¯ظٹط§طھ'], ['sync','ط±ط¨ط· ط§ظ„ط³ط­ط§ط¨ط©'], ['reports', 'ط§ظ„طھظ‚ط§ط±ظٹط± ط§ظ„ظ…ط§ظ„ظٹط©'], ['compliance','ط§ظ„ظپظˆطھط±ط© ظˆط§ظ„ظ‡ظٹط¦ط©'], ['print', 'ط¥ط¹ط¯ط§ط¯ط§طھ ط§ظ„ط·ط¨ط§ط¹ط©'], ['settings', 'ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ']];
const WORKSPACES = { trade: { name:'ط§ظ„طھط¬ط§ط±ظٹ ظˆط§ظ„ط®ط¯ظ…ط§طھ', subtitle:'ط£ط¹ظ…ط§ظ„ظƒ ط§ظ„ظٹظˆظ…ظٹط©طŒ ظپظٹ ظ…ظƒط§ظ† ظˆط§ط­ط¯', item:'طµظ†ظپ ط£ظˆ ط®ط¯ظ…ط©' }, events: { name:'ط§ظ„ط­ظپظ„ط§طھ ظˆط§ظ„ظ…ظ†ط§ط³ط¨ط§طھ', subtitle:'ظپظˆط§طھظٹط± طھط¬ظ‡ظٹط²ط§طھظƒ ظˆط®ط¯ظ…ط§طھ ظ…ظ†ط§ط³ط¨ط§طھظƒ', item:'طھط¬ظ‡ظٹط² ط£ظˆ ط®ط¯ظ…ط©' }, engineering: { name:'ط§ظ„ظ‡ظ†ط¯ط³ظٹ ظˆط§ظ„ظ…ظ‚ط§ظˆظ„ط§طھ', subtitle:'ظپظˆط§طھظٹط± ط§ظ„ط£ط¹ظ…ط§ظ„ ظˆط§ظ„ط®ط¯ظ…ط§طھ ط§ظ„ظ‡ظ†ط¯ط³ظٹط©', item:'ط¨ظ†ط¯ ط£ط¹ظ…ط§ظ„ ط£ظˆ ط®ط¯ظ…ط©' } };
const visibleWorkspace = key => key === 'trade'; // Temporary commercial-only rollout
const ACCOUNTANT_PAGES = new Set([
  'dashboard', 'invoices', 'quotes', 'new', 'parties', 'items', 'purchases',
  'vouchers', 'journals', 'ledger', 'stocktakes', 'shifts', 'reports', 'financial', 'costcenters', 'pricelevels'
]);
const OWNER_PAGES = new Set([...NAV.map(([key]) => key), 'financial']);
const canOpenLocalPage = (role, key) => {
  if (role === 'staff') return key === 'pos';
  if (role === 'accountant') return ACCOUNTANT_PAGES.has(key);
  return role === 'owner' && OWNER_PAGES.has(key);
};
let workspace = 'trade';
if (!WORKSPACES[workspace]) workspace = 'trade';
function shell(body) {
  const cur = location.hash.slice(1) || (S.state.user.role === 'staff' ? 'pos' : 'dashboard'), w = WORKSPACES[workspace];
  $('#app').innerHTML = '<div class="shell"><nav aria-label="ط§ظ„ظ‚ط§ط¦ظ…ط© ط§ظ„ط±ط¦ظٹط³ظٹط©"><a class="brand" href="#'+(S.state.user.role==='staff'?'pos':'dashboard')+'"><img class="brand-logo" src="/assets/almuhtariz-logo.png" alt="ط´ط¹ط§ط± ط§ظ„ظ…ط­طھط±ط²"><strong dir="rtl">المحترز للمحاسبة<small>وإدارة الأعمال</small></strong></a><div class="workspace-label">ظ…ط³ط§ط­ط© ط§ظ„ط¹ظ…ظ„</div><select id="workspace" aria-label="ط§ظ„ظ†ط´ط§ط·">' + Object.entries(WORKSPACES).filter(([key])=>visibleWorkspace(key)).map(([k,v])=>'<option value="'+k+'" '+(k===workspace?'selected':'')+'>'+v.name+'</option>').join('') + '</select><div class="nav-label">ط¥ط¯ط§ط±ط© ط§ظ„ط£ط¹ظ…ط§ظ„</div>'+NAV.filter(([k]) => canOpenLocalPage(S.state.user.role, k)).map(([k,t])=>'<a class="'+(cur===k?'on':'')+'" href="#'+k+'" '+(cur===k?'aria-current="page"':'')+'><span class="nav-icon" aria-hidden="true">'+ICONS[k]+'</span>'+t+'</a>').join('')+'<div class="nav-bottom"><div class="profile"><span class="avatar">'+esc(S.state.user.username.slice(0,1))+'</span><div><b>'+esc(S.state.user.username)+'</b><small>'+({owner:'ظ…ط§ظ„ظƒ ط§ظ„ظ…ظ†ط´ط£ط©',accountant:'ظ…ط­ط§ط³ط¨',staff:'ظ…ظˆط¸ظپ'}[S.state.user.role]||'')+'</small></div><button id="out" aria-label="طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬">â†ھ</button></div></div></nav><main><header class="topbar"><div><span class="eyebrow">'+esc(w.name)+'</span><span class="top-divider">/</span><span>'+esc(NAV.find(([k])=>k===cur)?.[1]||'ظ†ط¸ط±ط© ط¹ط§ظ…ط©')+'</span></div><div class="top-actions"><span class="today">'+fdate(S.state.today)+'</span><a class="button p" href="#new">ï¼‹ ظپط§طھظˆط±ط© ط¬ط¯ظٹط¯ط©</a></div></header><div class="content"><div id="msg" class="msg" role="status" hidden></div><div class="development-notice">ظ†ط³ط®ط© طھط·ظˆظٹط± آ· ط§ظ„ظ…ط³طھظ†ط¯ط§طھ طھط¬ط±ظٹط¨ظٹط© ظˆط؛ظٹط± طµط§ظ„ط­ط© ظ„ظ„ط§ط³طھط®ط¯ط§ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ</div>'+body+'</div><footer class="app-footer"><span dir="rtl">المحترز للمحاسبة</span><span>طھظپط§طµظٹظ„ ط£ظ‚ظ„. ظˆط¶ظˆط­ ط£ظƒط«ط±.</span></footer></main></div>';
  if(S.state.user.role==='staff'){$('#workspace').hidden=true;$('.workspace-label').hidden=true;$('.top-actions .button').href='#pos';$('.top-actions .button').textContent='ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹';}
  $('#workspace').onchange = e => { workspace=visibleWorkspace(e.target.value)?e.target.value:'trade';localStorage.setItem('smartz.workspace',workspace); route(); };
  $('#out').onclick = guard(async () => { await api('logout', { method: 'POST', body: {} }); await globalThis.AlmuhtarizStore?.clearScope(localScope()); location.reload(); });
}

// ---------- ط§ظ„دخول ظˆط§ظ„ط¥ط¹ط¯ط§ط¯ ----------

function openingScreen() {
 clearTimeout(S.openingTimer);
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 if(reduced){S.introComplete=true;sessionStorage.almuhtarizOpened='1';return route();}
 $('#app').innerHTML='<section class="brand-opening" aria-label="ط§ظپطھطھط§ط­ المحترز للمحاسبة"><div class="opening-grid" aria-hidden="true"></div><div class="opening-aura" aria-hidden="true"></div><button id="skip-opening" type="button">طھط¬ط§ظˆط² ط§ظ„ط§ظپطھطھط§ط­ظٹط© â†گ</button><div class="opening-identity"><div class="opening-emblem"><span class="opening-ring ring-first"></span><span class="opening-ring ring-second"></span><span class="opening-ring ring-third"></span><img src="/assets/almuhtariz-logo.png" alt="ط´ط¹ط§ط± ط§ظ„ظ…ط­طھط±ط²"></div><div class="opening-line"></div><h1>المحترز للمحاسبة</h1><p>وإدارة الأعمال</p><span class="opening-signature">ظƒظ„ ط§ظ„طھظپط§طµظٹظ„. ظپظٹ ظ…ظƒط§ظ†ظ‡ط§.</span></div></section>';
 let finished=false;const finish=()=>{if(finished)return;finished=true;clearTimeout(S.openingTimer);S.introComplete=true;sessionStorage.almuhtarizOpened='1';route();};
 $('#skip-opening').onclick=finish;S.openingTimer=setTimeout(finish,1800);
}

function activityScreen() {
 const portals={owner:{label:'دخول المالك',hint:'الإدارة والتقارير والإعدادات',icon:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.6'><path d='M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6l7-3z'/><path d='M9 12l2 2 4-4'/></svg>"},accountant:{label:'دخول المحاسب',hint:'المحاسبة والتقارير والقيود',icon:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.6'><rect x='4' y='3' width='16' height='18' rx='2'/><path d='M8 7h8M8 11h8M8 15h5'/></svg>"},staff:{label:'دخول موظف نقطة البيع',hint:'نقطة البيع والفواتير فقط',icon:"<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.6'><path d='M4 7h16v13H4zM7 7V4h10v3M8 12h8M8 16h5'/></svg>"}};
 const savedMotion=localStorage.getItem('almuhtariz.motion');
 const motion=savedMotion===null?!matchMedia('(prefers-reduced-motion: reduce)').matches:savedMotion==='on';
 const cube=(name)=>'<div class="entry-cube '+name+'"><div class="entry-cube-spin">'+['front','back','right','left','top','bottom'].map(face=>'<i class="cube-face cube-'+face+'"></i>').join('')+'</div></div>';
 $('#app').innerHTML='<section class="activity-start saas-entry" data-motion="'+(motion?'on':'off')+'"><div class="entry-ambient" aria-hidden="true"><div class="entry-glow glow-one"></div><div class="entry-glow glow-two"></div><div class="entry-grid"></div><div class="entry-orbit orbit-one"></div><div class="entry-orbit orbit-two"></div></div><div class="entry-shell"><header class="entry-header"><a class="entry-brand" href="#" aria-label="المحترز للمحاسبة"><img src="/assets/almuhtariz-logo.png" alt="ط´ط¹ط§ط± ط§ظ„ظ…ط­طھط±ط²"><span><b>المحترز للمحاسبة</b><small>وإدارة الأعمال</small></span></a><div class="entry-header-tools"><span class="entry-local"><i></i> ط¯ط§ط®ظ„ ط´ط¨ظƒط© ط§ظ„ظپط±ط¹</span><button id="entry-motion" type="button" aria-pressed="'+motion+'">'+(motion?'إيقاف الحركة ⏸':'تشغيل الحركة ▶')+'</button></div></header><div class="entry-hero"><div class="entry-copy"><div class="entry-eyebrow"><span></span> بوابة الدخول الرئيسية</div><h1>ط§ظ„ظ…ط­طھط±ط².<br><em>ظ„ظ„ظ…ط­ط§ط³ط¨ط© وإدارة الأعمال.</em></h1><p>اختر بوابة الدخول ط§ظ„ظ…ظ†ط§ط³ط¨ط© ظ„ط¯ظˆط±ظƒطŒ ط«ظ… ط£ط¯ط®ظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط­ط³ط§ط¨.<br>ظٹطھظ… ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط§ظ„ط¯ظˆط± ظپظٹ ط§ظ„ط®ط§ط¯ظ… ظ‚ط¨ظ„ ط¥ظ†ط´ط§ط، ط§ظ„ط¬ظ„ط³ط©.</p><div class="entry-feature-line"><span>ظˆط§ط¬ظ‡ط© ط¹ط±ط¨ظٹط©</span><i>آ·</i><span>ظ…ط§ظ„ظƒ ظˆظ…ط­ط§ط³ط¨ ظˆظ†ظ‚ط·ط© ط¨ظٹط¹</span><i>آ·</i><span>طھط´ط؛ظٹظ„ ظ…ط­ظ„ظٹ</span></div></div><div class="entry-visual" aria-hidden="true"><div class="entry-visual-halo"></div><div class="entry-scene"><div class="brand-core"><div class="brand-core-ring ring-a"></div><div class="brand-core-ring ring-b"></div><div class="brand-core-disc"><img src="/assets/almuhtariz-logo.png" alt=""></div><span class="brand-core-spark"></span></div><div class="entry-chart-panel"><div class="scene-panel-heading"><i></i><i></i><i></i><span></span></div><div class="scene-chart"><b style="--bar:.28"></b><b style="--bar:.48"></b><b style="--bar:.39"></b><b style="--bar:.65"></b><b style="--bar:.57"></b><b style="--bar:.83"></b><b style="--bar:1"></b></div><div class="scene-panel-lines"><span></span><span></span></div></div><div class="entry-receipt-panel"><span class="scene-check">âœ“</span><div><i></i><i></i><i></i></div><span class="scene-receipt-dot"></span></div><div class="entry-stack"><i></i><i></i><i></i></div>'+cube('cube-large')+cube('cube-small')+'<div class="entry-motion-orbit"><i></i></div><div class="entry-scene-ring"></div></div></div></div><div class="entry-choose-label"><span>اختر بوابة الدخول</span><span class="entry-choice-line"></span><small>قبل فتح نموذج الدخول</small></div><div class="activity-options portal-gate-options">'+Object.entries(portals).map(([key,card],i)=>'<button type="button" class="activity-option portal-gate-option" data-portal="'+key+'"><span class="entry-card-top"><span class="activity-symbol">'+card.icon+'</span><span class="entry-card-number">0'+(i+1)+'</span></span><span class="entry-card-body"><span class="activity-title">'+card.label+'</span><span class="activity-description">'+card.hint+'</span></span><span class="activity-enter">فتح نموذج الدخول <i>â†—</i></span></button>').join('')+'</div><footer class="entry-footer"><span>المحترز للمحاسبة <i>آ© 2026</i></span><span>ظٹطھظ… ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط§ظ„ط¯ظˆط± ظپظٹ ط§ظ„ط®ط§ط¯ظ… ظ‚ط¨ظ„ ط¥ظ†ط´ط§ط، ط§ظ„ط¬ظ„ط³ط©</span><span class="entry-footer-sign">طµظڈظ…ظ‘ظ… ظ„ظˆط¶ظˆط­ ط£ط¹ظ…ط§ظ„ظƒ <i>âœ¦</i></span></footer></div></section>';
 if(S.state.mode==='cloud'){$('.entry-local').textContent='ظ†ط³ط®ط© ط³ط­ط§ط¨ظٹط©';$('.entry-feature-line').lastElementChild.textContent='ط§طھطµط§ظ„ ط³ط­ط§ط¨ظٹ';}
 $$('[data-portal]').forEach(button=>button.onclick=()=>{const portal=button.dataset.portal;if(!portals[portal])return;workspace='trade';localStorage.setItem('smartz.workspace',workspace);localStorage.setItem('almuhtariz.portal',portal);S.selectedPortal=portal;S.activitySelected=true;route();});
 $('#entry-motion').onclick=()=>{const screen=$('.saas-entry'),button=$('#entry-motion'),enabled=screen.dataset.motion!=='on';screen.dataset.motion=enabled?'on':'off';localStorage.setItem('almuhtariz.motion',enabled?'on':'off');button.setAttribute('aria-pressed',String(enabled));button.textContent=enabled?'إيقاف الحركة ⏸':'تشغيل الحركة ▶';};
}

function authScreen() {
 const setup=S.state.setup_needed;
 const motion=localStorage.getItem('almuhtariz.motion')!=='off'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
 const portals={owner:{label:'المالك',hint:'الإدارة والتقارير والإعدادات',dest:'dashboard'},accountant:{label:'المحاسب',hint:'المحاسبط© ظˆط§ظ„طھظ‚ط§ط±ظٹط±',dest:'dashboard'},staff:{label:'موظف نقطة البيع',hint:'نقطة البيع فقط',dest:'pos'}};
 const saved=S.state.mode==='cloud'?'':(localStorage.getItem('almuhtariz.portal')||'owner');
 const selected=S.selectedPortal||saved;
 const portal=selected&&portals[selected]?selected:'owner';
 $('#app').innerHTML='<section class="auth-entry" data-motion="'+(motion?'on':'off')+'"><div class="auth-ambient" aria-hidden="true"></div><div class="auth-layout"><header class="auth-header"><a href="#" id="auth-home" class="entry-brand"><img src="/assets/almuhtariz-logo.png" alt="ط´ط¹ط§ط± ط§ظ„ظ…ط­طھط±ط²"><span><b>المحترز للمحاسبة</b><small>وإدارة الأعمال</small></span></a><button id="back-activities" type="button">تغيير البوابة ←</button></header><div class="auth-story"><span class="auth-eyebrow">'+esc(portals[portal].label)+'</span><h1>ط®ط·ظˆطھظƒ ط§ظ„ظ‚ط§ط¯ظ…ط©طŒ<br><em>ط£ظƒط«ط± ظˆط¶ظˆط­ظ‹ط§.</em></h1><p>ط­ط³ط§ط¨ط§طھظƒ ظˆط¹ظ…ظ„ط§ط¤ظƒ ظˆظپظˆط§طھظٹط±ظƒ.<br>ظƒظ„ ط§ظ„طھظپط§طµظٹظ„ ظپظٹ ظ…ط³ط§ط­ط© ط¹ظ…ظ„ظƒ.</p><div class="auth-emblem" aria-hidden="true"><span></span><img src="/assets/almuhtariz-logo.png" alt=""></div><div class="auth-local"><i></i> ظ…طھطµظ„ ط¨ط®ط§ط¯ظ… ط§ظ„ظپط±ط¹ ط§ظ„ظ…ط­ظ„ظٹ</div></div><section class="auth-panel"><div class="auth-panel-heading"><span class="eyebrow">'+(setup?'ظ„ظ†ط¨ط¯ط£ ظ…ط¹ظ‹ط§':'ط¨ظˆط§ط¨ط© '+esc(portals[portal].label))+'</span><h2>'+(setup?'أنشئ مساحة أعمالك':'سجّل دخولك')+'</h2><p>'+(setup?'ط¨ظٹط§ظ†ط§طھ ط¨ط³ظٹط·ط© ظ„طھط¬ظ‡ظٹط² ظ…ظ†ط´ط£طھظƒ ظˆط­ط³ط§ط¨ المالك.':'ط£ط¯ط®ظ„ ط¨ظٹط§ظ†ط§طھ ط­ط³ط§ط¨ '+esc(portals[portal].label)+'. ظٹطھظ… ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط§ظ„ط¯ظˆط± ظپظٹ ط§ظ„ط®ط§ط¯ظ… ظ‚ط¨ظ„ ط¥ظ†ط´ط§ط، ط§ظ„ط¬ظ„ط³ط©.')+'</p></div><div id="msg" class="msg" role="status" hidden></div><form id="login-form"><input type="hidden" name="portal" value="'+esc(portal)+'">'+(setup?'<label for="co">ط§ط³ظ… ط§ظ„ظ…ظ†ط´ط£ط©<input id="co" name="company" autocomplete="organization" placeholder="ط§ط³ظ… ظ…ظ†ط´ط£طھظƒ" required></label>':'')+'<label for="u">ط§ط³ظ… ط§ظ„ظ…ط³طھط®ط¯ظ…<input id="u" name="username" autocomplete="username" placeholder="ط£ط¯ط®ظ„ ط§ط³ظ… ط§ظ„ظ…ط³طھط®ط¯ظ…" required></label><label for="p">ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±</label><div class="password-field"><input id="p" name="password" type="password" autocomplete="'+(setup?'new-password':'current-password')+'" placeholder="'+(setup?'8 ط£ط­ط±ظپ ط¹ظ„ظ‰ ط§ظ„ط£ظ‚ظ„':'ط£ط¯ط®ظ„ ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±')+'" '+(setup?'minlength="8"':'')+' required><button id="toggle-password" type="button" aria-pressed="false" aria-label="ط¥ط¸ظ‡ط§ط± ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±">ط¥ط¸ظ‡ط§ط±</button></div><button class="auth-submit" type="submit" id="go">'+(setup?'ط¥ظ†ط´ط§ط، ظˆط¨ط¯ط، ط§ظ„ط¹ظ…ظ„':'دخول '+esc(portals[portal].label))+' <span>â†گ</span></button><p class="auth-form-note">'+(setup?'ط³ظٹظƒظˆظ† ظ‡ط°ط§ ط§ظ„ط­ط³ط§ط¨ ظ…ط§ظ„ظƒ ط§ظ„ظ…ظ†ط´ط£ط©. ظٹظ…ظƒظ†ظƒ ط¥ط¶ط§ظپط© ظپط±ظٹظ‚ظƒ ظ„ط§ط­ظ‚ظ‹ط§.':'ط¥ط°ط§ ظƒط§ظ† ط§ظ„ط­ط³ط§ط¨ ظ„ط§ ظٹط·ط§ط¨ظ‚ ظ‡ط°ظ‡ ط§ظ„ط¨ظˆط§ط¨ط©طŒ ط³ظٹط±ظپط¶ ط§ظ„ط®ط§ط¯ظ… طھط³ط¬ظٹظ„ ط§ظ„دخول ظ‚ط¨ظ„ ط¥ظ†ط´ط§ط، ط§ظ„ط¬ظ„ط³ط©.')+'</p></form><div class="auth-panel-footer"><span>'+esc(portals[portal].label)+'</span><span>المحترز للمحاسبة</span></div></section><footer class="auth-footer">ط£ط¹ظ…ط§ظ„ ظ…طھط¹ط¯ط¯ط©. ظ‡ظˆظٹط© ظˆط§ط­ط¯ط©.</footer></div></section>';
 if(S.state.mode==='cloud'){
   $('#u').type='email';$('#u').placeholder='ط§ظ„ط¨ط±ظٹط¯ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ ظ„ط­ط³ط§ط¨ ط§ظ„طھط·ط¨ظٹظ‚';
   $('label[for="u"]').firstChild.textContent='ط§ظ„ط¨ط±ظٹط¯ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ';
   $('.auth-local').textContent='ط§ظ„دخول ط§ظ„ط³ط­ط§ط¨ظٹ ط¹ط¨ط± Supabase';
   $('.auth-form-note').textContent='ظٹطھظ… ط§ظ„طھط­ظ‚ظ‚ ظ…ظ† ط¹ط¶ظˆظٹطھظƒ ظˆط¯ظˆط±ظƒ ظپظٹ ط§ظ„ط®ط§ط¯ظ… ظ‚ط¨ظ„ ط¥ظ†ط´ط§ط، ط§ظ„ط¬ظ„ط³ط©. ط§ط®طھظٹط§ط± ط¨ظˆط§ط¨ط© ط؛ظٹط± ظ…ط·ط§ط¨ظ‚ط© ظٹط±ظپط¶ ط§ظ„دخول.';
 }
 const back=e=>{e.preventDefault();S.activitySelected=false;S.selectedPortal=null;activityScreen();};$('#back-activities').onclick=back;$('#auth-home').onclick=back;
 $('#toggle-password').onclick=()=>{const input=$('#p'),button=$('#toggle-password'),show=input.type==='password';input.type=show?'text':'password';button.textContent=show?'ط¥ط®ظپط§ط،':'ط¥ط¸ظ‡ط§ط±';button.setAttribute('aria-pressed',String(show));button.setAttribute('aria-label',show?'ط¥ط®ظپط§ط، ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±':'ط¥ط¸ظ‡ط§ط± ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±');};
 $('#login-form').onsubmit=guard(async e=>{e.preventDefault();const button=$('#go'),label=button.innerHTML;button.disabled=true;button.textContent='ط¬ط§ط±ظچ طھط¬ظ‡ظٹط² ظ…ط³ط§ط­ط© ط¹ظ…ظ„ظƒâ€¦';try{const selectedPortal=$('input[name="portal"]')?.value||portal;const body={username:$('#u').value.trim(),password:$('#p').value};if(setup)await api('setup',{method:'POST',body:{...body,company_name:$('#co').value.trim(),activity:workspace}});else body.portal=selectedPortal;const login=await api('login',{method:'POST',body});sessionStorage.skipActivityOnce='1';if(!setup)localStorage.setItem('almuhtariz.portal',selectedPortal);S.selectedPortal=null;location.hash='#'+(login.destination||(login.role==='staff'?'pos':'dashboard'));location.reload();}finally{button.disabled=false;button.innerHTML=label;}});
}

// ---------- ط§ظ„طµظپط­ط§طھ ----------
const pages = {
  async quotes(){return(await import('./quotations.js')).renderQuotations({api,shell,esc,money});},
  async purchases(){return (await import('./commercial.js')).renderCommercial('purchases',{api,shell,esc,money,S});},
  async vouchers(){return (await import('./commercial.js')).renderCommercial('vouchers',{api,shell,esc,money,S});},
  async ledger(){return(await import('./ledger-page.js')).renderLedger({api,shell,esc,money,S});},
  async journals(){return (await import('./commercial.js')).renderCommercial('journals',{api,shell,esc,money,S});},
  async financial(){return (await import('./financial-reports.js')).renderFinancial({api,shell,esc,money,S});},
  async costcenters(){return (await import('./cost-centers.js')).renderCostCenters({api,shell,esc,money,S});},
  async pricelevels(){return (await import('./price-levels.js')).renderPriceLevels({api,shell,esc,money,S});},
  async shifts(){return (await import('./operations.js')).renderOperations('shifts',{api,shell,esc,money,S});},
  async stocktakes(){return (await import('./operations.js')).renderOperations('stocktakes',{api,shell,esc,money,S});},
  async sync(){return (await import('./sync-settings.js')).renderSync({api,shell,esc});},
  async dashboard() {
    const [d, invoicePage] = await Promise.all([api('dashboard'),api('lists/invoices?page_size=5')]), L=S.state.license, w=WORKSPACES[workspace];
    const drafts={length:d.drafts}, recent=invoicePage.rows;
    shell('<div class="page-heading"><div><span class="eyebrow">ظ†ط¸ط±ط© ط¹ط§ظ…ط©</span><h1>ظƒظ„ ط´ظٹط، ط£ظˆط¶ط­طŒ ظƒظ„ ظٹظˆظ….</h1><p>'+w.subtitle+'</p></div><a class="text-link" href="#reports">ط¹ط±ط¶ ط§ظ„طھظ‚ط§ط±ظٹط± â†گ</a></div>'+
    (L.readOnly?'<div class="msg">ط§ظ„طھط±ط®ظٹطµ ظ„ظ„ظ‚ط±ط§ط،ط© ظپظ‚ط·. ظٹظ…ظƒظ†ظƒ ط¹ط±ط¶ ط¨ظٹط§ظ†ط§طھظƒ ظˆطھطµط¯ظٹط±ظ‡ط§ ظ…ظ† ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ.</div>':'')+
    '<div class="grid metrics"><div class="card kpi"><div class="metric-label">ظ…ط¨ظٹط¹ط§طھ ط§ظ„ط´ظ‡ط± <span class="metric-icon">â†—</span></div><b class="num">'+money(d.sales)+' <small>ط±.ط³</small></b><span>ظ‚ط¨ظ„ ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط©</span></div><div class="card kpi"><div class="metric-label">ط¶ط±ظٹط¨ط© ط§ظ„ظ…ط¨ظٹط¹ط§طھ <span class="metric-icon">ظھ</span></div><b class="num">'+money(d.vat)+' <small>ط±.ط³</small></b><span>طµط§ظپظٹ ط§ظ„ط´ظ‡ط± ط¨ط¹ط¯ ط§ظ„ط¥ط´ط¹ط§ط±ط§طھ</span></div><div class="card kpi"><div class="metric-label">ظ…ط³طھظ†ط¯ط§طھ ط§ظ„ط´ظ‡ط± <span class="metric-icon">â–¤</span></div><b>'+d.invoices+'</b><span>ط§ظ„ظپظˆط§طھظٹط± ظˆط§ظ„ط¥ط´ط¹ط§ط±ط§طھ ط§ظ„طµط§ط¯ط±ط©</span></div></div>'+
    '<div class="dashboard-layout"><section class="card recent-card"><div class="section-heading"><div><h3>ط¢ط®ط± ط§ظ„ط¹ظ…ظ„ظٹط§طھ</h3><p>ظ…ط³طھظ†ط¯ط§طھظƒ ط§ظ„ط£ط®ظٹط±ط© ظˆط­ط§ظ„ط© ظƒظ„ ظ…ط³طھظ†ط¯</p></div><a href="#invoices">ط¹ط±ط¶ ط§ظ„ظƒظ„ â†گ</a></div>'+ (recent.length?'<div class="table-scroll"><table><thead><tr><th>ط§ظ„ظ…ط³طھظ†ط¯</th><th>ط§ظ„ط¹ظ…ظٹظ„</th><th>ط§ظ„ط­ط§ظ„ط©</th><th>ط§ظ„ظ‚ظٹظ…ط©</th></tr></thead><tbody>'+recent.map(i=>'<tr><td><a href="/api/invoices/'+i.id+'/html" target="_blank" rel="noopener">'+esc(i.number||'ظ…ط³ظˆط¯ط© #'+i.id)+'</a><small class="cell-sub">'+(i.type==='381'?'ط¥ط´ط¹ط§ط± ط¯ط§ط¦ظ†':'ظپط§طھظˆط±ط© ظ…ط¨ظٹط¹ط§طھ')+'</small></td><td>'+esc(i.party||'ط¹ظ…ظٹظ„ ظ†ظ‚ط¯ظٹ')+'</td><td><span class="status '+(i.status==='issued'?'issued':'draft')+'">'+(i.status==='issued'?'طµط§ط¯ط±ط©':'ظ…ط³ظˆط¯ط©')+'</span></td><td class="num">'+money(i.total)+'</td></tr>').join('')+'</tbody></table></div>':'<div class="empty-state"><span class="empty-icon">â–¤</span><h3>ط£ظˆظ„ ظپط§طھظˆط±ط©طŒ ط¨ط¯ط§ظٹط© ط£ظˆط¶ط­</h3><p>ط£ط¶ظپ ط¨ظ†ظˆط¯ظƒ ظˆط±ط§ط¬ط¹ ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ ط«ظ… ط£طµط¯ط± ظپط§طھظˆط±طھظƒ.</p><a class="button p" href="#new">ط¥ظ†ط´ط§ط، ط£ظˆظ„ ظپط§طھظˆط±ط©</a></div>')+'</section><aside><section class="card quick-card"><span class="eyebrow">ط®ط·ظˆطھظƒ ط§ظ„طھط§ظ„ظٹط©</span><h3>ط£ظ†ط¬ط²ظ‡ط§ ط¨ط¨ط³ط§ط·ط©</h3><a class="quick-action" href="#new"><span>ï¼‹</span><div><b>ط¥ظ†ط´ط§ط، ظپط§طھظˆط±ط©</b><small>ط¨ظٹط¹ ظ†ظ‚ط¯ظٹ ط£ظˆ ط¨ظ†ظƒظٹ ط£ظˆ ط¢ط¬ظ„</small></div><i>â†گ</i></a><a class="quick-action" href="#parties"><span>â™™</span><div><b>ط¥ط¶ط§ظپط© ط¹ظ…ظٹظ„</b><small>ط§ط­طھظپط¸ ط¨ط¨ظٹط§ظ†ط§طھظ‡ ظ„ظ„ظپظˆط§طھظٹط± ط§ظ„ظ‚ط§ط¯ظ…ط©</small></div><i>â†گ</i></a><a class="quick-action" href="#items"><span>â—‡</span><div><b>ط¥ط¶ط§ظپط© '+w.item+'</b><small>ط§ط®طھظٹط§ط± ط£ط³ط±ط¹ ط¹ظ†ط¯ ط¥ظ†ط´ط§ط، ط§ظ„ظپط§طھظˆط±ط©</small></div><i>â†گ</i></a></section><section class="card attention"><span class="eyebrow">ظ…طھط§ط¨ط¹ط© ط§ظ„ط¹ظ…ظ„</span><h3>'+(drafts.length?drafts.length+' ظ…ط³ظˆط¯ط© ظ„ظ„ظ…ط±ط§ط¬ط¹ط©':'ط¬ط§ظ‡ط² ظ„ط®ط·ظˆطھظƒ ط§ظ„ظ‚ط§ط¯ظ…ط©')+'</h3><p>'+(drafts.length?'ط±ط§ط¬ط¹ ط§ظ„ظ…ط³ظˆط¯ط§طھ ظ‚ط¨ظ„ ط¥طµط¯ط§ط±ظ‡ط§.':'ط§ط¨ط¯ط£ ط¨ط¥ط¶ط§ظپط© ط§ظ„ط¹ظ…ظ„ط§ط، ظˆط§ظ„ط£طµظ†ط§ظپ ظ„طھط³ط±ظٹط¹ ط¹ظ…ظ„ظƒ ط§ظ„ظٹظˆظ…ظٹ.')+'</p><a href="#'+(drafts.length?'invoices':'items')+'">'+(drafts.length?'ظ…ط±ط§ط¬ط¹ط© ط§ظ„ظپظˆط§طھظٹط±':'ط¥ط¯ط§ط±ط© ط§ظ„ط£طµظ†ط§ظپ ظˆط§ظ„ط®ط¯ظ…ط§طھ')+' â†گ</a></section></aside></div>'+
    '<div class="local-status"><span class="status issued">ظٹط¹ظ…ظ„ ط¹ظ„ظ‰ ط®ط§ط¯ظ… ط§ظ„ظپط±ط¹</span><span>ط§ظ„ظ…ط²ط§ظ…ظ†ط© ط§ظ„ط³ط­ط§ط¨ظٹط© ط؛ظٹط± ظ…ظ‡ظٹط£ط© آ· '+(S.state.sync?.pending || 0)+' ط¹ظ…ظ„ظٹط© ط¥طµط¯ط§ط± ظ…ط­ظپظˆط¸ط© ظپظٹ ظ‚ط§ط¦ظ…ط© ط§ظ„ط¥ط±ط³ط§ظ„</span></div><div class="workspace-note">ط§ظ„ظ…ط®ط²ظˆظ† ط§ظ„طھط¬ط§ط±ظٹ ظˆط§ظ„ظ…ط´طھط±ظٹط§طھ ظˆط§ظ„ط¬ط±ط¯ ظ…طھط§ط­ط© ظپظٹ ظ‚ظˆط§ط¦ظ…ظ‡ط§.</div>');
  },
  async invoices() {
    const result=await api('lists/invoices'),rows=result.rows;const {pagedView}=await import('./paged-view.js');
    const invoiceHtml=rows=>rows.map(r => `<tr data-invoice data-status="${r.status}" data-type="${r.type}" data-search="${esc((r.number || 'ظ…ط³ظˆط¯ط©') + ' ' + (r.party || ''))}"><td>${esc(r.number || 'ظ…ط³ظˆط¯ط©')}</td><td>${r.document_code==='383'?'ط¥ط´ط¹ط§ط± ظ…ط¯ظٹظ†':r.type==='381'?'ط¥ط´ط¹ط§ط± ط¯ط§ط¦ظ†':r.invoice_kind==='standard'?'ظپط§طھظˆط±ط© ط¶ط±ظٹط¨ظٹط©':'ظپط§طھظˆط±ط© ظ…ط¨ط³ط·ط©'}</td><td>${fdate(r.issue_date)}</td><td>${fdate(r.due_date)}</td><td>${esc(r.party || '')}</td>
    <td class="num">${money(r.total)}</td><td><a href="/api/invoices/${r.id}/html" target="_blank">ط·ط¨ط§ط¹ط©</a>
    ${r.type === '388' && r.document_code!=='383' && r.status === 'issued' && S.state.user.role !== 'staff' ? ` آ· <a href="#" data-cn="${r.id}">ط¥ط´ط¹ط§ط± ط¯ط§ط¦ظ†</a> آ· <a href="#" data-dn="${r.id}">ط¥ط´ط¹ط§ط± ظ…ط¯ظٹظ†</a>` : ''}${r.status === 'draft' ? ` آ· <a href="#" data-is="${r.id}">ط¥طµط¯ط§ط±</a>` : ''}</td></tr>`).join('') || '<tr><td colspan=7>ظ„ط§ طھظˆط¬ط¯ ظپظˆط§طھظٹط±</td></tr>';
    shell(`<div class="page-heading"><div><span class="eyebrow">ط§ظ„ظ…ط¨ظٹط¹ط§طھ</span><h1>ط§ظ„ظپظˆط§طھظٹط±</h1><p>ط§ط¨ط­ط« ط¹ظ† ظ…ط³طھظ†ط¯ط§طھظƒ ظˆط±ط§ط¬ط¹ ط­ط§ظ„طھظ‡ط§ ظپظٹ ظ…ظƒط§ظ† ظˆط§ط­ط¯</p></div></div><div class="toolbar"><input id="invoice-search" type="search" aria-label="ط§ظ„ط¨ط­ط« ظپظٹ ط§ظ„ظپظˆط§طھظٹط±" placeholder="ط§ط¨ط­ط« ط¨ط±ظ‚ظ… ط§ظ„ظپط§طھظˆط±ط© ط£ظˆ ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„"><select id="invoice-status" aria-label="ط­ط§ظ„ط© ط§ظ„ظپط§طھظˆط±ط©"><option value="all">ط¬ظ…ظٹط¹ ط§ظ„ط­ط§ظ„ط§طھ</option><option value="issued">طµط§ط¯ط±ط©</option><option value="draft">ظ…ط³ظˆط¯ط§طھ</option><option value="credit">ط¥ط´ط¹ط§ط±ط§طھ ط¯ط§ط¦ظ†ط©</option></select></div><div class="card"><table><thead><tr><th>ط§ظ„ط±ظ‚ظ…</th><th>ط§ظ„ظ†ظˆط¹</th><th>ط§ظ„طھط§ط±ظٹط®</th><th>ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚</th><th>ط§ظ„ط¹ظ…ظٹظ„</th><th>ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ</th><th></th></tr></thead><tbody id="invoice-list">
    ${invoiceHtml(rows)}</tbody></table></div>`);
    const bindInvoices=()=>{
    $$('[data-is]').forEach(a => a.onclick = guard(async e => { e.preventDefault(); const invoice = await api(`invoices/${a.dataset.is}`); if (!(await reviewInvoice('ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ ' + money(invoice.total / 100) + ' ط±.ط³', invoice.lines.length))) return; await api(`invoices/${a.dataset.is}/issue`, { method: 'POST', body: {} }); pages.invoices(); }));
    $$('[data-dn]').forEach(a=>a.onclick=guard(async e=>{e.preventDefault();debitDialog(a.dataset.dn);}));
    $$('[data-cn]').forEach(a => a.onclick = guard(async e => { e.preventDefault(); creditDialog(a.dataset.cn); }));
    };
    await pagedView({api,path:'lists/invoices',body:$('#invoice-list'),renderRows:invoiceHtml,initial:result,searchInput:$('#invoice-search'),filters:[{input:$('#invoice-status'),key:'status'}],bindRows:bindInvoices});
  },
  async new() {
    const isCashier=S.state.user.role==='staff',isPos=location.hash.slice(1)==='pos'||isCashier;
    const [parties,points,pricing]=await Promise.all([api(isPos?'pos/customers':'parties'),api(isPos?'pos/points':'pos'),isPos?api('pos/pricing'):null]);
    S.parties=parties;S.pos=points;
    S.items=[];
    if(!isPos)S.parties=S.parties.filter(p=>['customer','both'].includes(p.kind));
    shell(`<h1>ظپط§طھظˆط±ط© ط¬ط¯ظٹط¯ط©</h1><div class="card"><div class="row"><label>ط§ظ„ط¹ظ…ظٹظ„<select id="party"><option value="">â€” ط¨ط¯ظˆظ† â€”</option>${S.parties.map(p => `<option value="${p.id}">${esc(p.name_ar)}</option>`).join('')}</select></label>
    <label>ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹<select id="pos">${S.pos.filter(p => p.active).map(p => `<option value="${p.id}">${esc(p.name)} (${esc(p.prefix)})</option>`).join('')}</select></label>
    <label>ظ†ظˆط¹ ط§ظ„ظپط§طھظˆط±ط©<select id="invoice-kind"><option value="">ط­ط³ط¨ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط¹ظ…ظٹظ„</option><option value="standard">ظپط§طھظˆط±ط© ط¶ط±ظٹط¨ظٹط©</option><option value="simplified">ظپط§طھظˆط±ط© ط¶ط±ظٹط¨ظٹط© ظ…ط¨ط³ط·ط©</option></select></label><label>طھط§ط±ظٹط® ط§ظ„طھظˆط±ظٹط¯<input id="supply-date" type="date" value="${S.state.today}"></label><label>ظ…ط¯ط© ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚ (ط£ظٹط§ظ…)<input id="payment-terms-days" type="number" min="0" max="3650" step="1" value="0"></label><label>طھط§ط±ظٹط® ط§ظ„ط§ط³طھط­ظ‚ط§ظ‚<input id="due-date" type="date"></label><label>ط§ظ„ط¯ظپط¹<select id="pay"><option value="cash">ظ†ظ‚ط¯ظ‹ط§</option><option value="bank">ط¨ظ†ظƒ</option><option value="credit">ط¢ط¬ظ„</option></select></label></div>
    ${(pricing?.wholesale||(pricing?.allowed_price_levels&&pricing.allowed_price_levels.length))?'<label>ظ…ط³طھظˆظ‰ ط³ط¹ط± ط§ظ„ط³ظ„ط©<select id="pos-price-level"><option value="retail">طھط¬ط²ط¦ط©</option><option value="wholesale">ط¬ظ…ظ„ط©</option></select></label><p class="hint">طھظڈط­ط³ط¨ ط§ظ„ظˆط­ط¯ط© ط¨ط³ط¹ط± ط§ظ„طھط¬ط²ط¦ط© ط¹ظ†ط¯ طھط±ظƒ ط³ط¹ط± ط§ظ„ط¬ظ…ظ„ط© ظپط§ط±ط؛ظ‹ط§.</p>':''}
    <table id="ln"><thead><tr><th>ط§ظ„ظˆطµظپ</th><th>ط§ظ„ظƒظ…ظٹط©</th><th>ط§ظ„ط³ط¹ط±</th><th>ط¶ط±ظٹط¨ط© %</th><th>ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ</th><th></th></tr></thead><tbody></tbody></table>
    <p class="hint">ط²ط± آ«ط§ط®طھظٹط§ط± طµظ†ظپآ» ظٹط±ط¨ط· ط§ظ„ط¨ظ†ط¯ ط¨ط§ظ„ظ…ط®ط²ظˆظ† ظˆط§ظ„ظˆط­ط¯ط©. ط§ظ„ظˆطµظپ ط§ظ„ظ…ظƒطھظˆط¨ ط¯ظˆظ† ط§ط®طھظٹط§ط± طµظ†ظپ ط¨ظ†ط¯ ط­ط± ط؛ظٹط± ظ…ط®ط²ظ†ظٹ.</p><datalist id="dl">${S.items.map(i => `<option value="${esc(i.name_ar)}">`).join('')}</datalist>
    <div class="row" style="margin-top:10px"><button id="add">+ ط¨ظ†ط¯</button><div class="num" id="tt" style="flex:2;text-align:end;font-weight:700"></div></div>
    <div class="row" style="margin-top:12px"><button class="p" id="issue">ط¥طµط¯ط§ط± ط§ظ„ظپط§طھظˆط±ط©</button><button id="draft">ط­ظپط¸ ظƒظ…ط³ظˆط¯ط©</button></div></div>`);
    const tb = $('#ln tbody');
    if(isPos){const sel=$('#pos-price-level');if(sel){const levels=await api('price-levels');const allowed=pricing?.allowed_price_levels||[];sel.innerHTML=levels.filter(l=>l.active&&(l.is_builtin||allowed.includes(l.code))).map(l=>`<option value="${l.code}">${esc(l.name_ar)}</option>`).join('');}}
    const addRow = () => { const tr = document.createElement('tr');
      tr.innerHTML = `<td><input list="dl" class="d" style="width:100%"><button type="button" data-sale-tracking hidden>ط¯ظپط¹ط§طھ ط£ظˆ طھط³ظ„ط³ظ„ط§طھ</button></td><td><input class="q" type="number" value="1" min="0" step="any" style="width:80px"></td><td><input class="u" type="number" value="0" min="0" step="any" style="width:100px"></td><td><input class="v" type="number" value="15" style="width:70px"><select class="tc" aria-label="ط§ظ„ظپط¦ط© ط§ظ„ط¶ط±ظٹط¨ظٹط©"><option value="S">ط£ط³ط§ط³ظٹط©</option><option value="Z">طµظپط±ظٹط©</option><option value="E">ظ…ط¹ظپط§ط©</option><option value="O">ط®ط§ط±ط¬ ط§ظ„ظ†ط·ط§ظ‚</option></select><input class="ec" placeholder="VATEX-SA-â€¦" aria-label="ط±ظ…ط² ط§ظ„ط¥ط¹ظپط§ط،" hidden><input class="er" placeholder="ط³ط¨ط¨ ط§ظ„ط¥ط¹ظپط§ط،" aria-label="ط³ط¨ط¨ ط§ظ„ط¥ط¹ظپط§ط،" hidden></td><td class="num t">0.00</td><td><button class="d">أ—</button></td>`;
      $('[data-sale-tracking]',tr).onclick=guard(async()=>{const item=tr.trackingItem;if(!item)return;const factor=item.unit_factor_micro||item.units?.find(u=>u.id===item.item_unit_id)?.factor_micro||1000000;const {editTracking}=await import('./tracking-editor.js');const result=await editTracking({api,esc,mode:item.tracking_mode,itemId:item.id,posId:Number($('#pos').value),forSale:true,expectedQty:Number($('.q',tr).value)*factor/1000000,initial:JSON.parse(tr.dataset.tracking||'[]')});if(result!==null){tr.dataset.tracking=JSON.stringify(result);setTrackingItem(tr,item);$('.q',tr).dispatchEvent(new Event('input',{bubbles:true}));}});
      tr.oninput = e => { if (e.target.classList.contains('d')) { const it = S.items.find(i => i.name_ar === e.target.value); tr.dataset.itemId=it?String(it.id):'';tr.dataset.itemUnitId=it?.item_unit_id?String(it.item_unit_id):'';setTrackingItem(tr,it);if (it) { $('.u', tr).value = it.unit_price; $('.v', tr).value = it.vat_rate;$('.tc',tr).value=it.tax_category||'S';$('.ec',tr).value=it.exemption_code||'';$('.er',tr).value=it.exemption_reason||''; } }if(e.target.classList.contains('tc'))$('.v',tr).value=$('.tc',tr).value==='S'?15:0;$('.ec',tr).hidden=$('.tc',tr).value==='S';$('.er',tr).hidden=$('.tc',tr).value==='S';calc(); };
      if(!isPos){const pick=document.createElement('button');pick.type='button';pick.textContent='ط§ط®طھظٹط§ط± طµظ†ظپ';$('.d',tr).after(pick);pick.onclick=guard(async()=>{const {chooseItem}=await import('./choose-item.js'),item=await chooseItem({api,esc,units:true});if(!item)return;S.items=S.items.filter(i=>i.id!==item.id||i.item_unit_id!==item.item_unit_id);S.items.push(item);$('.d',tr).value=item.name_ar;tr.dataset.itemId=item.id;tr.dataset.itemUnitId=item.item_unit_id||'';setTrackingItem(tr,item);$('.u',tr).value=item.unit_price;$('.v',tr).value=item.vat_rate;$('.tc',tr).value=item.tax_category||'S';$('.ec',tr).value=item.exemption_code||'';$('.er',tr).value=item.exemption_reason||'';$('.ec',tr).hidden=$('.tc',tr).value==='S';$('.er',tr).hidden=$('.tc',tr).value==='S';calc();});$('.u',tr).parentElement.insertAdjacentHTML('beforeend','<label class="line-discount">ط®طµظ… %<input class="disc" type="number" value="0" min="0" max="100" step="0.01" aria-label="ظ†ط³ط¨ط© ط®طµظ… ط§ظ„ظˆط­ط¯ط©"></label>');}
      if(isPos){
        for(const selector of ['.d','.u','.v','.ec','.er'])$(selector,tr).readOnly=true;
        $('.tc',tr).disabled=true;
        const priceCell=$('.u',tr).parentElement;
        const canManual=pricing.manual_price && tr.trackingItem?.item_kind==='service';
        if(canManual)priceCell.insertAdjacentHTML('beforeend','<label class="line-discount">ط³ط¹ط± ظٹط¯ظˆظٹ ظ„ظ„ط®ط¯ظ…ط©<input class="pos-override" type="number" min="0" step="0.01" max="'+pricing.manual_price_cap+'"></label>');
        if(pricing.discount_limit>0)priceCell.insertAdjacentHTML('beforeend',`<label class="line-discount">ط®طµظ… %<input class="disc" type="number" value="0" min="0" max="${pricing.discount_limit}" step="0.01"></label>`);
        if($('.pos-override',tr))$('.pos-override',tr).oninput=()=>updatePosPrice(tr);
      }
      $('button.d', tr).onclick = () => { tr.remove(); calc(); }; tb.append(tr); };
    const rows = () => $$('tr', tb).map(tr => ({ item_id:Number(tr.dataset.itemId)||null,item_unit_id:Number(tr.dataset.itemUnitId)||null, tracking:JSON.parse(tr.dataset.tracking||'[]'), description: $('.d', tr).value, qty: +$('.q', tr).value, unit_price: +$('.u', tr).value,discount_rate:Number($('.disc',tr)?.value||0), vat_rate:+$('.v',tr).value,tax_category:$('.tc',tr).value,exemption_code:$('.ec',tr).value,exemption_reason:$('.er',tr).value }));
    const calc=()=>{const lines=rows(),groups=new Map();let sub=0;$$('tr',tb).forEach((tr,index)=>{const line=lines[index],rate=Math.round(line.discount_rate*100),list=Math.round(line.unit_price*100),unit=list>=0&&Number.isSafeInteger(list)&&rate>=0&&rate<=10000?Number((BigInt(list)*BigInt(10000-rate)+5000n)/10000n):0,net=Math.round(line.qty*unit),vat=Math.round(net*line.vat_rate/100);sub+=net;const key=[line.tax_category,line.vat_rate,line.exemption_code].join('|');if(!groups.has(key))groups.set(key,{base:0,rate:line.vat_rate});groups.get(key).base+=net;$('.t',tr).textContent=money((net+vat)/100);});const vat=[...groups.values()].reduce((s,g)=>s+Math.round(g.base*g.rate/100),0);$('#tt').textContent='ط¨ط¹ط¯ ط®طµظ… ط§ظ„ظˆط­ط¯ط©: ظ‚ط¨ظ„ ط§ظ„ط¶ط±ظٹط¨ط© '+money(sub/100)+' + ط¶ط±ظٹط¨ط© '+money(vat/100)+' = '+money((sub+vat)/100);};
    $('#add').onclick = () => { addRow(); calc(); }; addRow(); calc();
    $('#pos-price-level')?.addEventListener('change',()=>{
      $$('tr',tb).forEach(updatePosPrice);
      calc();
    });
    const save = draft => guard(async () => {
      if (isPos && Number($('#barcode-form')?.dataset.pending)) throw Error('ط§ظ†طھط¸ط± ط§ظƒطھظ…ط§ظ„ ظ‚ط±ط§ط،ط© ط§ظ„ط¨ط§ط±ظƒظˆط¯');
      if ($$('tr', tb).some(row => row.trackingItem?.unavailable)) throw Error('ط£ط²ظ„ ط§ظ„ط¨ظ†ظˆط¯ ط؛ظٹط± ط§ظ„ظ…طھط§ط­ط© ظ…ظ† ط§ظ„ط³ظ„ط© ظ‚ط¨ظ„ ط§ظ„ط¥طµط¯ط§ط±');
      if(isPos&&$$('.disc,.pos-override',tb).some(input=>!input.reportValidity()))return;
      const lines = rows();
      if(isPos)$$('tr',tb).forEach((row,index)=>{
        lines[index].pos_discount=$('.disc',row)?.value||'0';
        lines[index].override_price=$('.pos-override',row)?.value||null;
        lines[index].scale_code=row.trackingItem?.scale_code;
        lines[index].scale_mode=row.trackingItem?.scale_mode;
      });
      if (!lines.length || lines.some(l => !l.description.trim() || !Number.isFinite(l.qty) || l.qty <= 0 || !Number.isFinite(l.unit_price) || l.unit_price < 0 || !Number.isFinite(l.vat_rate) || l.vat_rate < 0 || l.vat_rate > 100)) throw new Error('ط£ظƒظ…ظ„ ظˆطµظپ ظƒظ„ ط¨ظ†ط¯ ظˆط§ظ„ظƒظ…ظٹط© ظˆط§ظ„ط³ط¹ط± ظˆظ†ط³ط¨ط© ط§ظ„ط¶ط±ظٹط¨ط©');
      if ($('#pay').value === 'credit' && !$('#party').value) throw new Error('ط§ط®طھط± ط§ظ„ط¹ظ…ظٹظ„ ظ„ظ„ظپط§طھظˆط±ط© ط§ظ„ط¢ط¬ظ„ط©');
      if (!draft && !(await reviewInvoice($('#tt').textContent, lines.length))) return;
      $('#issue').disabled = true; $('#draft').disabled = true;
      const dueDate=$('#due-date')?.value||undefined; const terms=Math.max(0,Number($('#payment-terms-days')?.value||0));
      let r; try { r = await api(isPos?'pos/sales':'invoices', { method: 'POST', body: { request_id:isPos?S.saleRequestId:undefined,price_level:isPos?$('#pos-price-level')?.value:undefined,invoice_kind:$('#invoice-kind').value||undefined,supply_date:$('#supply-date').value, due_date:dueDate, payment_terms_days:terms, lines, party_id: +$('#party').value || null, pos_id: +$('#pos').value, payment: $('#pay').value, draft } }); } catch(e) { $('#issue').disabled = false; $('#draft').disabled = false; throw e; }
      if(isPos)await globalThis.AlmuhtarizStore?.remove(localScope(),'sale','drafts');
      if (!draft) window.open(`/api/invoices/${r.id}/html?profile=${location.hash.slice(1)==='pos'||S.state.user.role==='staff'?'pos':'accountant'}`, '_blank'); if(isPos){await pages.pos();msg('طھظ… ط¥طµط¯ط§ط± ط§ظ„ط¨ظٹط¹ ظˆط­ظپط¸ظ‡ ظ…ط­ظ„ظٹظ‹ط§',true);}else location.hash='invoices'; });
    const syncDue=()=>{const d=$('#supply-date')?.value||S.state.today;const terms=Math.max(0,Number($('#payment-terms-days')?.value||0));if($('#due-date')&&!$('#due-date').dataset.manual){const dt=new Date(d+'T00:00:00Z');dt.setUTCDate(dt.getUTCDate()+terms);$('#due-date').value=dt.toISOString().slice(0,10);}};
    $('#supply-date')?.addEventListener('change',()=>{if($('#due-date'))$('#due-date').dataset.manual='';syncDue();});
    $('#payment-terms-days')?.addEventListener('input',()=>{if($('#due-date'))$('#due-date').dataset.manual='';syncDue();});
    $('#due-date')?.addEventListener('change',()=>{if($('#due-date'))$('#due-date').dataset.manual='1';});
    syncDue();
    $('#issue').onclick = save(false); $('#draft').onclick = save(true);
    if(!isPos){const {attachQuoteAction}=await import('./quotations.js');attachQuoteAction({api,rows,S,esc,onSaved:async()=>{location.hash='quotes';}});}
    if(isPos){$('#draft').hidden=true;$('#add').hidden=true;$('#invoice-kind').disabled=true;}
    return pricing;
  },
  async pos() {
    if(workspace!=='trade'&&S.state.user.role!=='staff'){shell('<div class="card"><h1>ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹ ط§ظ„طھط¬ط§ط±ظٹط©</h1><p>ط§ط®طھط± ط§ظ„ظ†ط´ط§ط· ط§ظ„طھط¬ط§ط±ظٹ ظ„ظپطھط­ ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹ ظˆظ‚ط±ط§ط،ط© ط§ظ„ط¨ط§ط±ظƒظˆط¯.</p><button id="open-trade" class="p">ظپطھط­ ط§ظ„ظ‚ط³ظ… ط§ظ„طھط¬ط§ط±ظٹ</button></div>');$('#open-trade').onclick=()=>{workspace='trade';localStorage.setItem('smartz.workspace',workspace);pages.pos();};return;}
    workspace='trade';S.saleRequestId=newSaleRequestId();const pricing=await pages.new();$('main h1').textContent='ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹ ط§ظ„طھط¬ط§ط±ظٹط©';
    const catalog=document.createElement('section');catalog.className='card pos-catalog';
    catalog.innerHTML=`<div class="section-heading"><div><h3>ط§ظ…ط³ط­طŒ ط£ط¶ظپطŒ ط£طµط¯ط±</h3><p>ظ‚ط§ط±ط¦ ط¨ط§ط±ظƒظˆط¯ USB ط£ظˆ Bluetooth ظٹط¹ظ…ظ„ ظƒظ„ظˆط­ط© ظ…ظپط§طھظٹط­ ظˆظٹظ†ظ‡ظٹ ط§ظ„ظ‚ط±ط§ط،ط© ط¨ط²ط± Enter.</p></div><span class="tag" id="local-storage-state">ط¬ط§ط±ظچ طھظ‡ظٹط¦ط© ط§ظ„ط°ط§ظƒط±ط© ط§ظ„ظ…ط­ظ„ظٹط©â€¦</span></div>
    <form id="barcode-form" class="barcode-form"><label for="barcode-input">ظ‚ط±ط§ط،ط© ط§ظ„ط¨ط§ط±ظƒظˆط¯<input id="barcode-input" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="ط§ظ…ط³ط­ ط§ظ„ط¨ط§ط±ظƒظˆط¯ ط£ظˆ ط§ظƒطھط¨ظ‡ ط«ظ… ط§ط¶ط؛ط· Enter" dir="ltr" maxlength="80" disabled></label><button type="submit" class="p" disabled>ط¥ط¶ط§ظپط© ط§ظ„طµظ†ظپ</button><button type="button" id="clear-pos-cart" disabled>ط³ظ„ط© ط¬ط¯ظٹط¯ط©</button></form>
    <div id="barcode-message" role="status" class="hint"></div><input id="pos-search" type="search" aria-label="ط§ظ„ط¨ط­ط« ط¹ظ† طµظ†ظپ" placeholder="ط§ط¨ط­ط« ط¨ط§ظ„ط§ط³ظ… ط£ظˆ ط§ظ„ظƒظˆط¯ ط£ظˆ ط§ظ„ط¨ط§ط±ظƒظˆط¯" maxlength="100" disabled><div class="product-grid"></div>
    <div class="toolbar"><button type="button" id="pos-previous" disabled>ط§ظ„ط³ط§ط¨ظ‚</button><span id="pos-results" role="status"></span><button type="button" id="pos-next" disabled>ط§ظ„طھط§ظ„ظٹ</button></div>`;
    $('.content').insertBefore(catalog,$('.content .card'));
    const controls=document.createElement('section');controls.className='card row';controls.innerHTML='<button id="pos-shift-tools">ظپطھط­ / ط¥ظ‚ظپط§ظ„ ط§ظ„ظˆط±ط¯ظٹط©</button><button id="pos-return-tools">ظ…ط±طھط¬ط¹ ظپط§طھظˆط±ط©</button>';catalog.before(controls);
    $('#pos-shift-tools').onclick=guard(async()=>{await (await import('./operations.js')).renderOperations('shifts',{api,shell,esc,money,S,dialog:$('#dlg')});});
    $('#pos-return-tools').onclick=guard(async()=>{await (await import('./operations.js')).renderPosReturn({api,esc,money,dialog:$('#dlg'),after:()=>pages.pos()});});

    const scanner=$('#barcode-input'), status=$('#barcode-message'), scope=localScope();
    const issue=$('#issue'), clear=$('#clear-pos-cart');
    let restoring=true;
    issue.disabled=true;
    const persist=()=>{
      if(restoring||!catalog.isConnected)return;
      const lines=$$('#ln tbody tr').filter(row=>row.dataset.itemId).map(row=>({
        item_id:Number(row.dataset.itemId),item_unit_id:Number(row.dataset.itemUnitId)||null,
        qty:Number($('.q',row).value),tracking:JSON.parse(row.dataset.tracking||'[]'),
        discount:$('.disc',row)?.value||'0',override:$('.pos-override',row)?.value||null,
        scale_code:row.trackingItem?.scale_code,scale_mode:row.trackingItem?.scale_mode,
      }));
      globalThis.AlmuhtarizStore?.put(scope,'sale',{request_id:S.saleRequestId,lines,price_level:$('#pos-price-level')?.value,pos_id:Number($('#pos').value),party_id:Number($('#party').value)||null,payment:$('#pay').value},'drafts');
    };
    const addItem=(item,quantity=item.scale_qty??1)=>{
      const rows=$$('#ln tbody tr');
      let row=item.scale_code?null:rows.find(row=>!row.trackingItem?.scale_code&&Number(row.dataset.itemId)===item.id&&(Number(row.dataset.itemUnitId)||null)===item.item_unit_id);
      if(row) quantity=Math.round((Number($('.q',row).value)+quantity)*1000000)/1000000;
      else {
        row=rows.find(row=>!row.dataset.itemId);
        if(!row){
          if(!restoring&&rows.length>=200)throw Error('ط§ظ„ط­ط¯ ط§ظ„ط£ظ‚طµظ‰ 200 ط¨ظ†ط¯ ظپظٹ ط§ظ„ط³ظ„ط©');
          $('#add').click();row=$$('#ln tbody tr').at(-1);
        }
      }
      row.dataset.itemId=String(item.id);row.dataset.itemUnitId=item.item_unit_id?String(item.item_unit_id):'';
      $('.d',row).value=item.name_ar;$('.q',row).value=quantity;$('.v',row).value=item.vat_rate;
      $('.q',row).readOnly=Boolean(item.scale_code);
      for(const input of $$('.disc,.pos-override',row))input.disabled=item.scale_mode==='price';
      $('.tc',row).value=item.tax_category||'S';$('.ec',row).value=item.exemption_code||'';$('.er',row).value=item.exemption_reason||'';
      setTrackingItem(row,item);updatePosPrice(row);$('.q',row).dispatchEvent(new Event('input',{bubbles:true}));
      return row;
    };
    $('#ln').addEventListener('input',persist);
    $('#ln').addEventListener('click',event=>{if(event.target.closest('button'))queueMicrotask(persist);});
    for(const id of ['party','pay','pos'])$('#'+id).addEventListener('change',persist);
    $('#pos-price-level')?.addEventListener('change',persist);
    clear.onclick=guard(async()=>{
      if(Number($('#barcode-form').dataset.pending))throw Error('ط§ظ†طھط¸ط± ط§ظƒطھظ…ط§ظ„ ظ‚ط±ط§ط،ط© ط§ظ„ط¨ط§ط±ظƒظˆط¯');
      const wasRestoring=restoring;
      restoring=true;
      clear.disabled=true;
      try {
        if(scope&&await globalThis.AlmuhtarizStore?.ready()){
          if(!await globalThis.AlmuhtarizStore.remove(scope,'sale','drafts'))throw Error('طھط¹ط°ط± ظ…ط³ط­ ط§ظ„ط³ظ„ط© ط§ظ„ظ…ط­ظ„ظٹط©');
        }
        if(catalog.isConnected)await pages.pos();
      } finally {
        restoring=wasRestoring;
        clear.disabled=false;
      }
    });

    const ready=Boolean(await globalThis.AlmuhtarizStore?.ready());
    if(!catalog.isConnected)return;
    $('#local-storage-state').textContent=ready?'ط§ظ„ط°ط§ظƒط±ط© ط§ظ„ظ…ط­ظ„ظٹط© ط¬ط§ظ‡ط²ط©':'ط§ظ„ط­ظپط¸ ط¯ط§ط®ظ„ ط§ظ„ظ…طھطµظپط­ ط؛ظٹط± ظ…طھط§ط­';
    try {
      if(ready&&scope){
        void globalThis.AlmuhtarizStore.remove(scope,'catalog');
        const draft=await globalThis.AlmuhtarizStore.get(scope,'sale','drafts');
        const lines=(draft?.lines||[]).filter(line=>Number.isSafeInteger(line.item_id)&&line.item_id>0&&Number.isFinite(line.qty)&&line.qty>0&&line.qty<=1000000);
        if(lines.length){
          const key=line=>line.item_id+':'+(line.item_unit_id||0), found=new Map();
          for(let offset=0;offset<lines.length;offset+=200){
            const keys=lines.slice(offset,offset+200).map(key).join(',');
            const {rows}=await api('pos/catalog/selection?'+new URLSearchParams({keys}));
            for(const item of rows)found.set(item.id+':'+(item.item_unit_id||0),item);
          }
          if(!catalog.isConnected)return;
          if(typeof draft.request_id==='string')S.saleRequestId=draft.request_id;
          if(draft.price_level==='wholesale'&&pricing.wholesale)$('#pos-price-level').value='wholesale';
          let missing=0;
          for(const line of lines){
            const selected=found.get(key(line))||{id:line.item_id,item_unit_id:line.item_unit_id||null,name_ar:'ط¨ظ†ط¯ ط؛ظٹط± ظ…طھط§ط­ #'+line.item_id,unit_price:0,vat_rate:15,unavailable:true};
            const item=line.scale_code?{...selected,scale_code:line.scale_code,scale_mode:line.scale_mode}:selected;
            if(item.unavailable)missing++;
            const row=addItem(item,line.qty);
            if(item.scale_mode!=='price'){
              if($('.disc',row)&&Number(line.discount)<=pricing.discount_limit)$('.disc',row).value=line.discount||'0';
              if($('.pos-override',row))$('.pos-override',row).value=line.override??'';
            }
            updatePosPrice(row);
            $('.q',row).dispatchEvent(new Event('input',{bubbles:true}));
            if(Array.isArray(line.tracking)){row.dataset.tracking=JSON.stringify(line.tracking);setTrackingItem(row,item);}
          }
          if(S.pos.some(point=>point.id===draft.pos_id))$('#pos').value=draft.pos_id;
          if(S.parties.some(party=>party.id===draft.party_id))$('#party').value=draft.party_id;
          if(['cash','bank','credit'].includes(draft.payment))$('#pay').value=draft.payment;
          status.textContent=missing?'ط§ط³طھظڈط¹ظٹط¯طھ ط§ظ„ط³ظ„ط©. ط£ط²ظ„ ط§ظ„ط¨ظ†ظˆط¯ ط؛ظٹط± ط§ظ„ظ…طھط§ط­ط© ظ‚ط¨ظ„ ط§ظ„ط¥طµط¯ط§ط±.':'ط§ط³طھظڈط¹ظٹط¯طھ ط³ظ„ط© ط؛ظٹط± ظ…طµط¯ط±ط© ظ…ظ† ظ‡ط°ط§ ط§ظ„ط¬ظ‡ط§ط².';
        }
      }
    } catch(error) {
      if(catalog.isConnected){clear.disabled=false;status.textContent='طھط¹ط°ط±طھ ط§ط³طھط¹ط§ط¯ط© ط§ظ„ط³ظ„ط©. ط£ط¹ط¯ طھط­ظ…ظٹظ„ ط§ظ„طµظپط­ط© ظ„ظ„ظ…ط­ط§ظˆظ„ط© ظ…ط¬ط¯ط¯ظ‹ط§. '+error.message;}
      return;
    }
    if(!catalog.isConnected)return;
    restoring=false;
    clear.disabled=false;
    scanner.disabled=false;
    $('#barcode-form button[type=submit]').disabled=false;
    $('#pos-search').disabled=false;
    issue.disabled=!S.pos.length;
    if(!S.pos.length)msg('ظ„ظ… طھظڈط¹ظٹظ‘ظ† ظ„ظƒ ظ†ظ‚ط·ط© ط¨ظٹط¹ ظ…ظپط¹ظ„ط©. ط±ط§ط¬ط¹ ظ…ط§ظ„ظƒ ط§ظ„ظ…ظ†ط´ط£ط©.');
    scanner.focus();
    const {mountPosCatalog}=await import('./pos-catalog.js');
    if(catalog.isConnected)await mountPosCatalog({root:catalog,api,esc,money,addItem,pricing});
  },
  async parties() {
    const rows=await api('parties');let editing=null;
    shell('<h1>ط§ظ„ط¹ظ…ظ„ط§ط، ظˆط§ظ„ظ…ظˆط±ط¯ظˆظ†</h1><div class="card"><div id="party-fields"></div><button class="p" id="save-party">ط­ظپط¸ ط§ظ„ط¹ظ…ظٹظ„</button><button id="new-party">ط¹ظ…ظٹظ„ ط¬ط¯ظٹط¯</button></div><div class="card"><table><thead><tr><th>ط§ظ„ط§ط³ظ…</th><th>ط§ظ„ظ†ظˆط¹</th><th>ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ</th><th></th></tr></thead><tbody>'+rows.map(p=>'<tr><td>'+esc(p.name_ar)+'</td><td>'+(p.entity_type==='business'?'ظ…ظ†ط´ط£ط©':'ظپط±ط¯')+'</td><td>'+esc(p.vat_number||'')+'</td><td><button data-edit-party="'+p.id+'">طھط¹ط¯ظٹظ„</button></td></tr>').join('')+'</tbody></table></div>');
    const form=p=>{$('#party-fields').innerHTML='<div class="row">'+fld('name_ar','ط§ط³ظ… ط§ظ„ط¹ظ…ظٹظ„ ط£ظˆ ط§ظ„ظ…ظˆط±ط¯',p.name_ar||'')+fld('entity_type','ط§ظ„طµظپط©',p.entity_type||'individual','select',[['individual','ظپط±ط¯'],['business','ظ…ظ†ط´ط£ط©']])+fld('kind','ط§ظ„طھط¹ط§ظ…ظ„',p.kind||'customer','select',[['customer','ط¹ظ…ظٹظ„'],['supplier','ظ…ظˆط±ط¯'],['both','ط¹ظ…ظٹظ„ ظˆظ…ظˆط±ط¯']])+'</div><div class="row">'+fld('vat_number','ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ ط¥ظ† ظƒط§ظ† ظ…ط³ط¬ظ„ظ‹ط§',p.vat_number||'')+fld('phone','ط§ظ„ظ‡ط§طھظپ',p.phone||'')+'</div><details '+(p.entity_type==='business'?'open':'')+'><summary>ط¨ظٹط§ظ†ط§طھ ط§ظ„ظپط§طھظˆط±ط© ط§ظ„ط¶ط±ظٹط¨ظٹط© ظˆط§ظ„ط¹ظ†ظˆط§ظ† ط§ظ„ظˆط·ظ†ظٹ</summary><p class="hint">طھظڈط·ظ„ط¨ ظ„ظ„ظپط§طھظˆط±ط© ط§ظ„ط¶ط±ظٹط¨ظٹط©. ط¥ظ† ظ„ظ… ظٹظƒظ† ط§ظ„ط¹ظ…ظٹظ„ ظ…ط³ط¬ظ„ظ‹ط§ ط¶ط±ظٹط¨ظٹظ‹ط§ ط£ط¯ط®ظ„ ظ…ط¹ط±ظپظ‡ ط§ظ„ط¢ط®ط± ظˆظ†ظˆط¹ظ‡.</p><div class="row">'+fld('id_scheme','ظ†ظˆط¹ ط§ظ„ظ…ط¹ط±ظپ ط§ظ„ط¢ط®ط±',p.id_scheme||'','select',[['','ط¨ط¯ظˆظ†'],['CRN','ط³ط¬ظ„ طھط¬ط§ط±ظٹ'],['NAT','ظ‡ظˆظٹط© ظˆط·ظ†ظٹط©'],['IQA','ط¥ظ‚ط§ظ…ط©'],['PAS','ط¬ظˆط§ط² ط³ظپط±'],['700','ط±ظ‚ظ… ظ…ظˆط­ط¯'],['OTH','ط¢ط®ط±']])+fld('id_number','ط±ظ‚ظ… ط§ظ„ظ…ط¹ط±ظپ ط§ظ„ط¢ط®ط±',p.id_number||'')+'</div>'+fld('street','ط§ظ„ط´ط§ط±ط¹',p.street||'')+'<div class="row">'+fld('building_number','ط±ظ‚ظ… ط§ظ„ظ…ط¨ظ†ظ‰',p.building_number||'')+fld('district','ط§ظ„ط­ظٹ',p.district||'')+'</div><div class="row">'+fld('city','ط§ظ„ظ…ط¯ظٹظ†ط©',p.city||'')+fld('postal_code','ط§ظ„ط±ظ…ط² ط§ظ„ط¨ط±ظٹط¯ظٹ',p.postal_code||'')+'</div>'+fld('country_code','ط§ظ„ط¯ظˆظ„ط©',p.country_code||'SA','select',[['SA','ط§ظ„ط³ط¹ظˆط¯ظٹط©']])+'</details>';};form({});
    $$('[data-edit-party]').forEach(b=>b.onclick=()=>{editing=Number(b.dataset.editParty);form(rows.find(p=>p.id===editing));});$('#new-party').onclick=()=>{editing=null;form({});};
    $('#save-party').onclick=guard(async()=>{await api('parties'+(editing?'/'+editing:''),{method:editing?'PUT':'POST',body:collect($('#party-fields'))});await pages.parties();msg('طھظ… ط­ظپط¸ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط¹ظ…ظٹظ„',true);});
  },
  async items() { const {renderItems}=await import('./items.js');await renderItems({api,shell,esc,guard,msg,owner:S.state.user.role==='owner'}); },
  async compliance(){const [state,queuePage]=await Promise.all([api('compliance/status'),api('compliance/lists/queue')]),queue=queuePage.rows;const {pagedView}=await import('./paged-view.js');const queueHtml=queue=>queue.map(q=>'<tr><td>'+esc(q.number)+'</td><td>'+(q.operation==='clearance'?'ط§ط¹طھظ…ط§ط¯':'ط¥ط¨ظ„ط§ط؛')+'</td><td>'+esc(q.state)+'</td><td>'+esc(q.last_error)+'</td><td><a href="/api/invoices/'+q.invoice_id+'/xml">XML طھط¬ط±ظٹط¨ظٹ</a></td></tr>').join('');shell('<h1>ط§ظ„ظپظˆطھط±ط© ظˆط§ظ„ظ‡ظٹط¦ط©</h1><div class="card"><span class="status draft">ظ…ط±ط­ظ„ط© ط§ظ„طھط·ظˆظٹط±</span><h3>ط§ظ„ط¥ظ†طھط§ط¬ ط؛ظٹط± ظ…ظپط¹ظ‘ظ„</h3><p>ط§ظ„ظ…ط³طھظ†ط¯ط§طھ ط§ظ„ط­ط§ظ„ظٹط© طھط¬ط±ظٹط¨ظٹط©. طھظˆظ„ظٹط¯ XML ط£ظˆ ظˆط¬ظˆط¯ QR ظ„ط§ ظٹط¹ظ†ظٹ ط§ط¬طھظٹط§ط² ط§ظ„طھط­ظ‚ظ‚ ط§ظ„ط±ط³ظ…ظٹ.</p><h4>ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ظ†ط´ط£ط©</h4>'+(state.seller_errors.length?'<ul>'+state.seller_errors.map(e=>'<li>'+esc(e)+'</li>').join('')+'</ul><a href="#settings" id="complete-company">ط§ط³طھظƒظ…ط§ظ„ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ظ†ط´ط£ط© â†گ</a>':'<p>ط§ط¬طھط§ط²طھ ط­ظ‚ظˆظ„ ط§ظ„ظ…ظ†ط´ط£ط© ط§ظ„طھط­ظ‚ظ‚ ط§ظ„ظ…ط­ظ„ظٹ.</p>')+'<h4>ط®ط·ظˆط§طھ ظ„ظ… طھظƒطھظ…ظ„ ط¨ط¹ط¯</h4><ol>'+state.remaining.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ol><p>ط³ظ„ط§ظ…ط© ط³ط¬ظ„ ط§ظ„طھط¯ظ‚ظٹظ‚: '+(state.audit_valid===null?'ظ„ظ… ظٹظڈظپط­طµ ط§ظ„ط³ط¬ظ„ ط§ظ„ط­ط§ظ„ظٹ ط¨ط¹ط¯':state.audit_valid?'ط§ط¬طھط§ط² ط§ظ„ظپط­طµ ط§ظ„ظ…ط­ظ„ظٹ':'ظٹظˆط¬ط¯ ط®ظ„ظ„ ظٹط­طھط§ط¬ ظ…ط±ط§ط¬ط¹ط©')+'</p><button id="verify-audit">ظپط­طµ ط³ط¬ظ„ ط§ظ„طھط¯ظ‚ظٹظ‚</button><p id="audit-result" role="status"></p></div><div class="card"><h3>ط·ط§ط¨ظˆط± ط§ظ„ظ‡ظٹط¦ط©</h3><table><thead><tr><th>ط§ظ„ظ…ط³طھظ†ط¯</th><th>ط§ظ„ظ…ط³ط§ط±</th><th>ط§ظ„ط­ط§ظ„ط©</th><th>ط§ظ„ط³ط¨ط¨</th><th></th></tr></thead><tbody id="compliance-queue-list">'+queueHtml(queue)+'</tbody></table></div>');if($('#complete-company'))$('#complete-company').onclick=()=>{sessionStorage.tab='company';};$('#verify-audit').onclick=async()=>{const button=$('#verify-audit'),result=$('#audit-result');button.disabled=true;result.textContent='ظٹط¬ط±ظٹ ظپط­طµ ط§ظ„ط³ط¬ظ„ط› ظٹظ…ظƒظ†ظƒ ظ…طھط§ط¨ط¹ط© ط§ظ„ط¹ظ…ظ„.';try{const checked=await api('compliance/audit/verify');result.textContent=checked.valid?'ط§ظƒطھظ…ظ„ ط§ظ„ظپط­طµ ط¨ظ†ط¬ط§ط­ ط­طھظ‰ ط§ظ„ط­ط¯ط« '+checked.tip.id:'ظƒط´ظپ ط§ظ„ظپط­طµ ط®ظ„ظ„ظ‹ط§ط› ط±ط§ط¬ط¹ ط§ظ„ط³ط¬ظ„ ظ‚ط¨ظ„ ط§ظ„ظ…طھط§ط¨ط¹ط©';}catch(error){result.textContent=error.message;}finally{button.disabled=false;}};await pagedView({api,path:'compliance/lists/queue',body:$('#compliance-queue-list'),initial:queuePage,renderRows:queueHtml});},
  async reports() {
    const tb = await api('reports/trial-balance'), t = S.state.today, m = t.slice(0, 8) + '01';
    shell(`<h1>ط§ظ„طھظ‚ط§ط±ظٹط±</h1><p><a class="button p" href="#financial">ط§ظ„طھظ‚ط§ط±ظٹط± ط§ظ„ظ…ط§ظ„ظٹط© ظˆطھظ‚ظٹظٹظ… ط§ظ„ظ…ط®ط²ظˆظ† â†گ</a></p><div class="card"><h3>ط¥ظ‚ط±ط§ط± ط¶ط±ظٹط¨ط© ط§ظ„ظ‚ظٹظ…ط© ط§ظ„ظ…ط¶ط§ظپط© (ظ…ط³ط§ط¹ط¯ ظ„ظ„ط¥ط¹ط¯ط§ط¯)</h3><div class="row"><label>ظ…ظ†<input id="f" type="date" value="${m}"></label><label>ط¥ظ„ظ‰<input id="t" type="date" value="${t}"></label><button class="p" id="go">ط¹ط±ط¶</button></div><div id="vr"></div></div>
    <div class="card"><h3>ظ…ظٹط²ط§ظ† ط§ظ„ظ…ط±ط§ط¬ط¹ط© ${tb.balanced ? '<span class="tag">ظ…طھظˆط§ط²ظ†</span>' : '<span class="tag" style="background:#fee4e2">ط؛ظٹط± ظ…طھظˆط§ط²ظ†!</span>'}</h3><table><thead><tr><th>ط§ظ„ط­ط³ط§ط¨</th><th>ظ…ط¯ظٹظ†</th><th>ط¯ط§ط¦ظ†</th></tr></thead><tbody>
    ${tb.rows.map(r => `<tr><td>${r.code} ${esc(r.name)}</td><td class="num">${money(r.debit)}</td><td class="num">${money(r.credit)}</td></tr>`).join('')}
    <tr><th>ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹ</th><th class="num">${money(tb.total_debit)}</th><th class="num">${money(tb.total_credit)}</th></tr></tbody></table></div>`);
    $('#go').onclick = guard(async () => { const r = await api(`reports/vat?from=${$('#f').value}&to=${$('#t').value}`);
      $('#vr').innerHTML = `<table><thead><tr><th>ط§ظ„ظ†ط³ط¨ط©</th><th>ظ‚ظٹظ…ط© ط§ظ„ظ…ط¨ظٹط¹ط§طھ</th><th>ط§ظ„ط¶ط±ظٹط¨ط©</th></tr></thead><tbody>${r.sales_by_rate.map(x => `<tr><td>${x.rate}%</td><td class="num">${money(x.base)}</td><td class="num">${money(x.vat)}</td></tr>`).join('')}</tbody></table>
      <p>ط¶ط±ظٹط¨ط© ط§ظ„ظ…ط®ط±ط¬ط§طھ: <b class="num">${money(r.output_vat)}</b> آ· ط¶ط±ظٹط¨ط© ط§ظ„ظ…ط¯ط®ظ„ط§طھ: <b class="num">${money(r.input_vat)}</b> آ· <b>ط§ظ„طµط§ظپظٹ ط§ظ„ظ…ط³طھط­ظ‚: <span class="num">${money(r.net_due)}</span></b></p>
      <small>ط§ظ„ط£ط±ظ‚ط§ظ… ظ…ط£ط®ظˆط°ط© ظ…ظ† ط§ظ„ط¯ظپط§طھط±طŒ ظˆطھظڈط±ط§ط¬ط¹ ظ…ط¹ المحاسب ظˆطھظڈط·ط§ط¨ظژظ‚ ظ…ط¹ ظ†ظ…ظˆط°ط¬ ط§ظ„ط¥ظ‚ط±ط§ط± ظپظٹ ط¨ظˆط§ط¨ط© ط§ظ„ظ‡ظٹط¦ط© ظ‚ط¨ظ„ ط§ظ„طھظ‚ط¯ظٹظ….</small>`; });
  },
  async print() { sessionStorage.tab='invoice'; await pages.settings(); },
  async settings() {
    const tab = sessionStorage.tab || 'ui', owner = S.state.user.role === 'owner';
    const T = [['ui', 'ط§ظ„ظˆط§ط¬ظ‡ط©'], ['invoice', 'ط·ط¨ط§ط¹ط© ط§ظ„ظپظˆط§طھظٹط±'], ['company', 'ط§ظ„ط´ط±ظƒط©'], ['pos', 'ظ†ظ‚ط§ط· ط§ظ„ط¨ظٹط¹'], ['users', 'ط§ظ„ظ…ط³طھط®ط¯ظ…ظˆظ†'], ['sys', 'ط§ظ„ظ†ط³ط® ظˆط§ظ„طھط±ط®ظٹطµ']];
    shell(`<h1>ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ</h1>${owner ? '' : '<div class="msg">ظ„ظ„ظ…ط§ظ„ظƒ ظپظ‚ط·</div>'}<div class="tabs">${T.map(([k, t]) => `<button class="${k === tab ? 'on' : ''}" data-t="${k}">${t}</button>`).join('')}</div><div id="tab"></div>`);
    $$('[data-t]').forEach(b => b.onclick = () => { sessionStorage.tab = b.dataset.t; pages.settings(); });
    if (owner) await tabs[tab]();
  }
};

// ---------- ط­ظ‚ظˆظ„ ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ ----------
const fld = (k, label, v, type = 'text', opts) => type === 'select' ? `<label>${label}<select data-k="${k}">${opts.map(([a, b]) => `<option value="${a}" ${String(v) === String(a) ? 'selected' : ''}>${b}</option>`).join('')}</select></label>`
  : type === 'checkbox' ? `<label class="ck"><input type="checkbox" data-k="${k}" ${v ? 'checked' : ''}> ${label}</label>`
  : type === 'textarea' ? `<label>${label}<textarea data-k="${k}" rows="3">${esc(v)}</textarea></label>`
  : `<label>${label}<input data-k="${k}" type="${type}" value="${esc(v)}"></label>`;
const collect = root => Object.fromEntries($$('[data-k]', root).map(e => [e.dataset.k, e.type === 'checkbox' ? e.checked : e.type === 'number' || e.type === 'range' ? +e.value : e.value]));
const saveBtn = '<button class="p" id="save">ط­ظپط¸</button>';


function companyFormMarkup(c) {
 return '<div class="company-form-grid"><div>'+fld('name_ar','ط§ط³ظ… ط§ظ„ظ…ظ†ط´ط£ط©',c.name_ar)+fld('name_en','ط§ظ„ط§ط³ظ… ط¨ط§ظ„ط¥ظ†ط¬ظ„ظٹط²ظٹط©',c.name_en)+'<div class="row">'+fld('vat_number','ط§ظ„ط±ظ‚ظ… ط§ظ„ط¶ط±ظٹط¨ظٹ',c.vat_number)+fld('cr_number','ط±ظ‚ظ… ط§ظ„ط³ط¬ظ„ ط§ظ„طھط¬ط§ط±ظٹ',c.cr_number)+'</div>'+fld('address','ظ…ط¹ظ„ظˆظ…ط§طھ ط¹ظ†ظˆط§ظ† ط¥ط¶ط§ظپظٹط© ظ„ظ„ط·ط¨ط§ط¹ط©',c.address)+'<h4>ط§ظ„ط¹ظ†ظˆط§ظ† ط§ظ„ظˆط·ظ†ظٹ</h4>'+fld('street','ط§ظ„ط´ط§ط±ط¹',c.street)+'<div class="row">'+fld('building_number','ط±ظ‚ظ… ط§ظ„ظ…ط¨ظ†ظ‰ آ· 4 ط£ط±ظ‚ط§ظ…',c.building_number)+fld('district','ط§ظ„ط­ظٹ',c.district)+'</div><div class="row">'+fld('city','ط§ظ„ظ…ط¯ظٹظ†ط©',c.city)+fld('postal_code','ط§ظ„ط±ظ…ط² ط§ظ„ط¨ط±ظٹط¯ظٹ آ· 5 ط£ط±ظ‚ط§ظ…',c.postal_code)+'</div>'+fld('country_code','ط§ظ„ط¯ظˆظ„ط©',c.country_code||'SA','select',[['SA','ط§ظ„ط³ط¹ظˆط¯ظٹط©']])+'<div class="row">'+fld('seller_id_scheme','ظ†ظˆط¹ ظ…ط¹ط±ظپ ط§ظ„ظ…ظ†ط´ط£ط©',c.seller_id_scheme||'CRN','select',[['CRN','ط§ظ„ط³ط¬ظ„ ط§ظ„طھط¬ط§ط±ظٹ'],['MOM','ط±ط®طµط© ط§ظ„ط¨ظ„ط¯ظٹط©'],['MLS','ط±ط®طµط© ط§ظ„ظ…ظˆط§ط±ط¯ ط§ظ„ط¨ط´ط±ظٹط©'],['700','ط§ظ„ط±ظ‚ظ… ط§ظ„ظ…ظˆط­ط¯'],['SAG','ط±ط®طµط© ط§ظ„ط§ط³طھط«ظ…ط§ط±'],['OTH','ظ…ط¹ط±ظپ ط¢ط®ط±']])+fld('seller_id','ظ‚ظٹظ…ط© ط§ظ„ظ…ط¹ط±ظپ آ· ط§طھط±ظƒظ‡ ظپط§ط±ط؛ظ‹ط§ ظ„ط§ط³طھط®ط¯ط§ظ… ط§ظ„ط³ط¬ظ„ ط§ظ„طھط¬ط§ط±ظٹ',c.seller_id)+'</div>'+'<div class="row">'+fld('phone','ط§ظ„ظ‡ط§طھظپ',c.phone)+fld('email','ط§ظ„ط¨ط±ظٹط¯ ط§ظ„ط¥ظ„ظƒطھط±ظˆظ†ظٹ',c.email)+'</div>'+'</div><div class="company-logo-panel"><img id="company-logo-preview" alt="ظ…ط¹ط§ظٹظ†ط© ط´ط¹ط§ط± ط§ظ„ط¹ظ…ظٹظ„" '+(c.logo?'src="'+esc(c.logo)+'"':'hidden')+'><label>ط´ط¹ط§ط± ظ…ظ†ط´ط£ط© ط§ظ„ط¹ظ…ظٹظ„<input id="company-logo-file" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"></label><p class="hint">PNG ط£ظˆ JPG ط£ظˆ SVG ط£ظˆ WebP آ· ط­طھظ‰ 1 ظ…ظٹط¬ط§ط¨ط§ظٹطھ</p><button id="remove-company-logo" type="button">ط¥ط²ط§ظ„ط© ط§ظ„ط´ط¹ط§ط±</button></div></div><button class="p" id="save-company">ط­ظپط¸ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ظ†ط´ط£ط© ظˆط§ظ„ط´ط¹ط§ط±</button>';
}
function bindCompanyForm(c,onChange=()=>{}) {
 const form=$('#company-form');form.innerHTML=companyFormMarkup(c);let logo=c.logo||'';
 const value=()=>({...collect(form),logo});form.oninput=()=>onChange(value());
 const showLogo=()=>{const img=$('#company-logo-preview',form);img.hidden=!logo;if(logo)img.src=logo;else img.removeAttribute('src');onChange(value());};
 $('#company-logo-file',form).onchange=e=>{const file=e.target.files[0];if(!file)return;if(file.size>1000000)return msg('ط­ط¬ظ… ط§ظ„ط´ط¹ط§ط± ط£ظƒط¨ط± ظ…ظ† 1 ظ…ظٹط¬ط§ط¨ط§ظٹطھ');if(!['image/png','image/jpeg','image/svg+xml','image/webp'].includes(file.type))return msg('ط§ط®طھط± ظ…ظ„ظپ طµظˆط±ط© ظ…ط¯ط¹ظˆظ…ظ‹ط§');const reader=new FileReader();reader.onload=()=>{logo=reader.result;showLogo();};reader.readAsDataURL(file);};
 $('#remove-company-logo',form).onclick=()=>{logo='';$('#company-logo-file',form).value='';showLogo();};
 $('#save-company',form).onclick=guard(async()=>{const saved=await api('settings/company',{method:'PUT',body:value()});S.state.activity=saved.activity;if(visibleWorkspace(saved.activity)){workspace=saved.activity;localStorage.setItem('smartz.workspace',workspace);}onChange(saved);msg('طھظ… ط­ظپط¸ ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ظ†ط´ط£ط© ظˆط´ط¹ط§ط±ظ‡ط§ ظ„ظ„ظ‚ط§ظ„ط¨ظٹظ†',true);});
}

const tabs = {
  async ui() {
    const u = await api('settings/ui'); S.ui = u;
    $('#tab').innerHTML = `<div class="card">${fld('theme', 'ط§ظ„ظ…ط¸ظ‡ط±', u.theme, 'select', [['auto', 'طھظ„ظ‚ط§ط¦ظٹ'], ['light', 'ظپط§طھط­'], ['dark', 'ط¯ط§ظƒظ†']])}
    <div class="row">${fld('accent', 'ط§ظ„ظ„ظˆظ† ط§ظ„ط£ط³ط§ط³ظٹ', u.accent, 'color')}${fld('fontScale', 'ط­ط¬ظ… ط§ظ„ط®ط·', u.fontScale, 'number')}${fld('radius', 'ط§ط³طھط¯ط§ط±ط© ط§ظ„ط²ظˆط§ظٹط§', u.radius, 'number')}</div>
    <div class="row">${fld('density', 'ط§ظ„ظƒط«ط§ظپط©', u.density, 'select', [['comfortable', 'ظ…ط±ظٹط­ط©'], ['compact', 'ظ…ط¶ط؛ظˆط·ط©']])}${fld('sidebar', 'ظ…ظƒط§ظ† ط§ظ„ظ‚ط§ط¦ظ…ط©', u.sidebar, 'select', [['right', 'ظٹظ…ظٹظ†'], ['left', 'ظٹط³ط§ط±']])}
    ${fld('font', 'ظ†ظˆط¹ ط§ظ„ط®ط·', u.font, 'select', [['system', 'ط¹ط§ط¯ظٹ'], ['serif', 'ظ†ط³ط®'], ['mono', 'ط£ط­ط§ط¯ظٹ']])}</div>
    <div class="row">${fld('calendar', 'ط§ظ„طھظ‚ظˆظٹظ…', u.calendar, 'select', [['gregorian', 'ظ…ظٹظ„ط§ط¯ظٹ'], ['hijri', 'ظ‡ط¬ط±ظٹ']])}${fld('digits', 'ط§ظ„ط£ط±ظ‚ط§ظ…', u.digits, 'select', [['latn', '123'], ['arab', 'ظ،ظ¢ظ£']])}</div>${saveBtn}</div>`;
    $('#tab').oninput = () => { S.ui = { ...S.ui, ...collect($('#tab')) }; applyUI(); };
    $('#save').onclick = guard(async () => { S.ui = await api('settings/ui', { method: 'PUT', body: collect($('#tab')) }); applyUI(); msg('طھظ… ط§ظ„ط­ظپط¸', true); });
  },
  async invoice() {
    const profile=sessionStorage.printProfile==='pos'?'pos':'accountant', key=profile==='pos'?'invoice_pos':'invoice';
    const [s,c]=await Promise.all([api('settings/'+key),api('settings/company')]);
    $('#tab').innerHTML='<div class="print-intro"><div><span class="eyebrow">ظ…ط±ظƒط² ط§ظ„ط·ط¨ط§ط¹ط©</span><h2>ظپط§طھظˆط±طھظƒطŒ ط¹ظ„ظ‰ ظ…ظ‚ط§ط³ ط¹ظ…ظ„ظƒ</h2><p>ظ‚ط§ظ„ط¨ط§ظ† ظ…ط³طھظ‚ظ„ط§ظ† ظˆط¨ظٹط§ظ†ط§طھ ظ…ظ†ط´ط£ط© ظˆط§ط­ط¯ط©. طھط¹ط¯ظٹظ„ ط£ط­ط¯ ط§ظ„ظ‚ط§ظ„ط¨ظٹظ† ظ„ط§ ظٹط؛ظٹظ‘ط± ط§ظ„ط¢ط®ط±.</p></div><div class="profile-switch"><button data-print-profile="accountant" class="'+(profile==='accountant'?'on':'')+'">â–¤ ط·ط¨ط§ط¹ط© المحاسب</button><button data-print-profile="pos" class="'+(profile==='pos'?'on':'')+'">â–£ ط¥ظٹطµط§ظ„ ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹</button></div></div><details class="card identity-panel"><summary>ط¨ظٹط§ظ†ط§طھ ط§ظ„ظ…ظ†ط´ط£ط© ظˆط´ط¹ط§ط± ط§ظ„ط¹ظ…ظٹظ„ <small>ظ…ط´طھط±ظƒط© ط¨ظٹظ† ط§ظ„ظ‚ط§ظ„ط¨ظٹظ†</small></summary><div id="company-form"></div></details><div class="split print-split"><section class="card print-controls" id="f"><div class="section-heading"><div><h3>'+ (profile==='pos'?'ظ‚ط§ظ„ط¨ ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹':'ظ‚ط§ظ„ط¨ المحاسب')+'</h3><p>ظٹط­ظپط¸ ظ‡ط°ط§ ط§ظ„ظ‚ط§ظ„ط¨ ط¨ط´ظƒظ„ ظ…ط³طھظ‚ظ„</p></div><span class="status issued">'+(profile==='pos'?'POS':'ACCOUNTING')+'</span></div><label>ظ…ظ‚ط§ط³ ط§ظ„ظˆط±ظ‚</label><div class="paper-presets"><button type="button" data-paper="A4">A4 <small>ظ…ط³طھظ†ط¯ ظƒط§ظ…ظ„</small></button><button type="button" data-paper="A5">A5 <small>ظ…ط³طھظ†ط¯ ظ…ط®طھطµط±</small></button><button type="button" data-paper="80mm">80 mm <small>ط¥ظٹطµط§ظ„ ط­ط±ط§ط±ظٹ</small></button></div>'+fld('paper','ط§ظ„ظ‚ظٹط§ط³ ط§ظ„ظ…ط®طھط§ط±',s.paper,'select',[['A4','A4 آ· 210 أ— 297 ظ…ظ…'],['A5','A5 آ· 148 أ— 210 ظ…ظ…'],['80mm','ط­ط±ط§ط±ظٹ آ· ط¹ط±ط¶ 80 ظ…ظ…']])+'<div class="row">'+fld('fontSize','ط­ط¬ظ… ط§ظ„ط®ط· (ظ†ظ‚ط·ط©)',s.fontSize,'number')+fld('accent','ظ„ظˆظ† ط§ظ„ط·ط¨ط§ط¹ط©',s.accent,'color')+'</div><h4>ظ‡ظˆط§ظ…ط´ ط§ظ„ظˆط±ظ‚ (ظ…ظ…)</h4><div class="row">'+fld('marginTop','ط£ط¹ظ„ظ‰',s.marginTop,'number')+fld('marginBottom','ط£ط³ظپظ„',s.marginBottom,'number')+'</div><div class="row">'+fld('marginRight','ظٹظ…ظٹظ†',s.marginRight,'number')+fld('marginLeft','ظٹط³ط§ط±',s.marginLeft,'number')+'</div><h4>ظ…ط³ط§ط­طھظƒ ط§ظ„ط®ط§طµط©</h4>'+fld('headerText','ط§ظ„طھط±ظˆظٹط³ط© آ· ط¹ظ†ظˆط§ظ†طŒ ط£ط±ظ‚ط§ظ… طھظˆط§طµظ„طŒ ظ…ط¹ظ„ظˆظ…ط§طھ ط¥ط¶ط§ظپظٹط©',s.headerText,'textarea')+fld('footerText','ط§ظ„طھط°ظٹظٹظ„ آ· ط±ط³ط§ظ„ط© ط§ظ„ط¹ظ…ظٹظ„ ط£ظˆ ظ…ط¹ظ„ظˆظ…ط§طھظ‡',s.footerText,'textarea')+fld('terms','ط´ط±ظˆط· ط§ظ„ط¨ظٹط¹ ط£ظˆ ط§ظ„طھط£ط¬ظٹط± ط£ظˆ طھظ†ظپظٹط° ط§ظ„ط£ط¹ظ…ط§ظ„',s.terms,'textarea')+'<details class="advanced-print"><summary>ط®ظٹط§ط±ط§طھ ط¥ط¶ط§ظپظٹط© ظ„ظ„ط´ط¹ط§ط± ظˆط§ظ„ط£ط¹ظ…ط¯ط© ظˆط§ظ„طھط¨ط§ط¹ط¯</summary><div class="row">'+fld('logoPosition','ظ…ظˆط¶ط¹ ط´ط¹ط§ط± ط§ظ„ط¹ظ…ظٹظ„',s.logoPosition,'select',[['right','ظٹظ…ظٹظ†'],['center','ظˆط³ط·'],['left','ظٹط³ط§ط±']])+fld('logoSize','ط­ط¬ظ… ط§ظ„ط´ط¹ط§ط± (ط¨ظƒط³ظ„)',s.logoSize,'number')+'</div><div class="row">'+fld('headerAlign','ظ…ط­ط§ط°ط§ط© ط§ظ„طھط±ظˆظٹط³ط©',s.headerAlign,'select',[['right','ظٹظ…ظٹظ†'],['center','ظˆط³ط·'],['left','ظٹط³ط§ط±']])+fld('lineSpacing','طھط¨ط§ط¹ط¯ ط§ظ„ط£ط³ط·ط±',s.lineSpacing,'number')+'</div><div class="row">'+fld('qrPosition','ظ…ظˆط¶ط¹ QR',s.qrPosition,'select',[['bottom-right','ط£ط³ظپظ„ ظٹظ…ظٹظ†'],['bottom-center','ط£ط³ظپظ„ ظˆط³ط·'],['bottom-left','ط£ط³ظپظ„ ظٹط³ط§ط±']])+fld('qrSize','ط­ط¬ظ… QR (ط¨ظƒط³ظ„)',s.qrSize,'number')+'</div>'+fld('cellPadding','ظ…ط³ط§ظپط© ط¯ط§ط®ظ„ ط®ظ„ط§ظٹط§ ط§ظ„ط¬ط¯ظˆظ„ (ط¨ظƒط³ظ„)',s.cellPadding,'number')+fld('showItemNo','طھط±ظ‚ظٹظ… ط§ظ„ط¨ظ†ظˆط¯',s.showItemNo,'checkbox')+fld('showUnitPrice','ط¥ط¸ظ‡ط§ط± ط³ط¹ط± ط§ظ„ظˆط­ط¯ط©',s.showUnitPrice,'checkbox')+fld('showVatCol','ط¥ط¸ظ‡ط§ط± ظ†ط³ط¨ط© ط§ظ„ط¶ط±ظٹط¨ط© ظ„ظƒظ„ ط¨ظ†ط¯',s.showVatCol,'checkbox')+fld('showPayment','ط·ط±ظٹظ‚ط© ط§ظ„ط¯ظپط¹',s.showPayment,'checkbox')+fld('showSignature','ط§ظ„طھظˆظ‚ظٹط¹ ظˆط§ظ„ط®طھظ…',s.showSignature,'checkbox')+fld('watermark','ط¹ظ„ط§ظ…ط© ظ…ط§ط¦ظٹط©',s.watermark)+'</details><div class="fixed-fields"><b>ط¨ظٹط§ظ†ط§طھ ط«ط§ط¨طھط© ط¯ط§ط¦ظ…ظ‹ط§</b><p>ظ‡ظˆظٹط© ط§ظ„ظ…ظ†ط´ط£ط© ظˆط±ظ‚ظ…ظ‡ط§ ط§ظ„ط¶ط±ظٹط¨ظٹ ظˆط§ظ„ط³ط¬ظ„ ط¹ظ†ط¯ ط¥ط¯ط®ط§ظ„ظ‡طŒ ط±ظ‚ظ… ط§ظ„ظپط§طھظˆط±ط© ظˆطھط§ط±ظٹط®ظ‡ط§طŒ ط¨ظٹط§ظ†ط§طھ ط§ظ„ط¹ظ…ظٹظ„ ط§ظ„ظ…ط³ط¬ظ„ط©طŒ ط§ظ„ط¥ط¬ظ…ط§ظ„ظٹط§طھ ظˆط§ظ„ط¶ط±ظٹط¨ط© ظˆQR.</p></div><div class="row"><button class="p" id="save">ط­ظپط¸ ظ‚ط§ظ„ط¨ '+(profile==='pos'?'ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹':'المحاسب')+'</button><button id="reset-print">ط¥ظ„ط؛ط§ط، ط§ظ„طھط؛ظٹظٹط±ط§طھ</button></div><p class="hint">ط§ط®طھط± ط§ظ„ظˆط±ظ‚ ظ†ظپط³ظ‡ ظ…ظ† ظ†ط§ظپط°ط© ط§ظ„ط·ط¨ط§ط¹ط©. ط§ظ„ط¥ظٹطµط§ظ„ ط§ظ„ط­ط±ط§ط±ظٹ ظٹطھط·ظ„ط¨ ط¶ط¨ط· ط§ظ„ط·ط§ط¨ط¹ط© ط¹ظ„ظ‰ ط¹ط±ط¶ 80 ظ…ظ…ط› ظ„ط§ ظٹط®طھط§ط± ط§ظ„ظ…طھطµظپط­ ط¬ظ‡ط§ط² ط§ظ„ط·ط§ط¨ط¹ط© طھظ„ظ‚ط§ط¦ظٹظ‹ط§.</p></section><section class="print-preview"><div class="section-heading"><h3>ظ…ط¹ط§ظٹظ†ط© ظ…ط¨ط§ط´ط±ط©</h3><span id="preview-state" class="hint">ط¬ط§ط±ظٹ ط§ظ„طھط­ظ…ظٹظ„â€¦</span></div><iframe class="pv" id="pv" title="ظ…ط¹ط§ظٹظ†ط© ظ‚ط§ظ„ط¨ ط§ظ„ط·ط¨ط§ط¹ط©" sandbox="allow-scripts"></iframe></section></div>';
    let dirty=false,timer,version=0,companyDraft={...c};const form=$('#f'),frame=$('#pv'),previewState=$('#preview-state');
    const preview=()=>{clearTimeout(timer);const current=++version;timer=setTimeout(async()=>{try {const r=await fetch('/api/invoice-preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profile,settings:collect(form),company:companyDraft})});const text=await r.text();if(current!==version||!frame.isConnected)return;if(!r.ok)throw new Error(JSON.parse(text).error||'طھط¹ط°ط± ط¹ط±ط¶ ط§ظ„ظ…ط¹ط§ظٹظ†ط©');frame.srcdoc=text;previewState.textContent='ظ…ط¹ط§ظٹظ†ط© '+(profile==='pos'?'ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹':'المحاسب');}catch(e){if(current===version){previewState.textContent=e.message;}}},180);};
    bindCompanyForm(c,data=>{companyDraft=data;preview();});
    form.oninput=()=>{dirty=true;preview();};
    $$('[data-paper]').forEach(b=>b.onclick=()=>{const paper=b.dataset.paper;const values=paper==='80mm'?{paper,fontSize:11,marginTop:3,marginBottom:3,marginLeft:3,marginRight:3,showItemNo:false,showUnitPrice:false,showVatCol:false,logoPosition:'center',logoSize:60,qrSize:100}:{paper,fontSize:13,marginTop:8,marginBottom:8,marginLeft:8,marginRight:8,showItemNo:true,showUnitPrice:true,showVatCol:true,logoPosition:'right',logoSize:90,qrSize:110};Object.entries(values).forEach(([k,v])=>{const el=$('[data-k="'+k+'"]',form);if(el.type==='checkbox')el.checked=v;else el.value=v;});dirty=true;preview();});
    const limits={fontSize:[8,24,.5],logoSize:[30,180,1],qrSize:[80,180,1],marginTop:[0,25,.5],marginBottom:[0,25,.5],marginLeft:[0,25,.5],marginRight:[0,25,.5],lineSpacing:[1,2.4,.1],cellPadding:[2,12,1]};Object.entries(limits).forEach(([k,v])=>{const el=$('[data-k="'+k+'"]',form);el.min=v[0];el.max=v[1];el.step=v[2];});
    $$('[data-print-profile]').forEach(b=>b.onclick=()=>{if(b.dataset.printProfile===profile)return;if(dirty)return msg('ط§ط­ظپط¸ ط§ظ„ظ‚ط§ظ„ط¨ ط£ظˆ ط§ط¶ط؛ط· ط¥ظ„ط؛ط§ط، ط§ظ„طھط؛ظٹظٹط±ط§طھ ظ‚ط¨ظ„ ط§ظ„ط§ظ†طھظ‚ط§ظ„ ظ„ظ„ظ‚ط§ظ„ط¨ ط§ظ„ط¢ط®ط±');sessionStorage.printProfile=b.dataset.printProfile;tabs.invoice();});
    $('#reset-print').onclick=()=>tabs.invoice();
    $('#save').onclick=guard(async()=>{await api('settings/'+key,{method:'PUT',body:collect(form)});dirty=false;msg('طھظ… ط­ظپط¸ ظ‚ط§ظ„ط¨ '+(profile==='pos'?'ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹':'المحاسب')+' ظˆط­ط¯ظ‡',true);preview();});
    preview();
  },
  async company() {
    const c=await api('settings/company');$('#tab').innerHTML='<div class="card"><h3>ط¨ظٹط§ظ†ط§طھ ظ…ظ†ط´ط£ط© ط§ظ„ط¹ظ…ظٹظ„</h3><p class="hint">ظ‡ط°ظ‡ ط§ظ„ط¨ظٹط§ظ†ط§طھ ظˆط´ط¹ط§ط± ط§ظ„ط¹ظ…ظٹظ„ طھط¸ظ‡ط± ظپظٹ ط§ظ„ظ…ط³طھظ†ط¯ط§طھ. ط´ط¹ط§ط± ط§ظ„ظ…ط­طھط±ط² ط®ط§طµ ط¨ط§ظ„طھط·ط¨ظٹظ‚.</p><div id="company-form"></div></div>';bindCompanyForm(c);
  },
  async pos() {
    const [p,scale] = await Promise.all([api('pos'),api('settings/pos_scale')]), L = S.state.license;
    $('#tab').innerHTML = `<div class="card"><p>ط§ظ„ظ…ط±ط®ظ‘طµ: <b>${L.max_pos}</b> ظ†ظ‚ط·ط© ط¨ظٹط¹. ظƒظ„ ظ†ظ‚ط·ط© ظ„ظ‡ط§ ط¨ط§ط¯ط¦ط© ظپظٹ ط±ظ‚ظ… ط§ظ„ظپط§طھظˆط±ط© ظˆطھطھط´ط§ط±ظƒ ط³ظ„ط³ظ„ط© ط§ظ„ظپط±ط¹.</p><div class="row"><label>ط§ظ„ط§ط³ظ…<input id="n"></label><label>ط§ظ„ط¨ط§ط¯ط¦ط© (A, Bâ€¦)<input id="x" maxlength="6"></label><button class="p" id="add">ط¥ط¶ط§ظپط© ظ†ظ‚ط·ط©</button></div></div>
    <div class="card"><table><tbody>${p.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.prefix)}</td><td>${r.active ? 'ظ…ظپط¹ظ‘ظ„ط©' : 'ظ…ظˆظ‚ظˆظپط©'}</td><td><a href="#" data-p="${r.id}" data-a="${r.active ? 0 : 1}">${r.active ? 'ط¥ظٹظ‚ط§ظپ' : 'طھظپط¹ظٹظ„'}</a></td></tr>`).join('')}</tbody></table></div>`;
    $('#add').onclick = guard(async () => { await api('pos', { method: 'POST', body: { name: $('#n').value, prefix: $('#x').value } }); tabs.pos(); });
    $$('[data-p]').forEach(a => a.onclick = guard(async e => { e.preventDefault(); await api('pos/' + a.dataset.p, { method: 'PUT', body: { active: a.dataset.a === '1' } }); tabs.pos(); }));
    $('#tab').insertAdjacentHTML('beforeend',`<form id="pos-scale-settings" class="card"><h3>ظ…ظ„طµظ‚ط§طھ ط§ظ„ظ…ظٹط²ط§ظ†</h3><p class="hint">طµظٹط؛ط© ظ…ظ† 13 ط±ظ‚ظ…ظ‹ط§. ط¨ط§ط¯ط¦ط© ظ…ظ† ط±ظ‚ظ…ظٹظ†طŒ ط±ظ…ط² ط§ظ„طµظ†ظپ ظ…ظ† ط®ظ…ط³ط© ط£ط±ظ‚ط§ظ…طŒ ط«ظ… ط®ظ…ط³ط© ط£ط±ظ‚ط§ظ… ظ„ظ„ظˆط²ظ† ط¨ط§ظ„ط¬ط±ط§ظ… ط£ظˆ ط³ط¹ط± ط§ظ„ط¹ط¨ظˆط© ط¨ط§ظ„ظ‡ظ„ظ„ط© ظ‚ط¨ظ„ ط§ظ„ط¶ط±ظٹط¨ط©طŒ ظˆط±ظ‚ظ… طھط­ظ‚ظ‚ ظپظٹ ط§ظ„ظ†ظ‡ط§ظٹط©.</p><div class="row"><label>ظ…ط­طھظˆظ‰ ط§ظ„ظ…ظ„طµظ‚<select name="mode"><option value="off">ظ…ط¹ط·ظ‘ظ„</option><option value="weight">ط§ظ„ظˆط²ظ† ط¨ط§ظ„ط¬ط±ط§ظ…</option><option value="price">ط§ظ„ط³ط¹ط± ظ‚ط¨ظ„ ط§ظ„ط¶ط±ظٹط¨ط©</option></select></label><label>ط¨ط§ط¯ط¦ط© ط§ظ„ظ…ظ„طµظ‚<input name="prefix" value="${esc(scale.prefix)}" pattern="2[0-9]" maxlength="2" dir="ltr" required></label><button class="p">ط­ظپط¸ ط¶ط¨ط· ط§ظ„ظ…ظٹط²ط§ظ†</button></div><p class="hint">ط£ط¯ط®ظ„ ط±ظ…ط² ط§ظ„ظ…ظٹط²ط§ظ† ظپظٹ ط¨ط·ط§ظ‚ط© ط§ظ„طµظ†ظپ ط¨ط§ظ„ظƒظٹظ„ظˆط¬ط±ط§ظ…. ظ…ظ„طµظ‚ ط§ظ„ط³ط¹ط± ظٹط¹طھظ…ط¯ ط³ط¹ط± ط§ظ„طھط¬ط²ط¦ط© ظ„ظƒظ„ ظƒظٹظ„ظˆط¬ط±ط§ظ… ظ„ط­ط³ط§ط¨ ط§ظ„ظˆط²ظ† ظˆظٹط«ط¨طھ ظ‚ظٹظ…ط© ط§ظ„ط¹ط¨ظˆط© ظ‚ط¨ظ„ ط§ظ„ط¶ط±ظٹط¨ط©.</p></form>`);
    const form=$('#pos-scale-settings');
    form.elements.mode.value=scale.mode;
    form.onsubmit=guard(async event=>{
      event.preventDefault();
      await api('settings/pos_scale',{method:'PUT',body:Object.fromEntries(new FormData(form))});
      msg('طھظ… ط­ظپط¸ ط¶ط¨ط· ط§ظ„ظ…ظٹط²ط§ظ†',true);
    });
  },
  async users() {
    const [users,points]=await Promise.all([api('users'),api('pos')]);const options=points.filter(p=>p.active).map(p=>'<option value="'+p.id+'">'+esc(p.name)+'</option>').join('');
    $('#tab').innerHTML='<div class="card"><h3>ط§ظ„ظ…ط³طھط®ط¯ظ…ظˆظ† ظˆطµظ„ط§ط­ظٹط§طھ ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹</h3><div class="row"><label>ط§ط³ظ… ط§ظ„ظ…ط³طھط®ط¯ظ…<input id="n"></label><label>ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط± (8+)<input id="p" type="password" autocomplete="new-password"></label><label>ط§ظ„ط¯ظˆط±<select id="r"><option value="staff">ط¹ط§ظ…ظ„ ظ†ظ‚ط·ط© ط¨ظٹط¹ ظپظ‚ط·</option><option value="accountant">ظ…ط­ط§ط³ط¨</option><option value="owner">ظ…ط§ظ„ظƒ</option></select></label><label>ظ†ظ‚ط·ط© ط¨ظٹط¹ ط§ظ„ط¹ط§ظ…ظ„<select id="user-pos">'+options+'</select></label><button class="p" id="add">ط¥ط¶ط§ظپط© ط§ظ„ظ…ط³طھط®ط¯ظ…</button></div><p class="hint">ط¹ط§ظ…ظ„ ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹ ظ„ط§ ظٹط¯ط®ظ„ المحاسبط© ط£ظˆ ط§ظ„ط¥ط¹ط¯ط§ط¯ط§طھ ط£ظˆ ط¥ط¯ط§ط±ط© ط§ظ„ط£طµظ†ط§ظپ. ظٹظڈطµط¯ط± ظ…ط¨ظٹط¹ط§طھ ط§ظ„ط£طµظ†ط§ظپ ط¨ط§ظ„ط£ط³ط¹ط§ط± ط§ظ„ظ…ط³ط¬ظ„ط© ظˆظٹط·ط¨ط¹ ظ…ط¨ظٹط¹ط§طھظ‡ ظپظ‚ط·.</p></div><div class="card"><table><thead><tr><th>ط§ظ„ظ…ط³طھط®ط¯ظ…</th><th>ط§ظ„ط¯ظˆط±</th><th>ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹ ط§ظ„ظ…ط³ظ…ظˆط­ط©</th></tr></thead><tbody>'+users.map(u=>'<tr><td>'+esc(u.username)+'</td><td>'+({owner:'ظ…ط§ظ„ظƒ',accountant:'ظ…ط­ط§ط³ط¨',staff:'ط¹ط§ظ…ظ„ ظ†ظ‚ط·ط© ط¨ظٹط¹'}[u.role])+'</td><td>'+(u.role==='staff'?'<select data-user-point="'+u.id+'">'+points.filter(p=>p.active).map(p=>'<option value="'+p.id+'" '+(u.pos_ids.includes(p.id)?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select><button data-save-access="'+u.id+'">ط­ظپط¸ ط§ظ„طµظ„ط§ط­ظٹط©</button>':'â€”')+'</td></tr>').join('')+'</tbody></table></div>';
    $('#add').onclick=guard(async()=>{await api('users',{method:'POST',body:{username:$('#n').value,password:$('#p').value,role:$('#r').value,pos_id:Number($('#user-pos').value)}});await tabs.users();msg('طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ظ…ط³طھط®ط¯ظ… ظˆطµظ„ط§ط­ظٹط§طھظ‡',true);});
    $$('[data-save-access]').forEach(button=>button.onclick=guard(async()=>{await api('users/'+button.dataset.saveAccess+'/pos-access',{method:'PUT',body:{pos_ids:[Number($('[data-user-point="'+button.dataset.saveAccess+'"]').value)]}});msg('طھظ… طھط­ط¯ظٹط« ظ†ظ‚ط·ط© ط§ظ„ط¨ظٹط¹ ط§ظ„ظ…ط³ظ…ظˆط­ط©',true);}));
    const workers=users.filter(user=>user.role==='staff');
    if(workers.length)$('#tab').insertAdjacentHTML('beforeend',`<div class="card"><h3>ط§ظ„ط£ط³ط¹ط§ط± ظˆط§ظ„ط®طµظ… ظ„ظ„ط¹ط§ظ…ظ„</h3><p class="hint">ط§ظ„طھط¹ط¯ظٹظ„ ط§ظ„ظٹط¯ظˆظٹ ظ„ظ„ط³ط¹ط± ظ…طھط§ط­ ظ„ظ„ظ…ط§ظ„ظƒ ظˆالمحاسب ط¯ط§ط¦ظ…ظ‹ط§. ظٹظ…ظƒظ† طھظپظˆظٹط¶ ط¹ط§ظ…ظ„ ظ†ظ‚ط·ط© ط¨ظٹط¹ ط¨ط¥ط¯ط®ط§ظ„ ط³ط¹ط± ظٹط¯ظˆظٹ ظ„ظ„ط®ط¯ظ…ط§طھ ظپظ‚ط· ط¶ظ…ظ† ط³ظ‚ظپ ظ…ط­ط¯ط¯.</p>${workers.map(user=>`<div class="row" data-pos-pricing="${user.id}"><b>${esc(user.username)}</b><label>ط­ط¯ ط®طµظ… ط§ظ„ط¨ظ†ط¯ %<input data-limit type="number" min="0" max="100" step="0.01" required value="${user.pos_discount_limit/100}"></label><label><input data-wholesale type="checkbox" ${user.pos_wholesale?'checked':''}> ط§ظ„ط³ظ…ط§ط­ ط¨ط³ط¹ط± ط§ظ„ط¬ظ…ظ„ط©</label><label><input data-manual type="checkbox" ${user.pos_manual_price?'checked':''}> طھظپظˆظٹط¶ ط³ط¹ط± ظٹط¯ظˆظٹ ظ„ظ„ط®ط¯ظ…ط§طھ</label><label>ط³ظ‚ظپ ط§ظ„ط³ط¹ط± ط§ظ„ظٹط¯ظˆظٹ<input data-cap type="number" min="0" step="0.01" value="${(user.pos_manual_price_cap||0)/100}" ${user.pos_manual_price?'':'disabled'}></label><button data-save-pricing>ط­ظپط¸ طµظ„ط§ط­ظٹط§طھ ط§ظ„ط³ط¹ط±</button></div>`).join('')}</div>`);
    $$('[data-pos-pricing]').forEach(row=>{
      const manual=$('[data-manual]',row),cap=$('[data-cap]',row);
      manual.onchange=()=>{cap.disabled=!manual.checked;if(!manual.checked)cap.value='0';};
      $('[data-save-pricing]',row).onclick=guard(async()=>{
        const limit=$('[data-limit]',row);
        if(!limit.reportValidity()||!cap.reportValidity())return;
        await api('users/'+row.dataset.posPricing+'/pos-pricing',{method:'PUT',body:{discount_limit:limit.value,wholesale:$('[data-wholesale]',row).checked,manual_price:manual.checked,manual_price_cap:cap.value||'0'}});
        msg('طھظ… ط­ظپط¸ طµظ„ط§ط­ظٹط§طھ ط§ظ„ط³ط¹ط± ظˆط§ظ„ط®طµظ…',true);
      });
    });
  },
  async sys() {
    const L = (await api('state')).license;
    $('#tab').innerHTML = `<div class="card"><h3>ط§ظ„طھط±ط®ظٹطµ</h3><p>ط§ظ„ط­ط§ظ„ط©: <b>${L.status}</b> آ· ط§ظ„ط¹ظ…ظٹظ„: ${esc(L.customer)} آ· ظ†ظ‚ط§ط· ط§ظ„ط¨ظٹط¹: ${L.max_pos} آ· ط§ظ„ظ…ط³طھط®ط¯ظ…ظˆظ†: ${L.max_users} آ· ظٹظ†طھظ‡ظٹ: ${esc(L.expires || 'â€”')}</p>
    <label>ط§ظ„طµظ‚ ظ…ظ„ظپ ط§ظ„طھط±ط®ظٹطµ (JSON)<textarea id="lic" rows="4"></textarea></label><button id="al">طھظپط¹ظٹظ„ ط§ظ„طھط±ط®ظٹطµ</button></div>
    <div class="card"><h3>ط§ظ„ظ†ط³ط® ط§ظ„ط§ط­طھظٹط§ط·ظٹ</h3><p>ظ†ط²ظ‘ظ„ ظ†ط³ط®ط© ظƒط§ظ…ظ„ط© ظ…ظ† ط§ظ„ط¨ظٹط§ظ†ط§طھ ظˆط§ط­ظپط¸ظ‡ط§ ط®ط§ط±ط¬ ظ‡ط°ط§ ط§ظ„ط¬ظ‡ط§ط² ط¨ط§ظ†طھط¸ط§ظ….</p><a href="/api/backup"><button class="p">طھظ†ط²ظٹظ„ ظ†ط³ط®ط© ط§ط­طھظٹط§ط·ظٹط©</button></a></div>`;
    $('#al').onclick = guard(async () => { await api('license', { method: 'POST', body: JSON.parse($('#lic').value) }); location.reload(); });
  }
};

// ---------- ط¥ط´ط¹ط§ط± ط¯ط§ط¦ظ† ----------
async function debitDialog(id){const d=$('#dlg');d.innerHTML='<h3>ط¥ط´ط¹ط§ط± ظ…ط¯ظٹظ† آ· ط²ظٹط§ط¯ط© ط¹ظ„ظ‰ ط§ظ„ظپط§طھظˆط±ط© ط§ظ„ط£طµظ„ظٹط©</h3><p class="hint">ظ„ط®ط¯ظ…ط© ط¥ط¶ط§ظپظٹط© ط®ط§ط¶ط¹ط© ظ„ظ„ظ†ط³ط¨ط© ط§ظ„ط£ط³ط§ط³ظٹط© 15%. ط§ظ„طھطµط­ظٹط­ ط¨ط§ظ„ظ†ظ‚طµ ظٹطھظ… ط¨ط¥ط´ط¹ط§ط± ط¯ط§ط¦ظ†.</p><label>ظˆطµظپ ط§ظ„ط®ط¯ظ…ط©<input id="debit-description"></label><label>ط§ظ„ظ‚ظٹظ…ط© ظ‚ط¨ظ„ ط§ظ„ط¶ط±ظٹط¨ط©<input id="debit-value" type="number" min="0.01" step="0.01"></label><label>ط§ظ„ط³ط¨ط¨<input id="debit-reason"></label><div id="debit-error" class="msg" hidden></div><div class="row"><button class="p" id="debit-confirm">ط¥طµط¯ط§ط± طھط¬ط±ظٹط¨ظٹ</button><button id="debit-cancel">ط¥ظ„ط؛ط§ط،</button></div>';d.showModal();$('#debit-cancel').onclick=()=>d.close();$('#debit-confirm').onclick=async()=>{try{const response=await api('invoices/'+id+'/debit-note',{method:'POST',body:{reason:$('#debit-reason').value,lines:[{description:$('#debit-description').value,qty:1,unit_price:$('#debit-value').value,vat_rate:15}]}});d.close();window.open('/api/invoices/'+response.id+'/html','_blank');pages.invoices();}catch(e){$('#debit-error').textContent=e.message;$('#debit-error').hidden=false;}};}

async function creditDialog(id) {
  const inv = await api('invoices/' + id), d = $('#dlg');
  d.innerHTML = `<h3>ط¥ط´ط¹ط§ط± ط¯ط§ط¦ظ† ظ„ظ„ظپط§طھظˆط±ط© ${esc(inv.number)}</h3><table><thead><tr><th>ط§ظ„ط¨ظ†ط¯</th><th>ط§ظ„ظ…طھط¨ظ‚ظٹ</th><th>ط§ظ„ظƒظ…ظٹط© ط§ظ„ظ…ط±ط¬ط¹ط©</th></tr></thead><tbody>
  ${inv.lines.map(l => `<tr><td>${esc(l.description)}</td><td>${l.remaining}</td><td><input type="number" min="0" max="${l.remaining}" step="any" value="0" data-l="${l.line_no}" style="width:90px"></td></tr>`).join('')}</tbody></table>
  <label>ط³ط¨ط¨ ط§ظ„ط¥ط´ط¹ط§ط±<input id="rs"></label><div id="dm" class="msg" hidden></div><div class="row"><button class="p" id="ok">ط¥طµط¯ط§ط±</button><button id="x">ط¥ظ„ط؛ط§ط،</button></div>`;
  d.showModal(); $('#x', d).onclick = () => d.close();
  const {attachReturnTracking}=await import('./tracking-editor.js');
  for(const input of $$('[data-l]',d)){const line=inv.lines.find(l=>l.line_no===Number(input.dataset.l));attachReturnTracking({api,esc,line,input,incoming:true,onError:error=>{const out=$('#dm',d);out.textContent=error.message;out.hidden=false;}});}
  $('#ok', d).onclick = async () => { try { const lines = $$('[data-l]', d).filter(i => +i.value > 0).map(i => ({ line_no: +i.dataset.l, qty: +i.value, tracking:JSON.parse(i.dataset.tracking||'[]') }));
    if (!lines.length) throw new Error('ط­ط¯ط¯ ظƒظ…ظٹط© ظˆط§ط­ط¯ط© ط¹ظ„ظ‰ ط§ظ„ط£ظ‚ظ„ ظ„ظ„ط¥ط±ط¬ط§ط¹');
    const r = await api(`invoices/${id}/credit-note`, { method: 'POST', body: { lines, reason: $('#rs', d).value } }); d.close(); window.open(`/api/invoices/${r.id}/html`, '_blank'); pages.invoices();
  } catch (e) { const m = $('#dm', d); m.textContent = e.message; m.hidden = false; } };
}


async function reviewInvoice(total, count) {
  const d = $('#dlg');
  d.innerHTML = '<span class="eyebrow">ط§ظ„ط®ط·ظˆط© ط§ظ„ط£ط®ظٹط±ط©</span><h3>ط±ط§ط¬ط¹ ط§ظ„ظپط§طھظˆط±ط© ظ‚ط¨ظ„ ط¥طµط¯ط§ط±ظ‡ط§</h3><p class="hint">'+count+' ط¨ظ†ظˆط¯. ط¨ط¹ط¯ ط§ظ„ط¥طµط¯ط§ط± طھظڈط­ظپط¸ ط§ظ„ظپط§طھظˆط±ط© ظˆظٹطµط¨ط­ ط§ظ„طھطµط­ظٹط­ ط¨ط¥ط´ط¹ط§ط± ط¯ط§ط¦ظ†.</p><div class="review-total">'+esc(total)+'</div><div class="row"><button class="p" id="confirm-issue">طھط£ظƒظٹط¯ ظˆط¥طµط¯ط§ط± ط§ظ„ظپط§طھظˆط±ط©</button><button id="back-to-edit">ط§ظ„ط¹ظˆط¯ط© ظ„ظ„طھط¹ط¯ظٹظ„</button></div>';
  return new Promise(resolve => { let done=false; const finish=v=>{if(done)return;done=true;d.close();resolve(v);}; $('#confirm-issue',d).onclick=()=>finish(true); $('#back-to-edit',d).onclick=()=>finish(false);d.oncancel=()=>finish(false); d.onclose=()=>{if(!done){done=true;resolve(false);}}; d.showModal(); });
}

// ---------- ط§ظ„طھط´ط؛ظٹظ„ ----------
async function route() {
 if(S.state.mode==='cloud' && S.state.user){const cloud=await import('./cloud-workspace.js');return cloud.renderCloudWorkspace(S.state,api);}
 if(S.state?.user?.role==='staff'){workspace='trade';S.activitySelected=true;if(location.hash!=='#pos')history.replaceState(null,'','#pos');}
 if (!S.introComplete && sessionStorage.almuhtarizOpened !== '1') return openingScreen();
 if (!S.activitySelected) return activityScreen();
 if (!S.state.user) return authScreen();
 const role = S.state.user.role;
 const fallback = role === 'staff' ? 'pos' : 'dashboard';
 const requested = location.hash.slice(1);
 const page = canOpenLocalPage(role, requested) ? requested : fallback;
 if (requested && requested !== page) history.replaceState(null, '', '#' + page);
 try {
   await pages[page]();
 } catch (error) {
   shell(`<div class="msg">${esc(error.message)}</div>`);
 }
}
(async () => {
  S.state = await api('state');
  if (visibleWorkspace(S.state.activity)) workspace=S.state.activity;
  if (sessionStorage.skipActivityOnce==='1') { S.activitySelected=true; delete sessionStorage.skipActivityOnce; }
  if (S.state.user && S.state.mode!=='cloud') { S.ui = await api('preferences/ui'); applyUI(); }
  addEventListener('hashchange', route); route();
})().catch(e => {
  $('#app').innerHTML = `<main class="auth"><h1>المحترز للمحاسبة وإدارة الأعمال</h1><div class="msg" role="alert">${esc(e.message)}</div><button id="retry-start">ط¥ط¹ط§ط¯ط© ط§ظ„ظ…ط­ط§ظˆظ„ط©</button></main>`;
  $('#retry-start').onclick = () => location.reload();
});

