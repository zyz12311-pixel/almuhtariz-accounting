import {trackingInput,movementTracking,remainingTracking} from './tracking.js';
import crypto from 'node:crypto';
import { tx } from './db.js';
import { toCents, fromCents, tlv, sha256b64, nowRiyadh } from './lib.js';
import { calculateLines, taxBreakdown,sumCents } from './money.js';
import { assertIssueData, assertSupported } from './compliance.js';
import { validDate } from './dates.js';
import { appendAudit } from './audit.js';
import { buildInvoiceXml, candidateHash } from './zatca/xml.js';
import { extractZatcaQr } from './zatca/qr.js';
import { DEFAULTS, CHART } from './defaults.js';
import {prepareItemLines,postInvoiceStock,baseQuantity} from './inventory.js';

export const INIT_HASH = 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';
const ACC = { cash: '1101', bank: '1102', credit: '1201', sales: '4101', vatOut: '2201' };

export const getSetting = (db, key) => {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  const saved = r ? JSON.parse(r.value) : {};
  if (key === 'company' && !Object.hasOwn(saved, 'logo')) {
    const legacy = db.prepare("SELECT value FROM settings WHERE key='invoice'").get();
    if (legacy) saved.logo = JSON.parse(legacy.value).logo || '';
  }
  return { ...DEFAULTS[key], ...saved }; 
};
export const setSetting = (db, key, val) => {
  const clean = {};
  for (const k of Object.keys(DEFAULTS[key])) if (k in val) clean[k] = val[k]; // يتجاهل أي مفتاح غير معروف
  db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(clean));
};
export const nextCounter = (db, name) =>
  db.prepare('INSERT INTO counters(name,value) VALUES(?,1) ON CONFLICT(name) DO UPDATE SET value=value+1 RETURNING value').get(name).value;

export function seedCompany(db, companyName) {
  const ins = db.prepare('INSERT OR IGNORE INTO accounts(code,name_ar,type,postable) VALUES(?,?,?,?)');
  for (const a of CHART) ins.run(...a);
  if (!db.prepare('SELECT 1 FROM branches').get()) {
    db.prepare("INSERT INTO branches(id,name) VALUES(1,'الفرع الرئيسي')").run();
    db.prepare("INSERT INTO pos_points(branch_id,name,prefix) VALUES(1,'نقطة البيع 1','A')").run();
  }
  setSetting(db, 'company', { ...getSetting(db, 'company'), name_ar: companyName });
}

export const postEntry=(db,e)=>tx(db,()=>postEntryAtomic(db,e));
function postEntryAtomic(db,e){
  if(!Array.isArray(e.lines)||e.lines.length<2||e.lines.length>1000||e.lines.some(l=>![l.debit||0,l.credit||0].every(n=>Number.isSafeInteger(n)&&n>=0)||(l.debit&&l.credit)))throw Error('بنود القيد أو المبالغ غير صالحة');
  const safeDebit=e.lines.reduce((s,l)=>s+BigInt(l.debit||0),0n),safeCredit=e.lines.reduce((s,l)=>s+BigInt(l.credit||0),0n);
  if(safeDebit>BigInt(Number.MAX_SAFE_INTEGER)||safeCredit>BigInt(Number.MAX_SAFE_INTEGER))throw Error('إجمالي القيد أكبر من المسموح');
  const d = e.lines.reduce((s, l) => s + (l.debit || 0), 0), c = e.lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (d !== c || d === 0 || e.lines.length < 2) throw new Error('القيد غير متوازن');
  const id = db.prepare('INSERT INTO journal_entries(entry_no,entry_date,description,source_type,source_id,branch_id) VALUES(?,?,?,?,?,?)')
    .run(nextCounter(db, 'entry'), e.date, e.description ?? null, e.source_type ?? null, e.source_id ?? null, e.branch_id ?? null).lastInsertRowid;
  // التوافق مع المخططات الأقدم (قبل 023): اكتب البعد التحليلي فقط إذا كان العمود/الجدول موجودًا
  const hasCC = db.prepare("SELECT COUNT(*) n FROM pragma_table_info('journal_lines') WHERE name='cost_center_id'").get().n > 0;
  const hasCCTable = hasCC && db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='cost_centers'").get().n > 0;
  const st = hasCC ? db.prepare('INSERT INTO journal_lines(entry_id,account_code,debit,credit,cost_center_id) VALUES(?,?,?,?,?)') : db.prepare('INSERT INTO journal_lines(entry_id,account_code,debit,credit) VALUES(?,?,?,?)');
  for (const l of e.lines) {
    const cc = hasCC ? (l.cost_center_id ?? e.cost_center_id ?? null) : null;
    if (cc !== null && cc !== undefined) {
      if (!Number.isSafeInteger(Number(cc))) throw Error('مركز التكلفة غير صالح');
      if (hasCCTable && !db.prepare('SELECT 1 FROM cost_centers WHERE id=?').get(Number(cc))) throw Error('مركز التكلفة غير موجود');
    }
    if(!Number.isSafeInteger(l.debit||0)||!Number.isSafeInteger(l.credit||0)||!db.prepare('SELECT 1 FROM accounts WHERE code=? AND postable=1').get(l.account))throw Error('حساب أو مبلغ القيد غير صالح');
    const lineId = hasCC ? st.run(id,l.account,l.debit||0,l.credit||0,cc||null).lastInsertRowid : st.run(id,l.account,l.debit||0,l.credit||0).lastInsertRowid;
    if(l.party_id)db.prepare('INSERT INTO journal_party_links(line_id,party_id) VALUES(?,?)').run(lineId,l.party_id);
  }
  db.prepare('INSERT INTO journal_seals(entry_id) VALUES(?)').run(id);
  return id;
}

