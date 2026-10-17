function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('paper-kindle',1);req.onupgradeneeded=()=>req.result.createObjectStore('files');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function transaction(mode,fn){const db=await openDB();try{return await new Promise((resolve,reject)=>{const tx=db.transaction('files',mode);const req=fn(tx.objectStore('files'));tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
export const savePDF=value=>transaction('readwrite',s=>s.put(value,'latest'));
export const readPDF=()=>transaction('readonly',s=>s.get('latest'));
export const clearPDF=()=>transaction('readwrite',s=>s.delete('latest'));
