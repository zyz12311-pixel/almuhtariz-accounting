import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const data=process.env.ALMUHTARIZ_DATA||process.env.SMARTZ_DATA||path.join(root,'data');
const file=path.join(data,'smartz.db');const db=openDb(file);
console.log('المحترز: قاعدة البيانات المحلية جاهزة: '+file);
console.log('إصدار الجداول: '+db.prepare('SELECT MAX(version) version FROM schema_migrations').get().version);
db.close();
