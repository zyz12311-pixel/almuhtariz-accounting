import { createHash } from 'node:crypto';
import {
  archiveSignedComplianceDocument,
  claimComplianceWork,
  finalizeComplianceIssue,
  prepareComplianceIssue,
  recordComplianceCredentialStatus,
  recordClearanceAccepted,
  recordComplianceOutcome,
  releaseComplianceWork,
} from '../core.js';
import { extractZatcaQr } from './qr.js';

const xmlDigest = xml => createHash('sha256').update(xml, 'utf8').digest('base64');
const outcomeDetails = result => {
  const warnings=result.warnings??result.result?.validationResults?.warningMessages??[];
  return {...(result.reason?{reason:result.reason}:{}),...(warnings.length?{warnings}:{})};
};

function assertValidation(xml, result) {
  if (!result?.passed || result.xmlSha256 !== xmlDigest(xml)) {
    throw new Error('فشل التحقق الرسمي من ملف XML نفسه');
  }
  return result;
}

function responseSummary(result) {
  return JSON.stringify({
    state: result.state,
    httpStatus: result.httpStatus ?? null,
    clearanceStatus: result.result?.clearanceStatus ?? null,
    reportingStatus: result.result?.reportingStatus ?? null,
    warnings: result.warnings ?? result.result?.validationResults?.warningMessages ?? [],
    errors: result.result?.validationResults?.errorMessages ?? [],
    reason: result.reason ?? '',
  });
}

function decodeClearedInvoice(value) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('رد التخليص لا يتضمن XML معتمداً بصيغة Base64 صالحة');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) throw new Error('ترميز XML المعتمد غير صالح');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function requireDependencies({ signer, validateXml, transport, certificateStatus }) {
  if (typeof signer !== 'function' || typeof validateXml !== 'function' || typeof transport?.submit !== 'function' || typeof certificateStatus !== 'function') {
    throw new Error('مسار الإصدار يحتاج موفر توقيع ومدقق SDK وناقلًا وفاحص صلاحية شهادة مهيئين');
  }
}

