import {trackingInput} from './tracking.js';import {scaledInteger} from './money.js';
export const fixedQuantity=(value,scale=6)=>{const n=BigInt(value),factor=10n**BigInt(scale);return(n/factor)+'.'+String(n%factor).padStart(scale,'0');};
export function prepareTrackingCount(db,item,warehouse,rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>1000)throw Error('أدخل الكميات المعدودة حسب الدفعة أو التسلسل');
 const normalized=trackingInput(rows.map(r=>({code:r.code,expiry_date:r.expiry_date,qty:1}))),counts=rows.map((row,index)=>{
  const entry=normalized[index],counted=Number(scaledInteger(row.counted_qty,6,'كمية الهوية المعدودة'));if(item.tracking_mode==='serial'&&![0,1000000].includes(counted))throw Error('عد التسلسل صفر أو قطعة واحدة');
  const trace=db.prepare('SELECT * FROM trace_units WHERE item_id=? AND code=?').get(item.id,entry.code);if(trace&&entry.expiry_date&&entry.expiry_date!==trace.expiry_date)throw Error('تاريخ هوية الجرد لا يطابق المحفوظ');
  if(!trace&&counted>0&&item.expiry_required&&!entry.expiry_date)throw Error('تاريخ انتهاء هوية الزيادة مطلوب');
  const expected=trace?db.prepare('SELECT qty_micro FROM trace_positions WHERE trace_id=? AND warehouse_id=?').get(trace.id,warehouse)?.qty_micro||0:0;
  return{code:entry.code,expiry_date:trace?.expiry_date||entry.expiry_date,expected_micro:expected,counted_micro:counted};
 });
 const existing=db.prepare('SELECT qty_micro FROM stock_positions WHERE item_id=? AND warehouse_id=?').get(item.id,warehouse)?.qty_micro||0,total=BigInt(existing)+counts.reduce((sum,c)=>sum+BigInt(c.counted_micro)-BigInt(c.expected_micro),0n);
 if(total<0n||total>BigInt(Number.MAX_SAFE_INTEGER))throw Error('إجمالي الجرد خارج المسموح');return{counts,counted:Number(total)};
}
export function trackingCountAdjustments(db,item,warehouse,counts){
 if(!counts.length)throw Error('جرد الصنف المتتبع يحتاج تفاصيل الهويات');const groups={incoming:[],outgoing:[]};
 for(const row of counts){const trace=db.prepare('SELECT id FROM trace_units WHERE item_id=? AND code=?').get(item,row.code),current=trace?db.prepare('SELECT qty_micro FROM trace_positions WHERE trace_id=? AND warehouse_id=?').get(trace.id,warehouse)?.qty_micro||0:0;if(current!==row.expected_micro)throw Error('تغير رصيد دفعة أو تسلسل منذ العد');const difference=row.counted_micro-row.expected_micro;if(difference)groups[difference>0?'incoming':'outgoing'].push({code:row.code,expiry_date:row.expiry_date,qty:fixedQuantity(Math.abs(difference))});}
 return Object.entries(groups).filter(([,rows])=>rows.length).map(([kind,tracking])=>({kind:kind==='incoming'?'adjust_in':'adjust_out',tracking,qty:fixedQuantity(tracking.reduce((sum,r)=>sum+Number(scaledInteger(r.qty,6)),0))})).sort((a,b)=>a.kind==='adjust_out'?-1:b.kind==='adjust_out'?1:0);
}
