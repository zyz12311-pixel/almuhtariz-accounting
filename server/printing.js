import { DEFAULTS } from './defaults.js';
export const profileKey = profile => {
 if (profile == null || profile === '' || profile === 'accountant') return 'invoice';
 if (profile === 'pos') return 'invoice_pos';
 throw new Error('قالب الطباعة غير معروف');
};
export function validatePrintSettings(input, base = DEFAULTS.invoice) {
 const s = { ...base };
 for (const key of Object.keys(DEFAULTS.invoice)) if (Object.hasOwn(input, key)) s[key] = input[key];
 const enums = {paper:['A4','A5','80mm'],logoPosition:['right','center','left'],headerAlign:['right','center','left'],qrPosition:['bottom-right','bottom-center','bottom-left']};
 for (const [key,values] of Object.entries(enums)) if (!values.includes(s[key])) throw new Error('اختيار غير صالح في إعدادات الطباعة: '+key);
 const ranges={fontSize:[8,24],logoSize:[30,180],qrSize:[80,180],marginTop:[0,25],marginBottom:[0,25],marginLeft:[0,25],marginRight:[0,25],lineSpacing:[1,2.4],cellPadding:[2,12]};
 for(const [key,[min,max]] of Object.entries(ranges)) { const n=Number(s[key]);if(!Number.isFinite(n)||n<min||n>max) throw new Error('مقياس الطباعة خارج النطاق: '+key+' ('+min+'–'+max+')');s[key]=n; }
 if(s.paper==='80mm' && s.marginLeft+s.marginRight>30) throw new Error('اجعل مجموع الهامشين الجانبيين للإيصال 30 مم أو أقل');
 if(!/^#[0-9a-f]{6}$/i.test(s.accent)) throw new Error('لون الطباعة غير صالح');
 for(const key of ['title','creditTitle','headerText','footerText','terms','watermark']) if(typeof s[key]!=='string'||s[key].length>4000) throw new Error('نص الطباعة غير صالح');
 if(!s.title.trim()||!s.creditTitle.trim()) throw new Error('عنوان المستند مطلوب');
 for(const key of ['showItemNo','showUnitPrice','showVatCol','showPayment','showSignature']) if(typeof s[key]!=='boolean') throw new Error('قيمة خيار الطباعة غير صالحة');
 s.showCustomerVat=true;s.currency='ر.س';
 return s;
}
export function validateCompany(data) {
 const clean={...data};
 for(const key of ['name_ar','name_en','vat_number','cr_number','address','phone','email','logo','activity','street','building_number','district','city','postal_code','country_code','seller_id_scheme','seller_id']) if(Object.hasOwn(clean,key)&&typeof clean[key]!=='string') throw new Error('بيانات المنشأة يجب أن تكون نصية');
 if(clean.country_code&&clean.country_code!=='SA')throw new Error('هذه النسخة تدعم المنشآت المحلية في السعودية فقط');
 if(clean.building_number&&!/^\d{4}$/.test(clean.building_number))throw new Error('رقم المبنى يجب أن يكون 4 أرقام');
 if(clean.postal_code&&!/^\d{5}$/.test(clean.postal_code))throw new Error('الرمز البريدي يجب أن يكون 5 أرقام');
 if(clean.vat_number && !/^3\d{13}3$/.test(clean.vat_number)) throw new Error('الرقم الضريبي يجب أن يكون 15 رقمًا يبدأ وينتهي بـ 3');
 if(clean.cr_number && !/^[0-9]{5,20}$/.test(clean.cr_number)) throw new Error('أدخل رقم السجل التجاري بالأرقام (5–20 رقمًا)');
 if(clean.activity && !['trade','events','engineering'].includes(clean.activity)) throw new Error('اختر نشاطًا من الأنشطة المتاحة');
 if(clean.logo && (!/^data:image\/(png|jpeg|svg\+xml|webp);base64,/.test(clean.logo)||clean.logo.length>1400000)) throw new Error('ارفع شعار PNG أو JPG أو SVG أو WebP بحجم لا يتجاوز 1 ميجابايت');
 return clean;
}
