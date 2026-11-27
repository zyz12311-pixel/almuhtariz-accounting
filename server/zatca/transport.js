const BASES={sandbox:'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',simulation:'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation'};
function messages(values=[]){return values.slice(0,100).map(value=>String(typeof value==='string'?value:value?.message||value?.error||JSON.stringify(value)||'').slice(0,500)).filter(Boolean);}
export function createTransport({environment='simulation',binarySecurityToken,secret,fetchImpl=globalThis.fetch}){
 if(environment==='production')throw Error('الإنتاج مقفل حتى استكمال المرحلة العاشرة وموافقة الممثل المخول');
 if(!Object.hasOwn(BASES,environment))throw Error('بيئة الهيئة غير صالحة');
 if(environment!=='simulation'&&(!binarySecurityToken||!secret))throw Error('شهادة الجهاز وبيانات مصادقته غير مهيأة');
 return {async submit({operation,uuid,invoiceHash,xml,officialValidation}){
  if(!['reporting','clearance'].includes(operation))throw Error('نوع الإرسال غير صالح');
  if(!officialValidation?.passed||officialValidation.xmlSha256!==await sha256(xml))throw Error('يجب التحقق الرسمي من نفس XML الموقّع قبل الإرسال');
  const headers={'Content-Type':'application/json','Accept':'application/json','Accept-Language':'en','Accept-Version':'V2','Authorization':'Basic '+Buffer.from(binarySecurityToken+':'+secret).toString('base64')};if(operation==='clearance')headers['Clearance-Status']='1';
  let response;try{response=await fetchImpl(BASES[environment]+'/invoices/'+operation+'/single',{method:'POST',headers,body:JSON.stringify({uuid,invoiceHash,invoice:Buffer.from(xml,'utf8').toString('base64')}),signal:AbortSignal.timeout(30000)});}catch(error){
   const timeout=error.name==='TimeoutError'||error.cause?.name==='TimeoutError'||error.code==='ETIMEDOUT';
   return{state:'retry',reason:timeout?'انتهت مهلة الاتصال بالهيئة؛ سيعاد إرسال المستند نفسه':'انقطع الاتصال بالهيئة؛ سيعاد إرسال المستند نفسه',errorCode:error.code||error.name};
  }
  if(response.status===401||response.status===403)return{state:'blocked',reason:`auth: رفضت الهيئة المصادقة (${response.status})؛ تحقق من الشهادة وبياناتها`,httpStatus:response.status};
  let result;try{result=await response.json();}catch{return{state:response.status>=500?'retry':'rejected',reason:'رد غير قابل للقراءة من الهيئة',httpStatus:response.status};}
  const errors=messages(result.validationResults?.errorMessages),warnings=messages(result.validationResults?.warningMessages);
  if([429,500,502,503,504].includes(response.status))return{state:'retry',reason:`استجابة مؤقتة من الهيئة (${response.status})`,httpStatus:response.status,result,warnings};
  if(response.status<200||response.status>=300)return{state:'rejected',reason:errors.join('؛ ')||`رفضت الهيئة الطلب (HTTP ${response.status})`,httpStatus:response.status,result,warnings};
  const accepted=operation==='reporting'?result.reportingStatus==='REPORTED':result.clearanceStatus==='CLEARED'&&Boolean(result.clearedInvoice);
  if(!accepted||errors.length)return{state:'rejected',reason:errors.join('؛ ')||'لم تؤكد الهيئة حالة القبول المتوقعة',httpStatus:response.status,result,warnings};
  return{state:'accepted',httpStatus:response.status,result,warnings};
 }};
}
async function sha256(xml){const {createHash}=await import('node:crypto');return createHash('sha256').update(xml).digest('base64');}
