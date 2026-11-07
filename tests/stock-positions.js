import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {openDb} from '../server/db.js';import {seedCompany} from '../server/core.js';import {balance,recordStock} from '../server/inventory.js';import {checkStockPositions,rebuildStockPositions} from '../server/stock-positions.js';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'muhtariz-position-')),file=path.join(folder,'old.db');let db=new DatabaseSync(file);
try{
 db.exec('PRAGMA foreign_keys=ON;CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)');
 const migrationDirectory=new URL('../server/migrations/',import.meta.url);
 for(const name of fs.readdirSync(migrationDirectory).filter(n=>/^\d+_.*\.sql$/.test(n)&&Number(n.split('_')[0])<=10).sort()){const sql=fs.readFileSync(new URL(name,migrationDirectory),'utf8');db.exec(sql);db.prepare('INSERT INTO schema_migrations VALUES(?,?,?,?)').run(Number(name.split('_')[0]),name,crypto.createHash('sha256').update(sql).digest('hex'),new Date().toISOString());}
 seedCompany(db,'ترقية');db.exec("INSERT INTO users(id,username,pass,role) VALUES(1,'fixture','fixture','owner');INSERT INTO items(id,name_ar,unit_price,track_stock) VALUES(1,'قديم',100,1);INSERT INTO stock_movements(id,event_id,request_hash,item_id,warehouse_id,delta_micro,kind,reason) VALUES(1,'old1','h',1,1,5000000,'receipt','قديم'),(2,'old2','h',1,1,-2000000,'issue','قديم');INSERT INTO stock_values VALUES(1,500,5000000,500,1,1),(2,-200,3000000,300,1,1)");
 db.close();db=openDb(file);assert.equal(balance(db,1,1),3000000);assert.ok(checkStockPositions(db).ok);assert.equal(db.prepare('SELECT COUNT(*) n FROM stock_positions').get().n,1);
 assert.throws(()=>db.exec('UPDATE stock_positions SET qty_micro=9000000'),/مشتق/);assert.throws(()=>db.exec('DELETE FROM stock_positions'),/مشتق/);
 const before=db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n;
 assert.throws(()=>recordStock(db,{request_id:crypto.randomUUID(),item_id:1,warehouse_id:1,qty:4,kind:'issue',reason:'فوق المتاح'},1),/الرصيد/);assert.equal(balance(db,1,1),3000000);
 assert.throws(()=>recordStock(db,{request_id:crypto.randomUUID(),item_id:1,warehouse_id:1,qty:2,unit_cost:'90071992547409.91',kind:'receipt',reason:'قيمة متجاوزة'},1),/قيمة المخزون/);assert.equal(balance(db,1,1),3000000);assert.equal(db.prepare('SELECT COUNT(*) n FROM stock_movements').get().n,before);
 assert.throws(()=>db.prepare("INSERT INTO stock_movements(event_id,request_hash,item_id,warehouse_id,delta_micro,kind,reason) VALUES('overflow','h',1,1,9007199254740991,'receipt','حد')").run(),/أكبر/);
 recordStock(db,{request_id:crypto.randomUUID(),item_id:1,warehouse_id:1,qty:1,kind:'issue',reason:'صرف صحيح'},1);assert.equal(balance(db,1,1),2000000);assert.ok(checkStockPositions(db).ok);
 const guard=db.prepare("SELECT sql FROM sqlite_schema WHERE name='position_guard_update'").get().sql;db.exec('DROP TRIGGER position_guard_update;UPDATE stock_positions SET qty_micro=qty_micro+1');db.exec(guard);
 assert.equal(checkStockPositions(db).ok,false);assert.throws(()=>recordStock(db,{request_id:crypto.randomUUID(),item_id:1,warehouse_id:1,qty:1,kind:'receipt',reason:'كاش غير مطابق'},1),/سلسلة تقييم/);
 assert.ok(rebuildStockPositions(db).ok);assert.equal(balance(db,1,1),2000000);assert.throws(()=>db.exec('UPDATE stock_positions SET qty_micro=0'),/مشتق/);
 db.close();db=openDb(file);assert.equal(balance(db,1,1),2000000);assert.ok(checkStockPositions(db).ok);
 console.log('PASS: real v10 upgrade, derived balance guards, negative/overflow rejection, valuation rollback, corruption detection, rebuild and reopen');
}finally{db.close();}
