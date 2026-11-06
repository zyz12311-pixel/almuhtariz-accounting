// الإعدادات الافتراضية. كل شيء هنا قابل للتعديل من شاشة الإعدادات.
export const DEFAULTS = {
  company: { name_ar: '', name_en: '', vat_number: '', cr_number: '', address: '', phone: '', email: '', logo: '', activity: '', street: '', building_number: '', district: '', city: '', postal_code: '', country_code: 'SA', seller_id_scheme: 'CRN', seller_id: '' },
  compliance: { mode:'development' },
  pos_control: {require_shift:false},
  ui: { theme: 'auto', accent: '#0f766e', fontScale: 1, density: 'comfortable', sidebar: 'right', radius: 10,
        font: 'system', calendar: 'gregorian', digits: 'latn' },
  invoice: { logo: '', logoPosition: 'right', logoSize: 90, headerText: '', headerAlign: 'right', title: 'فاتورة ضريبية',
             creditTitle: 'إشعار دائن', paper: 'A4', accent: '#0f766e', fontSize: 13, showItemNo: true, showUnitPrice: true,
             showVatCol: true, showCustomerVat: true, showPayment: true, qrPosition: 'bottom-left', qrSize: 110,
             footerText: '', terms: '', showSignature: false, watermark: '', currency: 'ر.س', marginTop: 8, marginBottom: 8, marginLeft: 8, marginRight: 8, lineSpacing: 1.6, cellPadding: 6 }
};
DEFAULTS.invoice_pos = { ...DEFAULTS.invoice, paper: '80mm', fontSize: 11, logoPosition: 'center', logoSize: 60, qrSize: 100, showItemNo: false, showUnitPrice: false, showVatCol: false, marginTop: 3, marginBottom: 3, marginLeft: 3, marginRight: 3, cellPadding: 3, lineSpacing: 1.4 };
export const CHART = [
  ['1000', 'الأصول', 'asset', 0], ['1101', 'الصندوق', 'asset', 1], ['1102', 'البنك', 'asset', 1], ['1201', 'العملاء', 'asset', 1],
  ['1301', 'ضريبة المدخلات', 'asset', 1],
  ['2000', 'الخصوم', 'liability', 0], ['2101', 'الموردون', 'liability', 1], ['2201', 'ضريبة المخرجات', 'liability', 1],
  ['3000', 'حقوق الملكية', 'equity', 0], ['3101', 'رأس المال', 'equity', 1], ['3201', 'الأرباح المبقاة', 'equity', 1],
  ['4000', 'الإيرادات', 'revenue', 0], ['4101', 'إيرادات المبيعات', 'revenue', 1],
  ['5000', 'المصروفات', 'expense', 0], ['5101', 'تكلفة المبيعات', 'expense', 1], ['5201', 'الرواتب', 'expense', 1],
  ['5202', 'الإيجار', 'expense', 1], ['5299', 'مصروفات أخرى', 'expense', 1]
];
