import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { archiveSignedComplianceDocument, createCreditNote, createDebitNote, createInvoice, getInvoice, recoverInterruptedComplianceWork, seedCompany, setSetting } from '../server/core.js';
import { createComplianceIssuance } from '../server/zatca/issuance.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almuhtariz-zatca-issuance-'));
const db = openDb(path.join(dir, 'test.db'));
const company = {
  name_ar: 'منشأة اختبار',
  vat_number: '300000000000003',
  cr_number: '1234567890',
  street: 'شارع الاختبار',
  building_number: '1234',
  district: 'الاختبار',
  city: 'الرياض',
  postal_code: '12345',
  country_code: 'SA',
};
const xmlDigest = xml => crypto.createHash('sha256').update(xml, 'utf8').digest('base64');
const finalQr=Buffer.from('final-qr','utf8').toString('base64');
const withQr=(xml,qr)=>xml.replace('</Invoice>','<cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject>'+qr+'</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference></Invoice>');
let clearanceState = 'accepted';
let clearanceCalls = 0;
let reportingCalls = 0;
let observedUnpostedClearance = false;
let credential={state:'valid',expiresAt:'2099-12-31T23:59:59.000Z'};
let clearanceWarnings=[];
let reportingWarnings=[];
let retryInvoiceId=null;
const retryIdentities=[];

