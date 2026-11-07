// Explicit maintenance command: backup first; reconstruct only derived quantity state.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {openDb} from '../server/db.js';import {rebuildStockPositions} from '../server/stock-positions.js';import {appendAudit} from '../server/audit.js';
const file=process.argv[2];if(!file||!fs.existsSync(file))throw Error('حدد قاعدة المحترز الموجودة؛ يفضل إيقاف خادم الفرع للصيانة أولًا');
const source=path.resolve(file),directory=path.join(path.dirname(source),'maintenance-backups');fs.mkdirSync(directory,{recursive:true});
const backup=path.join(directory,'before-stock-rebuild-'+Date.now()+'-'+crypto.randomUUID()+'.db'),db=openDb(source);
try{
 db.prepare('VACUUM INTO ?').run(backup);
 const {DatabaseSync}=await import('node:sqlite');const copy=new DatabaseSync(backup,{readOnly:true});try{if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('النسخة الاحتياطية غير سليمة؛ أوقفت إعادة البناء');}finally{copy.close();}
 const result=rebuildStockPositions(db);appendAudit(db,{event:'maintenance.stock_positions.rebuilt',details:{matched:result.ok}});console.log(JSON.stringify({matched:result.ok,backup},null,2));
}finally{db.close();}
