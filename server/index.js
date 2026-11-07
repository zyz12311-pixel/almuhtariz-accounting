import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPass, checkPass, toCents, fromCents, nowRiyadh } from './lib.js';
import { getSetting, setSetting, seedCompany, createInvoice, createCreditNote, createDebitNote, issueInvoice, getInvoice, trialBalance, vatReport } from './core.js';
import { evaluate, verifyLicenseFile, PUB } from './license.js';
import { renderInvoice, sampleInvoice } from './render.js';
import { DEFAULTS } from './defaults.js';
import { profileKey, validatePrintSettings, validateCompany } from './printing.js';
import { tx } from './db.js';
import { validateIdentity } from './compliance.js';
import { calculateLines } from './money.js';
import { appendAudit } from './audit.js';
import {maintenance} from './maintenance.js';
import { createPosSale } from './pos.js';
import {listItems,saveItem,posCatalog} from './items.js';
import {recordStock} from './inventory.js';
import {createPurchase,listPurchases,purchaseDetails,createVoucher,partyLedger,postManualJournal,validDate,financialReport} from './commercial.js';
import {stockValuation} from './valuation.js';
import {openShift,closeShift,shiftSummary,posReturn,createStocktake,approveStocktake} from './operations.js';
import {syncInfo,configureSync,syncBranch} from './sync.js';
import {createQuotation,quotation,convertQuotation,cancelQuotation} from './quotations.js';
import {commercialPrint} from './commercial-print.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(here, '..', 'web');
class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
class Raw { constructor(body, type = 'text/html; charset=utf-8', headers = {}) { Object.assign(this, { body, type, headers }); } }
class FileRaw {constructor(download,headers){Object.assign(this,{download,headers});}}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function createApp({ dbFile, licensePath }) {
  const db = openDb(dbFile), fails = new Map(), routes = [], jobs=maintenance(dbFile);
  const lic = () => evaluate(licensePath, getSetting(db, 'company').vat_number);
  const route = (m, p, fn, o = {}) => routes.push({ m, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, ...o });
  const need = (c, m) => { if (!c) throw new HttpError(400, m); };
  const isSetup = () => !!db.prepare('SELECT 1 FROM users').get();

  const syncStatus = () => ({ mode: 'local', cloud_configured:syncInfo(db).configured, ...syncInfo(db), pending: db.prepare('SELECT COUNT(*) n FROM sync_outbox o LEFT JOIN sync_receipts r ON r.event_id=o.event_id WHERE r.event_id IS NULL').get().n });
  route('GET', '/api/sync/status', () => syncStatus());
  route('GET','/api/sync/config',()=>syncInfo(db),{owner:true});
  route('PUT','/api/sync/config',({body})=>configureSync(db,body),{owner:true});
  route('POST','/api/sync/run',()=>syncBranch(db),{owner:true,external:true});

