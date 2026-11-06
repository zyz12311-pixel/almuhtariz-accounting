const BASES={sandbox:'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',simulation:'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',production:'https://gw-fatoora.zatca.gov.sa/e-invoicing/core'};
export function createTransport({environment='simulation',binarySecurityToken,secret,allowProduction=false,fetchImpl=globalThis.fetch}){
 if(!Object.hasOwn(BASES,environment))throw Error('بيئة الهيئة غير صالحة');if(environment==='production'&&!allowProduction)throw Error('الإرسال الإنتاجي مقفل');
 if(!binarySecurityToken||!secret)throw Error('شهادة الجهاز وبيانات مصادقته غير مهيأة');
 return {async submit({operation,uuid,invoiceHash,xml,officialValidation}){
  if(!['reporting','clearance'].includes(operation))throw Error('نوع الإرسال غير صالح');
  if(!officialValidation?.passed||officialValidation.xmlSha256!==await sha256(xml))throw Error('يجب التحقق الرسمي من نفس XML الموقّع قبل الإرسال');
  const headers={'Content-Type':'application/json','Accept':'application/json','Accept-Language':'en','Accept-Version':'V2','Authorization':'Basic '+Buffer.from(binarySecurityToken+':'+secret).toString('base64')};if(operation==='clearance')headers['Clearance-Status']='1';
  let response;try{response=await fetchImpl(BASES[environment]+'/invoices/'+operation+'/single',{method:'POST',headers,body:JSON.stringify({uuid,invoiceHash,invoice:Buffer.from(xml,'utf8').toString('base64')}),signal:AbortSignal.timeout(30000)});}catch{return{state:'retry',reason:'تعذر الاتصال بالهيئة',retryAfter:60};}
  let result;try{result=await response.json();}catch{return{state:response.status>=500?'retry':'rejected',reason:'رد غير قابل للقراءة من الهيئة',httpStatus:response.status,retryAfter:60};}
  if([429,500,502,503,504].includes(response.status))return{state:'retry',httpStatus:response.status,retryAfter:60};
  if(response.status<200||response.status>=300)return{state:'rejected',httpStatus:response.status,result};
  const accepted=operation==='reporting'?result.reportingStatus==='REPORTED':result.clearanceStatus==='CLEARED'&&Boolean(result.clearedInvoice);
  if(!accepted||result.validationResults?.errorMessages?.length)return{state:'rejected',httpStatus:response.status,result};
  return{state:'accepted',httpStatus:response.status,result,warnings:result.validationResults?.warningMessages||[]};
 }};
}
async function sha256(xml){const {createHash}=await import('node:crypto');return createHash('sha256').update(xml).digest('base64');}
