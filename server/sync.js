import {tx} from './db.js';import {getSetting,nextCounter} from './core.js';import {stockValuation} from './valuation.js';import {listItems} from './items.js';
const ENDPOINT='https://almuhtariz-accounting.zyz12311.workers.dev/api/sync/snapshot';
const running=new WeakMap();
export function syncInfo(db){const row=db.prepare('SELECT enabled,last_sequence,last_synced_at,last_error FROM sync_connection WHERE id=1').get();return{installation_id:db.prepare('SELECT id FROM installation LIMIT 1').get().id,configured:Boolean(row),enabled:Boolean(row?.enabled),last_sequence:row?.last_sequence||0,last_synced_at:row?.last_synced_at||null,last_error:row?.last_error||null,direction:'branch_to_cloud',fiscal_event_processing:false};}
export function configureSync(db,body){
 const installation=db.prepare('SELECT id FROM installation LIMIT 1').get().id;
 const token=String(body.device_token||'').trim();
 if(token&&!new RegExp('^'+installation.replace(/[-]/g,'\\-')+'\\.[A-Za-z0-9_-]{43}$').test(token))throw Error('رمز الجهاز لا يخص هذه النسخة أو تنسيقه غير صالح');
 if(!token&&!db.prepare('SELECT 1 FROM sync_connection WHERE id=1').get())throw Error('أدخل رمز ربط الجهاز');
 if(token)db.prepare('INSERT INTO sync_connection(id,device_token,enabled) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET device_token=excluded.device_token,enabled=excluded.enabled,last_error=NULL').run(token,body.enabled?1:0);
 else db.prepare('UPDATE sync_connection SET enabled=? WHERE id=1').run(body.enabled?1:0);
 return syncInfo(db);
}
export function branchSnapshot(db){return tx(db,()=>({
 version:1,installation_id:db.prepare('SELECT id FROM installation LIMIT 1').get().id,captured_at:new Date().toISOString(),
 company:getSetting(db,'company'),
 tables:{
  items:listItems(db),warehouses:db.prepare('SELECT id,name,active FROM warehouses').all(),valuation:stockValuation(db),
  parties:db.prepare('SELECT id,name_ar,kind,vat_number,phone,address FROM parties').all(),
  invoices:db.prepare('SELECT id,uuid,number,type,document_code,invoice_kind,status,party_id,payment,issue_date,subtotal,vat,total,pos_id,branch_id,created_by FROM invoices ORDER BY id').all(),
  purchases:db.prepare('SELECT id,uuid,number,kind,supplier_id,supplier_reference,document_date,warehouse_id,payment,subtotal,vat,total,ref_purchase_id FROM purchases ORDER BY id').all(),
  vouchers:db.prepare('SELECT id,number,kind,party_id,voucher_date,amount,cash_account,notes FROM cash_vouchers ORDER BY id').all(),
  accounts:db.prepare('SELECT code,name_ar,type,postable FROM accounts ORDER BY code').all(),
  journal_entries:db.prepare('SELECT id,entry_no,entry_date,description,source_type,source_id,branch_id FROM journal_entries ORDER BY id').all(),
  journal_lines:db.prepare('SELECT id,entry_id,account_code,debit,credit FROM journal_lines ORDER BY id').all(),
  stock_movements:db.prepare('SELECT id,item_id,warehouse_id,delta_micro,kind,invoice_id,purchase_id,reason,created_at FROM stock_movements ORDER BY id').all(),
  shifts:db.prepare('SELECT id,pos_id,user_id,opening_cash,opened_at,closed_at,counted_cash,expected_cash,variance FROM pos_shifts ORDER BY id').all()
 }
}));}
export function syncBranch(db){
 if(running.has(db))return running.get(db);
 const task=(async()=>{
  const connection=db.prepare('SELECT * FROM sync_connection WHERE id=1').get();if(!connection||!connection.enabled)throw Error('المزامنة غير مفعلة');
  const capture=tx(db,()=>({sequence:nextCounter(db,'cloud_snapshot'),snapshot:branchSnapshot(db)}));
  const data=JSON.stringify(capture);if(Buffer.byteLength(data)>4500000)throw Error('البيانات تجاوزت حد نقل النسخة الحالية؛ لم يُرفع جزء ناقص. يلزم النقل المجزأ');
  let response,result;
  try{response=await fetch(ENDPOINT,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+connection.device_token},body:data,redirect:'manual',signal:AbortSignal.timeout(25000)});result=await response.json();if(!response.ok||result.accepted!==true||result.sequence!==capture.sequence)throw Error('لم تؤكد السحابة حفظ اللقطة؛ راجع رمز الربط وحالة الخدمة');
   tx(db,()=>db.prepare('UPDATE sync_connection SET last_sequence=?,last_synced_at=?,last_error=NULL WHERE id=1').run(capture.sequence,new Date().toISOString()));return syncInfo(db);
  }catch(error){db.prepare('UPDATE sync_connection SET last_error=? WHERE id=1').run(error.name==='TimeoutError'?'انتهت مهلة الاتصال؛ ستُعاد المحاولة':error.message.includes('تؤكد')?error.message:'تعذر الاتصال بالسحابة؛ البيانات باقية على الفرع');throw Error(syncInfo(db).last_error);}
 })();running.set(db,task);task.finally(()=>running.delete(db)).catch(()=>{});return task;
}