  // ---------- المصادقة ----------
  route('GET', '/api/state', ({ user }) => ({ setup_needed: !isSetup(), user, license: lic(), today: nowRiyadh().date, sync: user && user.role!=='staff' ? syncStatus() : null, activity: user ? (user.role==='staff'?'trade':getSetting(db, 'company').activity) : '', installation_id: user ? db.prepare('SELECT id FROM installation LIMIT 1').get().id : null }), { open: true, cashier: true });
  route('POST', '/api/setup', ({ body }) => {
    if (isSetup()) throw new HttpError(403, 'تم الإعداد مسبقًا');
    need(body.username && String(body.password || '').length >= 8, 'اسم المستخدم مطلوب وكلمة المرور 8 أحرف على الأقل');
    need(body.company_name, 'اسم المنشأة مطلوب');
    const activity = validateCompany({activity:body.activity || ''}).activity;
    db.prepare("INSERT INTO users(username,pass,role) VALUES(?,?,'owner')").run(body.username, hashPass(body.password));
    seedCompany(db, body.company_name);
    if (activity) setSetting(db,'company',{...getSetting(db,'company'),activity});
    return { ok: true };
  }, { open: true });
  route('POST', '/api/login', ({ body, ip }) => {
    const f = fails.get(ip) || { n: 0, t: Date.now() };
    if (f.n >= 5 && Date.now() - f.t < 600000) throw new HttpError(429, 'محاولات كثيرة، حاول بعد 10 دقائق');
    const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(body.username || ''));
    if (!u || !checkPass(String(body.password || ''), u.pass)) { fails.set(ip, { n: f.n + 1, t: Date.now() }); throw new HttpError(401, 'بيانات الدخول غير صحيحة'); }
    fails.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(token, u.id, new Date().toISOString());
    return new Raw(JSON.stringify({ ok: true }), 'application/json', { 'Set-Cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000` });
  }, { open: true, cashier: true });
  route('POST', '/api/logout', ({ token }) => { db.prepare('DELETE FROM sessions WHERE token=?').run(token); return { ok: true }; }, { cashier: true });
  route('GET','/api/preferences/ui',()=>getSetting(db,'ui'),{cashier:true});

  // ---------- الإعدادات ----------
  route('GET', '/api/settings/:g', ({ params }) => { need(DEFAULTS[params.g], 'مجموعة غير معروفة'); return getSetting(db, params.g); });
  route('PUT', '/api/settings/:g', ({ params, body }) => {
    need(DEFAULTS[params.g], 'مجموعة غير معروفة');
    if (params.g === 'invoice' && String(body.logo || '').length > 600000) throw new HttpError(400, 'الشعار كبير جدًا (الحد 400 كيلوبايت تقريبًا)');
    if (params.g === 'invoice' && body.logo && !/^data:image\/(png|jpeg|svg\+xml|webp);base64,/.test(body.logo)) throw new HttpError(400, 'صيغة الشعار غير مدعومة');
    if (params.g === 'company' && body.vat_number && !/^3\d{13}3$/.test(body.vat_number)) throw new HttpError(400, 'الرقم الضريبي يجب أن يكون 15 رقمًا يبدأ وينتهي بـ 3');
    if(params.g==='compliance'&&body.mode!=='development')throw new HttpError(409,'لا يمكن تفعيل المحاكاة أو الإنتاج قبل اكتمال تهيئة الجهاز والتوقيع واختبارات SDK');
    if (params.g === 'company') {
      const old=getSetting(db,'company');if(Object.hasOwn(body,'vat_number')&&old.vat_number!==body.vat_number&&db.prepare("SELECT 1 FROM invoices WHERE status='issued' LIMIT 1").get())throw new HttpError(409,'لا يمكن تغيير هوية المنشأة الضريبية بعد إصدار المستندات');
      setSetting(db, 'company', { ...getSetting(db,'company'), ...validateCompany(body) });
    } else if (params.g === 'invoice' || params.g === 'invoice_pos') {
      const settings = validatePrintSettings(body, getSetting(db, params.g));
      tx(db, () => {
        setSetting(db, params.g, settings);
        if (Object.hasOwn(body,'logo')) setSetting(db,'company',{...getSetting(db,'company'),...validateCompany({logo:body.logo})});
      });
    } else setSetting(db, params.g, body);
    return getSetting(db, params.g);
  }, { owner: true });

  // ---------- العملاء والأصناف ----------
  route('GET', '/api/parties', () => db.prepare('SELECT * FROM parties ORDER BY name_ar').all());
  const partyData=body=>{
    const fields=['name_ar','vat_number','phone','address','kind','entity_type','street','building_number','district','city','postal_code','country_code','id_scheme','id_number'];const out={};for(const key of fields){out[key]=body[key]??(key==='kind'?'customer':key==='entity_type'?'individual':key==='country_code'?'SA':'');need(typeof out[key]==='string'&&out[key].length<=500,'بيانات عميل غير صالحة');}
    need(out.name_ar.trim()&&['customer','supplier','both'].includes(out.kind)&&['individual','business'].includes(out.entity_type),'بيانات العميل غير مكتملة');if(out.vat_number)need(/^3\d{13}3$/.test(out.vat_number),'الرقم الضريبي للعميل غير صالح');return out;
  };
  route('POST','/api/parties',({body})=>{const data=partyData(body),keys=Object.keys(data);return{id:db.prepare('INSERT INTO parties('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>data[k])).lastInsertRowid};});
  route('PUT','/api/parties/:id',({params,body})=>{need(db.prepare('SELECT 1 FROM parties WHERE id=?').get(params.id),'العميل غير موجود');const data=partyData(body),keys=Object.keys(data);db.prepare('UPDATE parties SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=?').run(...keys.map(k=>data[k]),params.id);return{ok:true};});
  route('GET','/api/items',()=>listItems(db));
  route('GET','/api/purchases',()=>listPurchases(db),{accountant:true});
  route('GET','/api/purchases/:id/html',({params})=>{const p=purchaseDetails(db,params.id),snapshot=db.prepare('SELECT supplier FROM purchase_snapshots WHERE purchase_id=?').get(p.id);return new Raw(commercialPrint({title:p.kind==='return'?'مرتجع شراء':'سند تسجيل فاتورة مورد',number:p.number,date:p.document_date,company:getSetting(db,'company'),party:snapshot?JSON.parse(snapshot.supplier):null,headers:['الوصف','الوحدة','الكمية','سعر الوحدة','الصافي','الضريبة'],rows:p.lines.map(l=>[l.description,l.unit_name,l.qty,l.unit_price,l.net,l.vat]),totals:[['قبل الضريبة',p.subtotal],['الضريبة',p.vat],['الإجمالي',p.total]],notes:'مرجع المورد: '+p.supplier_reference+' · '+p.notes,settings:getSetting(db,'invoice')}));},{accountant:true});
  route('GET','/api/vouchers/:id/html',({params})=>{const v=db.prepare('SELECT * FROM cash_vouchers WHERE id=?').get(params.id);need(v,'السند غير موجود');return new Raw(commercialPrint({title:v.kind==='receipt'?'سند قبض':'سند صرف',number:v.number,date:v.voucher_date,company:getSetting(db,'company'),party:db.prepare('SELECT name_ar FROM parties WHERE id=?').get(v.party_id),headers:['الحساب','البيان','المبلغ'],rows:[[v.cash_account,v.notes,v.amount/100]],totals:[['قيمة السند',v.amount/100]],settings:getSetting(db,'invoice')}));},{accountant:true});
  route('GET','/api/quotations',()=>db.prepare('SELECT id,number,document_date,valid_until,status,total,invoice_id FROM quotations ORDER BY id DESC LIMIT 500').all(),{accountant:true});
  route('POST','/api/quotations',({body,user})=>createQuotation(db,user.id,body),{accountant:true});
  route('POST','/api/quotations/:id/convert',({params,user,body})=>convertQuotation(db,user.id,params.id,body),{accountant:true});
  route('POST','/api/quotations/:id/cancel',({params,user})=>cancelQuotation(db,user.id,params.id),{accountant:true});
  route('GET','/api/quotations/:id/html',({params})=>{const q=quotation(db,params.id);return new Raw(commercialPrint({title:'عرض سعر',number:q.number,date:q.document_date,company:q.company,party:q.party,headers:['الوصف','الكمية','سعر الوحدة الصافي','الخصم %','الصافي','الضريبة'],rows:q.lines.map(l=>[l.input.description,l.input.qty,l.calculated.unit_price/100,l.calculated.discount_rate/100,l.calculated.net/100,l.calculated.vat/100]),totals:[['قبل الضريبة',q.subtotal/100],['الضريبة',q.vat/100],['الإجمالي',q.total/100]],notes:'صالح حتى '+q.valid_until+' · '+q.notes,settings:getSetting(db,'invoice')}));},{accountant:true});
  route('GET','/api/purchases/:id',({params})=>purchaseDetails(db,params.id),{accountant:true});
  route('POST','/api/purchases',({body,user})=>createPurchase(db,user.id,body),{accountant:true});
  route('GET','/api/vouchers',()=>db.prepare('SELECT v.*,p.name_ar party FROM cash_vouchers v JOIN parties p ON p.id=v.party_id ORDER BY v.id DESC LIMIT 500').all().map(v=>({...v,amount:v.amount/100})),{accountant:true});
  route('POST','/api/vouchers',({body,user})=>createVoucher(db,user.id,body),{accountant:true});
  route('GET','/api/parties/:id/ledger',({params})=>partyLedger(db,Number(params.id)),{accountant:true});
  route('GET','/api/accounts',()=>db.prepare('SELECT * FROM accounts ORDER BY code').all(),{accountant:true});
  route('GET','/api/journals',()=>db.prepare('SELECT e.*,l.account_code,a.name_ar account,l.debit,l.credit,x.party_id,p.name_ar party FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.code=l.account_code LEFT JOIN journal_party_links x ON x.line_id=l.id LEFT JOIN parties p ON p.id=x.party_id ORDER BY e.id DESC,l.id LIMIT 2000').all().map(l=>({...l,debit:l.debit/100,credit:l.credit/100})),{accountant:true});
  route('POST','/api/journals',({body,user})=>postManualJournal(db,user.id,body),{accountant:true});
  route('GET','/api/accounting/lock',()=>db.prepare('SELECT * FROM accounting_locks WHERE id=1').get()||null,{owner:true});
  route('POST','/api/accounting/lock',({body,user})=>{const date=validDate(body.closed_through),old=db.prepare('SELECT closed_through FROM accounting_locks WHERE id=1').get();need(!old||date>old.closed_through,'الإقفال يتقدم فقط ولا يعيد فتح الفترات');db.prepare('INSERT INTO accounting_locks(id,closed_through,actor_id) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET closed_through=excluded.closed_through,actor_id=excluded.actor_id,created_at=CURRENT_TIMESTAMP').run(date,user.id);return{ok:true};},{owner:true});
  route('POST','/api/items',({body,user})=>saveItem(db,body,null,user.id));
  route('PUT','/api/items/:id',({params,body,user})=>saveItem(db,body,Number(params.id),user.id));
  route('GET','/api/warehouses',()=>db.prepare('SELECT * FROM warehouses ORDER BY id').all());
  route('GET','/api/inventory/valuation',()=>stockValuation(db),{accountant:true});
  route('POST','/api/warehouses',({body})=>{const name=String(body.name||'').trim();need(name&&name.length<=100,'اسم المستودع مطلوب');return {id:db.prepare('INSERT INTO warehouses(name) VALUES(?)').run(name).lastInsertRowid};},{owner:true});
  route('PUT','/api/pos/:id/warehouse',({params,body})=>{need(db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(body.warehouse_id),'اختر مستودعًا فعالًا');need(db.prepare('SELECT 1 FROM pos_points WHERE id=?').get(params.id),'نقطة البيع غير موجودة');db.prepare('UPDATE pos_points SET warehouse_id=? WHERE id=?').run(body.warehouse_id,params.id);return {ok:true};},{owner:true});
  route('GET','/api/inventory/balances',()=>db.prepare('SELECT i.id item_id,i.name_ar,i.base_unit,i.reorder_micro,w.id warehouse_id,w.name warehouse,COALESCE(m.qty_micro,0) qty_micro FROM items i CROSS JOIN warehouses w LEFT JOIN stock_positions m ON m.item_id=i.id AND m.warehouse_id=w.id WHERE i.track_stock=1 ORDER BY i.name_ar,w.id').all().map(r=>({...r,qty:r.qty_micro/1000000,reorder_qty:r.reorder_micro/1000000})));
  route('GET','/api/inventory/movements',({query})=>{need(Number.isSafeInteger(Number(query.item_id))&&Number(query.item_id)>0,'اختر صنفًا');return db.prepare('SELECT m.*,w.name warehouse,i.number invoice_number FROM stock_movements m JOIN warehouses w ON w.id=m.warehouse_id LEFT JOIN invoices i ON i.id=m.invoice_id WHERE m.item_id=? ORDER BY m.id DESC LIMIT 300').all(Number(query.item_id)).map(r=>({...r,qty:r.delta_micro/1000000}));});
  route('POST','/api/inventory/movements',({body,user})=>recordStock(db,body,user.id));
  route('GET','/api/pos/catalog',()=>posCatalog(db),{cashier:true});
  route('GET','/api/pos/shifts',({user})=>db.prepare('SELECT * FROM pos_shifts '+(user.role==='staff'?'WHERE user_id=? ':'')+'ORDER BY id DESC LIMIT 100').all(...(user.role==='staff'?[user.id]:[])).map(s=>shiftSummary(db,s)),{cashier:true});
  route('POST','/api/pos/shifts',({body,user})=>openShift(db,user,body),{cashier:true});
  route('POST','/api/pos/shifts/:id/close',({params,body,user})=>closeShift(db,user,params.id,body),{cashier:true});
  route('POST','/api/pos/returns',({body,user})=>posReturn(db,user,body),{cashier:true});
  route('GET','/api/pos/control',()=>getSetting(db,'pos_control'),{cashier:true});
  route('GET','/api/stocktakes',()=>db.prepare('SELECT s.*,w.name warehouse FROM stocktakes s JOIN warehouses w ON w.id=s.warehouse_id ORDER BY s.id DESC LIMIT 100').all());
  route('GET','/api/stocktakes/:id',({params})=>{const row=db.prepare('SELECT * FROM stocktakes WHERE id=?').get(params.id);need(row,'الجرد غير موجود');return{...row,lines:db.prepare('SELECT l.*,i.name_ar FROM stocktake_lines l JOIN items i ON i.id=l.item_id WHERE l.stocktake_id=?').all(row.id)};});
  route('GET','/api/pos/history',({user})=>db.prepare("SELECT id,number,total,type,document_code FROM invoices WHERE status='issued' "+(user.role==='staff'?'AND created_by=? AND pos_id IN (SELECT pos_id FROM pos_user_access WHERE user_id=?) ':'')+'ORDER BY id DESC LIMIT 100').all(...(user.role==='staff'?[user.id,user.id]:[])),{cashier:true});
  route('POST','/api/stocktakes',({body,user})=>createStocktake(db,user,body));
  route('POST','/api/stocktakes/:id/approve',({params,user})=>approveStocktake(db,user,params.id),{owner:true});
  route('GET','/api/pos/customers',()=>db.prepare("SELECT id,name_ar FROM parties WHERE kind IN ('customer','both') ORDER BY name_ar").all(),{cashier:true});
  route('GET','/api/pos/points',({user})=>user.role==='staff'?db.prepare('SELECT p.* FROM pos_points p JOIN pos_user_access a ON a.pos_id=p.id WHERE a.user_id=? AND p.active=1 ORDER BY p.id').all(user.id):db.prepare('SELECT * FROM pos_points WHERE active=1 ORDER BY id').all(),{cashier:true});
  route('POST','/api/pos/sales',({user,body})=>({id:createPosSale(db,user,body)}),{cashier:true});

