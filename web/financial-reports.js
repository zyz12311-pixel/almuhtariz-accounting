import {attachCostCorrections} from './cost-correction.js';
export async function renderFinancial({api,shell,esc,money,S}){
 const $=s=>document.querySelector(s),today=S.state.today;
 shell(`<h1>التقارير المالية والمخزنية</h1><div id="financial-error" class="msg" hidden></div>
 <section class="card"><div class="row"><label>من<input id="financial-from" type="date" value="${today.slice(0,8)}01"></label><label>إلى<input id="financial-to" type="date" value="${today}"></label><button id="load-financial" class="p">عرض الفترة</button></div><div id="financial-results"></div></section>
 <section class="card"><h2>أعمار الذمم</h2><p>التقرير تاريخي حسب تاريخ المرجع (as_of). المستندات بدون تاريخ استحقاق تظهر ضمن «غير مستحق/بدون استحقاق» ولا تُصنَّف متأخرة تلقائيًا.</p><div class="row"><label>تاريخ المرجع<input id="aging-asof" type="date" value="${today}"></label><label>النوع<select id="aging-kind"><option value="customer">ذمم العملاء</option><option value="supplier">ذمم الموردين</option></select></label><button id="load-aging" class="p">عرض الأعمار</button></div><div id="aging-results"></div></section>
 <section class="card"><h2>تقييم المخزون الحالي · المتوسط المرجح</h2><p>التكلفة تخص الوحدة الأساسية. الأرصدة غير مكتملة التكلفة لا تصلح أساسًا لربحية نهائية.</p><div id="valuation-results"></div></section>`);
 const table=(head,rows)=>'<div class="table-scroll"><table><thead><tr>'+head.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 const showError=e=>{const el=$('#financial-error');el.textContent=e.message;el.hidden=false;};
 const loadFinancial=async()=>{try{const r=await api('reports/financial?from='+$('#financial-from').value+'&to='+$('#financial-to').value);$('#financial-results').innerHTML=(!r.costing_complete?'<p class="msg">توجد حركات دون تكلفة مؤكدة؛ الربح المعروض حسابي ويحتاج استكمال تقييمها.</p>':'')+'<div class="grid metrics"><div class="card">الإيرادات<b>'+money(r.revenue)+'</b></div><div class="card">المصروفات<b>'+money(r.expenses)+'</b></div><div class="card">نتيجة الفترة<b>'+money(r.profit)+'</b></div></div>'+table(['الحساب','الاسم','افتتاحي مدين','حركة مدين','حركة دائن','ختامي مدين'],r.rows.map(l=>[l.code,l.name_ar,money(l.opening),money(l.debit),money(l.credit),money(l.closing)]));}catch(e){showError(e);}};
 $('#load-financial').onclick=loadFinancial;
 const agingTable=r=>{
  const head=['الطرف','غير مستحق/بدون استحقاق','0-30','31-60','61-90','91-120','121-150','أكثر من 150','الإجمالي'];
  const rows=r.parties.map(p=>[p.party_name,money(p.not_due),money(p.d0_30),money(p.d31_60),money(p.d61_90),money(p.d91_120),money(p.d121_150),money(p.d150_plus),money(p.total)]);
  if(r.parties.length) rows.push(['الإجمالي',money(r.totals.not_due),money(r.totals.d0_30),money(r.totals.d31_60),money(r.totals.d61_90),money(r.totals.d91_120),money(r.totals.d121_150),money(r.totals.d150_plus),money(r.totals.total)]);
  return table(head,rows)||'<p>لا توجد أرصدة مفتوحة في تاريخ المرجع.</p>';
 };
 const loadAging=async()=>{try{const asOf=$('#aging-asof').value;const kind=$('#aging-kind').value;const r=await api(`reports/aging?as_of=${encodeURIComponent(asOf)}&kind=${encodeURIComponent(kind)}`);$('#aging-results').innerHTML='<p class="hint">تاريخ المرجع: '+esc(r.as_of)+' · '+(r.kind==='supplier'?'ذمم الموردين':'ذمم العملاء')+'</p>'+agingTable(r);}catch(e){showError(e);}};
 $('#load-aging').onclick=loadAging;
 const loadValuation=async()=>{try{const rows=await api('inventory/valuation');$('#valuation-results').innerHTML=table(['الصنف','المستودع','الكمية','قيمة الرصيد','متوسط الوحدة','اكتمال التكلفة'],rows.map(l=>[l.name_ar,l.warehouse,l.qty,money(l.value),money(l.average_cost),l.complete?'مكتملة':'تحتاج تقييمًا']));if(S.state.user.role==='owner')attachCostCorrections({api,rows,host:$('#valuation-results'),esc,money,onSaved:async()=>{await loadValuation();await loadFinancial();}});}catch(e){showError(e);}};
 await Promise.all([loadFinancial(),loadAging(),loadValuation()]);
}