const calcLines=input=>calculateLines(input).map((line,i)=>({...line,item_id:input[i].item_id||null,stock_qty_micro:input[i].stock_qty_micro||0,unit_factor_micro:input[i].unit_factor_micro||1000000,unit_name:input[i].unit_name||'',warehouse_id:input[i].warehouse_id||null,tracking:trackingInput(input[i].tracking)}));
function insertInvoice(db, o) {
  const taxes=taxBreakdown(o.lines),sub=sumCents(o.lines.map(l=>l.net)),vat=sumCents(taxes.map(g=>g.vat));
  if(!Number.isSafeInteger(sub+vat))throw Error('قيمة الفاتورة أكبر من المسموح');
  const pos = db.prepare('SELECT * FROM pos_points WHERE id=? AND active=1').get(o.pos_id || 1);
  if (!pos) throw new Error('نقطة البيع غير موجودة أو موقوفة');
  const paymentTermsDays=Math.max(0,Math.min(3650,Number(o.payment_terms_days||0)|0));
  const dueDate=o.due_date==null||o.due_date===''?null:validDate(o.due_date,{allowFuture:true});
  const id = db.prepare(`INSERT INTO invoices(uuid,type,pos_id,branch_id,party_id,payment,subtotal,vat,total,ref_invoice_id,reason,notes,created_by,payment_terms_days,due_date,cost_center_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), o.type, pos.id, pos.branch_id, o.party_id || null, o.payment || 'cash',
    sub, vat, sub + vat, o.ref || null, o.reason || null, o.notes || null, o.user || null,paymentTermsDays,dueDate,o.cost_center_id||null).lastInsertRowid;
  const party=o.party_id?db.prepare('SELECT * FROM parties WHERE id=?').get(o.party_id):null;
  if(o.party_id&&(!party||!['customer','both'].includes(party.kind)))throw Error('اختر عميلًا صالحًا لفاتورة البيع');
  const kind=o.invoice_kind||(party&&(party.vat_number||party.entity_type==='business')?'standard':'simplified');
  if(!['standard','simplified'].includes(kind))throw Error('نوع الفاتورة غير صالح');
  const documentCode = o.document_code || (kind === 'simplified' ? '389' : o.type);
  db.prepare('UPDATE invoices SET invoice_kind=?,document_code=?,supply_date=?,environment=? WHERE id=?').run(kind,documentCode,o.supply_date||null,'development',id);
  const st=db.prepare('INSERT INTO invoice_lines(invoice_id,line_no,description,qty,unit_price,vat_rate,net,vat,total,tax_category,exemption_code,exemption_reason,unit_code,item_id,stock_qty_micro,unit_factor_micro,unit_name,warehouse_id,list_price,discount_rate,tracking_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const l of o.lines)st.run(id,l.line_no,l.description,l.qty,l.unit_price,l.vat_rate,l.net,l.vat,l.total,l.tax_category,l.exemption_code,l.exemption_reason,l.unit_code,l.item_id||null,l.stock_qty_micro||0,l.unit_factor_micro||1000000,l.unit_name||'',l.warehouse_id||null,l.list_price??l.unit_price,l.discount_rate||0,JSON.stringify(l.tracking||[]));
  for(const g of taxes)db.prepare('INSERT INTO invoice_tax_totals VALUES(?,?,?,?,?,?,?)').run(id,g.tax_category,g.vat_rate,g.exemption_code,g.exemption_reason,g.taxable,g.vat);
  return id;
}

export const issueInvoice = (db, id) => tx(db, () => issueInvoiceAtomic(db, id));
function issueInvoiceAtomic(db, id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  if (!inv || inv.status !== 'draft') throw new Error('الفاتورة ليست مسودة');
  if (inv.number || db.prepare('SELECT 1 FROM regulatory_queue WHERE invoice_id=?').get(id)) throw new Error('الفاتورة محجوزة لمسار الامتثال؛ أكمل المسار نفسه');
  if(db.prepare("SELECT 1 FROM invoices i JOIN regulatory_queue q ON q.invoice_id=i.id WHERE i.branch_id=? AND i.status='draft' LIMIT 1").get(inv.branch_id))throw new Error('يوجد إصدار امتثال غير مكتمل في هذا الفرع');
  const co = getSetting(db, 'company');
  if(getSetting(db,'compliance').mode!=='development')throw Error('الإنتاج والمحاكاة مقفلان حتى تكتمل شهادة الجهاز والتوقيع والتحقق الرسمي');
  if (!co.name_ar || !/^3\d{13}3$/.test(co.vat_number)) throw new Error('أكمل بيانات الشركة والرقم الضريبي (15 رقمًا يبدأ وينتهي بـ 3) قبل إصدار الفواتير');
  const pos = db.prepare('SELECT * FROM pos_points WHERE id=? AND active=1').get(inv.pos_id);
  if (!pos) throw new Error('نقطة البيع موقوفة؛ اختر نقطة مفعّلة');
  if (!(inv.total > 0)) throw new Error('إجمالي الفاتورة يجب أن يكون أكبر من صفر');
  let party = inv.party_id ? db.prepare('SELECT * FROM parties WHERE id=?').get(inv.party_id) : null;
  if(inv.ref_invoice_id){const original=getInvoice(db,inv.ref_invoice_id);if(original.company_snapshot?.vat_number!==co.vat_number)throw Error('الإشعار يجب أن يخص نفس المنشأة الضريبية');party=original.party_snapshot||party;}
  const now=Date.now(),lastTime=db.prepare("SELECT value FROM compliance_state WHERE key='last_issue_utc'").get()?.value;
  assertIssueData({company:co,party,invoice:inv,now,lastTime,lines:db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=?').all(id)});
  db.prepare("INSERT INTO compliance_state(key,value) VALUES('last_issue_utc',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date(now).toISOString());
  if (inv.payment === 'credit' && !party) throw new Error('اختر العميل لحفظ فاتورة آجلة');
  db.prepare('INSERT INTO invoice_snapshots(invoice_id,company,party) VALUES(?,?,?)').run(id, JSON.stringify(co), JSON.stringify(party));
  const stockCost=postInvoiceStock(db,inv);
  const number = `${pos.prefix}-${String(nextCounter(db, 'inv:' + pos.prefix)).padStart(6, '0')}`;

  // الحصول على معرف وحدة EGS (issuer profile)
  const issuerProfileRaw = db.prepare("SELECT value FROM compliance_state WHERE key='issuer_profile'").get();
  const issuerProfile = issuerProfileRaw ? JSON.parse(issuerProfileRaw.value) : null;
  const issuerProfileId = issuerProfile?.local_id || null;

  // استخدام سلسلة ICV/PIH لكل وحدة EGS
  let egsChain = null;
  if (issuerProfileId) {
    egsChain = db.prepare('SELECT * FROM egs_unit_chain WHERE issuer_profile_id=?').get(issuerProfileId);
    if (!egsChain) {
      db.prepare('INSERT INTO egs_unit_chain(issuer_profile_id,icv,last_hash) VALUES(?,0,?)').run(issuerProfileId, INIT_HASH);
      egsChain = { icv: 0, last_hash: INIT_HASH };
    }
  } else {
    // Fallback للسلسلة القديمة لكل فرع (للتوافق مع البيانات الموجودة)
    let ch = db.prepare('SELECT * FROM chain WHERE branch_id=?').get(inv.branch_id);
    if (!ch) { db.prepare('INSERT INTO chain(branch_id,icv,last_hash) VALUES(?,0,?)').run(inv.branch_id, INIT_HASH); ch = { icv: 0, last_hash: INIT_HASH }; }
    egsChain = ch;
  }
  const { date, time } = nowRiyadh(), icv = egsChain.icv + 1, pih = egsChain.last_hash;
  const taxes=db.prepare('SELECT * FROM invoice_tax_totals WHERE invoice_id=? ORDER BY tax_category,vat_rate,exemption_code').all(id);
  const reference=inv.ref_invoice_id?db.prepare('SELECT number FROM invoices WHERE id=?').get(inv.ref_invoice_id)?.number:null;
  const document={...inv,number,issue_date:date,issue_time:time,icv,pih,ref_number:reference,lines:db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY line_no').all(id)};
  const hash=candidateHash({invoice:document,company:co,buyer:party,taxes});
  const qr=tlv([[1,co.name_ar],[2,co.vat_number],[3,`${date}T${time}+03:00`],[4,fromCents(inv.total)],[5,fromCents(inv.vat)]]);
  document.qr=qr;
  const xml=buildInvoiceXml({invoice:document,company:co,buyer:party,taxes});
  const nowIso=new Date(now).toISOString();
  db.prepare('INSERT INTO invoice_documents VALUES(?,?,?,?,?,?)').run(id,'xml_candidate',xml,sha256b64(xml),nowIso,nowIso);
  db.prepare('INSERT INTO regulatory_queue(invoice_id,operation,state,last_error,updated_at) VALUES(?,?,?,?,?)').run(id,inv.invoice_kind==='standard'?'clearance':'reporting','blocked','development: لم يتحقق SDK ولم تهيأ شهادة الجهاز أو التوقيع',new Date(now).toISOString());
  if (issuerProfileId) {
    db.prepare('UPDATE egs_unit_chain SET icv=?, last_hash=? WHERE issuer_profile_id=?').run(icv, hash, issuerProfileId);
  } else {
    db.prepare('UPDATE chain SET icv=?, last_hash=? WHERE branch_id=?').run(icv, hash, inv.branch_id);
  }
  const due=resolveInvoiceDue(date,inv.payment_terms_days,inv.due_date);
  db.prepare("UPDATE invoices SET status='issued', number=?, issue_date=?, issue_time=?, icv=?, pih=?, hash=?, qr=?, due_date=?, payment_terms_days=?, issuer_profile_id=? WHERE id=?")
    .run(number, date, time, icv, pih, hash, qr, due.due_date, due.payment_terms_days, issuerProfileId, id);
  const cn = inv.type === '381', pay = ACC[inv.payment];
  const cc = inv.cost_center_id || null;
  const side = (acc, amt, debit) => ({ account: acc, debit: debit ? amt : 0, credit: debit ? 0 : amt, cost_center_id: cc });
  const lines = [side(pay, inv.total, !cn), side(ACC.sales, inv.subtotal, cn)];
  if (inv.vat > 0) lines.push(side(ACC.vatOut, inv.vat, cn));
  if(stockCost.cost>0){lines.push(side('5101',stockCost.cost,!cn),side('1401',stockCost.cost,cn));}
  postEntry(db, { date, description: `${cn ? 'إشعار دائن' : 'فاتورة'} ${number}`, source_type: 'invoice', source_id: id, branch_id: inv.branch_id, lines });
  appendAudit(db,{actor:inv.created_by,event:'invoice.issued.development',entity_type:'invoice',entity_id:id,details:{uuid:inv.uuid,number,document_code:inv.document_code,invoice_kind:inv.invoice_kind,hash,validation:'not_sdk_validated'}});
  const installation = db.prepare('SELECT id FROM installation LIMIT 1').get().id;
  const payload = getInvoice(db, id);
  db.prepare('INSERT INTO sync_outbox(event_id,installation_id,aggregate_uuid,event_type,payload,created_at) VALUES(?,?,?,?,?,?)')
    .run(crypto.randomUUID(), installation, inv.uuid, 'invoice.issued', JSON.stringify({ version: 1, installation_id: installation, invoice: payload }), new Date().toISOString());
  return id;
}

export function prepareComplianceIssue(db,id) { return tx(db,()=>{
  const inv=db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  if(!inv||inv.status!=='draft')throw Error('الفاتورة ليست مسودة');
  const existing=db.prepare('SELECT * FROM regulatory_queue WHERE invoice_id=?').get(id);
  if(existing){
    const expectedOperation=inv.invoice_kind==='standard'?'clearance':'reporting';
    if(existing.operation!==expectedOperation)throw Error('نوع مسار الامتثال لا يطابق نوع الفاتورة');
    if(!inv.number||!inv.hash)throw Error('حالة حجز الفاتورة غير مكتملة');
    const snapshot=db.prepare('SELECT company,party FROM invoice_snapshots WHERE invoice_id=?').get(id);
    const candidate=db.prepare("SELECT content,sha256 FROM invoice_documents WHERE invoice_id=? AND kind='xml_candidate'").get(id);
    if(!snapshot||!candidate||sha256b64(candidate.content)!==candidate.sha256)throw Error('ملف المرشح أو لقطته غير مكتملة');
    return {id:Number(id),operation:existing.operation,state:existing.state,invoice:inv,company:JSON.parse(snapshot.company),buyer:JSON.parse(snapshot.party),xml:candidate.content,hash:inv.hash,uuid:inv.uuid,number:inv.number};
  }
  if(inv.number||inv.icv||inv.hash)throw Error('بيانات تسلسل الفاتورة محجوزة دون سجل امتثال');
  if(getSetting(db,'compliance').mode!=='development')throw Error('الإنتاج والمحاكاة مقفلان حتى تكتمل التهيئة والتحققات');
  const company=getSetting(db,'company');
  if(!company.name_ar||!/^3\d{13}3$/.test(company.vat_number||''))throw Error('أكمل بيانات الشركة والرقم الضريبي قبل الإصدار');
  const pos=db.prepare('SELECT * FROM pos_points WHERE id=? AND active=1').get(inv.pos_id);
  if(!pos)throw Error('نقطة البيع موقوفة؛ اختر نقطة مفعّلة');
  if(!(inv.total>0))throw Error('إجمالي الفاتورة يجب أن يكون أكبر من صفر');
  let buyer=inv.party_id?db.prepare('SELECT * FROM parties WHERE id=?').get(inv.party_id):null;
  if(inv.ref_invoice_id){
    const original=getInvoice(db,inv.ref_invoice_id);
    if(original.company_snapshot?.vat_number!==company.vat_number)throw Error('الإشعار يجب أن يخص نفس المنشأة الضريبية');
    buyer=original.party_snapshot||buyer;
  }
  if(inv.payment==='credit'&&!buyer)throw Error('اختر العميل لحفظ فاتورة آجلة');
  const now=Date.now(),lastTime=db.prepare("SELECT value FROM compliance_state WHERE key='last_issue_utc'").get()?.value;
  const lines=db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY line_no').all(id);
  assertIssueData({company,party:buyer,invoice:inv,now,lastTime,lines});
  const pending=db.prepare(`SELECT i.id FROM invoices i JOIN regulatory_queue q ON q.invoice_id=i.id
    WHERE i.branch_id=? AND i.status='draft' AND i.id<>? LIMIT 1`).get(inv.branch_id,id);
  if(pending)throw Error('يوجد إصدار امتثال غير مكتمل في هذا الفرع؛ أكمله أو عالجه قبل إصدار المستند التالي');
  const number=`${pos.prefix}-${String(nextCounter(db,'inv:'+pos.prefix)).padStart(6,'0')}`;

  // الحصول على معرف وحدة EGS (issuer profile)
  const issuerProfileRaw = db.prepare("SELECT value FROM compliance_state WHERE key='issuer_profile'").get();
  const issuerProfile = issuerProfileRaw ? JSON.parse(issuerProfileRaw.value) : null;
  const issuerProfileId = issuerProfile?.local_id || null;

  // استخدام سلسلة ICV/PIH لكل وحدة EGS
  let egsChain = null;
  if (issuerProfileId) {
    egsChain = db.prepare('SELECT * FROM egs_unit_chain WHERE issuer_profile_id=?').get(issuerProfileId);
    if (!egsChain) {
      db.prepare('INSERT INTO egs_unit_chain(issuer_profile_id,icv,last_hash) VALUES(?,0,?)').run(issuerProfileId, INIT_HASH);
      egsChain = { icv: 0, last_hash: INIT_HASH };
    }
  } else {
    // Fallback للسلسلة القديمة لكل فرع (للتوافق مع البيانات الموجودة)
    let chain = db.prepare('SELECT * FROM chain WHERE branch_id=?').get(inv.branch_id);
    if(!chain){db.prepare('INSERT INTO chain(branch_id,icv,last_hash) VALUES(?,0,?)').run(inv.branch_id,INIT_HASH);chain={icv:0,last_hash:INIT_HASH};}
    egsChain = chain;
  }
  const {date,time}=nowRiyadh(),icv=egsChain.icv+1,pih=egsChain.last_hash;
  const taxes=db.prepare('SELECT * FROM invoice_tax_totals WHERE invoice_id=? ORDER BY tax_category,vat_rate,exemption_code').all(id);
  const reference=inv.ref_invoice_id?db.prepare('SELECT number FROM invoices WHERE id=?').get(inv.ref_invoice_id)?.number:null;
  const document={...inv,number,issue_date:date,issue_time:time,icv,pih,ref_number:reference,lines};
  const hash=candidateHash({invoice:document,company,buyer,taxes});
  const xml=buildInvoiceXml({invoice:document,company,buyer,taxes,includeQr:false});
  const due=resolveInvoiceDue(date,inv.payment_terms_days,inv.due_date),operation=inv.invoice_kind==='standard'?'clearance':'reporting',createdAt=new Date(now).toISOString();
  db.prepare('INSERT INTO invoice_snapshots(invoice_id,company,party) VALUES(?,?,?)').run(id,JSON.stringify(company),JSON.stringify(buyer));
  db.prepare('INSERT INTO invoice_documents VALUES(?,?,?,?,?,?)').run(id,'xml_candidate',xml,sha256b64(xml),createdAt,createdAt);
  db.prepare('INSERT INTO regulatory_queue(invoice_id,operation,state,last_error,updated_at) VALUES(?,?,?,?,?)').run(id,operation,'ready','',createdAt);
  if (issuerProfileId) {
    db.prepare('UPDATE egs_unit_chain SET icv=?,last_hash=? WHERE issuer_profile_id=?').run(icv,hash,issuerProfileId);
  } else {
    db.prepare('UPDATE chain SET icv=?,last_hash=? WHERE branch_id=?').run(icv,hash,inv.branch_id);
  }
  db.prepare("INSERT INTO compliance_state(key,value) VALUES('last_issue_utc',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date(now).toISOString());
  db.prepare('UPDATE invoices SET number=?,issue_date=?,issue_time=?,icv=?,pih=?,hash=?,qr=NULL,due_date=?,payment_terms_days=?,environment=?,issuer_profile_id=? WHERE id=?')
    .run(number,date,time,icv,pih,hash,due.due_date,due.payment_terms_days,'development',issuerProfileId,id);
  return {id:Number(id),operation,state:'ready',invoice:{...document,due_date:due.due_date,payment_terms_days:due.payment_terms_days},company,buyer,xml,hash,uuid:inv.uuid,number};
});}

export function claimComplianceWork(db,id,operation) { return tx(db,()=>{
  const now=new Date().toISOString();
  const result=db.prepare("UPDATE regulatory_queue SET state='sending',last_error='',next_attempt_at=NULL,updated_at=? WHERE invoice_id=? AND operation=? AND state IN ('ready','retry') AND (next_attempt_at IS NULL OR next_attempt_at<=?)").run(now,id,operation,now);
  if(!result.changes)throw Error('طلب الامتثال غير جاهز أو قيد المعالجة');
  const invoice=db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  const candidate=db.prepare("SELECT content,sha256 FROM invoice_documents WHERE invoice_id=? AND kind='xml_candidate'").get(id);
  if(!invoice||!candidate||sha256b64(candidate.content)!==candidate.sha256)throw Error('تعذر قراءة مرشح الامتثال');
  return {invoice,candidate,startedAt:new Date().toISOString()};
});}

export function recordComplianceOutcome(db,id,{state,startedAt,reason='',responseCode=null,responseSummary='',retryAfter=null}) { return tx(db,()=>{
  if(!['accepted','retry','rejected','blocked'].includes(state))throw Error('نتيجة محاولة الامتثال غير صالحة');
  const queue=db.prepare("SELECT attempts FROM regulatory_queue WHERE invoice_id=? AND state='sending'").get(id);
  if(!queue)throw Error('لا توجد محاولة امتثال قيد المعالجة');
  const requestedDelay=Number(retryAfter),delay=Number.isFinite(requestedDelay)&&requestedDelay>0?Math.min(86400,Math.floor(requestedDelay)):Math.min(3600,30*2**Math.min(queue.attempts,7));
  const finishedAt=new Date().toISOString(),next=state==='retry'?new Date(Date.now()+delay*1000).toISOString():null;
  db.prepare('INSERT INTO regulatory_attempts(invoice_id,started_at,finished_at,outcome,response_code,response_summary) VALUES(?,?,?,?,?,?)')
    .run(id,startedAt,finishedAt,state,responseCode,responseSummary||reason);
  db.prepare('UPDATE regulatory_queue SET state=?,attempts=?,next_attempt_at=?,last_error=?,last_response=?,updated_at=? WHERE invoice_id=?')
    .run(state,queue.attempts+1,next,state==='accepted'?'':String(reason).slice(0,1000),responseSummary||null,finishedAt,id);
  return {id:Number(id),state};
});}

export function recordComplianceCredentialStatus(db,{state,expiresAt=null,message='',checkedAt=new Date().toISOString(),invoiceId=null}={}) { return tx(db,()=>{
  if(!['valid','expiring','expired','revoked','unknown'].includes(state))throw Error('حالة شهادة الامتثال غير صالحة');
  const expiry=expiresAt==null?'':new Date(expiresAt).toISOString(),details=String(message).slice(0,1000);
  const save=(key,value)=>db.prepare('INSERT INTO compliance_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,String(value));
  save('credential_status',state);save('credential_expires_at',expiry);save('credential_checked_at',new Date(checkedAt).toISOString());save('credential_message',details);
  if(state==='expired'||state==='revoked'||state==='unknown'){
    const reason='credential:'+state+(details?': '+details:'');
    if(invoiceId!==null)db.prepare("UPDATE regulatory_queue SET state='blocked',next_attempt_at=NULL,last_error=?,updated_at=? WHERE invoice_id=? AND state IN ('ready','retry','sending')").run(reason,checkedAt,invoiceId);
    else db.prepare("UPDATE regulatory_queue SET state='blocked',next_attempt_at=NULL,last_error=?,updated_at=? WHERE state IN ('ready','retry')").run(reason,checkedAt);
  }else{
    db.prepare("UPDATE regulatory_queue SET state='retry',next_attempt_at=NULL,last_error='',updated_at=? WHERE state='blocked' AND last_error LIKE 'credential:%'").run(checkedAt);
  }
  return {state,expiresAt:expiry||null,checkedAt,message:details};
});}

export function recoverInterruptedComplianceWork(db,{now=new Date().toISOString()}={}) { return tx(db,()=>{
  const sending=db.prepare("SELECT invoice_id,updated_at,attempts FROM regulatory_queue WHERE state='sending' ORDER BY invoice_id").all();
  for(const item of sending){
    const finishedAt=new Date(now).toISOString(),startedAt=new Date(item.updated_at).toISOString(),delay=Math.min(3600,30*2**Math.min(item.attempts,7));
    const reason='أعيدت بعد انقطاع الخادم؛ ستستخدم المحاولة UUID والبصمة نفسيهما دون إنشاء فاتورة جديدة';
    db.prepare('INSERT INTO regulatory_attempts(invoice_id,started_at,finished_at,outcome,response_code,response_summary) VALUES(?,?,?,?,?,?)')
      .run(item.invoice_id,startedAt,finishedAt,'retry',null,reason);
    db.prepare("UPDATE regulatory_queue SET state='retry',attempts=attempts+1,next_attempt_at=?,last_error=?,updated_at=? WHERE invoice_id=? AND state='sending'")
      .run(new Date(Date.parse(finishedAt)+delay*1000).toISOString(),reason,finishedAt,item.invoice_id);
  }
  return sending.length;
});}

export function releaseComplianceWork(db,id,{state='blocked',reason=''}={}) { return tx(db,()=>{
  if(!['blocked','retry'].includes(state))throw Error('حالة إعادة الامتثال غير صالحة');
  const updated=db.prepare("UPDATE regulatory_queue SET state=?,next_attempt_at=NULL,last_error=?,updated_at=? WHERE invoice_id=? AND state IN ('sending','ready')")
    .run(state,String(reason).slice(0,1000),new Date().toISOString(),id);
  if(!updated.changes)throw Error('لا يوجد عمل امتثال قيد المعالجة');
  return {id:Number(id),state};
});}

export function archiveSignedComplianceDocument(db,id,{content,qr}) { return tx(db,()=>{
  const invoice=db.prepare("SELECT * FROM invoices WHERE id=? AND status='draft'").get(id);
  const queue=db.prepare("SELECT operation,state FROM regulatory_queue WHERE invoice_id=?").get(id);
  if(!invoice||queue?.operation!=='reporting'||queue.state!=='sending'||typeof content!=='string'||!content.trim()||typeof qr!=='string'||!qr)throw Error('المستند الموقع غير صالح للأرشفة');
  if(extractZatcaQr(content)!==qr)throw Error('رمز QR المؤرشف لا يطابق الرمز المضمن في XML النهائي');
  const candidate=db.prepare("SELECT content,sha256 FROM invoice_documents WHERE invoice_id=? AND kind='xml_candidate'").get(id);
  if(!candidate||sha256b64(candidate.content)!==candidate.sha256)throw Error('مرشح XML غير صالح');
  const nowIso=new Date().toISOString();
  db.prepare('INSERT INTO invoice_documents VALUES(?,?,?,?,?,?)').run(id,'signed_xml',content,sha256b64(content),nowIso,nowIso);
  db.prepare('UPDATE invoices SET qr=? WHERE id=?').run(qr,id);
  db.prepare("UPDATE regulatory_queue SET state='ready',last_error='',next_attempt_at=NULL,updated_at=? WHERE invoice_id=?").run(new Date().toISOString(),id);
  return {id:Number(id),state:'ready'};
});}

export function recordClearanceAccepted(db,id,{startedAt,responseCode=null,responseSummary='',clearedXml}) { return tx(db,()=>{
  const invoice=db.prepare("SELECT * FROM invoices WHERE id=? AND status='draft'").get(id);
  const queue=db.prepare("SELECT attempts FROM regulatory_queue WHERE invoice_id=? AND operation='clearance' AND state='sending'").get(id);
  if(!invoice||!queue||typeof clearedXml!=='string'||!clearedXml.trim())throw Error('استجابة التخليص المقبولة غير مكتملة');
  const candidate=db.prepare("SELECT content,sha256 FROM invoice_documents WHERE invoice_id=? AND kind='xml_candidate'").get(id);
  if(!candidate||sha256b64(candidate.content)!==candidate.sha256)throw Error('مرشح التخليص غير صالح');
  const now=new Date().toISOString();
  db.prepare('INSERT INTO invoice_documents VALUES(?,?,?,?,?,?)').run(id,'cleared_xml',clearedXml,sha256b64(clearedXml),now,now);
  db.prepare('INSERT INTO regulatory_attempts(invoice_id,started_at,finished_at,outcome,response_code,response_summary) VALUES(?,?,?,?,?,?)')
    .run(id,startedAt,now,'accepted',responseCode,responseSummary);
  db.prepare("UPDATE regulatory_queue SET state='accepted',attempts=?,next_attempt_at=NULL,last_error='',last_response=?,updated_at=? WHERE invoice_id=?")
    .run(queue.attempts+1,responseSummary||null,now,id);
  return {id:Number(id),state:'accepted'};
});}

export function finalizeComplianceIssue(db,id,{documentKind,content,qr=null}={}) { return tx(db,()=>{
  const inv=db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  if(!inv||inv.status!=='draft')throw Error('الفاتورة ليست مسودة');
  const queue=db.prepare('SELECT * FROM regulatory_queue WHERE invoice_id=?').get(id);
  if(!queue||!((queue.operation==='reporting'&&['sending','ready'].includes(queue.state)&&documentKind==='signed_xml')||(queue.operation==='clearance'&&queue.state==='accepted'&&documentKind==='cleared_xml')))throw Error('حالة مسار الامتثال لا تسمح بترحيل الفاتورة');
  if(typeof content!=='string'||!content.trim())throw Error('المستند النهائي فارغ');
  const candidate=db.prepare("SELECT content,sha256 FROM invoice_documents WHERE invoice_id=? AND kind='xml_candidate'").get(id);
  if(!candidate||sha256b64(candidate.content)!==candidate.sha256)throw Error('مرشح XML غير صالح');
  const snapshot=db.prepare('SELECT company,party FROM invoice_snapshots WHERE invoice_id=?').get(id);
  if(!snapshot)throw Error('لقطة بيانات الإصدار مفقودة');
  const company=JSON.parse(snapshot.company),buyer=JSON.parse(snapshot.party);
  const taxes=db.prepare('SELECT * FROM invoice_tax_totals WHERE invoice_id=? ORDER BY tax_category,vat_rate,exemption_code').all(id);
  const lines=db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY line_no').all(id);
  const reference=inv.ref_invoice_id?db.prepare('SELECT number FROM invoices WHERE id=?').get(inv.ref_invoice_id)?.number:null;
  if(candidateHash({invoice:{...inv,ref_number:reference,lines},company,buyer,taxes})!==inv.hash)throw Error('تغيرت بيانات الفاتورة بعد حجز تسلسلها؛ لا يمكن ترحيلها');
  if(documentKind==='signed_xml'){
    const archived=db.prepare("SELECT content,sha256 FROM invoice_documents WHERE invoice_id=? AND kind='signed_xml'").get(id);
    if(archived){if(archived.content!==content||sha256b64(content)!==archived.sha256)throw Error('ملف XML الموقع لا يطابق النسخة المؤرشفة');}
    else {
      const nowIso=new Date().toISOString();
      db.prepare('INSERT INTO invoice_documents VALUES(?,?,?,?,?,?)').run(id,documentKind,content,sha256b64(content),nowIso,nowIso);
    }
  }
  else {
    const archived=db.prepare("SELECT content,sha256 FROM invoice_documents WHERE invoice_id=? AND kind='cleared_xml'").get(id);
    if(!archived||archived.content!==content||sha256b64(content)!==archived.sha256)throw Error('ملف التخليص المؤرشف لا يطابق الاستجابة');
  }
  const stockCost=postInvoiceStock(db,inv),cn=inv.type==='381',pay=ACC[inv.payment],cc=inv.cost_center_id||null;
  const side=(account,amount,debit)=>({account,debit:debit?amount:0,credit:debit?0:amount,cost_center_id:cc});
  const entryLines=[side(pay,inv.total,!cn),side(ACC.sales,inv.subtotal,cn)];
  if(inv.vat>0)entryLines.push(side(ACC.vatOut,inv.vat,cn));
  if(stockCost.cost>0)entryLines.push(side('5101',stockCost.cost,!cn),side('1401',stockCost.cost,cn));
  db.prepare("UPDATE invoices SET status='issued',qr=? WHERE id=?").run(queue.operation==='reporting'?qr:null,id);
  postEntry(db,{date:inv.issue_date,description:`${cn?'إشعار دائن':'فاتورة'} ${inv.number}`,source_type:'invoice',source_id:id,branch_id:inv.branch_id,lines:entryLines});
  appendAudit(db,{actor:inv.created_by,event:'invoice.issued.development',entity_type:'invoice',entity_id:id,details:{uuid:inv.uuid,number:inv.number,document_code:inv.document_code,invoice_kind:inv.invoice_kind,hash:inv.hash,delivery:queue.operation==='reporting'?'signed_pending_reporting':'cleared',validation:'official'}});
  const installation=db.prepare('SELECT id FROM installation LIMIT 1').get().id,payload=getInvoice(db,id);
  db.prepare('INSERT INTO sync_outbox(event_id,installation_id,aggregate_uuid,event_type,payload,created_at) VALUES(?,?,?,?,?,?)')
    .run(crypto.randomUUID(),installation,inv.uuid,'invoice.issued',JSON.stringify({version:1,installation_id:installation,invoice:payload}),new Date().toISOString());
  if(queue.operation==='reporting')db.prepare("UPDATE regulatory_queue SET state='ready',last_error='',next_attempt_at=NULL,updated_at=? WHERE invoice_id=?").run(new Date().toISOString(),id);
  return Number(id);
});}

function resolveInvoiceDue(issueDate,paymentTermsDays,dueDate){
  const terms=Math.max(0,Math.min(3650,Number(paymentTermsDays||0)|0));
  if(dueDate){const d=validDate(dueDate,{allowFuture:true});if(issueDate&&d<issueDate)throw Error('تاريخ الاستحقاق لا يمكن أن يسبق تاريخ المستند');return {payment_terms_days:terms,due_date:d};}
  if(!issueDate) return {payment_terms_days:terms,due_date:null};
  const d=new Date(issueDate+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+terms);
  return {payment_terms_days:terms,due_date:d.toISOString().slice(0,10)};
}
export const createInvoice = (db, user, b) => tx(db, () => {
  assertSupported(b);const lines = calcLines(prepareItemLines(db,b.lines || [],b.pos_id));
  if (!lines.length) throw new Error('الفاتورة بلا بنود');
  const due=resolveInvoiceDue(null,b.payment_terms_days,b.due_date);
  const id = insertInvoice(db, { type: '388', lines, pos_id: b.pos_id, party_id: b.party_id, payment: b.payment, notes:b.notes,user,invoice_kind:b.invoice_kind,supply_date:b.supply_date,payment_terms_days:due.payment_terms_days,due_date:due.due_date,cost_center_id:b.cost_center_id||null });
  if (!b.draft) issueInvoice(db, id);
  return id;
});

function stableRequestValue(value){
  if(Array.isArray(value))return value.map(stableRequestValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).filter(key=>key!=='request_id'&&key!=='deferIssue').sort().map(key=>[key,stableRequestValue(value[key])]));
  return value;
}

export function createIdempotentIssueRequest(db,user,operation,requestId,payload,create){
  if(!['invoice','credit_note','debit_note'].includes(operation)||typeof requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))throw Error('معرف طلب إصدار صالح مطلوب');
  if(typeof create!=='function')throw new TypeError('منشئ الفاتورة غير صالح');
  const requestHash=crypto.createHash('sha256').update(JSON.stringify({user,operation,payload:stableRequestValue(payload)})).digest('hex');
  return tx(db,()=>{
    const previous=db.prepare('SELECT user_id,operation,request_hash,invoice_id FROM invoice_issue_requests WHERE request_id=?').get(requestId);
    if(previous){
      if(previous.user_id!==user||previous.operation!==operation||previous.request_hash!==requestHash){const error=Error('معرف طلب الإصدار مستخدم ببيانات مختلفة');error.status=409;throw error;}
      return {id:Number(previous.invoice_id),replayed:true};
    }
    const invoiceId=Number(create());
    if(!Number.isSafeInteger(invoiceId)||invoiceId<=0)throw Error('تعذر إنشاء الفاتورة المرتبطة بالطلب');
    db.prepare('INSERT INTO invoice_issue_requests(request_id,user_id,operation,request_hash,invoice_id,created_at) VALUES(?,?,?,?,?,?)')
      .run(requestId,user,operation,requestHash,invoiceId,new Date().toISOString());
    return {id:invoiceId,replayed:false};
  });
}

export const remainingQty = (db, invId) => db.prepare(`
  SELECT l.line_no, l.qty - COALESCE((SELECT SUM(cl.qty) FROM invoice_lines cl JOIN invoices ci ON ci.id=cl.invoice_id
    WHERE ci.ref_invoice_id=l.invoice_id AND ci.type='381' AND ci.status='issued' AND cl.line_no=l.line_no),0) AS remaining
  FROM invoice_lines l WHERE l.invoice_id=?`).all(invId);

// إشعار دائن كامل أو جزئي. body.lines = [{line_no, qty}] وإن غابت فالمتبقي كله.
export const createCreditNote = (db, user, origId, b) => tx(db, () => {
  const o = db.prepare('SELECT * FROM invoices WHERE id=?').get(origId);
  const isStandard = o.invoice_kind === 'standard';
  const validOriginal = isStandard 
    ? (o.type === '388' && o.document_code === '388')
    : (o.type === '388' && o.document_code === '389');
  if (!o || o.status !== 'issued' || !validOriginal) throw new Error('يمكن إصدار إشعار دائن لفاتورة صادرة فقط');
  if (!String(b.reason || '').trim()) throw new Error('سبب الإشعار مطلوب');
  const rem = Object.fromEntries(remainingQty(db, origId).map(r => [r.line_no, r.remaining]));
  const orig = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY line_no').all(origId);
  const want = b.lines?.length ? b.lines : orig.map(l => ({ line_no: l.line_no, qty: rem[l.line_no] }));
  const lines = [], seen = new Set();
  if (Array.isArray(b.lines) && !b.lines.length) throw new Error('حدد كمية واحدة على الأقل للإرجاع');
  for (const w of want) {
    const ol = orig.find(l => l.line_no === Number(w.line_no)), q = Number(w.qty);
    if (!ol) throw new Error('بند غير موجود في الفاتورة الأصلية');
    if (seen.has(ol.line_no)) throw new Error('لا يمكن تكرار بند الإرجاع');
    seen.add(ol.line_no);
    if (!Number.isFinite(q)) throw new Error('كمية الإرجاع غير صالحة');
    if (!(q > 0)) continue;
    if (q > rem[ol.line_no] + 1e-9) throw new Error(`الكمية المرتجعة للبند ${ol.line_no} أكبر من المتبقي (${rem[ol.line_no]})`);
    const listPrice=ol.list_price>0?ol.list_price:ol.unit_price;
    lines.push({ original_line_no: ol.line_no, tracking:trackingInput(w.tracking), description: ol.description, qty: q, unit_price: listPrice / 100, discount_rate:(ol.discount_rate||0)/100, vat_rate:ol.vat_rate,tax_category:ol.tax_category,exemption_code:ol.exemption_code,exemption_reason:ol.exemption_reason,unit_code:ol.unit_code,item_id:ol.item_id,stock_qty_micro:ol.stock_qty_micro?baseQuantity(q,ol.unit_factor_micro):0,unit_factor_micro:ol.unit_factor_micro,unit_name:ol.unit_name,warehouse_id:ol.warehouse_id });
  }
  if (!lines.length) throw new Error('لا توجد كميات للإرجاع');
  const creditNoteDocumentCode = '381';
  const id = insertInvoice(db, { type: '381', document_code: creditNoteDocumentCode, lines: calcLines(lines).map((l, i) => ({ ...l, line_no: lines[i].original_line_no })), pos_id: o.pos_id, party_id: o.party_id, payment: o.payment, ref: origId, reason:b.reason,user,invoice_kind:o.invoice_kind,supply_date:o.supply_date,due_date:o.due_date||o.issue_date,payment_terms_days:o.payment_terms_days||0,cost_center_id:o.cost_center_id||null });
  const amounts=db.prepare('SELECT subtotal,vat FROM invoices WHERE id=?').get(id),previous=db.prepare("SELECT COALESCE(SUM(subtotal),0) subtotal,COALESCE(SUM(vat),0) vat FROM invoices WHERE ref_invoice_id=? AND type='381' AND status='issued'").get(origId);
  if(previous.subtotal+amounts.subtotal>o.subtotal||previous.vat+amounts.vat>o.vat)throw Error('مبالغ الإشعار تتجاوز المتبقي؛ يلزم مسار تسوية كسور');
  if(!b.deferIssue)issueInvoice(db,id);return id;
});

export function getInvoice(db, id) {
  const inv = db.prepare(`SELECT i.*, p.name_ar AS party_name, p.vat_number AS party_vat, p.phone AS party_phone, r.number AS ref_number
    FROM invoices i LEFT JOIN parties p ON p.id=i.party_id LEFT JOIN invoices r ON r.id=i.ref_invoice_id WHERE i.id=?`).get(id);
  if (!inv) return null;
  const snapshot = db.prepare('SELECT company,party FROM invoice_snapshots WHERE invoice_id=?').get(id);
  if (snapshot) {
    inv.company_snapshot = JSON.parse(snapshot.company);inv.party_snapshot=JSON.parse(snapshot.party);
    const party = JSON.parse(snapshot.party);
    inv.party_name = party?.name_ar || null; inv.party_vat = party?.vat_number || null;
  }
  inv.tax_totals=db.prepare('SELECT * FROM invoice_tax_totals WHERE invoice_id=?').all(id);
  inv.lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY line_no').all(id);
  for(const line of inv.lines){line.tracking_mode=line.item_id?db.prepare('SELECT tracking_mode FROM items WHERE id=?').get(line.item_id)?.tracking_mode||'none':'none';const movement=db.prepare('SELECT id FROM stock_movements WHERE invoice_id=? AND line_no=?').get(inv.id,line.line_no);line.tracking=movement?movementTracking(db,movement.id):JSON.parse(line.tracking_json||'[]');line.tracking_remaining=movement&&inv.type==='388'?remainingTracking(db,movement.id):[];}
  if (inv.type === '388' && inv.status === 'issued') {
    const rem = Object.fromEntries(remainingQty(db, id).map(r => [r.line_no, r.remaining]));
    inv.lines.forEach(l => (l.remaining = rem[l.line_no]));
  }
  return inv;
}

export function trialBalance(db) {
  const rows = db.prepare(`SELECT a.code, a.name_ar, a.type, COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c
    FROM accounts a LEFT JOIN journal_lines l ON l.account_code=a.code GROUP BY a.code ORDER BY a.code`).all();
  const td = rows.reduce((s, r) => s + r.d, 0), tc = rows.reduce((s, r) => s + r.c, 0);
  return { rows: rows.map(r => ({ code: r.code, name: r.name_ar, type: r.type, debit: fromCents(r.d), credit: fromCents(r.c) })),
           total_debit: fromCents(td), total_credit: fromCents(tc), balanced: td === tc };
}

// تقرير ضريبة القيمة المضافة من الدفاتر نفسها (فيشمل المشتريات والقيود اليدوية مستقبلًا)
export function vatReport(db, from, to) {
  const bal = (code, debitPositive) => {
    const r = db.prepare(`SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM journal_lines l
      JOIN journal_entries e ON e.id=l.entry_id WHERE l.account_code=? AND e.entry_date BETWEEN ? AND ?`).get(code, from, to);
    return debitPositive ? r.d - r.c : r.c - r.d;
  };
  const byRate=db.prepare(`SELECT t.vat_rate rate,SUM(CASE i.type WHEN '381' THEN -t.taxable ELSE t.taxable END) base,SUM(CASE i.type WHEN '381' THEN -t.vat ELSE t.vat END) vat FROM invoice_tax_totals t JOIN invoices i ON i.id=t.invoice_id WHERE i.status='issued' AND i.issue_date BETWEEN ? AND ? GROUP BY t.vat_rate`).all(from,to);
  const out = bal('2201', false), inn = bal('1301', true);
  return { from, to, sales_by_rate: byRate.map(r => ({ rate: r.rate, base: fromCents(r.base), vat: fromCents(r.vat) })),
           output_vat: fromCents(out), input_vat: fromCents(inn), net_due: fromCents(out - inn) };
}

export const createDebitNote=(db,user,originalId,body)=>tx(db,()=>{assertSupported(body);const original=getInvoice(db,originalId);if(!original||original.status!=='issued'||(original.document_code!=='388' && original.document_code!=='389'))throw Error('الإشعار المدين يحتاج فاتورة أصلية صادرة');if(!String(body.reason||'').trim())throw Error('سبب الإشعار المدين مطلوب');const id=insertInvoice(db,{type:'388',document_code:'383',lines:calculateLines(body.lines),pos_id:original.pos_id,party_id:original.party_id,payment:original.payment,ref:originalId,reason:body.reason,user,invoice_kind:original.invoice_kind,supply_date:body.supply_date||original.supply_date,due_date:body.due_date||original.due_date||original.issue_date,payment_terms_days:body.payment_terms_days??original.payment_terms_days??0});if(!body.deferIssue)issueInvoice(db,id);return id;});
