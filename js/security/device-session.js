/* Acesso persistente por navegador: CryptoKey não extraível, nunca a senha. */
globalThis.WalletDeviceSession = (() => {
  const tasks=new Map(),epochs=new Map();
  const version=meta=>JSON.stringify([meta.keyId,meta.kdf,meta.password,meta.recovery]);
  function database(){return new Promise((resolve,reject)=>{
    if(!globalThis.indexedDB)return reject(Error('Armazenamento de acesso indisponível.'));
    const request=indexedDB.open('royal-wallet-device-access',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('keys');
    request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Feche outras abas para salvar o acesso.'));
    request.onsuccess=()=>resolve(request.result);
  });}
  async function operation(uid,mode,change){const db=await database();try{return await new Promise((resolve,reject)=>{
    const tx=db.transaction('keys',mode),request=change(tx.objectStore('keys'));let result;
    request.onsuccess=()=>{result=request.result;};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||Error('Falha ao salvar acesso.'));tx.onerror=()=>reject(tx.error);
  });}finally{db.close();}}
  function queue(uid,task){const result=(tasks.get(uid)||Promise.resolve()).catch(()=>{}).then(task);tasks.set(uid,result);return result;}
  function remember(uid,session){const epoch=epochs.get(uid)||0;return queue(uid,async()=>{
    if(!globalThis.indexedDB)return false;
    const key=await session.deviceKey();if(epoch!==(epochs.get(uid)||0))return false;
    await operation(uid,'readwrite',store=>store.put({owner:uid,version:version(session.metadata),key},uid));
    const record=await operation(uid,'readonly',store=>store.get(uid));
    const restored=WalletCrypto.resume(uid,session.metadata,record.key),probe=await session.encrypt({probe:true},'device-session-check');
    if(!(await restored.decrypt(probe,'device-session-check')).probe)throw Error('Não foi possível verificar o acesso salvo.');
    if(epoch!==(epochs.get(uid)||0))return false;
    localStorage.removeItem('royalDeviceAccessRevoked_'+uid);if(uid==='device')localStorage.setItem('royalRememberLocal','1');return true;
  });}
  async function restore(uid,meta){await(tasks.get(uid)||Promise.resolve()).catch(()=>{});if(!meta||!globalThis.indexedDB)return null;
    try{if(localStorage.getItem('royalDeviceAccessRevoked_'+uid)==='1')return null;const record=await operation(uid,'readonly',store=>store.get(uid));if(!record||record.owner!==uid||record.version!==version(meta))return null;const session=WalletCrypto.resume(uid,meta,record.key);for(const prefix of ['royalVaultData_','royalVaultQueue_']){const key=prefix+uid,raw=localStorage.getItem(key);if(raw)await session.decrypt(JSON.parse(raw),'local:'+key);}return session;}catch(_){return null;}
  }
  function forget(uid){if(!uid)return Promise.resolve();epochs.set(uid,(epochs.get(uid)||0)+1);localStorage.setItem('royalDeviceAccessRevoked_'+uid,'1');if(uid==='device')localStorage.removeItem('royalRememberLocal');return queue(uid,async()=>{if(globalThis.indexedDB)await operation(uid,'readwrite',store=>store.delete(uid));});}
  return Object.freeze({remember,restore,forget});
})();
