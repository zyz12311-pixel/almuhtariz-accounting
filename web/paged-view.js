// Update only the list: searching/paging must not discard an unfinished form nearby.
export async function pagedView({api,path,body,renderRows,bindRows=()=>{},searchInput=null,filters=[],initial=null,onRows=()=>{},emptyHtml='<tr><td colspan="20">لا توجد نتائج</td></tr>'}){
 const host=body.closest('.table-scroll')||body.closest('table')||body,toolbar=document.createElement('div');toolbar.className='toolbar';toolbar.innerHTML='<button type="button" data-prev>السابق</button><span role="status" aria-live="polite"></span><button type="button" data-next>التالي</button>';
 host.after(toolbar);const status=toolbar.querySelector('span'),previous=toolbar.querySelector('[data-prev]'),next=toolbar.querySelector('[data-next]');
 if(!searchInput){searchInput=document.createElement('input');searchInput.type='search';searchInput.placeholder='بحث في جميع السجلات';searchInput.setAttribute('aria-label','بحث في جميع السجلات');toolbar.prepend(searchInput);}
 let current=null,serial=0,timer;
 const draw=result=>{current=result;onRows(result.rows);body.innerHTML=renderRows(result.rows)||emptyHtml;status.textContent='الصفحة '+result.page+' من '+result.pages+' · '+result.total+' سجل مطابق';previous.disabled=result.page<=1;next.disabled=result.page>=result.pages;bindRows(result.rows);};
 const load=async(page=1)=>{const request=++serial;previous.disabled=next.disabled=true;status.textContent='جارٍ تحميل النتائج…';const query=new URLSearchParams({page:String(page),page_size:'50',q:searchInput.value});for(const {input,key} of filters)if(input.value)query.set(key,input.value);try{const result=await api(path+(path.includes('?')?'&':'?')+query);if(request===serial&&body.isConnected)draw(result);}catch(error){if(request===serial&&body.isConnected){status.textContent=error.message;previous.disabled=!current||current.page<=1;next.disabled=!current||current.page>=current.pages;}}};
 previous.onclick=()=>load(current.page-1);next.onclick=()=>load(current.page+1);
 searchInput.oninput=()=>{clearTimeout(timer);++serial;timer=setTimeout(()=>{if(body.isConnected)load(1);},300);};for(const {input} of filters)input.onchange=()=>load(1);
 if(initial)draw(initial);else await load();return{reload:()=>load(current?.page||1)};
}
