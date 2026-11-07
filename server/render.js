import { validatePrintSettings } from './printing.js';
import { esc, fromCents } from './lib.js';
const money = c => fromCents(c);

// يولّد صفحة الفاتورة القابلة للطباعة بحسب إعدادات الفاتورة. حقول الامتثال (الرقم الضريبي، التاريخ، الإجماليات، QR) ثابتة ولا تُخفى.
export function renderInvoice({ inv, company, s, preview = false }) {
  s = validatePrintSettings(s);
  const cn = inv.type === '381',debit=inv.document_code==='383',title=debit?'إشعار مدين':cn?s.creditTitle:inv.invoice_kind==='simplified'?'فاتورة ضريبية مبسطة':inv.invoice_kind==='standard'?'فاتورة ضريبية':s.title, w = { A4: '210mm', A5: '148mm', '80mm': '80mm' }[s.paper] || '210mm';
  const just = { right: 'flex-start', left: 'flex-end', center: 'center' };
  const companyLogo = company.logo ?? s.logo;
  const logo = companyLogo ? `<img class="logo" src="${esc(companyLogo)}" alt="شعار المنشأة">` : '';
  const head = `<div class="co"><b>${esc(company.name_ar)}</b>${company.name_en ? `<div>${esc(company.name_en)}</div>` : ''}
    <div>الرقم الضريبي: ${esc(company.vat_number)}</div>${company.cr_number?`<div>السجل التجاري: ${esc(company.cr_number)}</div>`:company.seller_id?`<div>معرف المنشأة (${esc(company.seller_id_scheme)}): ${esc(company.seller_id)}</div>`:''}
    ${company.street?`<div>${esc([company.street,company.building_number,company.district,company.city,company.postal_code,company.country_code].filter(Boolean).join('، '))}</div>`:company.address?`<div>${esc(company.address)}</div>`:''}
    ${company.phone || company.email ? `<div>${esc(company.phone || '')} ${esc(company.email || '')}</div>` : ''}
    ${s.headerText ? `<div class="ht">${esc(s.headerText).replace(/\n/g, '<br>')}</div>` : ''}</div>`;
  const hd = s.logoPosition === 'center'
    ? `<div class="hd col">${logo}${head}</div>`
    : `<div class="hd" style="justify-content:space-between;flex-direction:${s.logoPosition === 'right' ? 'row' : 'row-reverse'}">${logo}${head}</div>`;
  const cols = [['#', 'showItemNo'], ['الوصف', 1], ['الكمية', 1], ['سعر الوحدة', 'showUnitPrice'], ['الضريبة %', 'showVatCol'], ['الإجمالي', 1]].filter(c => c[1] === 1 || s[c[1]]);
  const rows = inv.lines.map(l => `<tr>${s.showItemNo ? `<td>${l.line_no}</td>` : ''}<td class="d">${esc(l.description)}</td><td>${l.qty}</td>
    ${s.showUnitPrice ? `<td>${money(l.unit_price)}${l.discount_rate?`<small style="display:block">قبل الخصم ${money(l.list_price)} · خصم ${l.discount_rate/100}%</small>`:''}</td>` : ''}${s.showVatCol ? `<td>${l.vat_rate}</td>` : ''}<td>${money(l.total)}</td></tr>`).join('');
  const qrBlock = `<div class="qr"><div id="qr" data-v="${esc(inv.qr || '')}" style="width:${s.qrSize}px;height:${s.qrSize}px"></div></div>`;
  const qrJust = { 'bottom-right': 'flex-start', 'bottom-left': 'flex-end', 'bottom-center': 'center' }[s.qrPosition] || 'flex-end';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(inv.number || 'مسودة')} | المحترز للمحاسبة</title>
