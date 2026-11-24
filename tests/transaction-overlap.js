import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {tx} from '../server/db.js';
const db=new DatabaseSync(':memory:');
try {
 db.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY)');
 let release;
 const gate=new Promise(resolve=>{release=resolve;});
 const first=tx(db,async()=>{db.exec('INSERT INTO entries VALUES(1)');await gate;throw Error('rollback first');});
 const rejected=assert.rejects(first,/rollback first/);
 try {await tx(db,()=>db.exec('INSERT INTO entries VALUES(2)'));} finally {release();await rejected;}
 assert.deepEqual(db.prepare('SELECT id FROM entries ORDER BY id').all().map(row=>row.id),[2],'Independent successful transaction must survive rollback of another request');
 console.log('PASS: independent transaction rollback isolation');
} finally {db.close();}
