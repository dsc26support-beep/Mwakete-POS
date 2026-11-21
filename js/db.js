/* Local-first database. IndexedDB is the durable offline queue; never silently discard pending sales. */
const POSDB = (() => {
  const NAME = "mwakete-pos-v1", VERSION = 2;
  let db;
  function open(){return new Promise((resolve,reject)=>{const req=indexedDB.open(NAME,VERSION);req.onupgradeneeded=()=>{const d=req.result;
    if(!d.objectStoreNames.contains("products")){const s=d.createObjectStore("products",{keyPath:"id"});s.createIndex("sku","sku",{unique:false});}
    if(!d.objectStoreNames.contains("sales")){const s=d.createObjectStore("sales",{keyPath:"id"});s.createIndex("createdAt","createdAt");}
    if(!d.objectStoreNames.contains("settings"))d.createObjectStore("settings",{keyPath:"key"});
    if(!d.objectStoreNames.contains("customers")){const s=d.createObjectStore("customers",{keyPath:"id"});s.createIndex("name","name");}
  };req.onsuccess=()=>{db=req.result;resolve(db)};req.onerror=()=>reject(req.error)});}
  function tx(store,mode="readonly"){return db.transaction(store,mode).objectStore(store)}
  function all(store){return new Promise((res,rej)=>{const r=tx(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
  function get(store,key){return new Promise((res,rej)=>{const r=tx(store).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
  function put(store,value){return new Promise((res,rej)=>{const r=tx(store,"readwrite").put(value);r.onsuccess=()=>res(value);r.onerror=()=>rej(r.error)})}
  function remove(store,key){return new Promise((res,rej)=>{const r=tx(store,"readwrite").delete(key);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
  return {open,all,get,put,remove};
})();