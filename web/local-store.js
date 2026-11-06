/* Local UI cache only. Authentication tokens and issued ledgers never enter this store. */
(()=>{
 const DB_NAME='almuhtariz-local-v1';
 const ready=new Promise((resolve,reject)=>{
  if(!globalThis.indexedDB){resolve(null);return;}
  const request=indexedDB.open(DB_NAME,1);
  request.onupgradeneeded=()=>{const db=request.result;for(const name of ['meta','cache','drafts'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'key'});};
  request.onerror=()=>reject(request.error);
  request.onblocked=()=>resolve(null);
  request.onsuccess=()=>{const db=request.result;db.onversionchange=()=>db.close();try{db.transaction('meta','readwrite').objectStore('meta').put({key:'initialized',version:1,created_at:new Date().toISOString()});}catch{}resolve(db);};
 }).catch(()=>null);
 async function transaction(bucket,mode,operation){const db=await ready;if(!db)return null;return new Promise(resolve=>{let value=null;try{const tx=db.transaction(bucket,mode),request=operation(tx.objectStore(bucket));if(request)request.onsuccess=()=>{value=request.result};tx.oncomplete=()=>resolve(value??true);tx.onerror=tx.onabort=()=>resolve(null);}catch{resolve(null);}});}
 globalThis.AlmuhtarizStore={
  ready:()=>ready.then(Boolean),
  async get(scope,key,bucket='cache'){if(!scope)return null;const row=await transaction(bucket,'readonly',s=>s.get(scope+':'+key));return row&&typeof row==='object'?row.value:null;},
  async put(scope,key,value,bucket='cache'){if(!scope)return false;return Boolean(await transaction(bucket,'readwrite',s=>s.put({key:scope+':'+key,value,updated_at:new Date().toISOString()})));},
  async remove(scope,key,bucket='cache'){if(!scope)return false;return Boolean(await transaction(bucket,'readwrite',s=>s.delete(scope+':'+key)));},
  async clearScope(scope){if(!scope)return;for(const bucket of ['cache','drafts'])await transaction(bucket,'readwrite',s=>{const request=s.openCursor();request.onsuccess=()=>{const cursor=request.result;if(cursor){if(String(cursor.key).startsWith(scope+':'))cursor.delete();cursor.continue();}};return null;});}
 };
})();
