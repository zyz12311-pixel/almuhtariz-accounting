const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const activities = {trade:'التجاري',events:'الحفلات',engineering:'الهندسي'};
const roles = {staff:'عامل نقطة بيع',accountant:'محاسب',owner:'مالك'};
const options = (values, selected) => Object.entries(values).map(([value,label]) =>
  `<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`).join('');
const activeField = active => `<label><input type="checkbox" name="active" ${active?'checked':''}> مفعّل</label>`;
const submit = '<button type="submit" class="p">حفظ</button>';
const textField = (label,name,value='',max=150) =>
  `<label>${label}<input name="${name}" value="${esc(value)}" maxlength="${max}" required></label>`;

export async function showCloudAdmin({api, organizationId, after}) {
  const dialog=document.querySelector('#dlg'), url='cloud/manage?organization_id='+encodeURIComponent(organizationId);
  const redraw=async (section='organization',notice='')=>{
    const {organization,branches,points,members}=await api(url);
    const branchNames=Object.fromEntries(branches.map(branch=>[branch.id,branch.name]));
    const branchForm=(branch={})=>`<form class="card" data-action="branch" data-id="${esc(branch.id)}">
      ${textField('اسم الفرع','name',branch.name)}<label>العنوان<input name="address" value="${esc(branch.address)}" maxlength="300"></label>
      ${activeField(branch.active??true)}${submit}</form>`;
    const pointForm=(point={})=>`<form class="card" data-action="point" data-id="${esc(point.id)}">
      ${textField('اسم النقطة','name',point.name)}<label>الفرع<select name="branch_id" ${point.id?'disabled':''} required>
      ${options(point.id?{[point.branch_id]:branchNames[point.branch_id]}:Object.fromEntries(branches.filter(b=>b.active).map(b=>[b.id,b.name])),point.branch_id)}
      </select></label><label>بادئة الفاتورة<input name="prefix" dir="ltr" value="${esc(point.prefix)}" pattern="[A-Z0-9]{1,6}" maxlength="6" ${point.id?'readonly':''} required></label>
      ${activeField(point.active??true)}${submit}</form>`;
    const memberForm=(member={})=>{
      const allowed=new Set(member.pos_ids??[]);
      const assignable=points.filter(point=>allowed.has(point.id)||(point.active&&branches.some(branch=>branch.id===point.branch_id&&branch.active)));
      return `<form class="card" data-action="member" data-id="${esc(member.user_id)}">
        ${member.user_id?`<p><b>البريد:</b> ${esc(member.email??member.user_id)}</p>`:'<label>بريد الحساب المؤكد<input type="email" name="email" maxlength="254" required></label>'}
        <label>الدور/الصفة<select name="role">${options(roles,member.role??'staff')}</select></label>
        ${activeField(member.active??true)}
        <fieldset data-assignments><legend>نقاط البيع المعيّنة</legend>
          ${assignable.map(point=>`<label><input type="checkbox" name="pos_ids" value="${esc(point.id)}" ${allowed.has(point.id)?'checked':''}> ${esc(branchNames[point.branch_id])} / ${esc(point.name)}${point.active&&branches.some(branch=>branch.id===point.branch_id&&branch.active)?'':' (موقوفة)'}</label>`).join('')||'<p>أضف نقطة بيع مفعّلة أولًا.</p>'}
        </fieldset>
        ${member.user_id?'<label><input type="checkbox" name="end_sessions"> إنهاء الجلسات الحالية لهذه المنشأة</label>':''}
        ${submit}</form>`;
    };
    const edit=(label,html,id=null)=>`<details ${id?`data-member-details="${esc(id)}"`:''}><summary>${esc(label)}</summary>${html}</details>`;
    const panels={
      organization:`<form class="card" data-action="organization">${textField('اسم المنشأة','name',organization.name_ar)}
        <label>النشاط<select name="activity">${options(activities,organization.activity)}</select></label>${submit}</form>`,
      branches:edit('إضافة فرع',branchForm())+branches.map(branch=>edit(branch.name+(branch.active?'':' (موقوف)'),branchForm(branch))).join(''),
      points:edit('إضافة نقطة بيع',pointForm())+points.map(point=>edit(branchNames[point.branch_id]+' / '+point.name+(point.active?'':' (موقوفة)'),pointForm(point))).join(''),
      members:'<p>أضف عضوًا ببريد حساب سحابي مؤكد. يظهر البريد والصفة لكل عضو، ويمكن تغيير الصفة من نموذج العضو. عند تغيير الدور أو إيقاف العضوية تُغلق جلسات العضو لهذه المنشأة، ويحتاج إلى تسجيل الدخول مجددًا عند التفعيل.</p>'+
        `<div class="card"><table><thead><tr><th>البريد الإلكتروني</th><th>الصفة</th><th>الحالة</th><th>تعديل</th></tr></thead><tbody>${
          members.map(member=>`<tr><td dir="ltr">${esc(member.email??member.user_id)}</td><td>${esc(roles[member.role]??member.role)}</td><td>${member.active?'مفعّل':'موقوف'}${member.self?' (أنت)':''}</td><td>${member.self?'—':'<button type="button" class="text-link" data-edit-member="'+esc(member.user_id)+'">تعديل/ترقية</button>'}</td></tr>`).join('')||'<tr><td colspan="4">لا يوجد أعضاء.</td></tr>'
        }</tbody></table></div>`+
        edit('إضافة عضو',memberForm())+members.map(member=>edit((member.email??member.user_id)+' · '+roles[member.role]+(member.active?'':' (موقوف)'),
          member.self?`<p><b>البريد:</b> ${esc(member.email??member.user_id)}</p><p><b>الصفة:</b> ${esc(roles[member.role]??member.role)}</p><p>يمكن لمالك آخر تعديل عضويتك.</p>`:memberForm(member), member.user_id)).join(''),
    };
    dialog.innerHTML=`<h2>إدارة المنشأة السحابية</h2><div class="row">
      ${Object.entries({organization:'المنشأة',branches:'الفروع',points:'نقاط البيع',members:'الفريق'}).map(([key,label])=>
        `<button type="button" data-section="${key}" aria-pressed="${key===section}">${label}</button>`).join('')}
      <button type="button" data-close>إغلاق</button></div>
      <p role="status" data-admin-status>${esc(notice)}</p>${panels[section]}`;
    if(!dialog.open)dialog.showModal();
    const report=error=>{dialog.querySelector('[data-admin-status]').textContent=error.message;};
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    dialog.querySelectorAll('[data-edit-member]').forEach(button=>{
      button.onclick=()=>{
        const details=dialog.querySelector(`[data-member-details="${CSS.escape(button.dataset.editMember)}"]`);
        if(details){ details.open=true; details.scrollIntoView({block:'nearest'}); }
      };
    });
    dialog.querySelectorAll('[data-section]').forEach(button=>{
      button.onclick=()=>redraw(button.dataset.section).catch(report);
    });
    dialog.querySelectorAll('form[data-action]').forEach(form=>{
      const {action,id}=form.dataset, fields=form.elements;
      if(action==='member'){
        const toggle=()=>{form.querySelector('[data-assignments]').hidden=fields.role.value!=='staff';};
        fields.role.onchange=toggle;
        toggle();
      }
      form.onsubmit=async event=>{
        event.preventDefault();
        const button=form.querySelector('[type=submit]');
        button.disabled=true;
        const values=new FormData(form);
        const input={...Object.fromEntries(values),action,id:id||null,organization_id:organizationId};
        if(fields.active)input.active=fields.active.checked;
        if(action==='point')input.branch_id=fields.branch_id.value;
        if(action==='member'){
          input.pos_ids=input.role==='staff'?values.getAll('pos_ids'):[];
          input.end_sessions=Boolean(fields.end_sessions?.checked);
        }
        try {
          await api('cloud/manage',{method:'POST',body:input});
          await redraw(section,'تم الحفظ.');
          if(action==='organization')await after();
        } catch(error) {report(error);}
        finally {button.disabled=false;}
      };
    });
  };
  await redraw();
}
