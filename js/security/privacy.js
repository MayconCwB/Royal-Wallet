/* Desbloqueio, migração e transporte. Dados financeiros só saem do aparelho cifrados. */
globalThis.WalletPrivacy = (() => {
  'use strict';
  const migration = new Set();
  let preparing = null;
  let locking = Promise.resolve();
  const owner = () => AppState.isLocal ? 'device' : AppState.user?.uid;
  function active(uid) { if (!uid || uid !== owner()) throw Error('A conta ativa mudou. Abra a carteira novamente.'); }
  function ready(uid = owner()) { return !!uid && WalletStorage.ready(uid); }
  function requestSession(uid, metadata, label = 'sua carteira') {
    return new Promise((resolve, reject) => {
      const overlay = document.createElement('div');
      overlay.className = 'vault-overlay'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-labelledby', 'vaultTitle');
      overlay.innerHTML = `<div class="vault-dialog"><h2 id="vaultTitle">${metadata ? 'Desbloqueie sua carteira' : 'Proteja sua carteira'}</h2>
        <p id="vaultLabel"></p><p>${metadata ? 'A senha da carteira é diferente da senha de login do Firebase.' : 'Crie uma senha com pelo menos 12 caracteres. Ela protege os dados financeiros neste aparelho, na nuvem e nos backups.'}</p>
        <form id="vaultForm">
          ${metadata ? '<label class="vault-check"><input type="checkbox" id="vaultRecover"> Usar chave de recuperação</label>' : ''}
          <div id="vaultRecoveryInput" hidden><label for="vaultRecovery">Chave de recuperação</label><input id="vaultRecovery" type="password" class="input-field" autocomplete="off"></div>
          <label for="vaultPassword" id="vaultPasswordLabel">${metadata ? 'Senha da carteira' : 'Nova senha da carteira'}</label>
          <input id="vaultPassword" type="password" class="input-field" autocomplete="${metadata ? 'current-password' : 'new-password'}" required>
          <div id="vaultConfirmBox" ${metadata ? 'hidden' : ''}><label for="vaultConfirm">Confirme a nova senha</label><input id="vaultConfirm" type="password" class="input-field" autocomplete="new-password"></div>
          <button class="btn btn-primary" type="submit">${metadata ? 'Desbloquear' : 'Criar proteção'}</button>
        </form>
        <div id="vaultRecoverySave" hidden><h3>Guarde sua chave de recuperação</h3><p>Guarde fora deste aparelho. Quem possui esta chave pode abrir a carteira. Não envie ao suporte.</p>
          <label for="vaultRecoveryOutput">Sua chave</label><textarea id="vaultRecoveryOutput" class="input-field" readonly rows="4"></textarea>
          <button type="button" class="btn btn-outline" id="vaultDownloadRecovery">Baixar minha chave</button>
          <label class="vault-check"><input type="checkbox" id="vaultRecoverySaved"> Guardei a chave em um lugar seguro.</label>
          <button type="button" class="btn btn-primary" id="vaultContinue" disabled>Continuar com a carteira protegida</button>
        </div>
        <p id="vaultError" role="alert"></p><button type="button" class="btn btn-outline" id="vaultCancel">Voltar</button></div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#vaultLabel').textContent = label;
      const $ = id => overlay.querySelector('#' + id);
      let pending = null, busy = false;
      const finish = value => {
        for (const input of overlay.querySelectorAll('input,textarea')) input.value = '';
        pending = null; overlay.remove(); resolve(value);
      };
      const cancel = () => {
        if (busy) return;
        pending = null; overlay.remove(); const error = Error('Desbloqueio cancelado. Os dados foram preservados.'); error.code = 'VAULT_CANCELLED'; reject(error);
      };
      $('vaultCancel').onclick = cancel;
      if (metadata) $('vaultRecover').onchange = () => {
        const recovery = $('vaultRecover').checked;
        $('vaultRecoveryInput').hidden = !recovery; $('vaultConfirmBox').hidden = !recovery;
        $('vaultPasswordLabel').textContent = recovery ? 'Nova senha da carteira' : 'Senha da carteira';
        $('vaultPassword').autocomplete = recovery ? 'new-password' : 'current-password';
      };
      $('vaultForm').onsubmit = async event => {
        event.preventDefault(); if (busy) return;
        busy = true; const button = overlay.querySelector('button[type="submit"]'); button.disabled = true;
        $('vaultError').textContent = 'Verificando proteção...';
        try {
          const password = $('vaultPassword').value, recovery = !!$('vaultRecover')?.checked;
          if ((!metadata || recovery) && password !== $('vaultConfirm').value) throw Error('As senhas não coincidem.');
          if (!metadata) {
            pending = await WalletCrypto.create(uid, password);
            $('vaultPassword').value = ''; $('vaultConfirm').value = ''; $('vaultForm').hidden = true;
            $('vaultRecoverySave').hidden = false; $('vaultRecoveryOutput').value = pending.recoveryKey;
            $('vaultRecoverySaved').onchange = () => { $('vaultContinue').disabled = !$('vaultRecoverySaved').checked; };
            $('vaultContinue').onclick = () => { if ($('vaultRecoverySaved').checked) finish({ session: pending.session, changed: true }); };
            $('vaultDownloadRecovery').onclick = () => download('royal-wallet-chave-recuperacao.txt', 'Royal Wallet — chave de recuperação\nGuarde em local seguro. Não compartilhe.\n\n' + pending.recoveryKey + '\n', 'text/plain;charset=utf-8');
          } else {
            const session = recovery ? await WalletCrypto.recover(uid, metadata, $('vaultRecovery').value, password) : await WalletCrypto.unlock(uid, metadata, password);
            finish({ session, changed: recovery });
          }
          $('vaultError').textContent = '';
        } catch (error) { $('vaultError').textContent = error.message; }
        finally { busy = false; button.disabled = false; }
      };
      $('vaultPassword').focus();
    });
  }
  async function prepare(user = AppState.user) {
    await locking;
    const uid = AppState.isLocal ? 'device' : user?.uid;
    active(uid);
    if (ready(uid)) return;
    if (preparing) return preparing;
    const task = (async () => {
      if (!globalThis.crypto?.subtle) throw Error('A criptografia exige HTTPS ou localhost e um navegador atualizado.');
      let meta = WalletStorage.metadata(uid), remoteMeta = null, legacyCloud = false;
      if (uid !== 'device' && navigator.onLine) {
        try {
          const response = await fbFetch(`${FS_URL}/${encodeURIComponent(uid)}`, { headers: { Authorization: `Bearer ${user.idToken}` } });
          if (!response.ok && response.status !== 404) throw Error('Não foi possível verificar a proteção da carteira na nuvem.');
          if (response.ok) {
            const fields = response.data?.fields || {};
            if (fields.v?.stringValue === 'e2ee-1') remoteMeta = WalletCrypto.validate(fromFsValue(fields.encryption));
            else {
              if (walletStorage.getItem(`royalE2eeActivated_${uid}`) === '1') throw Error('A proteção criptográfica da nuvem mudou. Os dados locais foram preservados.');
              legacyCloud = true;
            }
          }
        } catch (error) { if (error.code !== 'NETWORK_UNAVAILABLE' || !meta) throw error; }
      } else if (uid !== 'device' && !meta) throw Error('Conecte-se à internet para ativar a proteção pela primeira vez. Depois será possível abrir offline.');
      if (remoteMeta && meta && remoteMeta.keyId !== meta.keyId) throw Error('A nuvem e este aparelho possuem chaves diferentes. Preserve o backup local antes de continuar.');
      const pendingMetadata = walletStorage.getItem(`royalVaultMetadataPending_${uid}`) === '1';
      const result = await requestSession(uid, pendingMetadata ? meta : remoteMeta || meta, uid === 'device' ? 'Carteira local deste aparelho' : user.email || 'Sua conta');
      active(uid);
      await WalletStorage.unlock(uid, result.session);
      if (uid !== 'device' && (legacyCloud || result.changed || pendingMetadata)) {
        migration.add(uid); walletStorage.setItem(`royalVaultMetadataPending_${uid}`, '1');
      }
    })();
    preparing = task;
    try { await task; } finally { if (preparing === task) preparing = null; }
  }
  async function encodeCloud(uid, data) {
    active(uid);
    const session = WalletStorage.current(uid);
    if (new TextEncoder().encode(JSON.stringify(data)).byteLength > 700000) throw Error('A carteira ultrapassou o limite de sincronização. Exporte um backup antes de continuar.');
    return { v: toFsValue('e2ee-1'), atualizadoEm: toFsValue(Number(data.updatedAt) || 0),
      encryption: toFsValue(session.metadata), payload: toFsValue(await session.encrypt(data, 'cloud-wallet')) };
  }
  async function decodeCloud(uid, fields) {
    active(uid);
    const metadata = WalletCrypto.validate(fromFsValue(fields.encryption));
    const session = WalletStorage.current(uid);
    if (metadata.keyId !== session.metadata.keyId) throw Error('A chave da nuvem mudou. Desbloqueie a carteira novamente antes de sincronizar.');
    const data = await session.decrypt(fromFsValue(fields.payload), 'cloud-wallet');
    if (Number(data.updatedAt) !== Number(fromFsValue(fields.atualizadoEm))) throw Error('A versão da carteira não passou na verificação.');
    // Um aparelho já aberto deve preservar a nova senha recuperada em outro.
    if (walletStorage.getItem(`royalVaultMetadataPending_${uid}`) !== '1') WalletStorage.adoptMetadata(uid, metadata);
    return data;
  }
  function download(name, content, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportBackup(data) {
    const session = WalletStorage.current(owner());
    const backup = { format: 'royal-wallet-encrypted-backup', version: 1, owner: session.owner,
      encryption: session.metadata, payload: await session.encrypt(data, 'backup') };
    download('royal-wallet-backup-criptografado.json', JSON.stringify(backup));
  }
  async function importBackup(backup) {
    if (backup.format !== 'royal-wallet-encrypted-backup' || backup.version !== 1 || typeof backup.owner !== 'string') throw Error('Backup criptografado inválido.');
    WalletCrypto.validate(backup.encryption);
    let session;
    if (ready() && WalletStorage.current().metadata.keyId === backup.encryption.keyId && owner() === backup.owner) session = WalletStorage.current();
    else session = (await requestSession(backup.owner, backup.encryption, 'Desbloqueio do arquivo de backup')).session;
    return session.decrypt(backup.payload, 'backup');
  }
  async function lock() {
    stopRealtimeSync();
    if (AppState.saveQueueTimeout) clearTimeout(AppState.saveQueueTimeout);
    await Promise.allSettled([...saveTasks.values()]); await WalletStorage.lock();
    clearWalletView();
    document.getElementById('loginOverlay').style.display = 'flex';
    await prepare();
    const raw = walletStorage.getItem(localDataKey());
    AppState.data = raw ? normalizeDataStructure(JSON.parse(raw), 'carteira desbloqueada') : emptyWallet();
    enterApp();
  }
  function endSession() {
    locking = locking.catch(() => {}).then(() => WalletStorage.lock());
    locking.catch(() => {
      setSyncBadge('⚠️ Há alterações não salvas. Mantenha o aplicativo aberto.');
      alert('Não foi possível concluir a gravação criptografada. Mantenha o aplicativo aberto para preservar as alterações.');
    });
  }
  document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('beforeunload', event => {
      if (WalletStorage.hasPending()) { event.preventDefault(); event.returnValue = ''; }
    });
    const config = document.getElementById('tab-config');
    if (!config) return;
    const panel = document.createElement('div'); panel.className = 'panel wallet-card';
    panel.innerHTML = '<h3>🔐 Proteção da carteira</h3><p>Dados financeiros protegidos com criptografia ponta a ponta. A senha da carteira e a chave de recuperação não são enviadas ao Firebase.</p><p>E-mail, sessão de login e horários de sincronização continuam sendo usados para autenticação e funcionamento do serviço.</p>';
    const button = document.createElement('button'); button.className = 'btn btn-outline'; button.textContent = 'Bloquear carteira';
    button.onclick = () => lock().catch(error => { if (error.code !== 'VAULT_CANCELLED') alert(error.message); });
    panel.appendChild(button); config.appendChild(panel);
  });
  return Object.freeze({ prepare, ready, lock, endSession, requestSession, encodeCloud, decodeCloud, exportBackup, importBackup,
    needsMigration: uid => migration.has(uid), cloudSaved: uid => {
      migration.delete(uid); walletStorage.removeItem(`royalVaultMetadataPending_${uid}`); walletStorage.setItem(`royalE2eeActivated_${uid}`, '1');
    } });
})();
