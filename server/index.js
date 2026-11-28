import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { hashPass, checkPass, toCents, fromCents, nowRiyadh } from './lib.js';
import { getSetting, setSetting, seedCompany, createInvoice, createCreditNote, createDebitNote, createIdempotentIssueRequest, issueInvoice, getInvoice, recoverInterruptedComplianceWork, trialBalance, vatReport } from './core.js';
import { evaluate, verifyLicenseFile, PUB } from './license.js';
import { renderInvoice, sampleInvoice } from './render.js';
import { DEFAULTS } from './defaults.js';
import { profileKey, validatePrintSettings, validateCompany } from './printing.js';
import { tx } from './db.js';
import { validateIdentity } from './compliance.js';
import { calculateLines } from './money.js';
import { appendAudit } from './audit.js';
import {maintenance} from './maintenance.js';
import { createPosSale, posPricing } from './pos.js';
import { scaledInteger } from './money.js';
import { validateScaleSettings } from './pos-scale.js';
import {listItems,saveItem} from './items.js';
import {posCatalog,posBarcode,posSelection} from './pos-catalog.js';
import {catalogPoint,companyActivity,posPoint,validateActivity} from './activity.js';
import {recordStock} from './inventory.js';
import {createPurchase,listPurchases,purchaseDetails,createVoucher,partyLedger,postManualJournal,validDate,financialReport} from './commercial.js';
import {stockValuation} from './valuation.js';
import {openShift,closeShift,shiftSummary,posReturn,createStocktake,approveStocktake} from './operations.js';
import {syncInfo,configureSync,syncBranch} from './sync.js';
import {isLoopback,localAccess,localCookie,sessionDigest} from './local-session.js';
import {createQuotation,quotation,convertQuotation,cancelQuotation} from './quotations.js';
import {commercialPrint} from './commercial-print.js';
import {commercialList,shiftList,complianceList,posHistoryList} from './lists.js';
import {traceList} from './tracking.js';
import {correctLegacyCost} from './cost-correction.js';
import {allocateVoucher,voucherDetails,outstandingDocuments,reverseManualJournal} from './settlements.js';
import {listCostCenters,createCostCenter,updateCostCenter,deleteCostCenter,costCenterReport} from './cost-centers.js';
import {listPriceLevels,createPriceLevel,updatePriceLevel,deletePriceLevel,listItemPriceLevels,setItemPriceLevel,listPartyPriceLists,createPartyPriceList,deletePartyPriceList} from './price-levels.js';
import { complianceAcceptance } from './compliance-acceptance.js';
import { createWindowsDpapiStore } from './zatca/windows-dpapi.js';
import { generateAndStoreIssuerKey, getIssuerKeyStatus, IssuerKeyConflict } from './zatca/keys.js';
import { loadEcdsaCertificate, loadEcdsaPrivateKey } from './zatca/node-crypto.js';
import { signInvoiceXml } from './zatca/signature.js';
import { buildInvoiceXml, candidateHash } from './zatca/xml.js';
import { createComplianceIssuance } from './zatca/issuance.js';
import { createTransport } from './zatca/transport.js';
import { extractZatcaQr } from './zatca/qr.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const appVersion = JSON.parse(fs.readFileSync(path.join(here,'..','package.json'),'utf8').replace(/^\uFEFF/, '')).version;
const WEB = path.join(here, '..', 'web');
class HttpError extends Error { constructor(s, m) { super(m); this.status = s; } }
class Raw { constructor(body, type = 'text/html; charset=utf-8', headers = {}) { Object.assign(this, { body, type, headers }); } }
class FileRaw {constructor(download,headers){Object.assign(this,{download,headers});}}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function createApp({ dbFile, licensePath, tls, complianceIssuance = null, complianceSecretStore: suppliedComplianceSecretStore = null, reportingIntervalMs = 0 }) {
  if(complianceIssuance&&['issue','reportReady','retryClearances','processQueue'].some(name=>typeof complianceIssuance[name]!=='function'))throw new TypeError('موفر إصدار الامتثال غير صالح');
  const complianceSecretStore=suppliedComplianceSecretStore??(
    process.platform==='win32'&&process.env.LOCALAPPDATA
      ?createWindowsDpapiStore(path.join(process.env.LOCALAPPDATA,'Almuhtariz','zatca','credentials.dpapi'))
      :null
  );
  if(complianceSecretStore&&['has','save','load'].some(name=>typeof complianceSecretStore[name]!=='function'))throw new TypeError('مخزن أسرار الامتثال غير صالح');
  if(!Number.isSafeInteger(reportingIntervalMs)||reportingIntervalMs<0||reportingIntervalMs>2147483647)throw new TypeError('فاصل دفعات الإبلاغ غير صالح');
  if(reportingIntervalMs&&!complianceIssuance)throw new TypeError('لا يمكن جدولة الإبلاغ قبل تهيئة مسار الامتثال');
  const db = openDb(dbFile), recoveredComplianceWork=recoverInterruptedComplianceWork(db),fails = new Map(), routes = [], jobs=maintenance(dbFile);
  if(recoveredComplianceWork)console.warn(`Recovered ${recoveredComplianceWork} interrupted compliance queue item(s).`);
  const lic = () => evaluate(licensePath, getSetting(db, 'company').vat_number);
  const legacyComplianceCredentials=()=>{const settings=getSetting(db,'compliance');return {certificatePem:settings.certificate_pem||'',privateKeyPem:settings.private_key_pem||''};};
  const legacyComplianceCredentialsExist=()=>{const credentials=legacyComplianceCredentials();return Boolean(credentials.certificatePem||credentials.privateKeyPem);};
  const storedCredentialState=async issuerId=>{
    if(!complianceSecretStore)return{available:false,issuer_matches:false,has_private_key:false,has_certificate:false,certificate_expires_at:null};
    if(!complianceSecretStore.has())return{available:true,issuer_matches:false,has_private_key:false,has_certificate:false,certificate_expires_at:null};
    const stored=await complianceSecretStore.load();
    let certificate_expires_at = null;
    if(stored.certificate_pem){
      try{
        const cert = loadEcdsaCertificate(stored.certificate_pem);
        certificate_expires_at = cert.validTo;
      }catch{}
    }
    return{
      available:true,
      issuer_matches:Boolean(issuerId&&stored.issuer_id===issuerId),
      has_private_key:Boolean(stored.private_key_pem),
      has_certificate:Boolean(stored.certificate_pem),
      certificate_expires_at,
    };
  };
  const route = (m, p, fn, o = {}) => routes.push({ m, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn, ...o });
  const need = (c, m) => { if (!c) throw new HttpError(400, m); };
  const isSetup = () => !!db.prepare('SELECT 1 FROM users').get();
  const complianceValue=key=>db.prepare('SELECT value FROM compliance_state WHERE key=?').get(key)?.value||'';
  const issuerProfile=()=>{
    const raw=complianceValue('issuer_profile');
    if(!raw)return null;
    let profile;
    try{profile=JSON.parse(raw);}catch(error){throw new HttpError(500,'ملف وحدة الإصدار المحلي تالف؛ راجع قاعدة البيانات قبل المتابعة');}
    if(!profile||typeof profile!=='object'||Array.isArray(profile)||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profile.local_id||'')||typeof profile.name!=='string'||!['central_server','independent_branch'].includes(profile.scope)||!/^3\d{13}3$/.test(profile.company_vat_number||'')||!['not_registered','registered'].includes(profile.registration_status)){
      throw new HttpError(500,'ملف وحدة الإصدار المحلي غير صالح؛ راجع قاعدة البيانات قبل المتابعة');
    }
    return {...profile,company_vat_matches:profile.company_vat_number===getSetting(db,'company').vat_number};
  };
  const credentialStatus=()=>{
    let state=complianceValue('credential_status')||'unconfigured',expiresAt=complianceValue('credential_expires_at')||null;
    if(expiresAt){const remaining=Date.parse(expiresAt)-Date.now();if(remaining<=0)state='expired';else if(state==='valid'&&remaining<=30*86400000)state='expiring';}
    return {state,expires_at:expiresAt,checked_at:complianceValue('credential_checked_at')||null,message:complianceValue('credential_message')||''};
  };

  const syncStatus = () => ({ mode: 'local', cloud_configured:syncInfo(db).configured, ...syncInfo(db), pending: db.prepare('SELECT COUNT(*) n FROM sync_outbox o LEFT JOIN sync_receipts r ON r.event_id=o.event_id WHERE r.event_id IS NULL').get().n });

  // ---------- Compliance issuance wiring ----------
  let complianceIssuanceInstance = null;
  if (complianceIssuance) {
    // Use provided compliance issuance (e.g., for testing with mock transport)
    complianceIssuanceInstance = complianceIssuance;
  } else if (complianceSecretStore) {
    const signPrebuiltInvoiceXml = async (db, invoiceXml, invoiceId) => {
      const profile = issuerProfile();
      if (!profile) throw new HttpError(409, 'أنشئ ملف وحدة الإصدار المحلي أولاً');
      const stored = await storedCredentialState(profile.local_id);
      if (!stored.issuer_matches || !stored.has_certificate || !stored.has_private_key) {
        throw new HttpError(400, 'الشهادة والمفتاح المطابقان غير مهيأين لوحدة الإصدار المحلية');
      }
      const credentials = await complianceSecretStore.load();
      const signed = await signInvoiceXml({
        invoiceXml,
        privateKeyPem: credentials.private_key_pem,
        certificatePem: credentials.certificate_pem,
      });

      let qr = null;
      try { qr = extractZatcaQr(signed.xml); } catch { /* QR may not exist if not inserted yet */ }

      return { invoiceId, xml: signed.xml, qr, hash: signed.invoiceHash };
    };

    const signer = async ({ invoiceXml, invoice, invoiceHash, uuid }) => {
      const result = await signPrebuiltInvoiceXml(db, invoiceXml, invoice.id);
      if (result.hash !== invoiceHash) {
        throw new Error('بصمة الفاتورة الموقعة لا تطابق البصمة المحجوزة');
      }
      return { xml: result.xml, qr: result.qr, invoiceHash: result.hash, invoiceId: result.invoiceId };
    };
    const validateXml = async (xml, { operation }) => {
      const { validateWithOfficialSdk } = await import('./zatca/runtime-sdk.js');
      return validateWithOfficialSdk(xml, { operation });
    };
    const complianceMode = getSetting(db, 'compliance').mode;
    let transport;
    if (complianceMode === 'development') {
      transport = createTransport({ environment: 'simulation', binarySecurityToken: '', secret: '' });
    } else {
      const profile = issuerProfile();
      let binarySecurityToken = '';
      let secret = '';
      if (profile && profile.official_identifier) {
        const csidData = complianceMode === 'production'
          ? db.prepare("SELECT value FROM compliance_state WHERE key='csid_production'").get()?.value
          : db.prepare("SELECT value FROM compliance_state WHERE key='csid_compliance'").get()?.value;
        if (csidData) {
          const parsed = JSON.parse(csidData);
          binarySecurityToken = parsed.csid || '';
          secret = parsed.secret || '';
        }
      }
      transport = createTransport({ environment: complianceMode, binarySecurityToken, secret });
    }
    const certificateStatus = async () => {
      const profile = issuerProfile();
      if (!profile) return { state: 'unconfigured', expiresAt: null, message: 'ملف وحدة الإصدار غير مهيأ' };
      const stored = await storedCredentialState(profile.local_id);
      if (!stored.has_certificate || !stored.has_private_key) return { state: 'missing', expiresAt: null, message: 'الشهادة أو المفتاح غير مهيأ' };
      return { state: 'valid', expiresAt: stored.certificate_expires_at, message: 'الشهادة والمفتاح مهيأان محلياً' };
    };
    complianceIssuanceInstance = createComplianceIssuance({ signer, validateXml, transport, certificateStatus });
  }

  // ---------- CSR generation helpers ----------
  async function csrGenerate(issuerId) {
    const profile = issuerProfile();
    if (!profile) throw new HttpError(409, 'أنشئ ملف وحدة الإصدار المحلي قبل إنشاء CSR');
    if (profile.registration_status !== 'not_registered') throw new HttpError(409, 'ملف الوحدة مسجل بالفعل؛ لا يمكن إنشاء CSR جديد');
    const stored = await storedCredentialState(issuerId);
    if (!stored.has_private_key) throw new HttpError(409, 'لم يُولّد مفتاح الوحدة بعد؛ وّلده أولاً');
    const company = getSetting(db, 'company');
    const config = {
      commonName: `${company.name_ar || 'Almuhtariz'} - ${profile.local_id.slice(0, 8)}`,
      serialNumber: `1-${company.cr_number || ''}|2-${company.vat_number}|3-${profile.local_id}`,
      organizationIdentifier: company.vat_number,
      organizationUnitName: company.cr_number || '',
      organizationName: company.name_ar || 'Almuhtariz',
      countryName: 'SA',
      invoiceType: '0001',
      location: [company.city, company.district, company.street, company.building_number].filter(Boolean).join(', '),
      industry: '01',
      template: 'PREZATCA-Code-Signing',
    };
    const keyPem = (await complianceSecretStore.load()).private_key_pem;
    return { csrPem: null, fingerprint: '', config };
  }

  async function csrSignWithStoredKey(csrPem) {
    const profile = issuerProfile();
    if (!profile) throw new HttpError(409, 'أنشئ ملف وحدة الإصدار المحلي أولاً');
    const stored = await storedCredentialState(profile.local_id);
    if (!stored.has_private_key) throw new HttpError(409, 'لا يوجد مفتاح خاص في مخزن الوحدة');
    const keyPem = (await complianceSecretStore.load()).private_key_pem;
    return { keyPem, issuerId: profile.local_id };
  }

  // ---------- XAdES signing for /api/invoices/:id/sign ----------
  async function signInvoiceForCompliance(invoiceId) {
    if (!complianceSecretStore) throw new HttpError(503, 'مخزن أسرار Windows DPAPI غير مهيأ');
    const invoice = getInvoice(db, invoiceId);
    if (!invoice) throw new HttpError(404, 'الفاتورة غير موجودة');
    if (invoice.status !== 'issued') throw new HttpError(400, 'الفاتورة يجب أن تكون صادرة قبل التوقيع');
    const profile = issuerProfile();
    if (!profile) throw new HttpError(409, 'أنشئ ملف وحدة الإصدار المحلي أولاً');
    const stored = await storedCredentialState(profile.local_id);
    if (!stored.issuer_matches || !stored.has_certificate || !stored.has_private_key) {
      throw new HttpError(400, 'الشهادة والمفتاح المطابقان غير مهيأين لوحدة الإصدار المحلية');
    }
    const credentials = await complianceSecretStore.load();
    const privateKey = loadEcdsaPrivateKey(credentials.private_key_pem);
    const certificate = loadEcdsaCertificate(credentials.certificate_pem);

    // بناء XML المرشح من بيانات الفاتورة
    const company = getSetting(db, 'company');
    const party = invoice.party_id ? db.prepare('SELECT * FROM parties WHERE id=?').get(invoice.party_id) : null;
    const taxes = db.prepare('SELECT * FROM invoice_tax_totals WHERE invoice_id=?').all(invoiceId);
    const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY line_no').all(invoiceId);
    const invoiceData = {
      ...invoice,
      lines: lines.map(l => ({
        description: l.description,
        qty: l.qty,
        unit_price: l.unit_price / 100,
        vat_rate: l.vat_rate,
        net: l.net / 100,
        vat: l.vat / 100,
        total: l.total / 100,
        discount_rate: l.discount_rate || 0,
        list_price: l.list_price ? l.list_price / 100 : null,
        tax_category: l.tax_category,
        exemption_code: l.exemption_code,
        exemption_reason: l.exemption_reason,
        unit_code: l.unit_code,
        unit_name: l.unit_name,
        tracking: l.tracking_json ? JSON.parse(l.tracking_json) : [],
      })),
    };
    const xmlCandidate = buildInvoiceXml({ invoice: invoiceData, company, buyer: party, taxes, includeQr: false });
    const hash = candidateHash({ invoice: invoiceData, company, buyer: party, taxes });

    // توقيع XAdES
    const signed = await signInvoiceXml({
      invoiceXml: xmlCandidate,
      privateKeyPem: credentials.private_key_pem,
      certificatePem: credentials.certificate_pem,
    });

    // استخراج QR من XML الموقع
    let qr = null;
    try { qr = extractZatcaQr(signed.xml); } catch { /* QR قد لا يوجد إذا لم يتم إدراجه بعد */ }

    // أرشفة XML الموقع
    const existing = db.prepare("SELECT 1 FROM invoice_documents WHERE invoice_id=? AND kind='signed_xml'").get(invoiceId);
    if (existing) {
      db.prepare("UPDATE invoice_documents SET content=?, sha256=?, updated_at=? WHERE invoice_id=? AND kind='signed_xml'")
        .run(signed.xml, crypto.createHash('sha256').update(signed.xml, 'utf8').digest('base64'), new Date().toISOString(), invoiceId);
    } else {
      db.prepare("INSERT INTO invoice_documents(invoice_id,kind,content,sha256,created_at,updated_at) VALUES(?,'signed_xml',?,?,?,?)")
        .run(invoiceId, signed.xml, crypto.createHash('sha256').update(signed.xml, 'utf8').digest('base64'), new Date().toISOString(), new Date().toISOString());
    }

    // إضافة إلى regulatory_queue للمعالجة (clearance)
    const queueRow = db.prepare("SELECT 1 FROM regulatory_queue WHERE invoice_id=?").get(invoiceId);
    if (!queueRow) {
      db.prepare("INSERT INTO regulatory_queue(invoice_id, operation, state, created_at, updated_at) VALUES(?, 'clearance', 'ready', ?, ?)")
        .run(invoiceId, new Date().toISOString(), new Date().toISOString());
    }

    return { invoiceId, xml: signed.xml, qr, hash, profile };
  }
  route('GET', '/api/sync/status', () => syncStatus());
  route('GET','/api/sync/config',()=>syncInfo(db),{owner:true});
  route('PUT','/api/sync/config',({body})=>configureSync(db,body),{owner:true});
  route('POST','/api/sync/run',()=>syncBranch(db),{owner:true,external:true});

  // ---------- الصحة ----------
  route('GET','/api/health',()=>({ok:true,db:true,version:appVersion,sync:syncStatus(),license:lic(),activity:getSetting(db,'company').activity||'trade',installation:db.prepare('SELECT id FROM installation LIMIT 1').get()?.id||null}),{open:true});

  // ---------- المصادقة ----------
  route('GET', '/api/state', ({ user }) => ({ setup_needed: !isSetup(), user, version:appVersion, license: lic(), today: nowRiyadh().date, sync: user && user.role!=='staff' ? syncStatus() : null, activity: user ? (user.role==='staff'?'trade':getSetting(db, 'company').activity) : '', installation_id: user ? db.prepare('SELECT id FROM installation LIMIT 1').get().id : null }), { open: true, cashier: true });
  route('POST', '/api/setup', ({ body }) => {
    if (isSetup()) throw new HttpError(403, 'تم الإعداد مسبقًا');
    need(body.username && String(body.password || '').length >= 8, 'اسم المستخدم مطلوب وكلمة المرور 8 أحرف على الأقل');
    need(body.company_name, 'اسم المنشأة مطلوب');
    const activity = validateCompany({activity:body.activity || ''}).activity;
    db.prepare("INSERT INTO users(username,pass,role) VALUES(?,?,'owner')").run(body.username, hashPass(body.password));
    seedCompany(db, body.company_name);
    if (activity) {
      setSetting(db,'company',{...getSetting(db,'company'),activity});
      db.prepare('UPDATE pos_points SET activity=?').run(activity);
    }
    return { ok: true };
  }, { open: true });
  route('POST', '/api/login', ({ body, ip, secure, token: previousToken }) => {
    const f = fails.get(ip) || { n: 0, t: Date.now() };
    if (f.n >= 5 && Date.now() - f.t < 600000) throw new HttpError(429, 'محاولات كثيرة، حاول بعد 10 دقائق');
    const portal = body.portal == null ? '' : String(body.portal);
    const portals = { owner: 'dashboard', accountant: 'dashboard', staff: 'pos' };
    if (portal && !portals[portal]) throw new HttpError(400, 'اختر بوابة الدخول الصحيحة');
    const u = db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(String(body.username || ''));
    if (!u || !checkPass(String(body.password || ''), u.pass)) { fails.set(ip, { n: f.n + 1, t: Date.now() }); throw new HttpError(401, 'بيانات الدخول غير صحيحة'); }
    if (portal && u.role !== portal) throw new HttpError(403, 'هذا الحساب لا يطابق بوابة الدخول المختارة');
    fails.delete(ip);
    if(previousToken)db.prepare('DELETE FROM sessions WHERE token=?').run(sessionDigest(previousToken));
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(sessionDigest(token), u.id, new Date().toISOString());
    return new Raw(JSON.stringify({ ok: true, role: u.role, destination: portals[u.role] || 'dashboard' }), 'application/json', { 'Set-Cookie': localCookie(token, secure) });
  }, { open: true, cashier: true });
  route('POST', '/api/logout', ({ token, secure }) => {
    if(token)db.prepare('DELETE FROM sessions WHERE token=?').run(sessionDigest(token));
    return new Raw(JSON.stringify({ok:true}), 'application/json', {'Set-Cookie':localCookie('', secure, 0)});
  }, { cashier: true });
  route('GET','/api/preferences/ui',()=>getSetting(db,'ui'),{cashier:true});

  // ---------- الإعدادات ----------
  route('GET', '/api/settings/:g', ({ params }) => {
    need(DEFAULTS[params.g], 'مجموعة غير معروفة');
    const setting=getSetting(db,params.g);
    return params.g==='compliance'?{mode:setting.mode}:setting;
  });
  route('PUT', '/api/settings/:g', ({ params, body }) => {
    need(DEFAULTS[params.g], 'مجموعة غير معروفة');
    if (params.g === 'invoice' && String(body.logo || '').length > 600000) throw new HttpError(400, 'الشعار كبير جدًا (الحد 400 كيلوبايت تقريبًا)');
    if (params.g === 'invoice' && body.logo && !/^data:image\/(png|jpeg|svg\+xml|webp);base64,/.test(body.logo)) throw new HttpError(400, 'صيغة الشعار غير مدعومة');
    if (params.g === 'company' && body.vat_number && !/^3\d{13}3$/.test(body.vat_number)) throw new HttpError(400, 'الرقم الضريبي يجب أن يكون 15 رقمًا يبدأ وينتهي بـ 3');
    if(params.g==='compliance'&&['certificate_pem','private_key_pem'].some(k=>Object.hasOwn(body,k)))throw new HttpError(400,'تدار الشهادة والمفتاح عبر مسار التهيئة المخصص فقط');
    if(params.g==='compliance'&&legacyComplianceCredentialsExist())throw new HttpError(409,'انقل بيانات الاعتماد القديمة إلى مخزن DPAPI قبل تعديل إعدادات الامتثال');
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
    } else if (params.g === 'pos_scale') {
      setSetting(db, params.g, validateScaleSettings({...getSetting(db,params.g),...body}));
    } else if(params.g==='compliance') {
      setSetting(db,params.g,{...getSetting(db,params.g),...body});
    } else setSetting(db, params.g, body);
    const setting=getSetting(db,params.g);
    return params.g==='compliance'?{mode:setting.mode}:setting;
  }, { owner: true });

  // ---------- العملاء والأصناف ----------
  route('GET', '/api/parties', () => db.prepare('SELECT * FROM parties ORDER BY name_ar').all());
  const partyData=body=>{
    const fields=['name_ar','vat_number','phone','address','kind','entity_type','street','building_number','district','city','postal_code','country_code','id_scheme','id_number'];const out={};for(const key of fields){out[key]=body[key]??(key==='kind'?'customer':key==='entity_type'?'individual':key==='country_code'?'SA':'');need(typeof out[key]==='string'&&out[key].length<=500,'بيانات عميل غير صالحة');}
    need(out.name_ar.trim()&&['customer','supplier','both'].includes(out.kind)&&['individual','business'].includes(out.entity_type),'بيانات العميل غير مكتملة');if(out.vat_number)need(/^3\d{13}3$/.test(out.vat_number),'الرقم الضريبي للعميل غير صالح');return out;
  };
  route('POST','/api/parties',({body})=>{const data=partyData(body),keys=Object.keys(data);return{id:db.prepare('INSERT INTO parties('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(k=>data[k])).lastInsertRowid};});
  route('PUT','/api/parties/:id',({params,body})=>{need(db.prepare('SELECT 1 FROM parties WHERE id=?').get(params.id),'العميل غير موجود');const data=partyData(body),keys=Object.keys(data);db.prepare('UPDATE parties SET '+keys.map(k=>k+'=?').join(',')+' WHERE id=?').run(...keys.map(k=>data[k]),params.id);return{ok:true};});
  const itemActivity = query => query.activity === undefined ? companyActivity(db) : validateActivity(query.activity);
  route('GET','/api/items',({query})=>listItems(db,itemActivity(query)));
  route('GET','/api/items/activity',()=>companyActivity(db));
  route('GET','/api/lists/:kind',({params,query})=>commercialList(db,params.kind,
    params.kind==='items'?{...query,activity:itemActivity(query)}:query),{accountant:true});
  route('GET','/api/purchases',()=>listPurchases(db),{accountant:true});
  route('GET','/api/purchases/:id/html',({params})=>{const p=purchaseDetails(db,params.id),snapshot=db.prepare('SELECT supplier FROM purchase_snapshots WHERE purchase_id=?').get(p.id);return new Raw(commercialPrint({title:p.kind==='return'?'مرتجع شراء':'سند تسجيل فاتورة مورد',number:p.number,date:p.document_date,company:getSetting(db,'company'),party:snapshot?JSON.parse(snapshot.supplier):null,headers:['الوصف','الوحدة','الكمية','سعر الوحدة','الصافي','الضريبة'],rows:p.lines.map(l=>[l.description,l.unit_name,l.qty,l.unit_price,l.net,l.vat]),totals:[['قبل الضريبة',p.subtotal],['الضريبة',p.vat],['الإجمالي',p.total]],notes:'مرجع المورد: '+p.supplier_reference+' · '+p.notes,settings:getSetting(db,'invoice')}));},{accountant:true});
  route('GET','/api/vouchers/:id/html',({params})=>{const v=voucherDetails(db,params.id);return new Raw(commercialPrint({title:v.kind==='receipt'?'سند قبض':'سند صرف',number:v.number,date:v.voucher_date,company:getSetting(db,'company'),party:v.party,headers:['الحساب','البيان','المبلغ'],rows:[[v.cash_account,v.notes,v.amount]],totals:[['قيمة السند',v.amount]],notes:v.legacy_snapshot?'بيانات الطرف محفوظة وقت ترقية السند القديم':'',settings:getSetting(db,'invoice')}));},{accountant:true});
  route('GET','/api/quotations',()=>db.prepare('SELECT id,number,document_date,valid_until,status,total,invoice_id FROM quotations ORDER BY id DESC').all(),{accountant:true});
  route('POST','/api/quotations',({body,user})=>createQuotation(db,user.id,body),{accountant:true});
  route('POST','/api/quotations/:id/convert',({params,user,body})=>convertQuotation(db,user.id,params.id,body),{accountant:true});
  route('POST','/api/quotations/:id/cancel',({params,user})=>cancelQuotation(db,user.id,params.id),{accountant:true});
  route('GET','/api/quotations/:id/html',({params})=>{const q=quotation(db,params.id);return new Raw(commercialPrint({title:'عرض سعر',number:q.number,date:q.document_date,company:q.company,party:q.party,headers:['الوصف','الكمية','سعر الوحدة الصافي','الخصم %','الصافي','الضريبة'],rows:q.lines.map(l=>[l.input.description,l.input.qty,l.calculated.unit_price/100,l.calculated.discount_rate/100,l.calculated.net/100,l.calculated.vat/100]),totals:[['قبل الضريبة',q.subtotal/100],['الضريبة',q.vat/100],['الإجمالي',q.total/100]],notes:'صالح حتى '+q.valid_until+' · '+q.notes,settings:getSetting(db,'invoice')}));},{accountant:true});
  route('GET','/api/purchases/:id',({params})=>purchaseDetails(db,params.id),{accountant:true});
  route('POST','/api/purchases',({body,user})=>createPurchase(db,user.id,body),{accountant:true});
  route('GET','/api/vouchers',()=>db.prepare('SELECT v.*,p.name_ar party FROM cash_vouchers v JOIN parties p ON p.id=v.party_id ORDER BY v.id DESC').all().map(v=>({...v,amount:v.amount/100})),{accountant:true});
  route('GET','/api/vouchers/:id',({params})=>voucherDetails(db,params.id),{accountant:true});
  route('POST','/api/vouchers/:id/allocations',({params,user,body})=>allocateVoucher(db,user.id,params.id,body),{accountant:true});
  route('GET','/api/parties/:id/outstanding',({params,query})=>outstandingDocuments(db,Number(params.id),query.account||'1201',query),{accountant:true});
  route('POST','/api/vouchers',({body,user})=>createVoucher(db,user.id,body),{accountant:true});
  route('GET','/api/parties/:id/ledger',({params})=>partyLedger(db,Number(params.id)),{accountant:true});
  route('GET','/api/accounts',()=>db.prepare('SELECT * FROM accounts ORDER BY code').all(),{accountant:true});
  route('GET','/api/journals',()=>db.prepare('SELECT e.*,l.account_code,a.name_ar account,l.debit,l.credit,x.party_id,p.name_ar party FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id JOIN accounts a ON a.code=l.account_code LEFT JOIN journal_party_links x ON x.line_id=l.id LEFT JOIN parties p ON p.id=x.party_id ORDER BY e.id DESC,l.id').all().map(l=>({...l,debit:l.debit/100,credit:l.credit/100})),{accountant:true});
  route('POST','/api/journals/:id/reverse',({params,user,body})=>reverseManualJournal(db,user.id,params.id,body),{accountant:true});
  route('POST','/api/journals',({body,user})=>postManualJournal(db,user.id,body),{accountant:true});
  route('GET','/api/accounting/lock',()=>db.prepare('SELECT * FROM accounting_locks WHERE id=1').get()||null,{owner:true});
  route('POST','/api/accounting/lock',({body,user})=>{const date=validDate(body.closed_through),old=db.prepare('SELECT closed_through FROM accounting_locks WHERE id=1').get();need(!old||date>old.closed_through,'الإقفال يتقدم فقط ولا يعيد فتح الفترات');db.prepare('INSERT INTO accounting_locks(id,closed_through,actor_id) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET closed_through=excluded.closed_through,actor_id=excluded.actor_id,created_at=CURRENT_TIMESTAMP').run(date,user.id);return{ok:true};},{owner:true});
  route('POST','/api/items',({body,user})=>saveItem(db,body,null,user.id,getSetting(db,'company').activity||'trade'));
  route('PUT','/api/items/:id',({params,body,user})=>saveItem(db,body,Number(params.id),user.id,getSetting(db,'company').activity||'trade'));
  route('GET','/api/warehouses',()=>db.prepare('SELECT * FROM warehouses ORDER BY id').all());
  route('POST','/api/inventory/cost-corrections',({body,user})=>correctLegacyCost(db,user,body),{owner:true});
  route('GET','/api/inventory/valuation',()=>jobs.report('valuation'),{accountant:true});
  route('POST','/api/warehouses',({body})=>{const name=String(body.name||'').trim();need(name&&name.length<=100,'اسم المستودع مطلوب');return {id:db.prepare('INSERT INTO warehouses(name) VALUES(?)').run(name).lastInsertRowid};},{owner:true});
  route('PUT','/api/pos/:id/warehouse',({params,body})=>{need(db.prepare('SELECT 1 FROM warehouses WHERE id=? AND active=1').get(body.warehouse_id),'اختر مستودعًا فعالًا');need(db.prepare('SELECT 1 FROM pos_points WHERE id=?').get(params.id),'نقطة البيع غير موجودة');db.prepare('UPDATE pos_points SET warehouse_id=? WHERE id=?').run(body.warehouse_id,params.id);return {ok:true};},{owner:true});
  route('GET','/api/inventory/balances',({query})=>db.prepare('SELECT i.id item_id,i.name_ar,i.base_unit,i.reorder_micro,w.id warehouse_id,w.name warehouse,COALESCE(m.qty_micro,0) qty_micro FROM items i CROSS JOIN warehouses w LEFT JOIN stock_positions m ON m.item_id=i.id AND m.warehouse_id=w.id WHERE i.track_stock=1 AND (? IS NULL OR i.id=?) ORDER BY i.name_ar,w.id').all(query.item_id?Number(query.item_id):null,query.item_id?Number(query.item_id):null).map(r=>({...r,qty:r.qty_micro/1000000,reorder_qty:r.reorder_micro/1000000})));
  route('GET','/api/inventory/movements',({query})=>{need(Number.isSafeInteger(Number(query.item_id))&&Number(query.item_id)>0,'اختر صنفًا');return db.prepare('SELECT m.*,w.name warehouse,i.number invoice_number FROM stock_movements m JOIN warehouses w ON w.id=m.warehouse_id LEFT JOIN invoices i ON i.id=m.invoice_id WHERE m.item_id=? ORDER BY m.id DESC').all(Number(query.item_id)).map(r=>({...r,qty:r.delta_micro/1000000}));});
  route('POST','/api/inventory/movements',({body,user})=>recordStock(db,body,user.id));
  route('GET','/api/inventory/traces',({query})=>traceList(db,query.item_id,query.warehouse_id,query),{accountant:true});
  route('GET','/api/pos/traces',({query,user})=>{
    const point=posPoint(db,user,query.pos_id);
    if (user.role==='staff') need(db.prepare('SELECT 1 FROM items WHERE id=? AND activity=?').get(query.item_id,point.activity),'الصنف لا ينتمي إلى نشاط نقطة البيع');
    return traceList(db,query.item_id,point.warehouse_id,query,true);
  },{cashier:true});
  route('GET','/api/pos/catalog',({query,user})=>posCatalog(db,query,catalogPoint(db,user,query.pos_id).activity),{cashier:true});
  route('GET','/api/pos/catalog/barcode',({query,user})=>({item:posBarcode(db,query.code,catalogPoint(db,user,query.pos_id).activity)}),{cashier:true});
  route('GET','/api/pos/catalog/selection',({query,user})=>({rows:posSelection(db,query.keys,catalogPoint(db,user,query.pos_id).activity)}),{cashier:true});
  route('GET','/api/pos/shifts',({user})=>db.prepare('SELECT * FROM pos_shifts '+(user.role==='staff'?'WHERE user_id=? ':'')+'ORDER BY id DESC').all(...(user.role==='staff'?[user.id]:[])).map(s=>shiftSummary(db,s)),{cashier:true});
  route('POST','/api/pos/shifts',({body,user})=>openShift(db,user,body),{cashier:true});
  route('POST','/api/pos/shifts/:id/close',({params,body,user})=>closeShift(db,user,params.id,body),{cashier:true});
  route('POST','/api/pos/returns',({body,user})=>{const result=posReturn(db,user,complianceIssuance?{...body,deferIssue:true}:body);return complianceIssuance?complianceIssuance.issue(db,result.id).then(issued=>({...issued,replayed:result.replayed})):result;},{cashier:true,external:Boolean(complianceIssuance)});
  route('GET','/api/pos/shifts/page',({user,query})=>shiftList(db,user,query),{cashier:true});
  route('GET','/api/pos/control',()=>getSetting(db,'pos_control'),{cashier:true});
  route('GET','/api/stocktakes',()=>db.prepare('SELECT s.*,w.name warehouse FROM stocktakes s JOIN warehouses w ON w.id=s.warehouse_id ORDER BY s.id DESC').all());
  route('GET','/api/stocktakes/:id',({params})=>{const row=db.prepare('SELECT * FROM stocktakes WHERE id=?').get(params.id);need(row,'الجرد غير موجود');return{...row,lines:db.prepare('SELECT l.*,i.name_ar FROM stocktake_lines l JOIN items i ON i.id=l.item_id WHERE l.stocktake_id=?').all(row.id)};});
  route('GET','/api/pos/history/page',({user,query})=>posHistoryList(db,user,query),{cashier:true});
  route('GET','/api/pos/history',({user})=>db.prepare("SELECT id,number,total,type,document_code FROM invoices WHERE status='issued' "+(user.role==='staff'?'AND created_by=? AND pos_id IN (SELECT pos_id FROM pos_user_access WHERE user_id=?) ':'')+'ORDER BY id DESC').all(...(user.role==='staff'?[user.id,user.id]:[])),{cashier:true});
  route('POST','/api/stocktakes',({body,user})=>createStocktake(db,user,body));
  route('POST','/api/stocktakes/:id/approve',({params,user})=>approveStocktake(db,user,params.id),{owner:true});
  route('GET','/api/pos/customers',()=>db.prepare("SELECT id,name_ar FROM parties WHERE kind IN ('customer','both') ORDER BY name_ar").all(),{cashier:true});
  route('GET','/api/pos/points',({user})=>user.role==='staff'?db.prepare('SELECT p.* FROM pos_points p JOIN pos_user_access a ON a.pos_id=p.id WHERE a.user_id=? AND p.active=1 ORDER BY p.id').all(user.id):db.prepare('SELECT * FROM pos_points WHERE active=1 ORDER BY id').all(),{cashier:true});
  route('GET','/api/pos/pricing',({user})=>posPricing(db,user),{cashier:true});
  route('POST','/api/pos/sales',({user,body})=>{const id=createPosSale(db,user,complianceIssuance?{...body,deferIssue:true}:body);return complianceIssuance?complianceIssuance.issue(db,id):{id};},{cashier:true,external:Boolean(complianceIssuance)});

  // ---------- الفروع ونقاط البيع (بحدود الترخيص) ----------
  route('GET', '/api/pos', () => db.prepare('SELECT * FROM pos_points ORDER BY id').all());
  route('POST', '/api/pos', ({ body }) => {
    const L = lic(), n = db.prepare('SELECT COUNT(*) n FROM pos_points WHERE active=1').get().n;
    if (n >= L.max_pos) throw new HttpError(403, `بلغت الحد المرخّص من نقاط البيع (${L.max_pos}). رقّ الترخيص لإضافة نقاط.`);
    const prefix = String(body.prefix || '').toUpperCase();
    need(/^[A-Z0-9]{1,6}$/.test(prefix) && body.name, 'الاسم مطلوب والبادئة 1-6 أحرف إنجليزية أو أرقام');
    const activity=body.activity===undefined?companyActivity(db):validateActivity(body.activity);
    return { id: db.prepare('INSERT INTO pos_points(branch_id,name,prefix,activity) VALUES(1,?,?,?)').run(body.name,prefix,activity).lastInsertRowid };
  }, { owner: true });
  route('PUT', '/api/pos/:id', ({ params, body }) => {
    const point=db.prepare('SELECT id,active,activity FROM pos_points WHERE id=?').get(params.id);
    if (!point) throw new HttpError(404,'نقطة البيع غير موجودة');
    const activity=body.activity===undefined?point.activity:validateActivity(body.activity);
    const active=body.active===undefined?point.active:Number(Boolean(body.active));
    if (activity!==point.activity && db.prepare('SELECT 1 FROM pos_shifts WHERE pos_id=? AND closed_at IS NULL').get(point.id)) {
      throw new HttpError(409,'أغلق وردية نقطة البيع قبل تغيير نشاطها');
    }
    db.prepare('UPDATE pos_points SET active=?,activity=? WHERE id=?').run(active,activity,point.id);
    return {ok:true};
  },{owner:true});

  // ---------- المستخدمون ----------
  route('GET', '/api/users', () => db.prepare('SELECT id,username,role,active,pos_discount_limit,pos_wholesale,pos_manual_price,pos_manual_price_cap,allowed_price_levels FROM users').all().map(u=>({...u,allowed_price_levels:(()=>{try{return JSON.parse(u.allowed_price_levels||'[]');}catch{return [];}})(),pos_ids:db.prepare('SELECT pos_id FROM pos_user_access WHERE user_id=? ORDER BY pos_id').all(u.id).map(a=>a.pos_id)})), { owner: true });
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

  route('PUT','/api/users/:id/pos-pricing',({params,body})=>{
    const limit=Number(scaledInteger(body.discount_limit,2,'حد الخصم'));
    need(limit<=10000&&typeof body.wholesale==='boolean','أدخل حد خصم من 0 إلى 100% وحدد صلاحية سعر الجملة');
    const existing=db.prepare("SELECT pos_manual_price,pos_manual_price_cap FROM users WHERE id=? AND role='staff'").get(params.id);
    need(existing,'اختر مستخدم نقطة بيع');
    const manualProvided=Object.hasOwn(body,'manual_price');
    if(manualProvided)need(typeof body.manual_price==='boolean','حدد تفويض السعر اليدوي بشكل صريح');
    const manual=manualProvided?body.manual_price:Boolean(existing.pos_manual_price);
    const capProvided=Object.hasOwn(body,'manual_price_cap');
    const cap=manual?(capProvided?Number(scaledInteger(body.manual_price_cap,2,'سقف السعر اليدوي')):Number(existing.pos_manual_price_cap||0)):0;
    need(Number.isSafeInteger(cap)&&cap>=0,'أدخل سقف سعر يدوي صالحًا للخدمة');
    const allowedProvided=Object.hasOwn(body,'allowed_price_levels');
    const allowed=allowedProvided?body.allowed_price_levels:[];
    need(Array.isArray(allowed),'قائمة المستويات المسموح بها يجب أن تكون مصفوفة');
    const cleanAllowed=[...new Set(allowed.map(x=>String(x).trim()).filter(Boolean))];
    for(const code of cleanAllowed)need(db.prepare('SELECT 1 FROM price_levels WHERE code=? AND active=1').get(code),'مستوى سعري غير صالح في قائمة المسموح');
    const updated=db.prepare("UPDATE users SET pos_discount_limit=?,pos_wholesale=?,pos_manual_price=?,pos_manual_price_cap=?,allowed_price_levels=? WHERE id=? AND role='staff'")
      .run(limit,Number(body.wholesale),Number(manual),cap,JSON.stringify(cleanAllowed),params.id);
    need(updated.changes,'اختر مستخدم نقطة بيع');
    return {ok:true};
  },{owner:true});

  // ---------- الفواتير ----------
  route('GET', '/api/invoices', () => db.prepare(`SELECT i.id,i.number,i.type,i.document_code,i.invoice_kind,i.environment,i.status,i.issue_date,i.total,p.name_ar party FROM invoices i
    LEFT JOIN parties p ON p.id=i.party_id ORDER BY i.id DESC`).all().map(r => ({ ...r, total: fromCents(r.total) })));
  route('POST', '/api/invoices', ({ body, user }) => {
    if(complianceIssuance&&!body.draft){
      const request=createIdempotentIssueRequest(db,user.id,'invoice',body.request_id,body,()=>createInvoice(db,user.id,{...body,draft:true}));
      return complianceIssuance.issue(db,request.id).then(result=>({...result,replayed:request.replayed||result.replayed}));
    }
    return {id:createInvoice(db,user.id,body)};
  },{external:Boolean(complianceIssuance)});
  route('GET', '/api/invoices/:id', ({ params,user }) => { const i = getInvoice(db, params.id); need(i, 'غير موجودة'); if(user.role==='staff'&&Number(i.created_by)!==user.id)throw new HttpError(403,'يمكنك عرض مبيعاتك فقط');return i; },{cashier:true});
  route('POST', '/api/invoices/:id/issue', ({ params }) => complianceIssuance?complianceIssuance.issue(db,Number(params.id)):{id:issueInvoice(db,Number(params.id))},{external:Boolean(complianceIssuance)});
  route('POST', '/api/invoices/:id/credit-note', ({ params, body, user }) => {
    if(complianceIssuance){
      const requestId = body.request_id || crypto.randomUUID();
      const request=createIdempotentIssueRequest(db,user.id,'credit_note',requestId,{original_id:Number(params.id),...body},()=>createCreditNote(db,user.id,Number(params.id),{...body,deferIssue:true}));
      return complianceIssuance.issue(db,request.id).then(result=>({...result,replayed:request.replayed||result.replayed}));
    }
    return {id:createCreditNote(db,user.id,Number(params.id),body)};
  }, { accountant: true,external:Boolean(complianceIssuance) });
  route('GET', '/api/cost-centers', () => listCostCenters(db), { accountant: true });
  route('POST', '/api/cost-centers', ({ body, user }) => createCostCenter(db, body), { accountant: true });
  route('PUT', '/api/cost-centers/:id', ({ params, body }) => updateCostCenter(db, Number(params.id), body), { accountant: true });
  route('DELETE', '/api/cost-centers/:id', ({ params }) => deleteCostCenter(db, Number(params.id)), { owner: true });
  route('GET', '/api/price-levels', () => listPriceLevels(db), { accountant: true });
  route('POST', '/api/price-levels', ({ body }) => createPriceLevel(db, body), { accountant: true });
  route('PUT', '/api/price-levels/:id', ({ params, body }) => updatePriceLevel(db, Number(params.id), body), { accountant: true });
  route('DELETE', '/api/price-levels/:id', ({ params }) => deletePriceLevel(db, Number(params.id)), { owner: true });
  route('GET', '/api/items/:id/price-levels', ({ params }) => listItemPriceLevels(db, Number(params.id)), { accountant: true });
  route('POST', '/api/items/:id/price-levels', ({ params, body }) => setItemPriceLevel(db, Number(params.id), body), { accountant: true });
  route('GET', '/api/parties/:id/price-lists', ({ params }) => listPartyPriceLists(db, Number(params.id)), { accountant: true });
  route('POST', '/api/parties/:id/price-lists', ({ params, body }) => createPartyPriceList(db, Number(params.id), body), { accountant: true });
  route('DELETE', '/api/price-lists/:id', ({ params }) => deletePartyPriceList(db, Number(params.id)), { accountant: true });
  route('GET', '/api/invoices/:id/html', ({ params, query, user }) => { const i = getInvoice(db, params.id); need(i, 'غير موجودة');
    if(user.role==='staff'&&(Number(i.created_by)!==user.id||(query.profile&&query.profile!=='pos')))throw new HttpError(403,'يمكنك طباعة مبيعاتك بقالب نقطة البيع فقط');
    return new Raw(renderInvoice({ inv: i, company: i.company_snapshot || getSetting(db, 'company'), s: validatePrintSettings({}, getSetting(db, profileKey(query.profile || (user.role==='staff'?'pos':'accountant')))) })); },{cashier:true});
  route('POST', '/api/invoice-preview', ({ body }) => {
    const settings = validatePrintSettings(body.settings || {}, getSetting(db, profileKey(body.profile)));
    const company = { ...getSetting(db,'company'), ...validateCompany(body.company || {}) };
    if (!company.name_ar) company.name_ar = 'اسم المنشأة';
    return new Raw(renderInvoice({inv:sampleInvoice(company.activity),preview:true,company,s:settings}));
  }, { owner: true });


  route('GET','/api/compliance/status',async()=>{
    const company=getSetting(db,'company');
    const issuer=issuerProfile();
    const stored=await storedCredentialState(issuer?.local_id);
    const issuerKey=await getIssuerKeyStatus(complianceSecretStore,issuer?.local_id);
    const csrPem=db.prepare("SELECT value FROM compliance_state WHERE key='csr_pem'").get()?.value;
    const csrFingerprint=db.prepare("SELECT value FROM compliance_state WHERE key='csr_fingerprint'").get()?.value;
    const counts=db.prepare(`SELECT
      SUM(CASE WHEN operation='clearance' AND state='accepted' THEN 1 ELSE 0 END) cleared,
      SUM(CASE WHEN operation='reporting' AND state='accepted' THEN 1 ELSE 0 END) reported,
      SUM(CASE WHEN state IN ('ready','retry','sending') THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN state='rejected' THEN 1 ELSE 0 END) rejected,
      SUM(CASE WHEN state='blocked' THEN 1 ELSE 0 END) blocked
      FROM regulatory_queue`).get();
    return {
      mode:getSetting(db,'compliance').mode,
      seller_errors:validateIdentity(company),
      company:{name_ar:company.name_ar,vat_number:company.vat_number},
      ...jobs.auditStatus(db),
      production_ready:false,
      official_sdk_validated:false,
      issuer_configured:false,
      issuer_status:issuer?'local_profile_unregistered':'unconfigured',
      issuer_profile:issuer,
      certificate_configured:stored.issuer_matches&&stored.has_certificate,
      key_configured:stored.issuer_matches&&stored.has_private_key,
      issuer_key:issuerKey,
      certificate_migration_required:legacyComplianceCredentialsExist(),
      credential:credentialStatus(),
      issuance_flow_configured:Boolean(complianceIssuance),
      counts:{cleared:counts.cleared||0,reported:counts.reported||0,pending:counts.pending||0,rejected:counts.rejected||0,blocked:counts.blocked||0},
      reporting_ready:db.prepare("SELECT COUNT(*) n FROM regulatory_queue WHERE operation='reporting' AND state='ready'").get().n,
      retries:db.prepare("SELECT COUNT(*) n FROM regulatory_queue WHERE state='retry'").get().n,
      uncertain:db.prepare("SELECT COUNT(*) n FROM regulatory_queue WHERE state='sending'").get().n,
      blocked:counts.blocked||0,
      acceptance:complianceAcceptance(),
      csr_generated:Boolean(csrPem),
      csr_pem:csrPem||null,
      csr_fingerprint:csrFingerprint||null,
      remaining:['تسجيل هوية EGS الرسمية والتحقق من قواعد الهيئة','إنشاء CSR وتهيئة الشهادة عبر مسار آمن','تشغيل اختبارات القبول الستة عشر وإرفاق أدلتها','اعتماد متطلبات الهيئة قبل تفعيل أي بيئة خارج التطوير'],
    };
  },{owner:true});
  route('GET','/api/compliance/acceptance',()=>complianceAcceptance(),{owner:true});
  route('GET','/api/compliance/lists/:kind',({params,query})=>complianceList(db,params.kind,query),{owner:true});
  route('GET','/api/compliance/audit',()=>db.prepare('SELECT id,actor_id,event,entity_type,entity_id,hash,created_at FROM audit_events ORDER BY id DESC').all(),{owner:true});
  route('GET','/api/invoices/:id/xml',({params})=>{const d=db.prepare("SELECT d.content FROM invoice_documents d JOIN invoices i ON i.id=d.invoice_id WHERE d.invoice_id=? AND i.status='issued' AND d.kind IN ('signed_xml','cleared_xml') ORDER BY CASE d.kind WHEN 'cleared_xml' THEN 0 ELSE 1 END LIMIT 1").get(params.id);need(d,'لا يوجد XML نهائي مؤرشف لهذا المستند');return {content:d.content};},{accountant:true});
  route('POST','/api/invoices/:id/debit-note',({params,user,body})=>{
    if(complianceIssuance){
      const requestId = body.request_id || crypto.randomUUID();
      const request=createIdempotentIssueRequest(db,user.id,'debit_note',requestId,{original_id:Number(params.id),...body},()=>createDebitNote(db,user.id,Number(params.id),{...body,deferIssue:true}));
      return complianceIssuance.issue(db,request.id).then(result=>({...result,replayed:request.replayed||result.replayed}));
    }
    return {id:createDebitNote(db,user.id,Number(params.id),body)};
  },{accountant:true,external:Boolean(complianceIssuance)});
  route('POST','/api/compliance/reporting/run',async({body})=>{if(!complianceIssuance)throw new HttpError(503,'مسار الامتثال غير مهيأ');return {results:await complianceIssuance.reportReady(db,{limit:body.limit??20})};},{owner:true,external:true});
  route('POST','/api/compliance/queue/run',async({body})=>{if(!complianceIssuance)throw new HttpError(503,'مسار الامتثال غير مهيأ');return complianceIssuance.processQueue(db,{limit:body.limit??20});},{owner:true,external:true});
  route('POST','/api/compliance/queue/:id/retry',({params})=>{
    if(!complianceIssuance)throw new HttpError(503,'مسار الامتثال غير مهيأ');
    const updated=tx(db,()=>{
      const queue=db.prepare('SELECT state,last_error FROM regulatory_queue WHERE invoice_id=?').get(params.id);
      if(!queue)throw new HttpError(404,'طلب الامتثال غير موجود');
      if(queue.state!=='blocked'||!queue.last_error.startsWith('auth:'))throw new HttpError(409,'لا يمكن إعادة المحاولة تلقائيًا لهذه الحالة؛ راجع سبب الإيقاف أولًا');
      db.prepare("UPDATE regulatory_queue SET state='retry',next_attempt_at=NULL,last_error='',updated_at=? WHERE invoice_id=? AND state='blocked'").run(new Date().toISOString(),params.id);
      return true;
    });
    return {id:Number(params.id),state:updated?'retry':'blocked',message:'أعيد الطلب نفسه إلى الطابور دون إنشاء فاتورة أو قيد جديد'};
  },{owner:true,external:true});
  route('GET','/api/compliance/queue',()=>db.prepare('SELECT q.*,q.state regulatory_state,i.status accounting_status,i.number,i.invoice_kind,i.environment FROM regulatory_queue q JOIN invoices i ON i.id=q.invoice_id ORDER BY i.id DESC').all(),{owner:true});
  route('GET','/api/compliance/attempts',({query})=>complianceList(db,'attempts',query),{owner:true});
  // ---------- ZATCA Phase 2 signing ----------
  route('PUT','/api/compliance/issuer',({body,user})=>{
    if(user.role!=='owner')throw new HttpError(403,'إدارة هوية وحدة الإصدار للمالك فقط');
    const name=typeof body.name==='string'?body.name.trim():'';
    const scope=body.scope;
    if(!name||name.length>100)throw new HttpError(400,'اسم وحدة الإصدار المحلي مطلوب وبحد أقصى 100 حرف');
    if(!['central_server','independent_branch'].includes(scope))throw new HttpError(400,'نطاق وحدة الإصدار المحلية غير صالح');
    const company=getSetting(db,'company');
    if(!/^3\d{13}3$/.test(company.vat_number||''))throw new HttpError(409,'أدخل الرقم الضريبي الصحيح للمنشأة قبل إنشاء ملف وحدة الإصدار');
    const current=issuerProfile();
    if(current){
      if(current.scope!==scope)throw new HttpError(409,'لا يمكن تغيير نطاق ملف الوحدة؛ أنشئ تثبيتاً محلياً مستقلاً للنطاق الجديد');
      if(current.company_vat_number!==company.vat_number&&(complianceSecretStore?.has()||legacyComplianceCredentialsExist()))throw new HttpError(409,'لا يمكن تغيير ربط الوحدة بمنشأة أخرى بعد حفظ بيانات اعتماد؛ راجع الشهادة قبل المتابعة');
      if(current.name!==name||current.company_vat_number!==company.vat_number){
        const updated={...current,name,company_vat_number:company.vat_number,company_vat_matches:true,updated_at:new Date().toISOString()};
        tx(db,()=>{
          db.prepare("INSERT INTO compliance_state(key,value) VALUES('issuer_profile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify({
            local_id:updated.local_id,name:updated.name,scope:updated.scope,company_vat_number:updated.company_vat_number,
            registration_status:updated.registration_status,official_identifier:updated.official_identifier,created_at:updated.created_at,updated_at:updated.updated_at,
          }));
          appendAudit(db,{actor:user.id,event:'compliance.issuer_profile_renamed',entity_type:'issuer_profile',entity_id:updated.local_id,details:{name:updated.name}});
        });
        return {created:false,profile:issuerProfile()};
      }
      return {created:false,profile:current};
    }
    if(complianceSecretStore?.has())throw new HttpError(409,'يوجد مخزن أسرار سابق غير مرتبط بهوية وحدة إصدار؛ لا يمكن ربطه تلقائياً');
    const now=new Date().toISOString();
    const profile={local_id:crypto.randomUUID(),name,scope,company_vat_number:company.vat_number,registration_status:'not_registered',official_identifier:null,created_at:now,updated_at:now};
    tx(db,()=>{
      db.prepare("INSERT INTO compliance_state(key,value) VALUES('issuer_profile',?)").run(JSON.stringify(profile));
      appendAudit(db,{actor:user.id,event:'compliance.issuer_profile_created',entity_type:'issuer_profile',entity_id:profile.local_id,details:{scope:profile.scope,company_vat_number:profile.company_vat_number}});
    });
    return {created:true,profile:issuerProfile()};
  },{owner:true});
  route('GET','/api/compliance/issuer/key',async()=>{
    const profile=issuerProfile();
    return getIssuerKeyStatus(complianceSecretStore,profile?.local_id);
  },{owner:true});
  route('POST','/api/compliance/issuer/key/generate',async()=>{
    const profile=issuerProfile();
    if(!profile)throw new HttpError(409,'أنشئ ملف وحدة الإصدار المحلي قبل توليد المفتاح');
    if(!profile.company_vat_matches)throw new HttpError(409,'الرقم الضريبي لا يطابق ملف وحدة الإصدار؛ لم يُنشأ مفتاح');
    if(legacyComplianceCredentialsExist())throw new HttpError(409,'رحّل بيانات الاعتماد القديمة أو عالجها قبل توليد مفتاح جديد');
    if(!complianceSecretStore)throw new HttpError(503,'مخزن DPAPI غير متاح على هذا الخادم؛ لم يُنشأ المفتاح');
    const result=await generateAndStoreIssuerKey(complianceSecretStore,profile.local_id);
    return{generated:true,...result};
  },{owner:true,external:true});
  route('GET','/api/compliance/certificate',async()=>{
    const profile=issuerProfile(),stored=await storedCredentialState(profile?.local_id);
    const configured=stored.issuer_matches&&stored.has_certificate;
    return {configured,has_certificate:configured,migration_required:legacyComplianceCredentialsExist()};
  },{owner:true});
  route('PUT','/api/compliance/certificate',async({body,user})=>{
    if(user.role!=='owner')throw new HttpError(403,'للاللمك');
    const profile=issuerProfile();
    if(!profile)throw new HttpError(409,'أنشئ ملف وحدة الإصدار المحلي قبل حفظ بيانات اعتمادها');
    if(!profile.company_vat_matches)throw new HttpError(409,'الرقم الضريبي الحالي لا يطابق هوية وحدة الإصدار؛ أوقف التهيئة وراجع بيانات المنشأة');
    const pem=String(body.certificate_pem||'');
    if(!pem.startsWith('-----BEGIN CERTIFICATE-----')||!pem.includes('-----END CERTIFICATE-----'))throw new HttpError(400,'الشهادة غير صالحة');
    let certificate;
    try{certificate=loadEcdsaCertificate(pem);}catch{throw new HttpError(400,'تعذر تحليل شهادة ECDSA؛ لم تُحفظ');}
    if(!complianceSecretStore)throw new HttpError(503,'مخزن أسرار Windows DPAPI غير مهيأ؛ لم تُحفظ بيانات الاعتماد');
    if(Object.hasOwn(body,'private_key_pem'))throw new HttpError(400,'لا ترسل المفتاح الخاص؛ يبقى داخل مخزن DPAPI');
    if(!complianceSecretStore.has())throw new HttpError(409,'ولّد مفتاح الوحدة داخل مخزن DPAPI قبل تثبيت الشهادة');
    const stored=await complianceSecretStore.load();
    if(stored.issuer_id!==profile.local_id)throw new HttpError(409,'مخزن المفتاح لا يطابق هوية هذه الوحدة');
    if(typeof stored.private_key_pem!=='string'||!stored.private_key_pem)throw new HttpError(409,'لا يوجد مفتاح خاص مولّد في مخزن الوحدة');
    if(stored.certificate_pem&&stored.certificate_pem!==pem)throw new HttpError(409,'يوجد certificate مختلف؛ لا يمكن استبداله عبر هذا المسار');
    const privatePublic=crypto.createPublicKey(loadEcdsaPrivateKey(stored.private_key_pem).nodeKey).export({format:'der',type:'spki'});
    const certificatePublic=certificate.publicKey.export({format:'der',type:'spki'});
    if(!privatePublic.equals(certificatePublic))throw new HttpError(400,'الشهادة لا تطابق المفتاح المولّد لهذه الوحدة');
    await complianceSecretStore.save({...stored,certificate_pem:pem});
    return {ok:true,configured:true};
  },{owner:true,external:true});