<style>
@page{size:${s.paper === '80mm' ? 'auto' : s.paper};margin:${s.marginTop}mm ${s.marginRight}mm ${s.marginBottom}mm ${s.marginLeft}mm}
*{box-sizing:border-box}body{margin:0;font:${s.fontSize}pt/${s.lineSpacing} Tahoma,"Segoe UI",Arial,sans-serif;color:#111;background:#fff}
.page{width:calc(${w} - ${s.marginLeft + s.marginRight}mm);max-width:100%;margin:12px auto;padding:0;position:relative}
.hd{display:flex;gap:16px;align-items:center;border-bottom:3px solid ${esc(s.accent)};padding-bottom:10px;margin-bottom:10px}
.hd.col{flex-direction:column;text-align:center}.logo{max-height:${s.logoSize}px;max-width:40%;object-fit:contain}
.co{text-align:${s.headerAlign}}.ht{margin-top:4px;color:#444;font-size:.92em}
h1{margin:6px 0;color:${esc(s.accent)};font-size:1.5em;text-align:center}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-bottom:10px}
table{width:100%;border-collapse:collapse}th{background:${esc(s.accent)};color:#fff;padding:${s.cellPadding}px;font-weight:600}
td{padding:${s.cellPadding}px;border-bottom:1px solid #ddd;text-align:center}td.d{text-align:right}
.tot{margin:10px 0 0 auto;width:min(320px,100%)}.tot div{display:flex;justify-content:space-between;padding:3px 0}
.tot .g{font-weight:700;font-size:1.15em;border-top:2px solid ${esc(s.accent)};margin-top:4px;padding-top:6px}
.ft{display:flex;justify-content:${qrJust};margin-top:14px}.note{margin-top:10px;color:#444;white-space:pre-wrap}
.sig{display:flex;justify-content:space-between;margin-top:34px}.sig div{border-top:1px solid #999;width:40%;text-align:center;padding-top:4px}
.wm{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:90px;color:rgba(0,0,0,.06);transform:rotate(-25deg);pointer-events:none}
.test-document{border:2px solid #8b2525;padding:9px;text-align:center;font-weight:bold;color:#8b2525;margin-bottom:12px}.pv{background:#fef3c7;text-align:center;padding:4px;font-size:.85em}
@media print{.noprint{display:none}.page{margin:0;max-width:100%}thead{display:table-header-group}th{color:#111;background:#eee;print-color-adjust:exact;-webkit-print-color-adjust:exact}tr,.tot,.ft{break-inside:avoid}}
</style></head><body><div class="page">
${preview ? '<div class="pv noprint">معاينة بيانات تجريبية</div>' : ''}${s.watermark ? `<div class="wm">${esc(s.watermark)}</div>` : ''}
${inv.environment==='development'?'<div class="test-document">تجريبية — غير صالحة للاستخدام الضريبي</div>':''}${hd}<h1>${esc(title)}</h1>
<div class="meta"><div>رقم: <b>${esc(inv.number || 'مسودة')}</b></div><div>التاريخ: <bdi dir="ltr">${esc(inv.issue_date || '')} ${esc(inv.issue_time || '')}</bdi></div>
${inv.party_name ? `<div>العميل: ${esc(inv.party_name)}</div>` : ''}${inv.party_vat ? `<div>الرقم الضريبي للعميل: ${esc(inv.party_vat)}</div>` : ''}
${inv.supply_date?`<div>تاريخ التوريد: ${esc(inv.supply_date)}</div>`:''}${inv.party_snapshot?.street?`<div>عنوان العميل: ${esc([inv.party_snapshot.street,inv.party_snapshot.building_number,inv.party_snapshot.district,inv.party_snapshot.city,inv.party_snapshot.postal_code,inv.party_snapshot.country_code].filter(Boolean).join('، '))}</div>`:''}${inv.party_snapshot?.id_number?`<div>معرف العميل: ${esc(inv.party_snapshot.id_number)}</div>`:''}
${s.showPayment ? `<div>الدفع: ${{ cash: 'نقدًا', bank: 'بنك', credit: 'آجل' }[inv.payment] || ''}</div>` : ''}
${cn||debit ? `<div>مرجع الفاتورة: ${esc(inv.ref_number)}</div><div>السبب: ${esc(inv.reason)}</div>` : ''}</div>
<table><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
<div class="tot"><div><span>المجموع قبل الضريبة</span><span>${money(inv.subtotal)} ${esc(s.currency)}</span></div>
<div><span>ضريبة القيمة المضافة</span><span>${money(inv.vat)} ${esc(s.currency)}</span></div>
<div class="g"><span>الإجمالي</span><span>${money(inv.total)} ${esc(s.currency)}</span></div></div>
${s.terms ? `<div class="note"><b>الشروط:</b>\n${esc(s.terms)}</div>` : ''}
<div class="ft">${qrBlock}</div>${s.footerText ? `<div class="note" style="text-align:center">${esc(s.footerText)}</div>` : ''}
${s.showSignature ? '<div class="sig"><div>توقيع المستلم</div><div>ختم المنشأة</div></div>' : ''}
</div>${preview ? '' : '<button class="noprint" onclick="print()" style="position:fixed;bottom:12px;left:12px;padding:8px 16px">طباعة</button>'}
<script src="/vendor/qr.js"></script><script>(function(){var e=document.getElementById('qr'),v=e&&e.dataset.v;if(!e||!v)return;try{e.innerHTML=qrSvg(v,e.clientWidth||110);}catch(x){e.textContent='تعذر توليد QR';}})();</script></body></html>`;
}

export const sampleInvoice = (activity = 'trade') => ({
  type: '388', number: 'A-000001', issue_date: '2026-10-25', issue_time: '10:30:00', payment: 'cash', party_name: 'عميل تجريبي', party_vat: '300000000000003',
  subtotal: 30000, vat: 4500, total: 34500, qr: 'ARBzaG9wIHNhbXBsZQ==',
  lines: [{ line_no: 1, description: activity === 'events' ? 'تنسيق وتجهيز حفل' : activity === 'engineering' ? 'أعمال تصميم وإشراف' : 'خدمة توريد وتجهيز', qty: 1, unit_price: 20000, vat_rate: 15, total: 23000 },
          { line_no: 2, description: activity === 'events' ? 'إيجار كراسي' : activity === 'engineering' ? 'وحدات تنفيذ أعمال' : 'صنف تجاري', qty: 50, unit_price: 200, vat_rate: 15, total: 11500 }]
});
