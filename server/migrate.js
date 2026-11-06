import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'migrations');
export function migrate(db) {
 db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)');
 for(const name of fs.readdirSync(dir).filter(n=>/^\d+_.*\.sql$/.test(n)).sort()) {
  const version=Number(name.split('_')[0]),sql=fs.readFileSync(path.join(dir,name),'utf8'),checksum=crypto.createHash('sha256').update(sql).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
   const applied=db.prepare('SELECT checksum FROM schema_migrations WHERE version=?').get(version);
   if(applied){if(applied.checksum!==checksum)throw Error('ملف ترحيل مطبق تم تغييره: '+name);db.exec('COMMIT');continue;}
   db.exec(sql);db.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(version,name,checksum,new Date().toISOString());db.exec('COMMIT');
  } catch(e){try{db.exec('ROLLBACK')}catch{}throw e;}
 }
}
