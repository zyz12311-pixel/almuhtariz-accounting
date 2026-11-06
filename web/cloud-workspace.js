// Cloud workspace deliberately exposes only implemented, permission-checked reads.
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export async function renderCloudWorkspace(state, api) {
  const app = document.querySelector('#app');
  app.innerHTML = '<main class="cloud-workspace"><h1>المحترز للمحاسبة وإدارة الأعمال</h1><p role="status">جارٍ تحميل بيانات المنشأة…</p></main>';
  let data, error;
  try { data = await api('cloud/overview' + (state.organization_id ? '?organization_id=' + encodeURIComponent(state.organization_id) : '')); }
  catch (e) { error = e.message; }
  const table = (head, rows) => '<div class="table-scroll"><table><thead><tr>' + head.map(x=>'<th>'+esc(x)+'</th>').join('') + '</tr></thead><tbody>' + (rows.map(row=>'<tr>'+row.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('') || '<tr><td colspan="'+head.length+'">لا توجد بيانات سحابية بعد</td></tr>') + '</tbody></table></div>';
  const currency = value => new Intl.NumberFormat('ar-SA',{style:'currency',currency:'SAR'}).format(Number(value)/100);
  app.innerHTML = '<main class="cloud-workspace"><header class="cloud-heading"><a class="entry-brand" href="#"><img src="/assets/almuhtariz-logo.png" alt="شعار المحترز"><span><b>المحترز للمحاسبة</b><small>وإدارة الأعمال</small></span></a><div><span>'+esc(state.user.username)+'</span> <button id="cloud-logout">خروج</button></div></header><div id="cloud-message" role="status"></div>' +
    '<section class="card"><h1>'+esc(data?.organizations?.[0]?.name_ar || 'مساحة العمل السحابية')+'</h1><p>الدخول عبر Supabase · '+esc(({owner:'مالك المنشأة',accountant:'محاسب',staff:'موظف نقطة بيع'})[data?.role] || 'بانتظار ربط المنشأة')+'</p>' +
    ((state.memberships?.length || 0) > 1 ? '<label>المنشأة<select id="cloud-org">'+state.memberships.map(m=>'<option value="'+esc(m.organization_id)+'" '+(m.organization_id===data?.organization_id?'selected':'')+'>'+esc(m.organization_id)+'</option>').join('')+'</select></label>' : '') +
    '<p class="msg">العرض السحابي متاح للقراءة. إصدار الفواتير وتعديل المخزون والمزامنة ما زالت على نسخة الفرع، ولم تُفعّل هنا بعد.</p></section>' +
    (error ? '<section class="card"><p class="msg">'+esc(error)+'</p><p>حساب لوحة Supabase يختلف عن حساب مستخدم التطبيق. يلزم إنشاء مستخدم في Authentication وربطه بعضوية منشأة؛ لا يمنح تسجيل الدخول وحده صلاحية المحاسب أو المالك.</p></section>' :
      '<section class="card"><h2>الأصناف المتاحة</h2><p>حتى 100 صنف نشط · الأسعار بالريال</p>'+table(['الصنف','الباركود','الوحدة','سعر الوحدة'],data.items.map(i=>[i.name_ar,i.barcode,i.base_unit,currency(i.unit_price)]))+'</section>' +
      (data.role==='staff' ? '' : '<section class="card"><h2>آخر الفواتير</h2><p>آخر 100 مستند · ليست إجماليات الفترة</p>'+table(['الرقم','التاريخ','الحالة','الإجمالي'],data.invoices.map(i=>[i.number||'مسودة',i.issue_date,i.status==='issued'?'صادرة':'مسودة',currency(i.total)]))+'</section><section class="card"><h2>العملاء والموردون</h2><p>حتى 100 سجل</p>'+table(['الاسم','النوع'],data.parties.map(p=>[p.name_ar,({customer:'عميل',supplier:'مورد',both:'عميل ومورد'})[p.kind]||p.kind]))+'</section>')) + '</main>';
  document.querySelector('#cloud-logout').onclick = async () => {
    try { await api('logout',{method:'POST',body:{}}); location.reload(); }
    catch(e) { document.querySelector('#cloud-message').textContent=e.message; }
  };
  const select = document.querySelector('#cloud-org');
  if (select) select.onchange = () => { state.organization_id=select.value; renderCloudWorkspace(state,api); };
}
