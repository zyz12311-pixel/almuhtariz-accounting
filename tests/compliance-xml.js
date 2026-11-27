import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDb} from '../server/db.js';
import {seedCompany,setSetting,createInvoice,createCreditNote,createDebitNote,getInvoice} from '../server/core.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'almuhtariz-compliance-xml-')),db=openDb(path.join(dir,'test.db'));
const company={name_ar:'منشأة اختبار XML',vat_number:'300000000000003',cr_number:'1010010000',street:'شارع الاختبار',building_number:'1234',district:'حي الاختبار',city:'الرياض',postal_code:'12345',country_code:'SA'};
const output=process.env.ALMUHTARIZ_XML_CASES_DIR?path.resolve(process.env.ALMUHTARIZ_XML_CASES_DIR):null;
const amount=(name,cents)=>`<cbc:${name} currencyID="SAR">${(cents/100).toFixed(2)}</cbc:${name}>`;
const exportXml=(name,xml)=>{if(output){fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,name),xml);}};
const invoiceXml=id=>db.prepare("SELECT content FROM invoice_documents WHERE invoice_id=? AND kind='xml_candidate'").get(id).content;

try{
 seedCompany(db,company.name_ar);setSetting(db,'company',company);
 const party=db.prepare("INSERT INTO parties(name_ar,vat_number,entity_type,street,building_number,district,city,postal_code,country_code) VALUES(?,?,'business',?,?,?,?,?,?)")
  .run('عميل اختبار XML','399999999800003',company.street,company.building_number,company.district,company.city,company.postal_code,'SA').lastInsertRowid;

 const cashId=createInvoice(db,1,{party_id:party,invoice_kind:'standard',payment:'cash',supply_date:'2026-11-26',lines:[{description:'بيع نقدي',qty:2,unit_price:'10.00'}]});
 const cash=getInvoice(db,cashId),cashXml=invoiceXml(cashId);
 assert.equal(cash.subtotal,2000);assert.equal(cash.vat,300);assert.equal(cash.total,2300);
 assert.ok(cashXml.includes('<cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>'));
 assert.ok(cashXml.includes(amount('LineExtensionAmount',cash.subtotal)));
 assert.ok(cashXml.includes(amount('TaxExclusiveAmount',cash.subtotal)));
 assert.ok(cashXml.includes(amount('TaxInclusiveAmount',cash.total)));
 assert.ok(cashXml.includes(amount('PrepaidAmount',0)));
 exportXml('cash-sale.xml',cashXml);

 const creditId=createInvoice(db,1,{party_id:party,invoice_kind:'standard',payment:'credit',payment_terms_days:30,supply_date:'2026-11-26',lines:[{description:'بيع آجل',qty:1,unit_price:'20.00'}]});
 const credit=getInvoice(db,creditId),creditXml=invoiceXml(creditId);
 assert.equal(credit.payment,'credit');assert.equal(credit.subtotal,2000);assert.equal(credit.vat,300);assert.equal(credit.total,2300);
 assert.ok(creditXml.includes('<cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>'));
 assert.ok(creditXml.includes('<cbc:CompanyID>399999999800003</cbc:CompanyID>'));
 assert.ok(creditXml.includes('<cbc:RegistrationName>عميل اختبار XML</cbc:RegistrationName>'));
 assert.ok(creditXml.includes(amount('PayableAmount',credit.total)));
 exportXml('credit-sale.xml',creditXml);

 const discountedId=createInvoice(db,1,{party_id:party,invoice_kind:'standard',payment:'credit',supply_date:'2026-11-26',
  lines:[{description:'بند مخفض',qty:'1.5',unit_price:'100.00',discount_rate:10,unit_code:'KGM'}]});
 const discounted=getInvoice(db,discountedId),discountXml=invoiceXml(discountedId);
 assert.equal(discounted.subtotal,13500);assert.equal(discounted.vat,2025);assert.equal(discounted.total,15525);
 assert.ok(discountXml.includes('<cbc:InvoicedQuantity unitCode="KGM">1.5</cbc:InvoicedQuantity>'));
 assert.ok(discountXml.includes(amount('PriceAmount',10000)));
 assert.ok(discountXml.includes('<cbc:AllowanceChargeReasonCode>95</cbc:AllowanceChargeReasonCode>'));
 assert.ok(discountXml.includes(amount('Amount',1500)));
 assert.ok(discountXml.includes(amount('LineExtensionAmount',13500)));
 assert.ok(discountXml.includes(amount('TaxExclusiveAmount',discounted.subtotal)));
 assert.ok(discountXml.includes(amount('TaxInclusiveAmount',discounted.total)));
 exportXml('discounted-credit-sale.xml',discountXml);

 const partialId=createCreditNote(db,1,discountedId,{reason:'مرتجع جزئي',lines:[{line_no:1,qty:'0.5'}]});
 const partial=getInvoice(db,partialId),partialXml=invoiceXml(partialId);
 assert.equal(partial.ref_number,discounted.number);assert.equal(partial.subtotal,4500);assert.equal(partial.vat,675);assert.equal(partial.total,5175);
 assert.ok(partialXml.includes('<cbc:ID>'+discounted.number+'</cbc:ID>'));
 assert.ok(partialXml.includes(amount('PriceAmount',10000)));
 assert.ok(partialXml.includes(amount('Amount',500)));
 assert.ok(partialXml.includes(amount('LineExtensionAmount',4500)));
 exportXml('partial-credit-note.xml',partialXml);

 const debitId=createDebitNote(db,1,discountedId,{reason:'زيادة مرتبطة بالأصل',lines:[{description:'زيادة خدمة',qty:1,unit_price:'10.00'}]});
 const debit=getInvoice(db,debitId),debitXml=invoiceXml(debitId);
 assert.equal(debit.ref_number,discounted.number);assert.equal(debit.document_code,'383');assert.equal(debit.subtotal,1000);assert.equal(debit.vat,150);assert.equal(debit.total,1150);
 assert.ok(debitXml.includes('<cbc:InvoiceTypeCode name="0100000">383</cbc:InvoiceTypeCode>'));
 assert.ok(debitXml.includes('<cbc:ID>'+discounted.number+'</cbc:ID>'));
 assert.ok(debitXml.includes(amount('PayableAmount',debit.total)));
 exportXml('debit-note.xml',debitXml);

 const categoriesId=createInvoice(db,1,{party_id:party,invoice_kind:'standard',supply_date:'2026-11-26',lines:[
  {description:'أساسي',qty:1,unit_price:'100.00',tax_category:'S',vat_rate:15},
  {description:'صفري',qty:1,unit_price:'100.00',tax_category:'Z',vat_rate:0,exemption_code:'VATEX-SA-34-1',exemption_reason:'اختبار فئة صفرية'},
  {description:'معفى',qty:1,unit_price:'100.00',tax_category:'E',vat_rate:0,exemption_code:'VATEX-SA-29',exemption_reason:'اختبار إعفاء'},
  {description:'خارج النطاق',qty:1,unit_price:'100.00',tax_category:'O',vat_rate:0,exemption_code:'VATEX-SA-OOS',exemption_reason:'اختبار خارج النطاق'},
 ]});
 const categories=getInvoice(db,categoriesId),categoriesXml=invoiceXml(categoriesId);
 assert.equal(categories.subtotal,40000);assert.equal(categories.vat,1500);assert.equal(categories.total,41500);
 assert.equal((categoriesXml.match(/<cac:TaxSubtotal>/g)||[]).length,4);
 for(const code of ['VATEX-SA-34-1','VATEX-SA-29','VATEX-SA-OOS'])assert.ok(categoriesXml.includes('<cbc:TaxExemptionReasonCode>'+code+'</cbc:TaxExemptionReasonCode>'));
 assert.ok(categoriesXml.includes(amount('TaxExclusiveAmount',40000)));
 assert.ok(categoriesXml.includes(amount('TaxInclusiveAmount',41500)));
 const outOfScopeLine=[...categoriesXml.matchAll(/<cac:ClassifiedTaxCategory>[\s\S]*?<\/cac:ClassifiedTaxCategory>/g)].find(category=>category[0].includes('<cbc:ID>O</cbc:ID>'))?.[0];
 assert.ok(outOfScopeLine);assert.ok(outOfScopeLine.includes('<cbc:Percent>0.00</cbc:Percent>'));
 exportXml('mixed-tax-categories.xml',categoriesXml);

 const before=db.prepare('SELECT COUNT(*) n FROM invoices').get().n;
 for(const unsupported of [{discount:5},{allowances:[{amount:5}]},{charges:[{amount:5}]},{prepayment:5}]){
  assert.throws(()=>createInvoice(db,1,{party_id:party,invoice_kind:'standard',supply_date:'2026-11-26',lines:[{description:'غير مدعوم',qty:1,unit_price:10}],...unsupported}),/مسارًا ضريبيًا لم يكتمل/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM invoices').get().n,before);
 }
}finally{db.close();}
console.log('PASS: accounting-to-XML totals, payment terms, line allowance, partial credit reference, debit reference, unit code, tax categories, and blocked invoice-level features');
