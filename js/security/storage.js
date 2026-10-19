/* Fachada síncrona de leitura em memória; persistência cifrada e serializada. */
globalThis.WalletStorage = (() => {
  'use strict';
  const native = localStorage;
  const memory = new Map(), sessions = new Map(), tasks = new Map(), failures = new Map();
  const pending = new Set();
  const metaKey = owner => `royalVault_${owner}`;
  const queueKey = owner => `royalVaultQueue_${owner}`;
  const dataKey = uid => `royalVaultData_${uid}`;
  let owner = null;
  const isSensitive = key => key === 'royalSyncQueueV1' || key === 'royalLocalData' || key.startsWith('royalLocalData_');
  const keyOwner = key => key.startsWith('royalLocalData_') ? key.slice('royalLocalData_'.length) : owner;
  function metadata(uid) {
    const value = native.getItem(metaKey(uid));
    if (!value) return null;
    return WalletCrypto.validate(JSON.parse(value));
  }
  function requireSession(uid) {
    const session = sessions.get(uid);
    if (!session) throw Error('Desbloqueie a carteira para acessar os dados.');
    return session;
  }
  function getItem(key) {
    if (!isSensitive(key)) return native.getItem(key);
    const uid = keyOwner(key);
    if (!uid || !metadata(uid)) return native.getItem(key);
    requireSession(uid);
    return memory.get(key) ?? null;
  }
  function queueWrite(uid, key, value) {
    const session = requireSession(uid);
    const persistedKey = key.startsWith('royalLocalData_') ? dataKey(uid) : key;
    const previous = tasks.get(uid) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const envelope = await session.encrypt(value, `local:${persistedKey}`);
      // Confere antes de substituir uma versão anterior persistida.
      if (JSON.stringify(await session.decrypt(envelope, `local:${persistedKey}`)) !== JSON.stringify(value)) throw Error('Falha na verificação da cópia local.');
      native.setItem(persistedKey, JSON.stringify(envelope));
      failures.delete(persistedKey);
    });
    tasks.set(uid, task);
    pending.add(task);
    task.then(() => pending.delete(task), () => pending.delete(task));
    task.catch(error => {
      failures.set(persistedKey, error);
      if (typeof setSyncBadge === 'function') setSyncBadge('⚠️ Não salvo — mantenha o aplicativo aberto');
      console.error('Falha ao persistir carteira criptografada:', error.name);
    });
  }
  function setItem(key, text) {
    if (!isSensitive(key)) return native.setItem(key, text);
    const uid = keyOwner(key);
    if (!uid) throw Error('Desbloqueie a carteira antes de gravar dados financeiros.');
    requireSession(uid);
    if (key === 'royalSyncQueueV1') {
      const items = JSON.parse(text).filter(item => item.uid === uid);
      memory.set(key, JSON.stringify(items)); queueWrite(uid, queueKey(uid), items);
    } else {
      memory.set(key, String(text)); queueWrite(uid, key, JSON.parse(text));
    }
  }
  function removeItem(key) {
    memory.delete(key);
    if (key === 'royalSyncQueueV1' && owner) native.removeItem(queueKey(owner));
    else if (key.startsWith('royalLocalData_')) { native.removeItem(dataKey(keyOwner(key))); native.removeItem(key); }
    else native.removeItem(key);
  }
  async function flush(uid = owner) {
    // Novas edições podem entrar enquanto uma gravação está em andamento.
    for (;;) {
      const task = tasks.get(uid); if (!task) break;
      await task;
      if (tasks.get(uid) === task) break;
    }
    if (failures.size) throw failures.values().next().value;
  }
  async function unlock(uid, session) {
    if (session.owner !== uid) throw Error('A chave pertence a outra carteira.');
    const existing = metadata(uid);
    if (existing && existing.keyId !== session.metadata.keyId) throw Error('Este aparelho tem outra chave. Preserve o backup antes de trocar de carteira.');
    const key = `royalLocalData_${uid}`;
    const protectedRaw = native.getItem(dataKey(uid));
    const raw = protectedRaw || native.getItem(key);
    let local = raw ? JSON.parse(raw) : null;
    if (WalletCrypto.isEnvelope(local)) local = await session.decrypt(local, `local:${protectedRaw ? dataKey(uid) : key}`);
    const oldRaw = protectedRaw && native.getItem(key);
    if (oldRaw) {
      const oldData = JSON.parse(oldRaw);
      if (Number(oldData.updatedAt || 0) > Number(local?.updatedAt || 0)) throw Error('Uma versão antiga do aplicativo gravou alterações neste aparelho. As duas cópias foram preservadas; feche a versão antiga e recupere o backup antes de continuar.');
    }
    const queueRaw = native.getItem(queueKey(uid));
    let queue = queueRaw ? await session.decrypt(JSON.parse(queueRaw), `local:${queueKey(uid)}`) : [];
    const legacyQueue = JSON.parse(native.getItem('royalSyncQueueV1') || '[]');
    const mine = legacyQueue.filter(item => item.uid === (uid === 'device' ? null : uid));
    if (mine.length) {
      const latest = [...queue, ...mine].reduce((a, b) => !a || Number(b.data?.updatedAt || 0) > Number(a.data?.updatedAt || 0) ? b : a, null);
      queue = latest ? [latest] : [];
    }
    // Monta e verifica todas as cópias antes de alterar o armazenamento.
    const staged = [];
    for (const [name, data] of [[dataKey(uid), local], [queueKey(uid), queue]]) {
      if (data === null) continue;
      const envelope = await session.encrypt(data, `local:${name}`);
      if (JSON.stringify(await session.decrypt(envelope, `local:${name}`)) !== JSON.stringify(data)) throw Error('A migração local não foi verificada.');
      staged.push([name, JSON.stringify(envelope)]);
    }
    // As chaves só são guardadas encapsuladas pela senha e pela recuperação.
    native.setItem(metaKey(uid), JSON.stringify(session.metadata));
    for (const [name, value] of staged) native.setItem(name, value);
    if (local !== null) native.removeItem(key);
    // Só elimina cópias legadas depois de confirmar a persistência cifrada.
    const remaining = legacyQueue.filter(item => item.uid !== (uid === 'device' ? null : uid));
    if (remaining.length) native.setItem('royalSyncQueueV1', JSON.stringify(remaining)); else native.removeItem('royalSyncQueueV1');
    const legacyOwner = native.getItem('royalLegacyOwner');
    if (legacyOwner === uid || (!legacyOwner && uid === 'device')) native.removeItem('royalLocalData');
    sessions.set(uid, session); owner = uid;
    memory.set(key, local ? JSON.stringify(local) : null);
    memory.set('royalSyncQueueV1', JSON.stringify(queue));
    failures.clear();
  }
  async function lock() {
    await flush();
    memory.clear(); sessions.clear(); tasks.clear(); failures.clear(); owner = null;
  }
  function current(uid = owner) { return requireSession(uid); }
  function adoptMetadata(uid, next) {
    const session = requireSession(uid);
    if (JSON.stringify(session.metadata) === JSON.stringify(next)) return;
    const updated = session.withMetadata(next);
    native.setItem(metaKey(uid), JSON.stringify(updated.metadata));
    sessions.set(uid, updated);
  }
  return Object.freeze({ getItem, setItem, removeItem, metadata, unlock, lock, flush, current,
    adoptMetadata, ready: uid => !!sessions.get(uid), hasPending: () => pending.size > 0 || failures.size > 0 });
})();
const walletStorage = WalletStorage;
