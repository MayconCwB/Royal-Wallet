/* Criptografia nativa do navegador. Não guarda senha nem chave de dados em disco. */
globalThis.WalletCrypto = (() => {
  'use strict';
  const iterations = 600000;
  const utf8 = new TextEncoder();
  const decodeText = new TextDecoder('utf-8', { fatal: true });
  const random = size => crypto.getRandomValues(new Uint8Array(size));
  const b64 = bytes => btoa(Array.from(new Uint8Array(bytes), byte => String.fromCharCode(byte)).join(''));
  function unb64(value, length) {
    if (typeof value !== 'string' || value.length > 1500000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Error('Formato criptografado inválido.');
    const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    if (b64(bytes) !== value || (length && bytes.length !== length)) throw Error('Formato criptografado inválido.');
    return bytes;
  }
  const aes = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const context = (owner, id, kind) => utf8.encode(JSON.stringify(['royal-wallet', 1, owner, id, kind]));
  function validate(meta) {
    if (!meta || meta.version !== 1 || meta.algorithm !== 'AES-256-GCM' || meta.kdf?.name !== 'PBKDF2' ||
        meta.kdf.hash !== 'SHA-256' || meta.kdf.iterations !== iterations) throw Error('Versão de criptografia não reconhecida. Nenhum dado foi alterado.');
    unb64(meta.keyId, 16); unb64(meta.kdf.salt, 16);
    for (const wrap of [meta.password, meta.recovery]) { unb64(wrap?.iv, 12); unb64(wrap?.ciphertext, 48); }
    return meta;
  }
  async function passwordKey(password, salt) {
    const key = await crypto.subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, bytes, aad) {
    const iv = random(12);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, bytes);
    return { iv: b64(iv), ciphertext: b64(ciphertext) };
  }
  async function open(key, envelope, aad) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv, 12), additionalData: aad, tagLength: 128 }, key, unb64(envelope.ciphertext));
  }
  function recoveryBytes(text) {
    const hex = String(text).trim().replace(/^RW1-/i, '').replace(/[-\s]/g, '');
    if (!/^[0-9a-f]{64}$/i.test(hex)) throw Error('Confira os oito grupos da chave de recuperação.');
    return Uint8Array.from(hex.match(/../g), pair => parseInt(pair, 16));
  }
  function session(owner, raw, metadata) {
    if (typeof owner !== 'string' || !owner || raw.byteLength !== 32) throw Error('Carteira não identificada.');
    const keyTask = aes(raw); raw.fill(0);
    return sessionForKey(owner, keyTask, metadata);
  }
  function sessionForKey(owner, keyTask, metadata) {
    const meta = JSON.parse(JSON.stringify(metadata));
    return Object.freeze({ owner, metadata: Object.freeze(meta),
      withMetadata(next) {
        validate(next);
        if (next.keyId !== meta.keyId) throw Error('A chave da carteira mudou.');
        return sessionForKey(owner, keyTask, next);
      },
      async encrypt(value, kind = 'wallet') {
        const bytes = utf8.encode(JSON.stringify(value));
        if (bytes.byteLength > 1048576) throw Error('A carteira excedeu o limite seguro. Exporte um backup antes de continuar.');
        return { format: 'royal-wallet-e2ee', version: 1, keyId: meta.keyId,
          ...await seal(await keyTask, bytes, context(owner, meta.keyId, kind)) };
      },
      async decrypt(envelope, kind = 'wallet') {
        if (!isEnvelope(envelope) || envelope.keyId !== meta.keyId) throw Error('A carteira usa outra chave. Nenhum dado foi substituído.');
        try {
          const bytes = await open(await keyTask, envelope, context(owner, meta.keyId, kind));
          return JSON.parse(decodeText.decode(bytes));
        } catch (_) { throw Error('Não foi possível verificar os dados criptografados. Nenhum dado foi alterado.'); }
      }
    });
  }
  function requirePassword(password) {
    if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw Error('Use uma senha de carteira com pelo menos 12 caracteres.');
  }
  async function create(owner, password) {
    requirePassword(password);
    const raw = random(32), recovery = random(32), salt = random(16), keyId = b64(random(16));
    const metadata = { version: 1, algorithm: 'AES-256-GCM', keyId,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: b64(salt) },
      password: await seal(await passwordKey(password, salt), raw, context(owner, keyId, 'password')),
      recovery: await seal(await aes(recovery), raw, context(owner, keyId, 'recovery')) };
    const hex = Array.from(recovery, byte => byte.toString(16).padStart(2, '0')).join(''); recovery.fill(0);
    const recoveryKey = 'RW1-' + hex.match(/.{8}/g).join('-');
    return { session: session(owner, raw, metadata), recoveryKey };
  }
  async function unlock(owner, metadata, password) {
    validate(metadata);
    try {
      const raw = new Uint8Array(await open(await passwordKey(password, unb64(metadata.kdf.salt)), metadata.password, context(owner, metadata.keyId, 'password')));
      return session(owner, raw, metadata);
    } catch (_) { throw Error('Senha da carteira incorreta ou chave inválida. Os dados foram preservados.'); }
  }
  async function recover(owner, metadata, recoveryKey, newPassword) {
    validate(metadata); requirePassword(newPassword);
    const recovery = recoveryBytes(recoveryKey);
    let raw;
    try { raw = new Uint8Array(await open(await aes(recovery), metadata.recovery, context(owner, metadata.keyId, 'recovery'))); }
    catch (_) { throw Error('A chave de recuperação não corresponde a esta carteira.'); }
    finally { recovery.fill(0); }
    const salt = random(16);
    const updated = { ...metadata, kdf: { ...metadata.kdf, salt: b64(salt) },
      password: await seal(await passwordKey(newPassword, salt), raw, context(owner, metadata.keyId, 'password')) };
    return session(owner, raw, updated);
  }
  function isEnvelope(value) { return !!value && value.format === 'royal-wallet-e2ee' && value.version === 1; }
  return Object.freeze({ create, unlock, recover, isEnvelope, validate });
})();