export function createComplianceIssuance(dependencies) {
  requireDependencies(dependencies);
  const { signer, validateXml, transport, certificateStatus } = dependencies;

  const replayIfIssued = (db,id,error) => {
    if(db.prepare("SELECT 1 FROM invoices WHERE id=? AND status='issued'").get(id))return {id:Number(id),state:'issued',replayed:true};
    throw error;
  };

  async function checkCredential(db,invoiceId=null) {
    let supplied;
    try {
      supplied=await certificateStatus();
    } catch {
      recordComplianceCredentialStatus(db,{state:'unknown',message:'تعذر التحقق من الشهادة',invoiceId});
      throw new Error('تعذر التحقق من الشهادة؛ أوقف الإرسال حتى التحقق منها');
    }
    let state=['valid','expiring','expired','revoked'].includes(supplied?.state)?supplied.state:'unknown';
    const rawExpiry=supplied?.expiresAt??supplied?.expires_at??supplied?.validTo??null;
    let expiresAt=null;
    if(rawExpiry!==null){
      const timestamp=Date.parse(rawExpiry);
      if(Number.isFinite(timestamp))expiresAt=new Date(timestamp).toISOString();
      else if(state==='valid'||state==='expiring')state='unknown';
    }else if(state==='valid'||state==='expiring')state='unknown';
    if(expiresAt&&Date.parse(expiresAt)<=Date.now())state='expired';
    else if(state==='valid'&&expiresAt&&Date.parse(expiresAt)-Date.now()<=30*86400000)state='expiring';
    const message=String(supplied?.message||'').slice(0,1000);
    recordComplianceCredentialStatus(db,{state,expiresAt,message,invoiceId});
    if(!['valid','expiring'].includes(state)){
      const reason=state==='revoked'?'الشهادة ملغاة؛ امنع استخدامها واطلب شهادة بديلة':state==='expired'?'الشهادة منتهية؛ جددها قبل الإرسال':'حالة الشهادة غير مؤكدة؛ أوقف الإرسال حتى التحقق منها';
      throw new Error(reason);
    }
    return {state,expiresAt,message};
  }

  async function finalizeAcceptedClearance(db, id, xml) {
    assertValidation(xml, await validateXml(xml, { operation: 'clearance-response' }));
    try {
      finalizeComplianceIssue(db, id, { documentKind: 'cleared_xml', content: xml });
    } catch (error) {
      return replayIfIssued(db,id,error);
    }
    return { id: Number(id), state: 'issued', delivery: 'cleared' };
  }

  async function finalizeArchivedSimplified(db, id) {
    const archived = db.prepare("SELECT content,sha256 FROM invoice_documents WHERE invoice_id=? AND kind='signed_xml'").get(id);
    const invoice=db.prepare('SELECT qr FROM invoices WHERE id=?').get(id);
    if (!archived || xmlDigest(archived.content) !== archived.sha256 || !invoice?.qr ||
        extractZatcaQr(archived.content) !== invoice.qr) {
      throw new Error('ملف XML الموقع أو QR النهائي غير مكتمل');
    }
    try {
      assertValidation(archived.content, await validateXml(archived.content, { operation: 'simplified-reporting' }));
    } catch (error) {
      releaseComplianceWork(db,id,{state:'blocked',reason:error.message});
      throw error;
    }
    try {
      finalizeComplianceIssue(db, id, { documentKind: 'signed_xml', content: archived.content, qr: invoice.qr });
    } catch (error) {
      return replayIfIssued(db,id,error);
    }
    return { id: Number(id), state: 'issued', delivery: 'signed', reporting: 'ready' };
  }

  async function issue(db, invoiceId) {
    const current = db.prepare('SELECT id,status FROM invoices WHERE id=?').get(invoiceId);
    if (!current) throw new Error('الفاتورة غير موجودة');
    if (current.status === 'issued') return { id: Number(invoiceId), state: 'issued', replayed: true };
    const queued=db.prepare('SELECT operation,state,last_error,next_attempt_at FROM regulatory_queue WHERE invoice_id=?').get(invoiceId);
    if(queued?.state==='sending')return{id:Number(invoiceId),state:'sending',replayed:true};
    if(queued?.state==='blocked'||queued?.state==='rejected')return{id:Number(invoiceId),state:queued.state,reason:queued.last_error||'' ,replayed:true};
    if(queued?.state==='retry'&&queued.next_attempt_at&&Date.parse(queued.next_attempt_at)>Date.now())return{id:Number(invoiceId),state:'retry',retryAt:queued.next_attempt_at,replayed:true};
    const acceptedClearance=queued?.operation==='clearance'&&queued.state==='accepted';
    const signedDocument=queued?.operation==='reporting'&&Boolean(db.prepare("SELECT 1 FROM invoice_documents WHERE invoice_id=? AND kind='signed_xml'").get(invoiceId));
    if(!acceptedClearance&&!signedDocument)await checkCredential(db,Number(invoiceId));

    let prepared;
    try {
      prepared = prepareComplianceIssue(db, Number(invoiceId));
    } catch (error) {
      return replayIfIssued(db,invoiceId,error);
    }
    if (prepared.state === 'blocked' || prepared.state === 'rejected') {
      throw new Error('مسار الامتثال متوقف؛ راجع حالة الطابور قبل إعادة المحاولة');
    }

    if (prepared.operation === 'clearance' && prepared.state === 'accepted') {
      const archived = db.prepare("SELECT content FROM invoice_documents WHERE invoice_id=? AND kind='cleared_xml'").get(invoiceId);
      if (!archived) throw new Error('استجابة التخليص المقبولة غير مؤرشفة');
      return finalizeAcceptedClearance(db, invoiceId, archived.content);
    }
    if(prepared.operation==='reporting'){
      const archived=db.prepare("SELECT 1 FROM invoice_documents WHERE invoice_id=? AND kind='signed_xml'").get(invoiceId);
      if(archived)return finalizeArchivedSimplified(db,invoiceId);
    }

    const claimed = claimComplianceWork(db, Number(invoiceId), prepared.operation);
    if (prepared.operation === 'reporting') {
      await checkCredential(db,Number(invoiceId));
      let signed;
      try {
        signed = await signer({ invoiceXml: claimed.candidate.content, invoice: prepared.invoice, invoiceHash: prepared.hash, uuid: prepared.uuid });
        if (!signed || typeof signed.xml !== 'string' || !signed.xml || signed.invoiceHash !== prepared.hash || typeof signed.qr !== 'string' || !signed.qr) {
          throw new Error('نتيجة التوقيع لا تطابق بصمة المرشح أو لا تتضمن QR');
        }
        assertValidation(signed.xml, await validateXml(signed.xml, { operation: 'simplified-reporting' }));
        if (extractZatcaQr(signed.xml) !== signed.qr) throw new Error('رمز QR لا يطابق XML الموقع النهائي');
      } catch (error) {
        releaseComplianceWork(db, invoiceId, { state: 'blocked', reason: error.message });
        throw error;
      }
      try {
        archiveSignedComplianceDocument(db,invoiceId,{content:signed.xml,qr:signed.qr});
      } catch (error) {
        releaseComplianceWork(db, invoiceId, { state: 'retry', reason: error.message });
        throw error;
      }
      return finalizeArchivedSimplified(db,invoiceId);
    }

    let officialValidation;
    try {
      officialValidation = assertValidation(claimed.candidate.content, await validateXml(claimed.candidate.content, { operation: 'standard-clearance' }));
    } catch (error) {
      releaseComplianceWork(db, invoiceId, { state: 'blocked', reason: error.message });
      throw error;
    }
    await checkCredential(db,Number(invoiceId));

    let result;
    try {
      result = await transport.submit({
        operation: 'clearance',
        uuid: prepared.uuid,
        invoiceHash: prepared.hash,
        xml: claimed.candidate.content,
        officialValidation,
      });
    } catch (error) {
      recordComplianceOutcome(db, invoiceId, { state: 'retry', startedAt: claimed.startedAt, reason: error.message });
      throw error;
    }
    if (!result || !['accepted', 'blocked', 'retry', 'rejected'].includes(result.state)) {
      const error = new Error('نتيجة التخليص غير معروفة؛ أُوقف الإكمال الآلي');
      recordComplianceOutcome(db, invoiceId, { state: 'rejected', startedAt: claimed.startedAt, reason: error.message });
      throw error;
    }
    if (result.state !== 'accepted') {
      recordComplianceOutcome(db, invoiceId, {
        state: result.state,
        startedAt: claimed.startedAt,
        reason: result.reason || '',
        responseCode: result.httpStatus ?? null,
        responseSummary: responseSummary(result),
        retryAfter: result.retryAfter,
      });
      return { id: Number(invoiceId), state: result.state, ...outcomeDetails(result) };
    }

    let clearedXml;
    try {
      clearedXml = decodeClearedInvoice(result.result?.clearedInvoice);
    } catch (error) {
      recordComplianceOutcome(db, invoiceId, {
        state: 'retry',
        startedAt: claimed.startedAt,
        reason: error.message,
        responseCode: result.httpStatus ?? null,
        responseSummary: responseSummary(result),
      });
      throw error;
    }
    const summary = responseSummary(result);
    recordClearanceAccepted(db, invoiceId, {
      startedAt: claimed.startedAt,
      responseCode: result.httpStatus ?? null,
      responseSummary: summary,
      clearedXml,
    });
    return {...await finalizeAcceptedClearance(db, invoiceId, clearedXml),...outcomeDetails(result)};
  }

  async function reportReady(db, { limit = 20 } = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('حد الدفعة يجب أن يكون من 1 إلى 100');
    await checkCredential(db);
    const now = new Date().toISOString();
    const nowMs = Date.now();
    // الفواتير المبسطة يجب إبلاغها خلال 24 ساعة من الإصدار
    const rows = db.prepare(`SELECT q.invoice_id, i.issue_date, i.issue_time FROM regulatory_queue q
      JOIN invoices i ON i.id=q.invoice_id
      WHERE q.operation='reporting' AND q.state IN ('ready','retry') AND i.status='issued'
      AND (q.next_attempt_at IS NULL OR q.next_attempt_at<=?) ORDER BY i.id LIMIT ?`).all(now, limit);
    const results = [];
    for (const { invoice_id: invoiceId, issue_date, issue_time } of rows) {
      // التحقق من مهلة 24 ساعة للفواتير المبسطة
      if (issue_date && issue_time) {
        const issueMs = new Date(`${issue_date}T${issue_time}+03:00`).getTime();
        if (!Number.isNaN(issueMs) && nowMs - issueMs > 24 * 60 * 60 * 1000) {
          // تجاوزت المهلة: احجب الفاتورة وسجل السبب
          db.prepare("UPDATE regulatory_queue SET state='blocked', last_error=?, updated_at=? WHERE invoice_id=? AND operation='reporting'")
            .run('تجاوزت مهلة الإبلاغ النظامية (24 ساعة) للفاتورة المبسطة', new Date().toISOString(), invoiceId);
          db.prepare('INSERT INTO regulatory_attempts(invoice_id,started_at,finished_at,outcome,response_code,response_summary) VALUES(?,?,?,?,?,?)')
            .run(invoiceId, new Date(issueMs).toISOString(), now, 'blocked', null, 'تجاوزت مهلة الإبلاغ النظامية (24 ساعة) للفاتورة المبسطة');
          results.push({ id: Number(invoiceId), state: 'blocked', reason: 'تجاوزت مهلة الإبلاغ النظامية (24 ساعة)' });
          continue;
        }
      }
      const claimed = claimComplianceWork(db, invoiceId, 'reporting');
      await checkCredential(db,invoiceId);
      const signed = db.prepare("SELECT content,sha256 FROM invoice_documents WHERE invoice_id=? AND kind='signed_xml'").get(invoiceId);
      if (!signed || xmlDigest(signed.content) !== signed.sha256) {
        releaseComplianceWork(db, invoiceId, { state: 'blocked', reason: 'ملف XML الموقع مفقود أو تغيرت بصمته' });
        throw new Error(`ملف XML الموقع غير صالح للفواتورة ${invoiceId}`);
      }
      let officialValidation;
      try {
        officialValidation = assertValidation(signed.content, await validateXml(signed.content, { operation: 'simplified-reporting' }));
      } catch (error) {
        releaseComplianceWork(db, invoiceId, { state: 'blocked', reason: error.message });
        throw error;
      }
      let result;
      try {
        result = await transport.submit({
          operation: 'reporting',
          uuid: claimed.invoice.uuid,
          invoiceHash: claimed.invoice.hash,
          xml: signed.content,
          officialValidation,
        });
      } catch (error) {
        recordComplianceOutcome(db, invoiceId, { state: 'retry', startedAt: claimed.startedAt, reason: error.message });
        throw error;
      }
      if (!result || !['accepted', 'blocked', 'retry', 'rejected'].includes(result.state)) {
        const error = new Error('نتيجة الإبلاغ غير معروفة؛ أُوقف الإكمال الآلي');
        recordComplianceOutcome(db, invoiceId, { state: 'rejected', startedAt: claimed.startedAt, reason: error.message });
        throw error;
      }
      recordComplianceOutcome(db, invoiceId, {
        state: result.state,
        startedAt: claimed.startedAt,
        reason: result.reason || '',
        responseCode: result.httpStatus ?? null,
        responseSummary: responseSummary(result),
        retryAfter: result.retryAfter,
      });
      results.push({ id: Number(invoiceId), state: result.state, ...outcomeDetails(result) });
    }
    return results;
  }

  async function retryClearances(db,{limit=20}={}) {
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('حد الدفعة يجب أن يكون من 1 إلى 100');
    await checkCredential(db);
    const now=new Date().toISOString();
    const rows=db.prepare(`SELECT q.invoice_id FROM regulatory_queue q JOIN invoices i ON i.id=q.invoice_id
      WHERE q.operation='clearance' AND q.state='retry' AND i.status='draft'
      AND (q.next_attempt_at IS NULL OR q.next_attempt_at<=?) ORDER BY i.id LIMIT ?`).all(now,limit);
    const results=[];
    for(const {invoice_id:invoiceId} of rows){
      try{results.push(await issue(db,invoiceId));}
      catch(error){results.push({id:Number(invoiceId),state:'error',reason:error.message});}
    }
    return results;
  }

  async function processQueue(db,{limit=20}={}) {
    const clearance=await retryClearances(db,{limit}),reporting=await reportReady(db,{limit});
    return {clearance,reporting};
  }

  return { issue, reportReady, retryClearances, processQueue };
}
