import crypto from 'node:crypto';
const NS={xmlns:'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2','xmlns:cac':'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2','xmlns:cbc':'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2','xmlns:ext':'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2'};
const text=s=>String(s??'').replace(/[&<>\r]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\r':'&#xD;'}[c]));
const attr=s=>text(s).replace(/"/g,'&quot;').replace(/\n/g,'&#xA;').replace(/\t/g,'&#x9;');
const e=(name,value,attrs={})=>({name,attrs,children:Array.isArray(value)?value:[String(value)]});
function canonical(node){return '<'+node.name+Object.keys(node.attrs).sort().map(k=>' '+k+'="'+attr(node.attrs[k])+'"').join('')+'>'+node.children.filter(v=>v!==null).map(v=>typeof v==='object'?canonical(v):text(v)).join('')+'</'+node.name+'>';}
const money=n=>(n/100).toFixed(2),amount=(name,n)=>e('cbc:'+name,money(n),{currencyID:'SAR'});
function address(p){return e('cac:PostalAddress',[e('cbc:StreetName',p.street),e('cbc:BuildingNumber',p.building_number),e('cbc:CitySubdivisionName',p.district),e('cbc:CityName',p.city),e('cbc:PostalZone',p.postal_code),e('cac:Country',[e('cbc:IdentificationCode',p.country_code)])]);}
function party(p,seller){const fields=[];const id=seller?(p.seller_id||p.cr_number):p.id_number,scheme=seller?(p.seller_id_scheme||'CRN'):p.id_scheme;if(id&&scheme)fields.push(e('cac:PartyIdentification',[e('cbc:ID',id,{schemeID:scheme})]));if(p.street&&p.city&&p.country_code)fields.push(address(p));if(p.vat_number)fields.push(e('cac:PartyTaxScheme',[e('cbc:CompanyID',p.vat_number),e('cac:TaxScheme',[e('cbc:ID','VAT')])]));if(p.name_ar)fields.push(e('cac:PartyLegalEntity',[e('cbc:RegistrationName',p.name_ar)]));return e(seller?'cac:AccountingSupplierParty':'cac:AccountingCustomerParty',[e('cac:Party',fields)]);}
function taxCategory(g){const fields=[e('cbc:ID',g.tax_category)];if(g.tax_category!=='O')fields.push(e('cbc:Percent',Number(g.vat_rate).toFixed(2)));if(g.exemption_code)fields.push(e('cbc:TaxExemptionReasonCode',g.exemption_code));if(g.exemption_reason)fields.push(e('cbc:TaxExemptionReason',g.exemption_reason));fields.push(e('cac:TaxScheme',[e('cbc:ID','VAT')]));return e('cac:TaxCategory',fields);}
export function buildInvoiceXml({invoice:i,company,buyer,taxes,includeQr=true}){
 const nodes=[e('cbc:ProfileID','reporting:1.0'),e('cbc:ID',i.number),e('cbc:UUID',i.uuid),e('cbc:IssueDate',i.issue_date),e('cbc:IssueTime',i.issue_time),e('cbc:InvoiceTypeCode',i.document_code||i.type,{name:i.invoice_kind==='standard'?'0100000':'0200000'}),e('cbc:DocumentCurrencyCode','SAR'),e('cbc:TaxCurrencyCode','SAR')];
 if(i.notes)nodes.splice(6,0,e('cbc:Note',i.notes,{languageID:'ar'}));
 if(i.ref_number)nodes.push(e('cac:BillingReference',[e('cac:InvoiceDocumentReference',[e('cbc:ID',i.ref_number)])]));
 nodes.push(e('cac:AdditionalDocumentReference',[e('cbc:ID','ICV'),e('cbc:UUID',String(i.icv))]),e('cac:AdditionalDocumentReference',[e('cbc:ID','PIH'),e('cac:Attachment',[e('cbc:EmbeddedDocumentBinaryObject',i.pih,{mimeCode:'text/plain'})])]));
 if(includeQr&&i.qr)nodes.push(e('cac:AdditionalDocumentReference',[e('cbc:ID','QR'),e('cac:Attachment',[e('cbc:EmbeddedDocumentBinaryObject',i.qr,{mimeCode:'text/plain'})])]));
 nodes.push(party(company,true));if(buyer)nodes.push(party(buyer,false));else nodes.push(e('cac:AccountingCustomerParty',[e('cac:Party',[])]));
 if(i.supply_date)nodes.push(e('cac:Delivery',[e('cbc:ActualDeliveryDate',i.supply_date)]));
 const payments=[e('cbc:PaymentMeansCode',({cash:'10',bank:'42',credit:'30'})[i.payment])];if(i.reason)payments.push(e('cbc:InstructionNote',i.reason));nodes.push(e('cac:PaymentMeans',payments));
 nodes.push(e('cac:TaxTotal',[amount('TaxAmount',i.vat)]));nodes.push(e('cac:TaxTotal',[amount('TaxAmount',i.vat),...taxes.map(g=>e('cac:TaxSubtotal',[amount('TaxableAmount',g.taxable),amount('TaxAmount',g.vat),taxCategory(g)]))]));
 nodes.push(e('cac:LegalMonetaryTotal',[amount('LineExtensionAmount',i.subtotal),amount('TaxExclusiveAmount',i.subtotal),amount('TaxInclusiveAmount',i.total),amount('PrepaidAmount',0),amount('PayableAmount',i.total)]));
 for(const line of i.lines)nodes.push(e('cac:InvoiceLine',[e('cbc:ID',line.line_no),e('cbc:InvoicedQuantity',line.qty,{unitCode:line.unit_code||'PCE'}),amount('LineExtensionAmount',line.net),e('cac:TaxTotal',[amount('TaxAmount',line.vat),amount('RoundingAmount',line.total)]),e('cac:Item',[e('cbc:Name',line.description),e('cac:ClassifiedTaxCategory',[e('cbc:ID',line.tax_category),...(line.tax_category==='O'?[]:[e('cbc:Percent',Number(line.vat_rate).toFixed(2))]),e('cac:TaxScheme',[e('cbc:ID','VAT')])])]),e('cac:Price',[amount('PriceAmount',line.unit_price)])]));
 return canonical(e('Invoice',nodes,NS));
}
export const candidateHash=input=>crypto.createHash('sha256').update(buildInvoiceXml({...input,includeQr:false}),'utf8').digest('base64');
