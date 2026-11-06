import crypto from 'node:crypto';
import { tx } from './db.js';
import { toCents, fromCents, tlv, sha256b64, nowRiyadh } from './lib.js';
import { calculateLines, taxBreakdown } from './money.js';
import { assertIssueData, assertSupported } from './compliance.js';
import { appendAudit } from './audit.js';
import { buildInvoiceXml, candidateHash } from './zatca/xml.js';
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
  const d = e.lines.reduce((s, l) => s + (l.debit || 0), 0), c = e.lines.reduce((s, l) => s + (l.credit || 0), 0);
  if (d !== c || d === 0 || e.lines.length < 2) throw new Error('القيد غير متوازن');
  const id = db.prepare('INSERT INTO journal_entries(entry_no,entry_date,description,source_type,source_id,branch_id) VALUES(?,?,?,?,?,?)')
    .run(nextCounter(db, 'entry'), e.date, e.description ?? null, e.source_type ?? null, e.source_id ?? null, e.branch_id ?? null).lastInsertRowid;
  const st = db.prepare('INSERT INTO journal_lines(entry_id,account_code,debit,credit) VALUES(?,?,?,?)');
  for (const l of e.lines) {if(!Number.isSafeInteger(l.debit||0)||!Number.isSafeInteger(l.credit||0)||!db.prepare('SELECT 1 FROM accounts WHERE code=? AND postable=1').get(l.account))throw Error('حساب أو مبلغ القيد غير صالح');st.run(id,l.account,l.debit||0,l.credit||0);}
  db.prepare('INSERT INTO journal_seals(entry_id) VALUES(?)').run(id);
  return id;
}

