import crypto from 'node:crypto';
import { migrate } from './migrate.js';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file) {
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const db=new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    migrate(db);
    db.exec('BEGIN IMMEDIATE');
    if(!db.prepare('SELECT id FROM installation LIMIT 1').get()) db.prepare('INSERT INTO installation(id,created_at) VALUES(?,?)').run(crypto.randomUUID(),new Date().toISOString());
    db.exec('COMMIT');return db;
  } catch(error) {try{db.exec('ROLLBACK')}catch{}db.close();throw error;}
}
export function tx(db, fn) {
  const savepoint = 'sp_' + Math.random().toString(36).slice(2);
  db.exec('SAVEPOINT ' + savepoint);
  try { const r = fn(); db.exec('RELEASE ' + savepoint); return r; }
  catch (e) { try { db.exec('ROLLBACK TO ' + savepoint); db.exec('RELEASE ' + savepoint); } catch {} throw e; }
}
