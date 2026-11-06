export function validateIdentity(p,{buyer=false,required=true}={}){
 const errors=[],label=buyer?'العميل':'المنشأة';if(!p){if(required)errors.push('بيانات '+label+' مطلوبة');return errors;}
 if(required&&!String(p.name_ar||'').trim())errors.push('اسم '+label+' مطلوب');
 if(!buyer&&!/^3\d{13}3$/.test(p.vat_number||''))errors.push('الرقم الضريبي للمنشأة غير مكتمل');
 if(buyer&&p.vat_number&&!/^3\d{13}3$/.test(p.vat_number))errors.push('الرقم الضريبي للعميل غير صالح');
 if(required){for(const [field,name]of [['street','الشارع'],['district','الحي'],['city','المدينة']])if(!String(p[field]||'').trim())errors.push(name+' في عنوان '+label+' مطلوب');if(!/^\d{4}$/.test(p.building_number||''))errors.push('رقم المبنى في عنوان '+label+' يجب أن يكون 4 أرقام');if(!/^\d{5}$/.test(p.postal_code||''))errors.push('الرمز البريدي في عنوان '+label+' يجب أن يكون 5 أرقام');if(p.country_code!=='SA')errors.push('هذه النسخة تدعم المعاملات المحلية داخل السعودية فقط');}
 if(!buyer){const scheme=p.seller_id_scheme||'CRN',id=p.seller_id||(scheme==='CRN'?p.cr_number:'');if(!['CRN','MOM','MLS','700','SAG','OTH'].includes(scheme)||!/^[A-Za-z0-9]{1,35}$/.test(id||''))errors.push('معرف المنشأة النظامي ونوعه مطلوبان');}
 if(buyer&&required&&!p.vat_number&&(!['CRN','MOM','MLS','700','SAG','NAT','GCC','IQA','PAS','OTH'].includes(p.id_scheme)||!/^[A-Za-z0-9]{1,35}$/.test(p.id_number||'')))errors.push('العميل غير المسجل ضريبيًا يحتاج معرفًا آخر ونوعه');
 return errors;
}
export function assertIssueData({company,party,invoice,now,lastTime,lines=[]}){
 const errors=validateIdentity(company);if(party?.vat_number&&party.vat_number===company.vat_number)errors.push('الرقم الضريبي للعميل يجب أن يختلف عن الرقم الضريبي للمنشأة');if(!['standard','simplified'].includes(invoice.invoice_kind))errors.push('نوع الفاتورة غير صالح');if(invoice.invoice_kind==='standard')errors.push(...validateIdentity(party,{buyer:true}));
 if(party?.vat_number&&!/^3\d{13}3$/.test(party.vat_number))errors.push('الرقم الضريبي للعميل غير صالح');
 if(invoice.invoice_kind==='standard'&&!/^\d{4}-\d{2}-\d{2}$/.test(invoice.supply_date||''))errors.push('تاريخ التوريد مطلوب للفاتورة الضريبية');
 if(invoice.supply_date&&(!Number.isFinite(Date.parse(invoice.supply_date+'T00:00:00Z'))||new Date(invoice.supply_date+'T00:00:00Z').toISOString().slice(0,10)!==invoice.supply_date))errors.push('تاريخ التوريد غير صالح');
 if(lines.some(l=>['VATEX-SA-EDU','VATEX-SA-HEA'].includes(l.exemption_code))&&(!party?.name_ar||party.id_scheme!=='NAT'||!/^\d{10}$/.test(party.id_number||'')))errors.push('هذه المعاملة تتطلب اسم المستفيد ومعرفه الوطني');
 if(lastTime&&now+2000<Date.parse(lastTime))errors.push('ساعة الجهاز متراجعة عن آخر إصدار؛ صحح الوقت قبل المتابعة');if(errors.length)throw Error(errors.join('، '));
}
export function assertSupported(body){for(const key of ['discount','allowances','charges','prepayment','export','self_billed','third_party','summary'])if(body[key])throw Error('هذه المعاملة تحتاج مسارًا ضريبيًا لم يكتمل بعد: '+key);}