  // ---------- الفروع ونقاط البيع (بحدود الترخيص) ----------
  route('GET', '/api/pos', () => db.prepare('SELECT * FROM pos_points ORDER BY id').all());
  route('POST', '/api/pos', ({ body }) => {
    const L = lic(), n = db.prepare('SELECT COUNT(*) n FROM pos_points WHERE active=1').get().n;
    if (n >= L.max_pos) throw new HttpError(403, `بلغت الحد المرخّص من نقاط البيع (${L.max_pos}). رقّ الترخيص لإضافة نقاط.`);
    const prefix = String(body.prefix || '').toUpperCase();
    need(/^[A-Z0-9]{1,6}$/.test(prefix) && body.name, 'الاسم مطلوب والبادئة 1-6 أحرف إنجليزية أو أرقام');
    return { id: db.prepare('INSERT INTO pos_points(branch_id,name,prefix) VALUES(1,?,?)').run(body.name, prefix).lastInsertRowid };
  }, { owner: true });
  route('PUT', '/api/pos/:id', ({ params, body }) => { db.prepare('UPDATE pos_points SET active=? WHERE id=?').run(body.active ? 1 : 0, params.id); return { ok: true }; }, { owner: true });

  // ---------- المستخدمون ----------
  route('GET', '/api/users', () => db.prepare('SELECT id,username,role,active FROM users').all().map(u=>({...u,pos_ids:db.prepare('SELECT pos_id FROM pos_user_access WHERE user_id=? ORDER BY pos_id').all(u.id).map(a=>a.pos_id)})), { owner: true });
  route('POST', '/api/users', ({ body }) => {
    const L = lic(); if (db.prepare('SELECT COUNT(*) n FROM users WHERE active=1').get().n >= L.max_users) throw new HttpError(403, `بلغت الحد المرخّص من المستخدمين (${L.max_users})`);
    need(body.username && String(body.password || '').length >= 8 && ['owner', 'accountant', 'staff'].includes(body.role), 'بيانات المستخدم غير مكتملة');
    return tx(db,()=>{
      const point=body.role==='staff'?(body.pos_id?db.prepare('SELECT id FROM pos_points WHERE id=? AND active=1').get(body.pos_id):db.prepare('SELECT id FROM pos_points WHERE active=1 ORDER BY id LIMIT 1').get()):null;
      if(body.role==='staff')need(point,'اختر نقطة بيع مفعلة للعامل');
      const id=db.prepare('INSERT INTO users(username,pass,role) VALUES(?,?,?)').run(body.username,hashPass(body.password),body.role).lastInsertRowid;
      if(point)db.prepare('INSERT INTO pos_user_access(user_id,pos_id) VALUES(?,?)').run(id,point.id);return {id};
    });
  }, { owner: true });


