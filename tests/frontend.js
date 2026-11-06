import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const withoutBoot=source.slice(0,source.lastIndexOf('(async () => {'));
function environment(reduced=false, initial={}) {
 const storage=new Map(Object.entries(initial));
 const session={almuhtarizOpened:'1'};const location={hash:''};
 const doc={nodes:[]};
 class Element {
  constructor(tag,attrs={}) {this.tagName=tag;this.attrs=attrs;this.dataset={};this.textContent='';this.type=attrs.type||'';this.value='';this.disabled=false;for(const [key,v] of Object.entries(attrs))if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=v;}
  setAttribute(key,value){this.attrs[key]=String(value);}
  getAttribute(key){return this.attrs[key]??null;}
  set innerHTML(value){this.markup=value;if(this.attrs.id!=='app')return;doc.nodes=[];for(const match of value.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*?)>/gi)){const attrs={};for(const attr of match[2].matchAll(/([a-z_:][-a-z0-9_:]*)(?:="([^"]*)")?/gi))attrs[attr[1]]=attr[2]??'';doc.nodes.push(new Element(match[1],attrs));}}
  get innerHTML(){return this.markup||'';}
 }
 const app=new Element('div',{id:'app'});
 const matches=(node,selector)=>{selector=selector.split(' ').at(-1);return selector.startsWith('#')?node.attrs.id===selector.slice(1):selector.startsWith('.')?(node.attrs.class||'').split(' ').includes(selector.slice(1)):selector.startsWith('[')?Object.hasOwn(node.attrs,selector.slice(1,-1)):node.tagName===selector;};
 doc.querySelector=selector=>selector==='#app'?app:doc.nodes.find(n=>matches(n,selector))||null;
 doc.querySelectorAll=selector=>doc.nodes.filter(n=>matches(n,selector));
 doc.documentElement={dataset:{},style:{setProperty(){}}};
 const context=vm.createContext({document:doc,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))},sessionStorage:session,location,history:{replaceState:(_a,_b,url)=>{location.hash=url}},matchMedia:()=>({matches:reduced}),console,setTimeout,clearTimeout,fetch:async()=>({ok:false,text:async()=>JSON.stringify({error:'بيانات الدخول غير صحيحة'})})});
 vm.runInContext(withoutBoot+';globalThis.hooks={S,route,activityScreen,pages,shell};',context);
 context.hooks.S.state={setup_needed:true,user:null,activity:'engineering'};
 return {doc,app,storage,session,location,hooks:context.hooks};
}
for(const activity of ['trade','events','engineering']) {
 const env=environment();await env.hooks.route();
 const cards=env.doc.querySelectorAll('[data-activity]');assert.equal(cards.length,3);
 assert.ok(env.app.innerHTML.includes('saas-entry'));assert.ok(!env.doc.querySelector('#go'));
 assert.equal(env.doc.querySelector('.saas-entry').dataset.motion,'on');
 const toggle=env.doc.querySelector('#entry-motion');toggle.onclick();
 assert.equal(env.doc.querySelector('.saas-entry').dataset.motion,'off');
 assert.equal(toggle.getAttribute('aria-pressed'),'false');
 assert.equal(env.storage.get('almuhtariz.motion'),'off');
 cards.find(card=>card.dataset.activity===activity).onclick();
 assert.equal(env.storage.get('smartz.workspace'),activity);
 assert.equal(env.hooks.S.activitySelected,true);
 assert.ok(env.doc.querySelector('#go'),'Selection must reach the login/setup form');
}
const reduced=environment(true);await reduced.hooks.route();assert.equal(reduced.doc.querySelector('.saas-entry').dataset.motion,'off');
const saved=environment(false,{'almuhtariz.motion':'off'});await saved.hooks.route();assert.equal(saved.doc.querySelector('.saas-entry').dataset.motion,'off');
assert.ok(!/https?:|@import|url\(/.test(fs.readFileSync(new URL('../web/start-screen.css',import.meta.url),'utf8')),'Background must have no external asset dependencies');
const login=environment();login.hooks.S.state.setup_needed=false;login.hooks.S.activitySelected=true;await login.hooks.route();
assert.ok(login.app.innerHTML.includes('المحترز للمحاسبة')&&login.app.innerHTML.includes('وإدارة الأعمال'));
const password=login.doc.querySelector('#p');assert.equal(password.type,'password');
login.doc.querySelector('#toggle-password').onclick();assert.equal(password.type,'text');
login.doc.querySelector('#toggle-password').onclick();assert.equal(password.type,'password');
login.doc.querySelector('#u').value='test';password.value='invalid';
await login.doc.querySelector('#login-form').onsubmit({preventDefault(){}});
assert.equal(login.doc.querySelector('#go').disabled,false);
assert.equal(login.doc.querySelector('#msg').textContent,'بيانات الدخول غير صحيحة');
login.doc.querySelector('#back-activities').onclick({preventDefault(){}});
assert.equal(login.doc.querySelectorAll('[data-activity]').length,3);
const opening=environment();delete opening.session.almuhtarizOpened;await opening.hooks.route();
assert.ok(opening.doc.querySelector('#skip-opening'),'Opening must be skippable');
opening.doc.querySelector('#skip-opening').onclick();
assert.equal(opening.session.almuhtarizOpened,'1');assert.equal(opening.doc.querySelectorAll('[data-activity]').length,3);
await opening.hooks.route();assert.equal(opening.doc.querySelector('#skip-opening'),null);
const quiet=environment(true);delete quiet.session.almuhtarizOpened;await quiet.hooks.route();assert.equal(quiet.doc.querySelector('#skip-opening'),null);assert.equal(quiet.doc.querySelectorAll('[data-activity]').length,3);
const cashier=environment();cashier.hooks.S.state.user={id:2,username:'عامل',role:'staff'};cashier.hooks.S.activitySelected=true;let opened=0;
cashier.hooks.pages.pos=async()=>{opened++;cashier.hooks.shell('<h1>نقطة البيع</h1>');};
for(const hash of ['#settings','#reports','#items','#dashboard']){cashier.location.hash=hash;await cashier.hooks.route();assert.equal(cashier.location.hash,'#pos');}
assert.equal(opened,4);assert.ok(!cashier.app.innerHTML.includes('href="#settings"'));assert.ok(!cashier.app.innerHTML.includes('href="#reports"'));assert.ok(!cashier.app.innerHTML.includes('href="#items"'));assert.equal(cashier.doc.querySelector('#workspace').hidden,true);
console.log('نجحت اختبارات اختيار الأنشطة الثلاثة وحفظ التفضيل وتعطيل الحركة وتفضيل تقليل الحركة');
