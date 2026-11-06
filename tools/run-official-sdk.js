// Executes a locally installed official SDK without a shell. It never marks invoices as compliant.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {parseSdkResult} from '../server/zatca/sdk-result.js';
const [configFile,invoiceFile]=process.argv.slice(2);if(!configFile||!invoiceFile)throw Error('الاستخدام: node tools/run-official-sdk.js sdk-command.json invoice.xml');
const config=JSON.parse(fs.readFileSync(configFile,'utf8')),invoice=path.resolve(invoiceFile);if(!path.isAbsolute(config.executable)||!Array.isArray(config.arguments)||config.arguments.some(a=>typeof a!=='string'))throw Error('حدد ملفًا تنفيذيًا مطلقًا وقائمة وسائط SDK الرسمية');
const args=config.arguments.map(a=>a.replaceAll('{invoice}',invoice));if(!config.arguments.some(a=>a.includes('{invoice}')))throw Error('يجب تحديد موضع {invoice} في وسائط التحقق');
const env={...process.env};if(config.sdkConfig){if(!path.isAbsolute(config.sdkConfig))throw Error('SDK_CONFIG must be an absolute path');env.SDK_CONFIG=config.sdkConfig;}
const result=spawnSync(config.executable,args,{cwd:config.cwd||path.dirname(config.executable),env,encoding:'utf8',shell:false,timeout:60000,maxBuffer:8*1024*1024});
const output=result.stdout||'',errors=result.stderr||'',executionError=result.error?.message||null;
const validation=parseSdkResult(output+'\n'+errors,{exitCode:result.status,executionError});
const report={invoice,xmlSha256:crypto.createHash('sha256').update(fs.readFileSync(invoice)).digest('base64'),checkedAt:new Date().toISOString(),exitCode:result.status,...validation,output,errors,executionError,officialComplianceClaim:false};fs.writeFileSync(invoice+'.sdk-output.json',JSON.stringify(report,null,2));console.log('حُفظ تقرير الأداة في: '+invoice+'.sdk-output.json');if(!report.passed)process.exitCode=1;