const calcLines=input=>calculateLines(input).map((line,i)=>({...line,item_id:input[i].item_id||null,stock_qty_micro:input[i].stock_qty_micro||0,unit_factor_micro:input[i].unit_factor_micro||1000000,unit_name:input[i].unit_name||'',warehouse_id:input[i].warehouse_id||null}));
function insertInvoice(db, o) {
  const taxes=taxBreakdown(o.lines),sub=o.lines.reduce((s,l)=>s+l.net,0),vat=taxes.reduce((s,g)=>s+g.vat,0);
  if(!Number.isSafeInteger(sub+vat))throw Error('قيمة الفاتورة أكبر من المسموح');
  const pos = db.prepare('SELECT * FROM pos_points WHERE id=? AND active=1').get(o.pos_id || 1);
  if (!pos) throw new Error('نقطة البيع غير موجودة أو موقوفة');
  const id = db.prepare(`INSERT INTO invoices(uuid,type,pos_id,branch_id,party_id,payment,subtotal,vat,total,ref_invoice_id,reason,notes,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), o.type, pos.id, pos.branch_id, o.party_id || null, o.payment || 'cash',
    sub, vat, sub + vat, o.ref || null, o.reason || null, o.notes || null, o.user || null).lastInsertRowid;
  const party=o.party_id?db.prepare('SELECT * FROM parties WHERE id=?').get(o.party_id):null;
  const kind=o.invoice_kind||(party&&(party.vat_number||party.entity_type==='business')?'standard':'simplified');
  if(!['standard','simplified'].includes(kind))throw Error('نوع الفاتورة غير صالح');
  db.prepare('UPDATE invoices SET invoice_kind=?,document_code=?,supply_date=?,environment=? WHERE id=?').run(kind,o.document_code||o.type,o.supply_date||null,'development',id);
  const st=db.prepare('INSERT INTO invoice_lines(invoice_id,line_no,description,qty,unit_price,vat_rate,net,vat,total,tax_category,exemption_code,exemption_reason,unit_code,item_id,stock_qty_micro,unit_factor_micro,unit_name,warehouse_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const l of o.lines)st.run(id,l.line_no,l.description,l.qty,l.unit_price,l.vat_rate,l.net,l.vat,l.total,l.tax_category,l.exemption_code,l.exemption_reason,l.unit_code,l.item_id||null,l.stock_qty_micro||0,l.unit_factor_micro||1000000,l.unit_name||'',l.warehouse_id||null);
  for(const g of taxes)db.prepare('INSERT INTO invoice_tax_totals VALUES(?,?,?,?,?,?,?)').run(id,g.tax_category,g.vat_rate,g.exemption_code,g.exemption_reason,g.taxable,g.vat);
  return id;
}

export const issueInvoice = (db, id) => tx(db, () => issueInvoiceAtomic(db, id));
function issueInvoiceAtomic(db, id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
  if (!inv || inv.status !== 'draft') throw new Error('الفاتورة ليست مسودة');
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
  postInvoiceStock(db,inv);
  const number = `${pos.prefix}-${String(nextCounter(db, 'inv:' + pos.prefix)).padStart(6, '0')}`;
  let ch = db.prepare('SELECT * FROM chain WHERE branch_id=?').get(inv.branch_id);
  if (!ch) { db.prepare('INSERT INTO chain(branch_id,icv,last_hash) VALUES(?,0,?)').run(inv.branch_id, INIT_HASH); ch = { icv: 0, last_hash: INIT_HASH }; }
  const { date, time } = nowRiyadh(), icv = ch.icv + 1, pih = ch.last_hash;
  const taxes=db.prepare('SELECT * FROM invoice_tax_totals WHERE invoice_id=? ORDER BY tax_category,vat_rate,exemption_code').all(id);
  const reference=inv.ref_invoice_id?db.prepare('SELECT number FROM invoices WHERE id=?').get(inv.ref_invoice_id)?.number:null;
  const document={...inv,number,issue_date:date,issue_time:time,icv,pih,ref_number:reference,lines:db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY line_no').all(id)};
  const hash=candidateHash({invoice:document,company:co,buyer:party,taxes});
  const qr=tlv([[1,co.name_ar],[2,co.vat_number],[3,`${date}T${time}+03:00`],[4,fromCents(inv.total)],[5,fromCents(inv.vat)]]);
  document.qr=qr;
  const xml=buildInvoiceXml({invoice:document,company:co,buyer:party,taxes});
  db.prepare('INSERT INTO invoice_documents VALUES(?,?,?,?,?)').run(id,'xml_candidate',xml,sha256b64(xml),new Date(now).toISOString());
  db.prepare('INSERT INTO regulatory_queue(invoice_id,operation,state,last_error,updated_at) VALUES(?,?,?,?,?)').run(id,inv.invoice_kind==='standard'?'clearance':'reporting','blocked','development: لم يتحقق SDK ولم تهيأ شهادة الجهاز أو التوقيع',new Date(now).toISOString());
  db.prepare('UPDATE chain SET icv=?, last_hash=? WHERE branch_id=?').run(icv, hash, inv.branch_id);
  db.prepare("UPDATE invoices SET status='issued', number=?, issue_date=?, issue_time=?, icv=?, pih=?, hash=?, qr=? WHERE id=?")
    .run(number, date, time, icv, pih, hash, qr, id);
  const cn = inv.type === '381', pay = ACC[inv.payment];
  const side = (acc, amt, debit) => ({ account: acc, debit: debit ? amt : 0, credit: debit ? 0 : amt });
  const lines = [side(pay, inv.total, !cn), side(ACC.sales, inv.subtotal, cn)];
  if (inv.vat > 0) lines.push(side(ACC.vatOut, inv.vat, cn));
  postEntry(db, { date, description: `${cn ? 'إشعار دائن' : 'فاتورة'} ${number}`, source_type: 'invoice', source_id: id, branch_id: inv.branch_id, lines });
  appendAudit(db,{actor:inv.created_by,event:'invoice.issued.development',entity_type:'invoice',entity_id:id,details:{uuid:inv.uuid,number,document_code:inv.document_code,invoice_kind:inv.invoice_kind,hash,validation:'not_sdk_validated'}});
  const installation = db.prepare('SELECT id FROM installation LIMIT 1').get().id;
  const payload = getInvoice(db, id);
  db.prepare('INSERT INTO sync_outbox(event_id,installation_id,aggregate_uuid,event_type,payload,created_at) VALUES(?,?,?,?,?,?)')
    .run(crypto.randomUUID(), installation, inv.uuid, 'invoice.issued', JSON.stringify({ version: 1, installation_id: installation, invoice: payload }), new Date().toISOString());
  return id;
}

export const createInvoice = (db, user, b) => tx(db, () => {
  assertSupported(b);const lines = calcLines(prepareItemLines(db,b.lines || [],b.pos_id));
  if (!lines.length) throw new Error('الفاتورة بلا بنود');
  const id = insertInvoice(db, { type: '388', lines, pos_id: b.pos_id, party_id: b.party_id, payment: b.payment, notes:b.notes,user,invoice_kind:b.invoice_kind,supply_date:b.supply_date });
  if (!b.draft) issueInvoice(db, id);
  return id;
});

export const remainingQty = (db, invId) => db.prepare(`
  SELECT l.line_no, l.qty - COALESCE((SELECT SUM(cl.qty) FROM invoice_lines cl JOIN invoices ci ON ci.id=cl.invoice_id
    WHERE ci.ref_invoice_id=l.invoice_id AND ci.type='381' AND ci.status='issued' AND cl.line_no=l.line_no),0) AS remaining
  FROM invoice_lines l WHERE l.invoice_id=?`).all(invId);

// إشعار دائن كامل أو جزئي. body.lines = [{line_no, qty}] وإن غابت فالمتبقي كله.
export const createCreditNote = (db, user, origId, b) => tx(db, () => {
  const o = db.prepare('SELECT * FROM invoices WHERE id=?').get(origId);
  if (!o || o.status !== 'issued' || (o.type !== '388'||o.document_code!=='388')) throw new Error('يمكن إصدار إشعار دائن لفاتورة صادرة فقط');
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
    lines.push({ original_line_no: ol.line_no, description: ol.description, qty: q, unit_price: ol.unit_price / 100, vat_rate:ol.vat_rate,tax_category:ol.tax_category,exemption_code:ol.exemption_code,exemption_reason:ol.exemption_reason,unit_code:ol.unit_code,item_id:ol.item_id,stock_qty_micro:ol.stock_qty_micro?baseQuantity(q,ol.unit_factor_micro):0,unit_factor_micro:ol.unit_factor_micro,unit_name:ol.unit_name,warehouse_id:ol.warehouse_id });
  }
  if (!lines.length) throw new Error('لا توجد كميات للإرجاع');
  const id = insertInvoice(db, { type: '381', lines: calcLines(lines).map((l, i) => ({ ...l, line_no: lines[i].original_line_no })), pos_id: o.pos_id, party_id: o.party_id, payment: o.payment, ref: origId, reason:b.reason,user,invoice_kind:o.invoice_kind,supply_date:o.supply_date });
  const amounts=db.prepare('SELECT subtotal,vat FROM invoices WHERE id=?').get(id),previous=db.prepare("SELECT COALESCE(SUM(subtotal),0) subtotal,COALESCE(SUM(vat),0) vat FROM invoices WHERE ref_invoice_id=? AND type='381' AND status='issued'").get(origId);
  if(previous.subtotal+amounts.subtotal>o.subtotal||previous.vat+amounts.vat>o.vat)throw Error('مبالغ الإشعار تتجاوز المتبقي؛ يلزم مسار تسوية كسور');
  issueInvoice(db,id);return id;
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

export const createDebitNote=(db,user,originalId,body)=>tx(db,()=>{assertSupported(body);const original=getInvoice(db,originalId);if(!original||original.status!=='issued'||original.document_code!=='388')throw Error('الإشعار المدين يحتاج فاتورة أصلية صادرة');if(!String(body.reason||'').trim())throw Error('سبب الإشعار المدين مطلوب');const id=insertInvoice(db,{type:'388',document_code:'383',lines:calculateLines(body.lines),pos_id:original.pos_id,party_id:original.party_id,payment:original.payment,ref:originalId,reason:body.reason,user,invoice_kind:original.invoice_kind,supply_date:body.supply_date||original.supply_date});issueInvoice(db,id);return id;});
