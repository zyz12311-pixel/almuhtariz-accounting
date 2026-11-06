import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data=process.env.ALMUHTARIZ_DATA||process.env.SMARTZ_DATA||path.join(root,'data');
const source=path.resolve(data,'smartz.db');
if(!fs.existsSync(source))throw Error('لا توجد قاعدة بيانات محلية بعد. شغّل التطبيق وأكمل الإعداد أولًا.');
const destination=path.resolve(process.env.ALMUHTARIZ_BACKUPS||path.join(root,'backups'));
fs.mkdirSync(destination,{recursive:true});
const target=path.join(destination,'almuhtariz-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(4).toString('hex')+'.db');
const db=new DatabaseSync(source,{readOnly:true});
try{
  db.exec('PRAGMA busy_timeout=10000');
  db.prepare('VACUUM INTO ?').run(target);
}finally{db.close();}
const copy=new DatabaseSync(target,{readOnly:true});
try{
  const rows=copy.prepare('PRAGMA integrity_check').all();
  if(rows.length!==1||rows[0].integrity_check!=='ok')throw Error('لم تجتز النسخة فحص سلامة SQLite؛ لا تعتمد عليها.');
  console.log('تم حفظ نسخة SQLite وفحص سلامتها: '+target);
  console.log('النسخة تشمل قاعدة البيانات فقط. احفظ ملف الترخيص ومفاتيح التوقيع مستقبلًا ضمن خطة النسخ الخاصة بها.');
}finally{copy.close();}
