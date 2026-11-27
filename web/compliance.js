const stateLabels={blocked:'محجوب',ready:'جاهز',sending:'قيد الإرسال',accepted:'مقبول',rejected:'مرفوض',retry:'إعادة محاولة'};
const credentialLabels={valid:'سارية',expiring:'قريبة الانتهاء',expired:'منتهية',revoked:'ملغاة',unknown:'غير مؤكدة',unconfigured:'غير مهيأة'};
const issuerScopeLabels={central_server:'الخادم المركزي للمنشأة',independent_branch:'خادم فرع مستقل'};
const issuerKeyStateLabels={generated:'مولد ومحفوظ داخل DPAPI',missing:'لم يولّد بعد',identity_required:'أنشئ ملف الوحدة أولاً',identity_mismatch:'المخزن لا يطابق هوية الوحدة',invalid:'المفتاح المحفوظ غير صالح',unavailable:'DPAPI غير متاح على هذا الخادم'};
const csidTypeLabels={compliance:'CSID الامتثال',production:'CSID الإنتاج'};
const csidStatusLabels={active:'نشط',pending_csr:'في انتظار CSR',expired:'منتهي',revoked:'ملغى'};
const dateLabel=value=>value?new Date(value).toLocaleString('ar-SA-u-nu-latn'):'—';

