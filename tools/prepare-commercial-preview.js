// Explicit local QA fixture. Never use against a customer database or public host.
const base='http://127.0.0.1:3019';
const state=await(await fetch(base+'/api/state')).json();
if(!state.setup_needed)throw Error('Preview already initialized; do not change an existing workspace');
async function call(path,body,cookie){const response=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});if(!response.ok)throw Error(await response.text());return response;}
await call('setup',{username:'qa-only',password:'Local-QA-2026!only',company_name:'متجر اختبار الشاشات فقط',activity:'trade'});
const login=await call('login',{username:'qa-only',password:'Local-QA-2026!only'}),cookie=login.headers.get('set-cookie').split(';')[0];
await call('parties',{name_ar:'مورد اختبار',kind:'supplier',entity_type:'business'},cookie);
await call('parties',{name_ar:'عميل اختبار',kind:'customer',entity_type:'individual'},cookie);
await call('items',{name_ar:'مياه 500 مل',barcode:'QA0001',unit_price:2,track_stock:true,base_unit:'عبوة',opening_qty:24,opening_unit_cost:1,units:[{name:'كرتون',factor:12,unit_price:20,barcode:'QA0002'}]},cookie);
console.log('Isolated commercial preview prepared. No cloud configuration or real company data used.');
