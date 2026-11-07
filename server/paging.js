export function pageQuery(query={}){
 const integer=(value,fallback,max)=>{if(value===undefined)return fallback;if(!/^\d+$/.test(String(value)))throw Error('رقم الصفحة أو حجمها غير صالح');const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>max)throw Error('رقم الصفحة أو حجمها خارج المسموح');return n;};
 const q=String(query.q||'').trim();if(q.length>100)throw Error('نص البحث طويل');
 return{page:integer(query.page,1,10000000),page_size:integer(query.page_size,50,200),q,like:'%'+q.replace(/[\\%_]/g,'\\$&')+'%'};
}
export function paged(db,{select,from,where='1',params=[],order,map=x=>x},query){
 const p=pageQuery(query),total=db.prepare('SELECT COUNT(*) n FROM '+from+' WHERE '+where).get(...params).n;
 const pages=Math.max(1,Math.ceil(total/p.page_size)),page=Math.min(p.page,pages),rows=db.prepare('SELECT '+select+' FROM '+from+' WHERE '+where+' ORDER BY '+order+' LIMIT ? OFFSET ?').all(...params,p.page_size,(page-1)*p.page_size).map(map);
 return{rows,total,page,page_size:p.page_size,pages};
}
