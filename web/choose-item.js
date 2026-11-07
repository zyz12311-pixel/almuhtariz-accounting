import {pagedView} from './paged-view.js';
export async function chooseItem({api,esc,units=false}){
 const initial=await api('lists/items?active=1'),dialog=document.createElement('dialog');dialog.className='stock-dialog';
 dialog.innerHTML='<h2>اختيار صنف</h2><p>ابحث بالاسم أو الكود أو باركود أي وحدة.</p><input type="search" aria-label="بحث الصنف المطلوب" placeholder="اسم / كود / باركود"><div class="table-scroll"><table><thead><tr><th>الصنف</th><th>الوحدة</th><th>اختيار</th></tr></thead><tbody></tbody></table></div><button type="button" data-close>إغلاق</button>';document.body.append(dialog);
 let choices=[];const result=new Promise(resolve=>{
  dialog.addEventListener('close',()=>{resolve(null);dialog.remove();},{once:true});dialog.querySelector('[data-close]').onclick=()=>dialog.close();
  dialog._choose=item=>{resolve(item);dialog.close();};
 });
 await pagedView({api,path:'lists/items?active=1',body:dialog.querySelector('tbody'),searchInput:dialog.querySelector('input'),initial,onRows:rows=>{choices=rows;},renderRows:rows=>rows.flatMap(item=>[item,...(units?item.units.map(u=>({...item,name_ar:item.name_ar+' — '+u.name,base_unit:u.name,unit_code:u.unit_code,item_unit_id:u.id,unit_price:u.unit_price,barcode:u.barcode})):[])]).map(item=>'<tr><td>'+esc(item.name_ar)+'</td><td>'+esc(item.base_unit)+'</td><td><button type="button" data-item="'+item.id+'" data-unit="'+(item.item_unit_id||'')+'">اختيار</button></td></tr>').join(''),bindRows:()=>{dialog.querySelectorAll('[data-item]').forEach(button=>button.onclick=()=>{const item=choices.find(i=>i.id===Number(button.dataset.item)),unit=item.units.find(u=>u.id===Number(button.dataset.unit));dialog._choose(unit?{...item,name_ar:item.name_ar+' — '+unit.name,base_unit:unit.name,unit_code:unit.unit_code,item_unit_id:unit.id,unit_price:unit.unit_price,barcode:unit.barcode}:item);});}});
 dialog.showModal();dialog.querySelector('input').focus();return result;
}
