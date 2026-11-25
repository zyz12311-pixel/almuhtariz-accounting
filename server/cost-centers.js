import {validDate} from './dates.js';import {tx} from './db.js';
const identifier=value=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw Error('معرف غير صالح');return n;};

export function listCostCenters(db){
 return db.prepare('SELECT id,code,name_ar,active,created_at FROM cost_centers ORDER BY code').all();
}

export function createCostCenter(db,body){
 const code=String(body.code||'').trim();const name_ar=String(body.name_ar||'').trim();
 if(!code||!name_ar)throw Error('كود واسم المركز مطلوبان');
 if(code.length>30)throw Error('كود المركز طويل جدًا');
 if(db.prepare('SELECT 1 FROM cost_centers WHERE code=?').get(code))throw Error('كود المركز مستخدم مسبقًا');
 const id=Number(db.prepare('INSERT INTO cost_centers(code,name_ar,active) VALUES(?,?,1)').run(code,name_ar).lastInsertRowid);
 return{id,code,name_ar,active:1};
}

export function updateCostCenter(db,id,body){
 identifier(id);const row=db.prepare('SELECT * FROM cost_centers WHERE id=?').get(id);if(!row)throw Error('مركز التكلفة غير موجود');
 const code=String(body.code||row.code).trim();const name_ar=String(body.name_ar||row.name_ar).trim();
 if(!code||!name_ar)throw Error('كود واسم المركز مطلوبان');
 if(code!==row.code&&db.prepare('SELECT 1 FROM cost_centers WHERE code=?').get(code))throw Error('كود المركز مستخدم مسبقًا');
 if(typeof body.active==='boolean'){db.prepare('UPDATE cost_centers SET active=? WHERE id=?').run(body.active?1:0,id);}
 db.prepare('UPDATE cost_centers SET code=?,name_ar=? WHERE id=?').run(code,name_ar,id);
 return db.prepare('SELECT id,code,name_ar,active,created_at FROM cost_centers WHERE id=?').get(id);
}

export function deleteCostCenter(db,id){
 identifier(id);
 const has=db.prepare('SELECT 1 FROM journal_lines WHERE cost_center_id=? LIMIT 1').get(id);
 if(has)throw Error('لا يمكن حذف مركز التكلفة لأنه مرتبط بحركات محاسبية سابقة؛ ألغِ تفعيله بدلاً من الحذف');
 db.prepare('DELETE FROM cost_centers WHERE id=?').run(id);return{ok:true};
}

export function costCenterReport(db,from,to,costCenterId){
 from=validDate(from);to=validDate(to);if(from>to)throw Error('بداية الفترة تتجاوز نهايتها');
 const ccFilter=costCenterId?` AND l.cost_center_id=?`:'';
 const ccArg=costCenterId?[costCenterId]:[];
 const rows=db.prepare(`
  SELECT cc.id,cc.code,cc.name_ar,l.account_code,a.name_ar account_name,
         COALESCE(SUM(l.debit),0) debit,COALESCE(SUM(l.credit),0) credit
  FROM journal_lines l
  JOIN journal_entries e ON e.id=l.entry_id
  JOIN cost_centers cc ON cc.id=l.cost_center_id
  JOIN accounts a ON a.code=l.account_code
  WHERE l.cost_center_id IS NOT NULL AND e.entry_date BETWEEN ? AND ? ${ccFilter}
  GROUP BY cc.id,l.account_code
  ORDER BY cc.code,l.account_code
 `).all(from,to,...ccArg);
 const byCenter=new Map();
 for(const r of rows){
  let c=byCenter.get(r.id);
  if(!c){c={id:r.id,code:r.code,name_ar:r.name_ar,accounts:[],total_debit:0,total_credit:0};byCenter.set(r.id,c);}
  c.accounts.push({code:r.account_code,name:r.account_name,debit:r.debit/100,credit:r.credit/100});
  c.total_debit+=r.debit;c.total_credit+=r.credit;
 }
 const costCenters=[...byCenter.values()].map(c=>({...c,total_debit:c.total_debit/100,total_credit:c.total_credit/100,balance:(c.total_debit-c.total_credit)/100}));
 // إجماليات الحسابات عبر جميع المراكز (لتطابقها مع الأستاذ العام لنفس الفترة)
 const accountRows=db.prepare(`
  SELECT l.account_code,a.name_ar account_name,
         COALESCE(SUM(l.debit),0) debit,COALESCE(SUM(l.credit),0) credit
  FROM journal_lines l
  JOIN journal_entries e ON e.id=l.entry_id
  JOIN accounts a ON a.code=l.account_code
  WHERE l.cost_center_id IS NOT NULL AND e.entry_date BETWEEN ? AND ? ${ccFilter}
  GROUP BY l.account_code
  ORDER BY l.account_code
 `).all(from,to,...ccArg);
 const accountTotals=accountRows.map(r=>({code:r.account_code,name:r.account_name,debit:r.debit/100,credit:r.credit/100,balance:(r.debit-r.credit)/100}));
 const totals={debit:costCenters.reduce((s,c)=>s+c.total_debit,0),credit:costCenters.reduce((s,c)=>s+c.total_credit,0)};
 return{from,to,costCenters,accountTotals,totals};
}
