import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createTransport } from '../server/zatca/transport.js';

const xml='<invoice/>';
const officialValidation={passed:true,xmlSha256:crypto.createHash('sha256').update(xml).digest('base64')};
let response;
const transport=createTransport({
  environment:'simulation',
  binarySecurityToken:'local-test-token',
  secret:'local-test-secret',
  fetchImpl:async()=>response,
});
const submit=(operation='clearance')=>transport.submit({operation,uuid:'test-uuid',invoiceHash:'test-hash',xml,officialValidation});

response={status:401,json:async()=>{throw new Error('invalid json')}};
assert.equal((await submit()).state,'blocked');
assert.equal((await submit()).httpStatus,401);

response={status:503,json:async()=>({validationResults:{warningMessages:['تأخير مؤقت']}})};
const unavailable=await submit();
assert.equal(unavailable.state,'retry');
assert.deepEqual(unavailable.warnings,['تأخير مؤقت']);

response={status:400,json:async()=>({validationResults:{errorMessages:[{message:'XML مرفوض'}]}})};
const rejected=await submit();
assert.equal(rejected.state,'rejected');
assert.match(rejected.reason,/XML مرفوض/);

response={status:200,json:async()=>({clearanceStatus:'CLEARED',clearedInvoice:Buffer.from('<cleared/>').toString('base64'),validationResults:{warningMessages:['تحذير']}})};
const accepted=await submit();
assert.equal(accepted.state,'accepted');
assert.deepEqual(accepted.warnings,['تحذير']);

response={status:200,json:async()=>({reportingStatus:'REPORTED'})};
assert.equal((await submit('reporting')).state,'accepted');

const timeoutTransport=createTransport({
  environment:'simulation',
  binarySecurityToken:'local-test-token',
  secret:'local-test-secret',
  fetchImpl:async()=>{const error=new Error('timeout');error.name='TimeoutError';throw error;},
});
const timeout=await timeoutTransport.submit({operation:'reporting',uuid:'test-uuid',invoiceHash:'test-hash',xml,officialValidation});
assert.equal(timeout.state,'retry');
assert.match(timeout.reason,/مهلة/);

const networkTransport=createTransport({
  environment:'simulation',
  binarySecurityToken:'local-test-token',
  secret:'local-test-secret',
  fetchImpl:async()=>{throw new Error('offline');},
});
const network=await networkTransport.submit({operation:'reporting',uuid:'test-uuid',invoiceHash:'test-hash',xml,officialValidation});
assert.equal(network.state,'retry');
assert.match(network.reason,/انقطع الاتصال/);

assert.throws(()=>createTransport({environment:'production',binarySecurityToken:'local-test-token',secret:'local-test-secret'}),/مقفل/);
assert.throws(()=>createTransport({environment:'production',binarySecurityToken:'local-test-token',secret:'local-test-secret',allowProduction:true}),/مقفل/);
console.log('نجحت اختبارات تصنيف النقل الآمن: قبول وتحذيرات ورفض ومصادقة ومهلة وانقطاع');