try {
  seedCompany(db, company.name_ar);
  setSetting(db, 'company', company);
  const partyId = Number(db.prepare(`INSERT INTO parties(name_ar,vat_number,entity_type,street,building_number,district,city,postal_code,country_code)
    VALUES(?,?,?,?,?,?,?,?,?)`).run('عميل اختبار', '399999999800003', 'business', company.street, company.building_number, company.district, company.city, company.postal_code, 'SA').lastInsertRowid);
  const flow = createComplianceIssuance({
    signer: async ({ invoiceXml, invoiceHash }) => ({ xml: withQr(invoiceXml,finalQr), invoiceHash, qr: finalQr }),
    validateXml: async xml => ({ passed: true, xmlSha256: xmlDigest(xml) }),
    certificateStatus:async()=>credential,
    transport: {
      async submit(request) {
        if (request.operation === 'clearance') {
          clearanceCalls++;
          const current=db.prepare('SELECT id,status FROM invoices WHERE uuid=?').get(request.uuid);
          if(current?.id===retryInvoiceId)retryIdentities.push({uuid:request.uuid,hash:request.invoiceHash});
          const journal=db.prepare('SELECT 1 FROM journal_entries WHERE source_type=? AND source_id=?').get('invoice',current?.id);
          observedUnpostedClearance ||= current?.status==='draft'&&!journal;
          if (clearanceState !== 'accepted') return { state: clearanceState, httpStatus: 400, reason: 'محاكاة رفض التخليص' };
          return {
            state: 'accepted',
            httpStatus: 200,
            result: {
              clearanceStatus: 'CLEARED',
              clearedInvoice: Buffer.from('<cleared-invoice/>', 'utf8').toString('base64'),
            },
            warnings:clearanceWarnings,
          };
        }
        reportingCalls++;
        return { state: 'accepted', httpStatus: 200, result: { reportingStatus: 'REPORTED' },warnings:reportingWarnings };
      },
    },
  });

  const simplified = createInvoice(db, 1, {
    draft: true,
    lines: [{ description: 'خدمة مبسطة', qty: 1, unit_price: '100.00', vat_rate: 15 }],
  });
  const simplifiedResult = await flow.issue(db, simplified);
  assert.deepEqual(simplifiedResult, { id: simplified, state: 'issued', delivery: 'signed', reporting: 'ready' });
  assert.equal(getInvoice(db, simplified).status, 'issued');
  assert.equal(getInvoice(db, simplified).qr, finalQr);
  assert.equal(db.prepare("SELECT state FROM regulatory_queue WHERE invoice_id=?").get(simplified).state, 'ready');
  assert.ok(db.prepare("SELECT content FROM invoice_documents WHERE invoice_id=? AND kind='signed_xml'").get(simplified));
  assert.equal(clearanceCalls, 0, 'simplified issuance must not call clearance');

  reportingWarnings=['تحذير إبلاغ'];
  const reportResults = await flow.reportReady(db);
  assert.deepEqual(reportResults, [{ id: simplified, state: 'accepted',warnings:reportingWarnings }]);
  assert.match(db.prepare('SELECT last_response FROM regulatory_queue WHERE invoice_id=?').get(simplified).last_response,/تحذير إبلاغ/);
  reportingWarnings=[];
  assert.equal(reportingCalls, 1);
  assert.equal(db.prepare("SELECT state FROM regulatory_queue WHERE invoice_id=?").get(simplified).state, 'accepted');

  const standard = createInvoice(db, 1, {
    draft: true,
    party_id: partyId,
    invoice_kind: 'standard',
    supply_date: '2026-11-25',
    lines: [{ description: 'خدمة قياسية', qty: 1, unit_price: '100.00', vat_rate: 15 }],
  });
  clearanceWarnings=['تحذير تخليص'];
  const standardResult = await flow.issue(db, standard);
  assert.deepEqual(standardResult, { id: standard, state: 'issued', delivery: 'cleared',warnings:clearanceWarnings });
  assert.match(db.prepare('SELECT last_response FROM regulatory_queue WHERE invoice_id=?').get(standard).last_response,/تحذير تخليص/);
  clearanceWarnings=[];
  assert.equal(observedUnpostedClearance, true, 'accounting must remain unposted while clearance is pending');
  assert.equal(getInvoice(db, standard).status, 'issued');
  assert.ok(db.prepare("SELECT content FROM invoice_documents WHERE invoice_id=? AND kind='cleared_xml'").get(standard));

  const credit = createCreditNote(db, 1, standard, { lines: [{ line_no: 1, qty: 0.5 }], reason: 'مرتجع جزئي', deferIssue: true });
  assert.equal(getInvoice(db, credit).status, 'draft');
  await flow.issue(db, credit);
  assert.equal(getInvoice(db, credit).status, 'issued');

  const debit = createDebitNote(db, 1, standard, {
    lines: [{ description: 'خدمة إضافية', qty: 1, unit_price: '10.00', vat_rate: 15 }],
    reason: 'زيادة مستحقة',
    deferIssue: true,
  });
  assert.equal(getInvoice(db, debit).status, 'draft');
  await flow.issue(db, debit);
  assert.equal(getInvoice(db, debit).status, 'issued');

  const retryInvoice=createInvoice(db,1,{draft:true,party_id:partyId,invoice_kind:'standard',supply_date:'2026-11-25',lines:[{description:'إعادة آمنة',qty:1,unit_price:'15.00',vat_rate:15}]});
  retryInvoiceId=retryInvoice;
  clearanceState='retry';
  assert.deepEqual(await flow.issue(db,retryInvoice),{id:retryInvoice,state:'retry',reason:'محاكاة رفض التخليص'});
  const retryQueue=db.prepare('SELECT state,next_attempt_at FROM regulatory_queue WHERE invoice_id=?').get(retryInvoice);
  assert.equal(retryQueue.state,'retry');
  assert.deepEqual(await flow.issue(db,retryInvoice),{id:retryInvoice,state:'retry',retryAt:retryQueue.next_attempt_at,replayed:true});
  assert.equal(retryIdentities.length,1,'an API replay during backoff does not submit again');
  const retryDelay=Date.parse(retryQueue.next_attempt_at)-Date.now();
  assert.ok(retryDelay>0&&retryDelay<=30000,'transient failures use the initial capped exponential backoff');
  db.prepare("UPDATE regulatory_queue SET state='sending',next_attempt_at=NULL WHERE invoice_id=?").run(retryInvoice);
  assert.equal(recoverInterruptedComplianceWork(db),1);
  assert.equal(db.prepare('SELECT state FROM regulatory_queue WHERE invoice_id=?').get(retryInvoice).state,'retry');
  db.prepare("UPDATE regulatory_queue SET next_attempt_at='2000-01-01T00:00:00.000Z' WHERE invoice_id=?").run(retryInvoice);
  clearanceState='accepted';
  const retryResults=await flow.retryClearances(db);
  assert.equal(retryResults.some(result=>result.id===retryInvoice&&result.state==='issued'),true);
  assert.equal(getInvoice(db,retryInvoice).status,'issued');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM journal_entries WHERE source_type='invoice' AND source_id=?").get(retryInvoice).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM regulatory_attempts WHERE invoice_id=?').get(retryInvoice).n,3);
  assert.equal(retryIdentities.length,2);
  assert.deepEqual(retryIdentities[0],retryIdentities[1]);

  const credentialInvoice=createInvoice(db,1,{draft:true,lines:[{description:'شهادة غير صالحة',qty:1,unit_price:'10.00',vat_rate:15}]});
  credential={state:'revoked',expiresAt:'2099-12-31T23:59:59.000Z'};
  const callsBeforeCredential=clearanceCalls;
  await assert.rejects(()=>flow.issue(db,credentialInvoice),/الشهادة ملغاة/);
  assert.equal(clearanceCalls,callsBeforeCredential);
  assert.equal(db.prepare("SELECT value FROM compliance_state WHERE key='credential_status'").get().value,'revoked');
  credential={state:'valid',expiresAt:'2099-12-31T23:59:59.000Z'};
  await flow.issue(db,credentialInvoice);
  assert.equal(getInvoice(db,credentialInvoice).status,'issued');

  const expiredInvoice=createInvoice(db,1,{draft:true,lines:[{description:'شهادة منتهية',qty:1,unit_price:'10.00',vat_rate:15}]});
  credential={state:'valid',expiresAt:'2000-01-01T00:00:00.000Z'};
  const callsBeforeExpiry=clearanceCalls;
  await assert.rejects(()=>flow.issue(db,expiredInvoice),/الشهادة منتهية/);
  assert.equal(clearanceCalls,callsBeforeExpiry);
  assert.equal(db.prepare("SELECT value FROM compliance_state WHERE key='credential_status'").get().value,'expired');
  credential={state:'valid',expiresAt:'2099-12-31T23:59:59.000Z'};
  await flow.issue(db,expiredInvoice);
  assert.equal(getInvoice(db,expiredInvoice).status,'issued');

  clearanceState = 'rejected';
  const rejected = createInvoice(db, 1, {
    draft: true,
    party_id: partyId,
    invoice_kind: 'standard',
    supply_date: '2026-11-25',
    lines: [{ description: 'خدمة مرفوضة', qty: 1, unit_price: '20.00', vat_rate: 15 }],
  });
  assert.deepEqual(await flow.issue(db, rejected), { id: rejected, state: 'rejected',reason:'محاكاة رفض التخليص' });
  assert.equal(getInvoice(db, rejected).status, 'draft');
  assert.equal(db.prepare('SELECT 1 FROM journal_entries WHERE source_id=?').get(rejected), undefined);
  assert.equal(db.prepare('SELECT state FROM regulatory_queue WHERE invoice_id=?').get(rejected).state, 'rejected');
  assert.ok(clearanceCalls >= 3);
  const following=createInvoice(db,1,{draft:true,lines:[{description:'بعد الرفض',qty:1,unit_price:'10.00',vat_rate:15}]});
  await assert.rejects(()=>flow.issue(db,following),/إصدار امتثال غير مكتمل/);
  const mismatchedQr=Buffer.from('different-qr','utf8').toString('base64');
  db.prepare("UPDATE regulatory_queue SET operation='reporting',state='sending' WHERE invoice_id=?").run(rejected);
  const candidate=db.prepare("SELECT content FROM invoice_documents WHERE invoice_id=? AND kind='xml_candidate'").get(rejected).content;
  assert.throws(()=>archiveSignedComplianceDocument(db,rejected,{content:withQr(candidate,mismatchedQr),qr:finalQr}),/لا يطابق/);
  assert.equal(db.prepare("SELECT 1 FROM invoice_documents WHERE invoice_id=? AND kind='signed_xml'").get(rejected),undefined);
} finally {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('نجحت محاكاة مساري التوقيع المبسط والتخليص القياسي، وتأخر الترحيل حتى اكتمال التخليص، وطابور الإبلاغ والإشعارات');