  route('PUT','/api/users/:id/pos-access',({params,body})=>tx(db,()=>{
    need(db.prepare("SELECT 1 FROM users WHERE id=? AND role='staff'").get(params.id),'اختر مستخدم نقطة بيع');
    need(Array.isArray(body.pos_ids)&&body.pos_ids.length>0,'اختر نقطة بيع واحدة على الأقل');
    const ids=[...new Set(body.pos_ids.map(Number))];for(const id of ids)need(Number.isSafeInteger(id)&&db.prepare('SELECT 1 FROM pos_points WHERE id=? AND active=1').get(id),'نقطة بيع غير صالحة');
    db.prepare('DELETE FROM pos_user_access WHERE user_id=?').run(params.id);for(const id of ids)db.prepare('INSERT INTO pos_user_access VALUES(?,?)').run(params.id,id);return {ok:true};
  }),{owner:true});

  // ---------- الفواتير ----------
  route('GET', '/api/invoices', () => db.prepare(`SELECT i.id,i.number,i.type,i.document_code,i.invoice_kind,i.environment,i.status,i.issue_date,i.total,p.name_ar party FROM invoices i
    LEFT JOIN parties p ON p.id=i.party_id ORDER BY i.id DESC LIMIT 200`).all().map(r => ({ ...r, total: fromCents(r.total) })));
  route('POST', '/api/invoices', ({ body, user }) => ({ id: createInvoice(db, user.id, body) }));
  route('GET', '/api/invoices/:id', ({ params,user }) => { const i = getInvoice(db, params.id); need(i, 'غير موجودة'); if(user.role==='staff'&&Number(i.created_by)!==user.id)throw new HttpError(403,'يمكنك عرض مبيعاتك فقط');return i; },{cashier:true});
  route('POST', '/api/invoices/:id/issue', ({ params }) => ({ id: issueInvoice(db, Number(params.id)) }));
  route('POST', '/api/invoices/:id/credit-note', ({ params, body, user }) => ({ id: createCreditNote(db, user.id, Number(params.id), body) }), { accountant: true });
  route('GET', '/api/invoices/:id/html', ({ params, query, user }) => { const i = getInvoice(db, params.id); need(i, 'غير موجودة');
    if(user.role==='staff'&&(Number(i.created_by)!==user.id||(query.profile&&query.profile!=='pos')))throw new HttpError(403,'يمكنك طباعة مبيعاتك بقالب نقطة البيع فقط');
    return new Raw(renderInvoice({ inv: i, company: i.company_snapshot || getSetting(db, 'company'), s: validatePrintSettings({}, getSetting(db, profileKey(query.profile || (user.role==='staff'?'pos':'accountant')))) })); },{cashier:true});
  route('POST', '/api/invoice-preview', ({ body }) => {
    const settings = validatePrintSettings(body.settings || {}, getSetting(db, profileKey(body.profile)));
    const company = { ...getSetting(db,'company'), ...validateCompany(body.company || {}) };
    if (!company.name_ar) company.name_ar = 'اسم المنشأة';
    return new Raw(renderInvoice({inv:sampleInvoice(company.activity),preview:true,company,s:settings}));
  }, { owner: true });


