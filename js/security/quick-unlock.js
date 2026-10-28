/* Passkey + PRF: opção local. Senha e recuperação permanecem independentes. */
globalThis.WalletQuickUnlock = (() => {
  'use strict';
  const utf8 = new TextEncoder(), random = size => crypto.getRandomValues(new Uint8Array(size));
  const storageKey = uid => `royalQuickUnlock_${uid}`;
  const b64 = value => btoa(Array.from(new Uint8Array(value), x => String.fromCharCode(x)).join(''));
  function bytes(value, size) {
    if (typeof value !== 'string' || value.length > 4096 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Error('Configuração de desbloqueio inválida. Use sua senha.');
    const result = Uint8Array.from(atob(value), x => x.charCodeAt(0));
    if (b64(result) !== value || (size && result.length !== size)) throw Error('Configuração de desbloqueio inválida. Use sua senha.');
    return result;
  }
  const currentOwner = () => AppState.isLocal ? 'device' : AppState.user?.uid;
  const passwordVersion = meta => `${meta.kdf.salt}:${meta.password.iv}:${meta.password.ciphertext}`;
  const supported = () => !!(globalThis.isSecureContext && globalThis.PublicKeyCredential && typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function' && navigator.credentials?.create && navigator.credentials?.get);
  const binding = record => JSON.stringify(['royal-wallet-quick-unlock', 1, record.origin, record.owner, record.keyId, record.passwordVersion, record.credentialId]);
  const pending = new Set();
  function cancelPending() { for (const controller of pending) controller.abort(); pending.clear(); }
  function validate(uid, meta, record) {
    WalletCrypto.validate(meta);
    if (!record || record.version !== 1 || record.owner !== uid || record.keyId !== meta.keyId || record.origin !== location.origin || record.passwordVersion !== passwordVersion(meta)) throw Error('O desbloqueio rápido precisa ser ativado novamente. Use sua senha.');
    if (!bytes(record.credentialId).length) throw Error('Chave de acesso inválida.');
    bytes(record.salt, 32); bytes(record.wrapped?.iv, 12); bytes(record.wrapped?.ciphertext, 48);
    return record;
  }
  function read(uid, meta) {
    try { const raw = localStorage.getItem(storageKey(uid)); return raw ? validate(uid, meta, JSON.parse(raw)) : null; }
    catch (_) { return null; } // Nunca bloqueia a alternativa por senha.
  }
  function available(uid, meta) { return supported() && !!meta && !!read(uid, meta); }
  async function deriveKey(output, record) {
    if (!(output instanceof ArrayBuffer) || output.byteLength !== 32) throw Error('Este aparelho ou gerenciador de chaves não oferece o recurso necessário. Continue usando a senha.');
    const material = await crypto.subtle.importKey('raw', output, 'HKDF', false, ['deriveKey']); new Uint8Array(output).fill(0);
    return crypto.subtle.deriveKey({name:'HKDF', hash:'SHA-256', salt:bytes(record.salt,32), info:utf8.encode(binding(record))}, material, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
  }
  async function assertion(record, signal) {
    const challenge = random(32);
    const credential = await navigator.credentials.get({signal, publicKey:{challenge, rpId:location.hostname, allowCredentials:[{type:'public-key',id:bytes(record.credentialId)}], userVerification:'required', timeout:60000, extensions:{prf:{eval:{first:bytes(record.salt,32)}}}}});
    if (!credential || b64(credential.rawId) !== record.credentialId) throw Error('A chave de acesso não corresponde a esta carteira.');
    const client = JSON.parse(new TextDecoder().decode(credential.response.clientDataJSON));
    const challengeUrl = b64(challenge).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
    if (client.type !== 'webauthn.get' || client.origin !== location.origin || client.challenge !== challengeUrl || client.crossOrigin === true) throw Error('Confirmação de acesso inválida.');
    const authData = new Uint8Array(credential.response.authenticatorData), rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8.encode(location.hostname)));
    if (authData.length < 37 || !(authData[32]&4) || !(authData[32]&1) || rpHash.some((value,i)=>value!==authData[i])) throw Error('O aparelho não confirmou sua identidade.');
    return deriveKey(credential.getClientExtensionResults()?.prf?.results?.first, record);
  }
  async function enroll(uid, meta, password) {
    if (!supported()) throw Error('Este navegador não oferece desbloqueio rápido. Sua senha continua funcionando.');
    const initial = WalletStorage.current(uid), controller = new AbortController(); pending.add(controller);
    const active = () => { if (controller.signal.aborted || currentOwner() !== uid || !WalletStorage.ready(uid) || WalletStorage.current(uid) !== initial) throw Error('A sessão mudou. Abra a ativação novamente.'); };
    try {
      active();
      const result = await WalletCrypto.wrapQuickUnlock(uid, meta, password, async () => {
        active();
        if (!await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) throw Error('Não foi encontrado um desbloqueio compatível neste aparelho. Use sua senha.');
        active();
        const credential = await navigator.credentials.create({signal:controller.signal, publicKey:{challenge:random(32),rp:{id:location.hostname,name:'Royal Wallet'},user:{id:random(32),name:'carteira-'+b64(random(6)),displayName:'Carteira Royal Wallet'},pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],authenticatorSelection:{authenticatorAttachment:'platform',residentKey:'required',userVerification:'required'},attestation:'none',timeout:60000,extensions:{prf:{}}}});
        active();
        if (!credential?.getClientExtensionResults()?.prf?.enabled) throw Error('Este aparelho ou gerenciador de chaves não oferece o recurso necessário. Continue usando a senha.');
        const record = {version:1,owner:uid,keyId:meta.keyId,passwordVersion:passwordVersion(meta),origin:location.origin,credentialId:b64(credential.rawId),salt:b64(random(32))};
        const key = await assertion(record, controller.signal); active();
        return {key,binding:binding(record),record};
      });
      active(); validate(uid,meta,result);
      localStorage.setItem(storageKey(uid),JSON.stringify(result));
      if (JSON.stringify(read(uid,meta)) !== JSON.stringify(result)) throw Error('Não foi possível salvar a preferência. Sua senha continua funcionando.');
      return result;
    } finally { pending.delete(controller); }
  }
  async function unlock(uid, meta, externalSignal) {
    if (!supported()) throw Error('Use a senha da carteira neste navegador.');
    const record = read(uid,meta); if (!record) throw Error('Ative o desbloqueio rápido nas Configurações após entrar com sua senha.');
    const controller = new AbortController(), abort = () => controller.abort(); pending.add(controller);
    if (externalSignal?.aborted) controller.abort(); else externalSignal?.addEventListener('abort',abort,{once:true});
    try {
      const key = await assertion(record,controller.signal);
      if (controller.signal.aborted || currentOwner() !== uid) throw Error('A sessão mudou. Abra a carteira novamente.');
      validate(uid,meta,read(uid,meta));
      const session = await WalletCrypto.unlockQuick(uid,meta,record.wrapped,key,binding(record));
      // Comprova a mesma chave contra os dados existentes antes de liberar a sessão.
      const stored = localStorage.getItem(`royalVaultData_${uid}`);
      if (stored) await session.decrypt(JSON.parse(stored),`local:royalVaultData_${uid}`);
      if (controller.signal.aborted || currentOwner() !== uid) throw Error('A sessão mudou. Abra a carteira novamente.');
      return session;
    } finally { pending.delete(controller); externalSignal?.removeEventListener('abort',abort); }
  }
  function disable(uid) { cancelPending(); localStorage.removeItem(storageKey(uid)); render(); }
  function message(error) {
    if (['AbortError','NotAllowedError'].includes(error.name)) return 'A confirmação não foi concluída. Você pode tentar novamente ou usar sua senha.';
    if (['NotSupportedError','SecurityError','InvalidStateError'].includes(error.name)) return 'Este navegador ou gerenciador de chaves não concluiu o desbloqueio rápido. Continue usando sua senha.';
    return error.message;
  }
  function render() {
    const status = document.getElementById('quickUnlockStatus'), button = document.getElementById('quickUnlockSetup'); if (!status || !button) return;
    const uid = currentOwner(), meta = uid && WalletStorage.metadata(uid), enabled = meta && available(uid,meta);
    status.textContent = enabled ? 'Ativado neste navegador. Use o botão de desbloqueio rápido ao abrir a carteira.' : 'Opcional: confirme com Face ID, digital ou bloqueio do aparelho, conforme a compatibilidade. Sua senha continua disponível.';
    button.textContent = enabled ? 'Desativar desbloqueio rápido' : 'Ativar desbloqueio rápido'; button.disabled = !WalletPrivacy.ready();
  }
  function configure() {
    const uid = currentOwner(); if (!WalletPrivacy.ready() || !uid) return;
    const meta = WalletStorage.metadata(uid);
    if (available(uid,meta)) { if (confirm('Desativar o desbloqueio rápido neste navegador? A senha e os dados serão mantidos. A chave de acesso pode continuar nos ajustes do aparelho.')) {disable(uid);showToast('Desbloqueio rápido desativado.');} return; }
    const controller = new AbortController();
    openModal('Ativar desbloqueio rápido','<p>Confirme sua senha da carteira uma vez. Depois, use a confirmação do aparelho neste navegador.</p><p>O aparelho pode pedir duas confirmações durante a ativação. A compatibilidade será verificada antes de salvar.</p><label for="quickUnlockPassword">Senha da carteira</label><input id="quickUnlockPassword" class="input-field" type="password" autocomplete="current-password"><p id="quickUnlockError" role="alert"></p>',[{label:'Cancelar',onClick:()=>{controller.abort();cancelPending();closeModal();}},{label:'Ativar',primary:true,onClick:async()=>{
      const input = document.getElementById('quickUnlockPassword'), error = document.getElementById('quickUnlockError');
      if (!input || input.disabled) return;input.disabled=true;error.textContent='Confirme no aparelho quando solicitado…';
      const password = input.value;input.value='';
      try { if (controller.signal.aborted || currentOwner()!==uid) return; await enroll(uid,meta,password);if(!controller.signal.aborted){closeModal();render();showToast('Desbloqueio rápido ativado. A senha continua disponível.');} }
      catch (failure) { if (error.isConnected) error.textContent=message(failure); }
      finally { if(input.isConnected)input.disabled=false; }
    }}]);
    document.getElementById('quickUnlockPassword').focus();
  }
  document.addEventListener('DOMContentLoaded',()=>{
    const config = document.getElementById('tab-config'); if (!config) return;
    const panel = document.createElement('div'); panel.className='panel wallet-card';panel.id='walletQuickUnlock';
    panel.innerHTML='<h3>Desbloqueio rápido</h3><p id="quickUnlockStatus"></p><p class="wallet-muted">A ativação fica neste navegador e não entra nos backups. Guarde sua senha e sua chave de recuperação. O Royal Wallet não recebe sua biometria.</p>';
    const button = document.createElement('button');button.className='btn btn-outline';button.id='quickUnlockSetup';button.onclick=configure;panel.append(button);config.append(panel);render();
    window.addEventListener('pagehide',cancelPending);
  });
  const baseRender=renderAll;renderAll=()=>{baseRender();render();};
  const baseClose=closeModal;closeModal=()=>{cancelPending();baseClose();};
  return Object.freeze({supported,available,enroll,unlock,disable,cancelPending,message});
})();