export async function renderCompliance({api,shell,esc}){
  const [state,queuePage,attemptPage,acceptance,csid]=await Promise.all([
    api('compliance/status'),
    api('compliance/lists/queue'),
    api('compliance/attempts'),
    api('compliance/acceptance'),
    api('compliance/csid'),
  ]);
  const {pagedView}=await import('./paged-view.js');
  const credentialState=state.certificate_configured?(credentialLabels[state.credential.state]||'غير معروفة'):'غير مهيأة';
  const issuer=state.issuer_profile;
  const issuerKey=state.issuer_key;
  const issuerKeyState=issuerKey?.configured?(issuerKeyStateLabels[issuerKey.state]||'مولد'):issuerKeyStateLabels[issuerKey?.state]||'غير معروف';
  const metric=(label,value,detail)=>'<article class="card compliance-metric"><span>'+label+'</span><strong>'+esc(value)+'</strong><small>'+detail+'</small></article>';
  const queueRows=rows=>rows.map(row=>{
    const retry=row.state==='blocked'&&String(row.last_error||'').startsWith('auth:');
    const documentLink=row.accounting_status==='issued'?'<a href="/api/invoices/'+encodeURIComponent(row.invoice_id)+'/xml">XML النهائي</a>':'لا يوجد XML نهائي';
    return '<tr><td>'+esc(row.number||'—')+'</td><td>'+(row.operation==='clearance'?'تخليص':'إبلاغ')+'</td><td><span class="status '+(row.state==='accepted'?'issued':row.state==='rejected'?'compliance-failed':'draft')+'">'+esc(stateLabels[row.state]||row.state)+'</span><small class="compliance-substatus">محاسبي: '+esc(row.accounting_status)+'</small></td><td>'+esc(row.last_error||'—')+'</td><td>'+documentLink+(retry?'<button type="button" class="compliance-retry" data-retry="'+esc(row.invoice_id)+'">إعادة للطابور</button>':'')+'</td></tr>';
  }).join('');
  const attemptRows=rows=>rows.map(row=>'<tr><td>'+esc(row.number||'—')+'</td><td>'+(row.operation==='clearance'?'تخليص':'إبلاغ')+'</td><td>'+esc(stateLabels[row.outcome]||row.outcome)+'</td><td>'+esc(row.response_code??'—')+'</td><td>'+esc(dateLabel(row.finished_at))+'</td><td><details><summary>عرض التفاصيل</summary><pre class="compliance-response" dir="auto">'+esc(row.response_summary)+'</pre></details></tr>').join('');
  const acceptanceRows=acceptance.items.map((item,index)=>'<tr><td>'+(index+1)+'</td><td>'+esc(item.label)+'</td><td>'+esc(item.scope)+'</td><td><span class="status draft">قيد التنفيذ</span></td><td>لا يوجد دليل مسجل</td></tr>').join('');
  const csidCard=(csid,type)=>{const c=csid[type];if(!c)return'<p class="hint">'+csidTypeLabels[type]+' غير مطلوب بعد.</p>';return'<dl class="compliance-facts"><div><dt>CSID</dt><dd dir="ltr">'+esc(c.csid)+'</dd></div><div><dt>الحالة</dt><dd><span class="status '+(c.status==='active'?'issued':'draft')+'">'+esc(csidStatusLabels[c.status]||c.status)+'</span></dd></div><div><dt>تاريخ الطلب</dt><dd>'+esc(dateLabel(c.requested_at))+'</dd></div><div><dt>تاريخ الانتهاء</dt><dd>'+esc(dateLabel(c.expires_at))+'</dd></div>'+(c.compliance_csid?'<div><dt>CSID الامتثال المرجعي</dt><dd dir="ltr">'+esc(c.compliance_csid)+'</dd></div>':'')+'</dl>';};
  shell(`<header class="page-heading compliance-heading"><div><span class="eyebrow">مركز قيادة الربط</span><h1>الفوترة والهيئة</h1><p>حالة مستقلة لوحدة الإصدار والاعتماد التنظيمي؛ لا تؤثر على حالة القيود المحاسبية.</p></div><span class="status draft">بيئة ${esc(state.mode)}</span></header>
  <section class="compliance-alert" role="status"><strong>الإنتاج غير مفعّل</strong><span>الاختبارات السابقة لا تغلق قائمة القبول الجديدة. لا توجد شهادة تشغيل أو اعتماد رسمي موثق.</span></section>
  <section class="grid compliance-metrics" aria-label="ملخص حالات الامتثال">
    ${metric('الفواتير المعتمدة',Number(state.counts.cleared)+Number(state.counts.reported),'تخليص وإبلاغ مقبولان')}
    ${metric('الفواتير المعلقة',state.counts.pending,'جاهزة أو قيد الإرسال أو إعادة المحاولة')}
    ${metric('مرفوضة أو محجوبة',Number(state.counts.rejected)+Number(state.counts.blocked),'تحتاج مراجعة المالك')}
    ${metric('اختبارات القبول',acceptance.passed+' / '+acceptance.total,'لم تسجل أدلة جديدة بعد')}
  </section>
  <section class="grid compliance-two">
    <article class="card"><div class="section-heading"><h3>بيانات المنشأة ووحدة الإصدار</h3><span class="status draft">${issuer?'ملف محلي غير مسجل لدى الهيئة':'هوية الوحدة غير مهيأة'}</span></div>
     <dl class="compliance-facts"><div><dt>المنشأة</dt><dd>${esc(state.company.name_ar||'غير مكتمل')}</dd></div><div><dt>الرقم الضريبي</dt><dd dir="ltr">${esc(state.company.vat_number||'غير مكتمل')}</dd></div>${issuer?'<div><dt>معرّف الملف المحلي (ليس EGS رسميًا)</dt><dd dir="ltr">'+esc(issuer.local_id)+'</dd></div><div><dt>نطاق الخادم</dt><dd>'+esc(issuerScopeLabels[issuer.scope]||'غير معروف')+'</dd></div><div><dt>ربط الرقم الضريبي</dt><dd>'+(issuer.company_vat_matches?'مطابق':'غير مطابق؛ أوقف التهيئة وراجع بيانات المنشأة')+'</dd></div>':'<div><dt>هوية EGS الرسمية</dt><dd>غير مسجلة</dd></div>'}</dl>
     <p class="hint">هذا سجل محلي مرتبط بوحدة الإصدار على هذا الخادم فقط؛ المعرّف المحلي ليس الرقم التسلسلي الرسمي ولا يُستخدم في CSR. الفرع المستقل يحتاج تثبيتًا ومخزن مفاتيح منفصلين.</p>
     ${state.seller_errors.length?'<ul class="compliance-errors">'+state.seller_errors.map(error=>'<li>'+esc(error)+'</li>').join('')+'</ul>':'<p class="compliance-ok">اجتازت بيانات المنشأة فحوص الحقول المحلية فقط.</p>'}
     <a class="button" href="#settings" id="compliance-company-settings">بيانات المنشأة</a>
     <form id="compliance-issuer-form" class="compliance-issuer-form">
      <label>اسم داخلي للوحدة<input id="compliance-issuer-name" maxlength="100" required value="${issuer?esc(issuer.name):''}" placeholder="خادم المنشأة الرئيسي"></label>
      ${issuer?'<input id="compliance-issuer-scope" type="hidden" value="'+esc(issuer.scope)+'">':'<label>نطاق هذا الخادم<select id="compliance-issuer-scope"><option value="central_server">خادم مركزي للمنشأة</option><option value="independent_branch">خادم فرع مستقل</option></select></label>'}
      <button class="p" type="submit">${issuer?'حفظ الاسم الداخلي':'إنشاء ملف وحدة محلي'}</button>
      <p id="compliance-issuer-result" role="status"></p>
     </form>
    </article>
    <article class="card"><div class="section-heading"><h3>الشهادة الرقمية</h3><span class="status draft">${esc(credentialState)}</span></div>
     <dl class="compliance-facts"><div><dt>تاريخ الانتهاء</dt><dd>${esc(dateLabel(state.credential.expires_at))}</dd></div><div><dt>آخر فحص</dt><dd>${esc(dateLabel(state.credential.checked_at))}</dd></div></dl>
     <dl class="compliance-facts"><div><dt>حالة المفتاح الخاص</dt><dd>${esc(issuerKeyState)}</dd></div>${issuerKey?.fingerprint?'<div><dt>بصمة المفتاح العام</dt><dd dir="ltr">'+esc(issuerKey.fingerprint)+'</dd></div>':''}</dl>
     ${issuer&&issuerKey?.state==='missing'&&issuer.company_vat_matches&&!state.certificate_migration_required?'<button type="button" class="p" id="compliance-generate-key">توليد مفتاح ECDSA داخل مخزن DPAPI</button>':''}
     <p id="compliance-key-result" role="status">${esc(issuerKey?.error||'')}</p>
     <p>${esc(state.credential.message||'لا توجد شهادة مهيأة أو حالة صلاحية موثقة.')}</p>
 ${state.certificate_migration_required?'<div class="compliance-alert" role="status"><strong>بيانات قديمة غير محمية في قاعدة البيانات</strong><span>انقلها إلى مخزن DPAPI قبل أي إعداد آخر. لن تظهر قيم الشهادة أو المفتاح.</span><button type="button" id="compliance-migrate-legacy">نقل إلى مخزن DPAPI</button></div>':''}
     <p id="compliance-migration-result" role="status"></p>
     <div class="compliance-actions">
       <button type="button" id="compliance-generate-csr" ${issuer&&issuerKey?.state==='generated'&&issuer.company_vat_matches?'':'disabled'} title="توليد طلب توقيع شهادة (CSR)">إنشاء CSR</button>
       <button type="button" disabled title="إجراء التجديد والإلغاء غير منفذ">تجديد / إلغاء الشهادة</button>
     </div>
     <p id="compliance-csr-result" role="status"></p>
     ${state.csr_generated?'<div class="compliance-csr-display"><h4>CSR مولد</h4><pre class="csr-pem" dir="ltr">'+esc(state.csr_pem)+'</pre><button type="button" id="compliance-download-csr">تنزيل CSR</button></div>':''}
     <p class="hint">لن تظهر مفاتيح خاصة أو رموز مصادقة هنا. توليد CSR وتهيئة CSID والتجديد والإلغاء غير متاحة حتى اعتماد تدفق التهيئة الرسمي.</p>
    <div class="compliance-alert"><strong>حماية المفتاح والاستعادة</strong><span>يحمي DPAPI المفتاح ضمن حساب Windows الحالي. النسخ العادية تشمل قاعدة البيانات فقط؛ استعادة المفتاح تتطلب نسخة Windows محمية لحساب DPAPI على المضيف والحساب نفسيهما. عند فقدهما، يلزم إعادة تهيئة الوحدة بمفتاح جديد.</span></div>
    </article>
  </section>
  <section class="grid compliance-two">
    <article class="card"><div class="section-heading"><h3>CSID — معرفات وحدة الإصدار</h3><span class="status draft">${csid.compliance?'نشط':'غير مطلوب بعد'}</span></div>
     <h4>CSID الامتثال</h4>
     ${csidCard(csid,'compliance')}
     <h4>CSID الإنتاج</h4>
     ${csidCard(csid,'production')}
     ${csid.csid_renewal?'<div class="compliance-alert"><strong>طلب تجديد معلق</strong><span>تم طلب التجديد في '+esc(dateLabel(csid.csid_renewal.requested_at))+' — يجب إنشاء CSR جديد وتقديمه للهيئة.</span></div>':''}
     <div class="compliance-actions">
       <button type="button" class="p" id="compliance-request-csid-compliance" ${csid.certificate_configured && !csid.compliance && issuer && issuer.registration_status==='not_registered'?'':'disabled'} title="طلب CSID الامتثال (محاكاة)">طلب CSID الامتثال</button>
       <button type="button" class="p" id="compliance-request-csid-production" ${csid.compliance && csid.compliance.status==='active' && !csid.production?'':'disabled'} title="طلب CSID الإنتاج (محاكاة)">طلب CSID الإنتاج</button>
       <button type="button" class="p" id="compliance-renew-csid" ${csid.certificate_configured && csid.compliance?'':'disabled'} title="طلب تجديد الشهادة (محاكاة)">طلب تجديد</button>
     </div>
     <p id="compliance-csid-result" role="status"></p>
     <p class="hint">جميع عمليات CSID محاكاة — لا يوجد اتصال حقيقي بهيئة ZATCA. CSID الامتثال يُحصل عليه أولاً، ثم CSID الإنتاج.</p>
    </article>
    <article class="card"><div class="section-heading"><h3>اختبارات الامتثال — قائمة القبول الجديدة</h3><p>النتائج السابقة لا تُحتسب ضمن هذه القائمة؛ يلزم دليل مولّد من مسار التطبيق نفسه.</p></div><strong class="compliance-score">${acceptance.passed} / ${acceptance.total}</strong></div>
      <div class="table-scroll"><table><thead><tr><th>#</th><th>معيار القبول</th><th>النطاق</th><th>الحالة</th><th>الدليل</th></tr></thead><tbody>${acceptanceRows}</tbody></table></div>
      <p class="hint">الحالة الحالية ${acceptance.pending} بنداً قيد التنفيذ. لا يوجد زر لتسجيل نجاح يدوي؛ يجب ربط النتيجة باختبار فعلي وسجل دليل موثوق.</p>
    </article>
  </section>
  <section class="card"><div class="section-heading"><div><h3>طابور الاعتماد والإبلاغ</h3><p>الحالة التنظيمية منفصلة عن الحالة المحاسبية.</p></div><button type="button" class="p" id="compliance-run" ${state.issuance_flow_configured?'':'disabled'}>تشغيل الطابور</button></div>
    <p id="compliance-run-result" role="status"></p><div class="table-scroll"><table><thead><tr><th>المستند</th><th>المسار</th><th>الحالة / المحاسبة</th><th>آخر سبب</th><th>الإجراء</th></tr></thead><tbody id="compliance-queue-list"></tbody></table></div>
  </section>
  <section class="card"><div class="section-heading"><div><h3>سجل استجابات الهيئة</h3><p>محفوظات المحاولات والاستجابات، مع إظهار الملخص دون بيانات اعتماد.</p></div></div>
    <div class="table-scroll"><table><thead><tr><th>المستند</th><th>المسار</th><th>النتيجة</th><th>HTTP</th><th>الوقت</th><th>الاستجابة</th></tr></thead><tbody id="compliance-attempt-list"></tbody></table></div>
  </section>
  <section class="card"><h3>سلامة السجل</h3><p>حالة سجل التدقيق: ${state.audit_valid===null?'لم يُفحص بعد':state.audit_valid?'اجتاز الفحص المحلي':'يتطلب مراجعة'}</p><button type="button" id="verify-audit">فحص سجل التدقيق</button><p id="audit-result" role="status"></p></section>`);

 document.querySelector('#compliance-company-settings').onclick=()=>{sessionStorage.tab='company';};
 const generateKeyButton=document.querySelector('#compliance-generate-key');
 if(generateKeyButton)generateKeyButton.onclick=async()=>{
  const result=document.querySelector('#compliance-key-result');
  generateKeyButton.disabled=true;result.textContent='يجري توليد المفتاح وحفظه… لن يعاد المفتاح الخاص.';
  try{
   const outcome=await api('compliance/issuer/key/generate',{method:'POST',body:{}});
   await renderCompliance({api,shell,esc});
   document.querySelector('#compliance-key-result').textContent='حُفظ المفتاح. بصمة المفتاح العام: '+outcome.fingerprint;
  }
  catch(error){result.textContent=error.message;generateKeyButton.disabled=false;}
 };
 const issuerForm=document.querySelector('#compliance-issuer-form');
 issuerForm.onsubmit=async event=>{
  event.preventDefault();
  const button=issuerForm.querySelector('[type=submit]'),result=document.querySelector('#compliance-issuer-result');
  button.disabled=true;result.textContent='يجري حفظ ملف الوحدة المحلي…';
  try{
   const outcome=await api('compliance/issuer',{method:'PUT',body:{
    name:document.querySelector('#compliance-issuer-name').value.trim(),
    scope:document.querySelector('#compliance-issuer-scope').value,
   }});
   await renderCompliance({api,shell,esc});
   document.querySelector('#compliance-issuer-result').textContent=outcome.created?'أُنشئ ملف محلي غير مسجل لدى الهيئة.':'حُفظ الاسم الداخلي.';
  }
  catch(error){result.textContent=error.message;button.disabled=false;}
 };
 const migrateButton=document.querySelector('#compliance-migrate-legacy');
 if(migrateButton)migrateButton.onclick=async()=>{
  migrateButton.disabled=true;
  const result=document.querySelector('#compliance-migration-result');
  result.textContent='يجري نقل البيانات المشفرة…';
  try{
   const outcome=await api('compliance/certificate/migrate',{method:'POST',body:{}});
   await renderCompliance({api,shell,esc});
   const updatedResult=document.querySelector('#compliance-migration-result');
   if(updatedResult)updatedResult.textContent=outcome.migrated?'نُقلت بيانات الاعتماد وأزيلت من قاعدة البيانات.':'لا توجد بيانات قديمة للنقل.';
  }
  catch(error){result.textContent=error.message;migrateButton.disabled=false;}
 };
document.querySelector('#verify-audit').onclick=async()=>{
   const button=document.querySelector('#verify-audit'),result=document.querySelector('#audit-result');
   button.disabled=true;result.textContent='يجري فحص السجل…';
   try{const checked=await api('compliance/audit/verify');result.textContent=checked.valid?'اجتاز الفحص المحلي حتى الحدث '+checked.tip.id:'كشف الفحص خللاً؛ راجع السجل.';}
   catch(error){result.textContent=error.message;}finally{button.disabled=false;}
  };
  const generateCsrButton=document.querySelector('#compliance-generate-csr');
  if(generateCsrButton)generateCsrButton.onclick=async()=>{
   const result=document.querySelector('#compliance-csr-result');
   generateCsrButton.disabled=true;result.textContent='يجري إنشاء CSR…';
   try{
    const outcome=await api('compliance/csr/generate',{method:'POST',body:{}});
    await renderCompliance({api,shell,esc});
    document.querySelector('#compliance-csr-result').textContent='تم إنشاء CSR. بصمة المفتاح: '+outcome.fingerprint;
   }
   catch(error){result.textContent=error.message;generateCsrButton.disabled=false;}
  };
  const downloadCsrButton=document.querySelector('#compliance-download-csr');
  if(downloadCsrButton)downloadCsrButton.onclick=async()=>{
   const result=document.querySelector('#compliance-csr-result');
   try{
    const state=await api('compliance/status');
    if(state.csr_pem){
     const blob=new Blob([state.csr_pem],{type:'application/pkcs10'});
     const url=URL.createObjectURL(blob);
     const a=document.createElement('a');
     a.href=url;a.download='zatca-csr.pem';
     document.body.appendChild(a);a.click();document.body.removeChild(a);
     URL.revokeObjectURL(url);
     result.textContent='تم تنزيل CSR.';
    }else{result.textContent='لا يوجد CSR للتنزيل.';}
   }
   catch(error){result.textContent=error.message;}
  };
  document.querySelector('#compliance-run').onclick=async()=>{
  const button=document.querySelector('#compliance-run'),result=document.querySelector('#compliance-run-result');
  button.disabled=true;result.textContent='يجري تشغيل الدفعة…';
  try{
   const outcome=await api('compliance/queue/run',{method:'POST',body:{limit:20}});
   const issues=[...outcome.clearance,...outcome.reporting].filter(item=>!['accepted','issued'].includes(item.state));
   await renderCompliance({api,shell,esc});
   document.querySelector('#compliance-run-result').textContent='اكتمل التشغيل: '+outcome.clearance.length+' تخليص و'+outcome.reporting.length+' إبلاغ.'+(issues.length?' تحتاج مراجعة: '+issues.map(item=>'#'+item.id+' '+item.state+(item.reason?' — '+item.reason:'')).join('؛'):'');
  }
catch(error){result.textContent=error.message;}finally{if(button.isConnected)button.disabled=false;}
  };

  const requestCsidCompliance=document.querySelector('#compliance-request-csid-compliance');
  if(requestCsidCompliance)requestCsidCompliance.onclick=async()=>{
    const result=document.querySelector('#compliance-csid-result');
    requestCsidCompliance.disabled=true;result.textContent='يجري طلب CSID الامتثال…';
    try{
      const outcome=await api('compliance/csid/compliance',{method:'POST',body:{}});
      await renderCompliance({api,shell,esc});
      document.querySelector('#compliance-csid-result').textContent='تم الحصول على CSID الامتثال: '+outcome.csid.csid;
    }
    catch(error){result.textContent=error.message;requestCsidCompliance.disabled=false;}
  };
  const requestCsidProduction=document.querySelector('#compliance-request-csid-production');
  if(requestCsidProduction)requestCsidProduction.onclick=async()=>{
    const result=document.querySelector('#compliance-csid-result');
    requestCsidProduction.disabled=true;result.textContent='يجري طلب CSID الإنتاج…';
    try{
      const outcome=await api('compliance/csid/production',{method:'POST',body:{}});
      await renderCompliance({api,shell,esc});
      document.querySelector('#compliance-csid-result').textContent='تم الحصول على CSID الإنتاج: '+outcome.csid.csid;
    }
    catch(error){result.textContent=error.message;requestCsidProduction.disabled=false;}
  };
  const renewCsid=document.querySelector('#compliance-renew-csid');
  if(renewCsid)renewCsid.onclick=async()=>{
    const result=document.querySelector('#compliance-csid-result');
    renewCsid.disabled=true;result.textContent='يجري طلب التجديد…';
    try{
      const outcome=await api('compliance/csid/renew',{method:'POST',body:{}});
      await renderCompliance({api,shell,esc});
      document.querySelector('#compliance-csid-result').textContent='تم طلب التجديد: '+outcome.renewal.message;
    }
    catch(error){result.textContent=error.message;renewCsid.disabled=false;}
  };

  let queueView;
 queueView=await pagedView({
  api,path:'compliance/lists/queue',body:document.querySelector('#compliance-queue-list'),initial:queuePage,renderRows:queueRows,
  bindRows:()=>document.querySelectorAll('[data-retry]').forEach(button=>button.onclick=async()=>{
   button.disabled=true;
   try{const result=await api('compliance/queue/'+encodeURIComponent(button.dataset.retry)+'/retry',{method:'POST',body:{}});document.querySelector('#compliance-run-result').textContent=result.message;await queueView.reload();}
   catch(error){document.querySelector('#compliance-run-result').textContent=error.message;button.disabled=false;}
  }),
 });
 await pagedView({api,path:'compliance/attempts',body:document.querySelector('#compliance-attempt-list'),initial:attemptPage,renderRows:attemptRows});
}