route('POST','/api/compliance/certificate/migrate',async()=>{
    if(!complianceSecretStore)throw new HttpError(503,'مخزن أسرار Windows DPAPI غير مهيأ؛ لم تُنقل بيانات الاعتماد القديمة');
    const profile=issuerProfile();
    if(!profile)throw new HttpError(409,'أنشئ ملف وحدة الإصدار المحلي قبل ترحيل بيانات اعتمادها');
    if(!profile.company_vat_matches)throw new HttpError(409,'الرقم الضريبي الحالي لا يطابق هوية وحدة الإصدار؛ لم تُنقل البيانات');
    const settings=getSetting(db,'compliance'),credentials=legacyComplianceCredentials();
    if(!credentials.certificatePem&&!credentials.privateKeyPem)return {migrated:false,configured:(await storedCredentialState(profile.local_id)).has_certificate};
    if(!credentials.certificatePem||!credentials.privateKeyPem)throw new HttpError(409,'بيانات الاعتماد القديمة غير مكتملة؛ لا يمكن نقلها بأمان');
    const migratedCredentials={issuer_id:profile.local_id,certificate_pem:credentials.certificatePem,private_key_pem:credentials.privateKeyPem};
    if(complianceSecretStore.has()){
      const current=await complianceSecretStore.load();
      if(current.certificate_pem!==credentials.certificatePem||current.private_key_pem!==credentials.privateKeyPem||current.issuer_id&&current.issuer_id!==profile.local_id)throw new HttpError(409,'يحتوي مخزن DPAPI على بيانات أو هوية مختلفة؛ لم تُستبدل أي بيانات');
      if(current.issuer_id!==profile.local_id)await complianceSecretStore.save(migratedCredentials);
    }else await complianceSecretStore.save(migratedCredentials);
    tx(db,()=>setSetting(db,'compliance',{mode:settings.mode}));
    return {migrated:true,configured:true};
  },{owner:true,external:true});

  // ---------- CSID Management (Task 08) ----------
  route('GET','/api/compliance/csid',async()=>{
    const profile=issuerProfile();
    if(!profile)return {compliance:null,production:null,certificate_configured:false,certificate_expires_at:null};
    const complianceCsid = db.prepare("SELECT value FROM compliance_state WHERE key='csid_compliance'").get()?.value;
    const productionCsid = db.prepare("SELECT value FROM compliance_state WHERE key='csid_production'").get()?.value;
    const certStatus = await storedCredentialState(profile.local_id);
    return {
      compliance: complianceCsid ? JSON.parse(complianceCsid) : null,
      production: productionCsid ? JSON.parse(productionCsid) : null,
      certificate_configured: certStatus.has_certificate,
      certificate_expires_at: certStatus.certificate_expires_at || null,
    };
  },{owner:true});

  route('POST','/api/compliance/csid/compliance',async({body,user})=>{
    if(user.role!=='owner')throw new HttpError(403,'إدارة CSID للمالك فقط');
    const profile=issuerProfile();
    if(!profile)throw new HttpError(409,'أنشئ ملف وحدة الإصدار المحلي أولاً');
    if(profile.registration_status === 'registered')throw new HttpError(409,'الوحدة مسجلة بالفعل؛ لا يمكن طلب CSID الامتثال مجدداً');
    const certStatus = await storedCredentialState(profile.local_id);
    if(!certStatus.has_certificate)throw new HttpError(409,'يجب تثبيت الشهادة أولاً قبل طلب CSID');
    if(!certStatus.issuer_matches)throw new HttpError(409,'الشهادة لا تطابق مفتاح الوحدة');

    // محاكاة الحصول على CSID الامتثال من الهيئة
    const csidData = {
      csid: `COMPLIANCE-${profile.local_id.slice(0,8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
      type: 'compliance',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 365*24*60*60*1000).toISOString(), // سنة واحدة
      status: 'active',
      source: 'simulation',
    };
    db.prepare("INSERT INTO compliance_state(key,value) VALUES('csid_compliance',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(csidData));
    // تحديث حالة التسجيل
    const updatedProfile = {...profile, registration_status: 'registered', official_identifier: csidData.csid, updated_at: new Date().toISOString()};
    db.prepare("INSERT INTO compliance_state(key,value) VALUES('issuer_profile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(updatedProfile));
    appendAudit(db,{actor:user.id,event:'compliance.csid_compliance_obtained',entity_type:'csid',entity_id:profile.local_id,details:{csid:csidData.csid,type:'compliance'}});
    return { ok: true, csid: csidData };
  },{owner:true,external:true});

  route('POST','/api/compliance/csid/production',async({body,user})=>{
    if(user.role!=='owner')throw new HttpError(403,'إدارة CSID للمالك فقط');
    const profile=issuerProfile();
    if(!profile)throw new HttpError(409,'أنشئ ملف وحدة الإصدار المحلي أولاً');
    if(profile.registration_status !== 'registered')throw new HttpError(409,'يجب الحصول على CSID الامتثال أولاً');
    const complianceCsid = db.prepare("SELECT value FROM compliance_state WHERE key='csid_compliance'").get()?.value;
    if(!complianceCsid)throw new HttpError(409,'CSID الامتثال غير موجود');

    // محاكاة الحصول على CSID الإنتاج من الهيئة
    const csidData = {
      csid: `PRODUCTION-${profile.local_id.slice(0,8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
      type: 'production',
      requested_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 365*24*60*60*1000).toISOString(), // سنة واحدة
      status: 'active',
      source: 'simulation',
      compliance_csid: JSON.parse(complianceCsid).csid,
    };
    db.prepare("INSERT INTO compliance_state(key,value) VALUES('csid_production',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(csidData));
    const updatedProfile = {...profile, official_identifier: csidData.csid, updated_at: new Date().toISOString()};
    db.prepare("INSERT INTO compliance_state(key,value) VALUES('issuer_profile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(updatedProfile));
    appendAudit(db,{actor:user.id,event:'compliance.csid_production_obtained',entity_type:'csid',entity_id:profile.local_id,details:{csid:csidData.csid,type:'production'}});
    return { ok: true, csid: csidData };
  },{owner:true,external:true});

  route('POST','/api/compliance/csid/renew',async({body,user})=>{
    if(user.role!=='owner')throw new HttpError(403,'تجديد الشهادة للمالك فقط');
    const profile=issuerProfile();
    if(!profile)throw new HttpError(409,'أنشئ ملف وحدة الإصدار المحلي أولاً');
    const certStatus = await storedCredentialState(profile.local_id);
    if(!certStatus.has_certificate)throw new HttpError(409,'لا توجد شهادة للتجديد');

    // محاكاة تجديد الشهادة - في الواقع يتم إنشاء CSR جديد وإرسال للهيئة
    const renewalData = {
      previous_csid: profile.official_identifier,
      requested_at: new Date().toISOString(),
      status: 'pending_csr',
      message: 'تم طلب التجديد؛ يجب إنشاء CSR جديد وتقديمه للهيئة',
    };
    db.prepare("INSERT INTO compliance_state(key,value) VALUES('csid_renewal',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(renewalData));
    appendAudit(db,{actor:user.id,event:'compliance.csid_renewal_requested',entity_type:'csid',entity_id:profile.local_id,details:{previous_csid:profile.official_identifier}});
    return { ok: true, renewal: renewalData };
  },{owner:true,external:true});

  route('POST','/api/compliance/csr/generate',async({body,user})=>{
    if(user.role!=='owner')throw new HttpError(403,'إدارة CSR للمالك فقط');
    const profile=issuerProfile();
    if(!profile)throw new HttpError(409, 'أنشئ ملف وحدة الإصدار المحلي أولاً');
    if(profile.registration_status !== 'not_registered')throw new HttpError(409, 'ملف الوحدة مسجل بالفعل؛ لا يمكن إنشاء CSR جديد');
    const stored = await storedCredentialState(profile.local_id);
    if(!stored.has_private_key)throw new HttpError(409, 'لم يُولّد مفتاح الوحدة بعد؛ وّلده أولاً عبر /api/compliance/key/generate');
    const company=getSetting(db,'company');
    const config={
      commonName: body.commonName || `${company.name_ar || 'Almuhtariz'} - ${profile.local_id.slice(0, 8)}`,
      serialNumber: body.serialNumber || `1-${company.cr_number || ''}|2-${company.vat_number}|3-${profile.local_id}`,
      organizationIdentifier: body.organizationIdentifier || company.vat_number,
      organizationUnitName: body.organizationUnitName || company.cr_number || '',
      organizationName: body.organizationName || company.name_ar || 'Almuhtariz',
      countryName: body.countryName || 'SA',
      invoiceType: body.invoiceType || '0001',
      location: body.location || [company.city, company.district, company.street, company.building_number].filter(Boolean).join(', '),
      industry: body.industry || '01',
      template: body.template || 'PREZATCA-Code-Signing',
    };
    const keyPem = (await complianceSecretStore.load()).private_key_pem;
    const { createZatcaCsr } = await import('./zatca/csr.js');
    const result = createZatcaCsr({ privateKeyPem: keyPem, config });
    db.prepare("INSERT INTO compliance_state(key,value) VALUES('csr_pem',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(result.csrPem);
    db.prepare("INSERT INTO compliance_state(key,value) VALUES('csr_fingerprint',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(result.fingerprint);
    appendAudit(db,{actor:user.id,event:'compliance.csr_generated',entity_type:'csr',entity_id:profile.local_id,details:{template:config.template}});
    return { csrPem: result.csrPem, fingerprint: result.fingerprint, subject: result.subject };
  },{owner:true,external:true});

  route('POST','/api/compliance/csr/verify',async({body,user})=>{
    if(user.role!=='owner')throw new HttpError(403, 'للمالك فقط');
    if(!body.csrPem)throw new HttpError(400, 'بيانات CSR مطلوبة');
    const { verifyZatcaCsr } = await import('./zatca/csr.js');
    const company=getSetting(db,'company');
    const profile=issuerProfile();
    const expected = profile ? {
      commonName: body.commonName || `${company.name_ar || 'Almuhtariz'} - ${profile.local_id.slice(0, 8)}`,
      serialNumber: body.serialNumber || `1-${company.cr_number || ''}|2-${company.vat_number}|3-${profile.local_id}`,
      organizationIdentifier: body.organizationIdentifier || company.vat_number,
      organizationUnitName: body.organizationUnitName || company.cr_number || '',
      organizationName: body.organizationName || company.name_ar || 'Almuhtariz',
      countryName: body.countryName || 'SA',
      invoiceType: body.invoiceType || '0001',
      location: body.location || [company.city, company.district, company.street, company.building_number].filter(Boolean).join(', '),
      industry: body.industry || '01',
      template: body.template || 'PREZATCA-Code-Signing',
    } : null;
    const result = verifyZatcaCsr(body.csrPem, expected || {});
    return { valid: result.valid, subject: result.subject, san: result.san, template: result.template, publicKeyFingerprint: result.publicKeyFingerprint };
  },{owner:true,external:true});

  route('POST','/api/compliance/key/generate',async({body,user})=>{
    if(user.role!=='owner')throw new HttpError(403, 'إدارة مفاتيح وحدة الإصدار للمالك فقط');
    if(!complianceSecretStore)throw new HttpError(503, 'مخزن أسرار Windows DPAPI غير مهيأ');
    const profile=issuerProfile();
    if(!profile)throw new HttpError(409, 'أنشئ ملف وحدة الإصدار المحلي أولاً');
    try {
      const result = await generateAndStoreIssuerKey(complianceSecretStore, profile.local_id);
      appendAudit(db,{actor:user.id,event:'compliance.issuer_key_generated',entity_type:'issuer_key',entity_id:profile.local_id,details:{fingerprint:result.fingerprint,algorithm:result.algorithm}});
      return { fingerprint: result.fingerprint, generated_at: result.generated_at, algorithm: result.algorithm };
    } catch(error) {
      if(error instanceof IssuerKeyConflict)throw new HttpError(409, error.message);
      throw error;
    }
  },{owner:true,external:true});

  route('POST','/api/invoices/:id/sign',async({params,user})=>{
    if(user.role!=='owner')throw new HttpError(403, 'للمالك فقط');
    if(legacyComplianceCredentialsExist())throw new HttpError(409, 'انقل بيانات الاعتماد إلى مخزن DPAPI قبل متابعة التوقيع');
    const result = await signInvoiceForCompliance(Number(params.id));
    return { ok: true, xml: result.xml, invoice_id: result.invoiceId, hash: result.hash, qr: result.qr, profile: result.profile };
  },{owner:true,external:true});

  // ---------- التقارير والإدارة ----------
  route('GET', '/api/dashboard', () => {
    const m = nowRiyadh().date.slice(0, 7);
    const t = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(CASE type WHEN '381' THEN -subtotal ELSE subtotal END),0) sub,
      COALESCE(SUM(CASE type WHEN '381' THEN -vat ELSE vat END),0) vat FROM invoices WHERE status='issued' AND issue_date LIKE ?`).get(m + '%');
    return { month: m, invoices: t.n, drafts:db.prepare("SELECT COUNT(*) n FROM invoices WHERE status='draft'").get().n, sales: fromCents(t.sub), vat: fromCents(t.vat) };
  });
  route('GET','/api/reports/ledger',({query})=>{validDate(query.from);validDate(query.to);return jobs.report('ledger',query.from,query.to,query);},{accountant:true});
  route('GET', '/api/reports/trial-balance', () => jobs.report('trial'), { accountant: true });
  route('GET','/api/reports/financial',({query})=>{validDate(query.from);validDate(query.to);return jobs.report('financial',query.from,query.to);},{accountant:true});
  route('GET','/api/reports/aging',({query})=>{const asOf=validDate(query.as_of||nowRiyadh().date,{allowFuture:true});const kind=query.kind==='supplier'?'supplier':'customer';return jobs.report('aging',asOf,kind);},{accountant:true});
  route('GET','/api/reports/cost-centers',({query})=>{const from=validDate(query.from);const to=validDate(query.to);return jobs.report('cost-centers',from,to,query);},{accountant:true});
  route('GET', '/api/reports/vat', ({ query }) => { need(/^\d{4}-\d{2}-\d{2}$/.test(query.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(query.to || ''), 'حدد الفترة (from/to بصيغة YYYY-MM-DD)'); return jobs.report('vat',query.from,query.to); }, { accountant: true });
  route('GET','/api/compliance/audit/verify',()=>jobs.audit(),{owner:true});
  route('GET', '/api/backup', async () => new FileRaw(await jobs.backup(), { 'Content-Disposition': `attachment; filename="almuhtariz-backup-${new Date().toISOString().slice(0,10)}.db"` }), { owner: true });
  route('POST', '/api/license', ({ body }) => {
    need(fs.existsSync(PUB), 'لا يوجد مفتاح عام للترخيص في هذه النسخة');
    try { verifyLicenseFile(body, fs.readFileSync(PUB)); } catch { throw new HttpError(400, 'ملف الترخيص غير صالح'); }
    fs.writeFileSync(licensePath, JSON.stringify(body)); return lic();
  }, { owner: true });

  // ---------- المعالج العام ----------
  const handler = async (req, res) => {
    const send = (st, body, type = 'application/json', h = {}) => { res.writeHead(st, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Connection': 'close', ...h }); res.end(body); };
    try {
      const access = localAccess(req);
      if (!access.allowed) throw new HttpError(403, 'اتصل عبر HTTPS من أجهزة الشبكة؛ HTTP متاح على جهاز الخادم فقط');
      const u = new URL(req.url, 'http://x'), ip = req.socket.remoteAddress;
      if (req.method !== 'GET' && !access.writeAllowed) throw new HttpError(403, 'مصدر الطلب غير مسموح');
      if (!u.pathname.startsWith('/api/')) { // ملفات الواجهة
        let p = path.normalize(path.join(WEB, u.pathname === '/' ? 'index.html' : u.pathname));
        if (!p.startsWith(WEB + path.sep)) return send(404, 'غير موجود', 'text/plain; charset=utf-8');
        let content;try{content=await fs.promises.readFile(p);}catch(error){if(['ENOENT','EISDIR','ENOTDIR'].includes(error.code))return send(404,'غير موجود','text/plain; charset=utf-8');throw error;}
        return send(200, content, MIME[path.extname(p)] || 'application/octet-stream');
      }
      const r = routes.find(x => x.m === req.method && x.re.test(u.pathname)); if (!r) throw new HttpError(404, 'مسار غير معروف');
      const cookie = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(c => c[0]));
      const token = cookie.sid, user = token ? db.prepare(`SELECT u.id,u.username,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND u.active=1 AND s.created_at>=?`).get(sessionDigest(token),new Date(Date.now()-30*86400000).toISOString()) : null;
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
      const context={db,req,body,params:{...r.re.exec(u.pathname).groups},query:Object.fromEntries(u.searchParams),user,token,ip,secure:access.secure};
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
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  const syncTimer=setInterval(()=>{try{if(syncInfo(db).enabled)syncBranch(db).catch(()=>{});}catch{}},60000);syncTimer.unref();
  const reportingTimer=reportingIntervalMs?setInterval(()=>{
    complianceIssuance.processQueue(db).then(result=>{
      for(const [operation,items] of Object.entries(result))for(const item of items)if(item.state==='error')console.error(`ZATCA ${operation} retry failed for invoice ${item.id}:`,item.reason);
    }).catch(error=>console.error('ZATCA compliance queue worker failed:',error));
  },reportingIntervalMs):null;
  reportingTimer?.unref();
  // Automatic nightly backup at 03:00 Riyadh time.
  let lastBackupDate='';
  const backupTimer=setInterval(()=>{
    try{
      const now=nowRiyadh();
      if(now.time>='03:00'&&now.time<'03:05'&&lastBackupDate!==now.date){
        lastBackupDate=now.date;
        const backupDir=path.join(path.dirname(dbFile),'..','backups');
        fs.mkdirSync(backupDir,{recursive:true});
        const dest=path.join(backupDir,'auto-'+now.date.replace(/-/g,'')+'.db');
        jobs.backup().then(({file,dispose})=>{
          fs.copyFileSync(file,dest);
          console.log('Auto-backup saved:',dest);
          try{
            const files=fs.readdirSync(backupDir).filter(f=>f.startsWith('auto-')&&f.endsWith('.db')).sort();
            while(files.length>30){const old=path.join(backupDir,files.shift());try{fs.unlinkSync(old);}catch{}}
          }catch{}
          dispose();
        }).catch(()=>{});
      }
    }catch{}
  },60000);backupTimer.unref();
  server.on('close',()=>{clearInterval(syncTimer);clearInterval(backupTimer);if(reportingTimer)clearInterval(reportingTimer);});
  return { server, db };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const data = process.env.ALMUHTARIZ_DATA || process.env.SMARTZ_DATA || path.join(here, '..', 'data');
  const certPath = process.env.ALMUHTARIZ_TLS_CERT, keyPath = process.env.ALMUHTARIZ_TLS_KEY;
  if (Boolean(certPath) !== Boolean(keyPath)) throw Error('يلزم تحديد مسار الشهادة ومفتاحها معًا');
  const tls = certPath ? {cert:fs.readFileSync(certPath), key:fs.readFileSync(keyPath), minVersion:'TLSv1.2'} : undefined;
  const port = Number(process.env.PORT || 3000);
  const servers = [];
  // خادم HTTPS على جميع واجهات الشبكة للوصول من أجهزة LAN
  if (tls) {
    const { server: httpsServer } = createApp({ dbFile: path.join(data, 'smartz.db'), licensePath: path.join(data, 'license.json'), tls });
    httpsServer.listen(port, '0.0.0.0', () => {
      console.log(`\nالمحترز للمحاسبة يعمل على HTTPS.`);
      for (const l of Object.values(os.networkInterfaces()).flat()) if (l.family === 'IPv4' && !l.internal) console.log(`عنوان الشبكة: https://${l.address}:${port} (استخدم الاسم أو العنوان المشمول في الشهادة)`);
    });
    servers.push(httpsServer);
  }
  // خادم HTTP فقط على localhost للجهاز الرئيسي
  const { server: httpServer } = createApp({ dbFile: path.join(data, 'smartz.db'), licensePath: path.join(data, 'license.json'), tls: undefined });
  httpServer.listen(port + 1, '127.0.0.1', () => {
    console.log(`المحترز للمحاسبة يعمل على HTTP (محلي فقط): http://127.0.0.1:${port + 1}`);
  });
  servers.push(httpServer);
  process.on('SIGTERM', () => { for (const s of servers) s.close(); });
  process.on('SIGINT', () => { for (const s of servers) s.close(); });
}