  route('GET','/api/compliance/status',()=>({mode:getSetting(db,'compliance').mode,seller_errors:validateIdentity(getSetting(db,'company')),...jobs.auditStatus(db),production_ready:false,official_sdk_validated:false,certificate_configured:false,blocked:db.prepare("SELECT COUNT(*) n FROM regulatory_queue WHERE state='blocked'").get().n,remaining:['تنزيل SDK الرسمي وقبول شروطه وتشغيل التحقق','توليد CSR وتهيئة شهادة الجهاز وحماية مفتاحه','إكمال التوقيع XAdES وQR المرحلة الثانية والتحقق منهما','اختبار أنواع الفواتير والإشعارات في بيئة الهيئة','اعتماد إعداد الإنتاج بعد نجاح الاختبارات']}),{owner:true});
  route('GET','/api/compliance/queue',()=>db.prepare('SELECT q.*,i.number,i.invoice_kind,i.environment FROM regulatory_queue q JOIN invoices i ON i.id=q.invoice_id ORDER BY i.id DESC LIMIT 200').all(),{owner:true});
  route('GET','/api/compliance/audit',()=>db.prepare('SELECT id,actor_id,event,entity_type,entity_id,hash,created_at FROM audit_events ORDER BY id DESC LIMIT 100').all(),{owner:true});
  route('GET','/api/invoices/:id/xml',({params})=>{const d=db.prepare("SELECT content FROM invoice_documents WHERE invoice_id=? AND kind='xml_candidate'").get(params.id);need(d,'لا يوجد XML مؤرشف لهذا المستند');return new Raw(d.content,'application/xml; charset=utf-8',{'Content-Disposition':'attachment; filename="development-invoice-'+Number(params.id)+'.xml"'});},{accountant:true});
  route('POST','/api/invoices/:id/debit-note',({params,user,body})=>({id:createDebitNote(db,user.id,Number(params.id),body)}),{accountant:true});

