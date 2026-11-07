// Compare both ledger queries against the same isolated synthetic database.
import fs from 'node:fs';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';import {performance} from 'node:perf_hooks';
import {openDb} from '../server/db.js';import {FINANCIAL_SQL} from '../server/commercial.js';import {listItems} from '../server/items.js';import {commercialList} from '../server/lists.js';import {nowRiyadh} from '../server/lib.js';
const source=path.resolve(process.argv[2]||''),metadata=JSON.parse(fs.readFileSync(path.join(source,'report.json'),'utf8'));if(!metadata.fixture_kind?.startsWith('synthetic'))throw Error('Synthetic benchmark fixtures only');
const output=fs.mkdtempSync(path.resolve('releases/query-performance-')),file=path.join(output,'fixture.db'),raw=new DatabaseSync(path.join(source,'fixture-100000.db'),{readOnly:true});try{raw.prepare('VACUUM INTO ?').run(file);}finally{raw.close();}
const db=openDb(file),today=nowRiyadh().date;
const old=`SELECT a.code,a.name_ar,a.type,COALESCE(SUM(CASE WHEN e.entry_date<? THEN l.debit-l.credit ELSE 0 END),0) opening,COALESCE(SUM(CASE WHEN e.entry_date BETWEEN ? AND ? THEN l.debit ELSE 0 END),0) debit,COALESCE(SUM(CASE WHEN e.entry_date BETWEEN ? AND ? THEN l.credit ELSE 0 END),0) credit FROM accounts a LEFT JOIN journal_lines l ON l.account_code=a.code LEFT JOIN journal_entries e ON e.id=l.entry_id GROUP BY a.code ORDER BY a.code`;
const measure=fn=>{fn();const times=[];for(let i=0;i<9;i++){const start=performance.now();fn();times.push(performance.now()-start);}times.sort((a,b)=>a-b);return{samples:9,p50_ms:times[4],p95_ms:times[8]};};
const report={created_at:new Date().toISOString(),node:process.version,source_fixture:path.basename(source),history_rows:100000,notes:'Same synthetic fixture; both queries warmed. Opening balances still require earlier history. No production guarantee.',periods:[]};
try{
 for(const [from,to] of [[today,today],['2024-01-01','2024-12-31']]){
  const legacy=()=>db.prepare(old).all(from,from,to,from,to),current=()=>db.prepare(FINANCIAL_SQL).all(from,from,from,to);
  if(JSON.stringify(legacy())!==JSON.stringify(current()))throw Error('Ledger result mismatch');report.periods.push({from,to,before:measure(legacy),after:measure(current)});
 }
 report.full_catalog=measure(()=>listItems(db));report.catalog_page_50=measure(()=>commercialList(db,'items',{}));report.plans=db.prepare('EXPLAIN QUERY PLAN '+FINANCIAL_SQL).all(today,today,today,today);
 report.catalog_page_rows=commercialList(db,'items',{}).rows.length;fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log('Report: '+path.join(output,'report.json'));
}finally{db.close();}