  // ---------- التقارير والإدارة ----------
  route('GET', '/api/dashboard', () => {
    const m = nowRiyadh().date.slice(0, 7);
    const t = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(CASE type WHEN '381' THEN -subtotal ELSE subtotal END),0) sub,
      COALESCE(SUM(CASE type WHEN '381' THEN -vat ELSE vat END),0) vat FROM invoices WHERE status='issued' AND issue_date LIKE ?`).get(m + '%');
    return { month: m, invoices: t.n, sales: fromCents(t.sub), vat: fromCents(t.vat) };
  });
  route('GET', '/api/reports/trial-balance', () => trialBalance(db), { accountant: true });
  route('GET','/api/reports/financial',({query})=>financialReport(db,query.from,query.to),{accountant:true});
  route('GET', '/api/reports/vat', ({ query }) => { need(/^\d{4}-\d{2}-\d{2}$/.test(query.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(query.to || ''), 'حدد الفترة (from/to بصيغة YYYY-MM-DD)'); return vatReport(db, query.from, query.to); }, { accountant: true });
  route('GET','/api/compliance/audit/verify',()=>jobs.audit(),{owner:true});
  route('GET', '/api/backup', async () => new FileRaw(await jobs.backup(), { 'Content-Disposition': `attachment; filename="almuhtariz-backup-${new Date().toISOString().slice(0,10)}.db"` }), { owner: true });
  route('POST', '/api/license', ({ body }) => {
    need(fs.existsSync(PUB), 'لا يوجد مفتاح عام للترخيص في هذه النسخة');
    try { verifyLicenseFile(body, fs.readFileSync(PUB)); } catch { throw new HttpError(400, 'ملف الترخيص غير صالح'); }
    fs.writeFileSync(licensePath, JSON.stringify(body)); return lic();
  }, { owner: true });

  // ---------- المعالج العام ----------
  const server = http.createServer(async (req, res) => {
    const send = (st, body, type = 'application/json', h = {}) => { res.writeHead(st, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', ...h }); res.end(body); };
    try {
      const u = new URL(req.url, 'http://x'), ip = req.socket.remoteAddress;
      if (!u.pathname.startsWith('/api/')) { // ملفات الواجهة
        let p = path.normalize(path.join(WEB, u.pathname === '/' ? 'index.html' : u.pathname));
        if (!p.startsWith(WEB + path.sep)) return send(404, 'غير موجود', 'text/plain; charset=utf-8');
        let content;try{content=await fs.promises.readFile(p);}catch(error){if(['ENOENT','EISDIR','ENOTDIR'].includes(error.code))return send(404,'غير موجود','text/plain; charset=utf-8');throw error;}
        return send(200, content, MIME[path.extname(p)] || 'application/octet-stream');
      }
      const r = routes.find(x => x.m === req.method && x.re.test(u.pathname)); if (!r) throw new HttpError(404, 'مسار غير معروف');
      const cookie = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(c => c[0]));
      const token = cookie.sid, user = token ? db.prepare(`SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1 AND s.created_at>=?`).get(token,new Date(Date.now()-30*86400000).toISOString()) : null;
      if (!r.open && !user) throw new HttpError(401, 'سجّل الدخول');
      if (user?.role==='staff'&&!r.cashier)throw new HttpError(403,'حساب العامل مخصص لنقطة البيع فقط');
      if (r.accountant && !['owner','accountant'].includes(user.role)) throw new HttpError(403, 'هذه العملية للمحاسب أو المالك');
      if (r.owner && user.role !== 'owner') throw new HttpError(403, 'للمالك فقط');
      let body = {};
      if (req.method !== 'GET') {
        if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'JSON فقط');
        if (lic().readOnly && !['/api/login', '/api/logout'].includes(u.pathname) && !(u.pathname === '/api/license')) throw new HttpError(402, 'الترخيص منتهٍ أو غير مطابق: البرنامج للقراءة والتصدير فقط');
        const chunks = []; let n = 0;
        for await (const c of req) { n += c.length; if (n > 2e6) throw new HttpError(413, 'الطلب كبير'); chunks.push(c); }
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
      }
      const context={db,req,body,params:{...r.re.exec(u.pathname).groups},query:Object.fromEntries(u.searchParams),user,token,ip};
      const recordResult=result=>appendAudit(db,{actor:user?.id||null,event:'api.'+req.method,entity_type:'api',entity_id:u.pathname,details:{fields:Object.keys(body).filter(k=>!/(password|secret|token|logo|csr|otp)/i.test(k)),result_id:result?.id||null}});
      let out;
      if(req.method==='GET')out=await r.fn(context);
      else if(r.external){out=await r.fn(context);tx(db,()=>recordResult(out));}
      else out=tx(db,()=>{const result=r.fn(context);recordResult(result);return result;});
      if(out instanceof FileRaw){try{res.writeHead(200,{'Content-Type':'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...out.headers});await pipeline(fs.createReadStream(out.download.file),res);}finally{await out.download.dispose();}return;}
      if (out instanceof Raw) return send(200, out.body, out.type, out.headers);
      send(200, JSON.stringify(out));
    } catch (e) {
      if(res.headersSent){res.destroy();return;}
      const st = e.status || 400;
      send(st, JSON.stringify({ error: st >= 500 ? 'خطأ داخلي' : e.message }));
    }
  });
  const syncTimer=setInterval(()=>{try{if(syncInfo(db).enabled)syncBranch(db).catch(()=>{});}catch{}},60000);syncTimer.unref();server.on('close',()=>clearInterval(syncTimer));
  return { server, db };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = process.env.ALMUHTARIZ_DATA || process.env.SMARTZ_DATA || path.join(here, '..', 'data');
  const { server } = createApp({ dbFile: path.join(data, 'smartz.db'), licensePath: path.join(data, 'license.json') });
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '0.0.0.0';
  server.listen(port, host, () => {
    console.log(`\nالمحترز للمحاسبة يعمل. افتح من هذا الجهاز: http://localhost:${port}`);
    for (const l of Object.values(os.networkInterfaces()).flat()) if (l.family === 'IPv4' && !l.internal) console.log(`ومن أجهزة الشبكة المحلية:      http://${l.address}:${port}`);
  });
}
