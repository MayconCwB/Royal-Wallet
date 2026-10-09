const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
for (const script of scripts) new vm.Script(script);
new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'));

function setup() {
  const storage = new Map();
  const elements = new Map();
  const context = vm.createContext({
    console, navigator: { onLine: true }, setTimeout, clearTimeout, AbortController,
    window: {}, document: {
      addEventListener() {},
      getElementById(id) {
        if (!elements.has(id)) {
          const classes = new Set();
          elements.set(id, { textContent: '', style: {}, classList: {
            add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value)
          } });
        }
        return elements.get(id);
      }
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    fetch: () => { throw new Error('Rede real proibida nos testes'); }
  });
  vm.runInContext(scripts.find(s => s.includes('const AppState')), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'royal-wallet-features.js'), 'utf8'), context);
  vm.runInContext(`
    renderAll = () => {};
    logEvent = () => {};
    showToast = () => {};
    openModal = (title, body, buttons) => { globalThis.modal = { title, body, buttons }; };
    globalThis.api = { AppState, emptyWallet, localDataKey, readLocalWallet, migrateLegacyStorage,
      queueOfflineSnapshot, readOfflineQueue, mcSaveDoc, mcLoadDoc, mcDeleteAccount,
      syncCloudOnLogin, syncPendingCloud, triggerAutoSave, logout, closeModal,
      parseCsvDate, csvToRows, prepareCsvImport, normalizeDataStructure, toFsValue, fbFetch,
      startRealtimeSync, stopRealtimeSync, processRealtimeChange, enterApp };
  `, context);
  const api = context.api;
  api.AppState.user = { uid: 'A', idToken: 'token-A', refreshToken: 'refresh-A' };
  api.AppState.isLocal = false;
  const wallet = (ts, desc = 'Compra') => ({ ...api.emptyWallet(), updatedAt: ts,
    movimentos: [{ id: 'm1', tipo: 'despesa', data: '2026-10-08', desc, valor: 10, cat: 'Outros' }] });
  const local = data => storage.set(api.localDataKey(), JSON.stringify(data));
  const cloudResponse = (data, version = 'version-1') => ({ ok: true, status: 200, data: {
    updateTime: version, fields: {
      v: { stringValue: '2' }, atualizadoEm: { integerValue: String(data.updatedAt) },
      movimentos: api.toFsValue(data.movimentos)
    }
  } });
  const mock = handler => { context.handler = handler; vm.runInContext('fbFetch = (...args) => handler(...args)', context); };
  return { context, api, storage, elements, wallet, local, cloudResponse, mock };
}

const cases = [];
const test = (name, run) => cases.push([name, run]);
const tick = () => new Promise(resolve => setImmediate(resolve));

function realtimeHarness(env, sdkUser = 'A') {
  const { context } = env;
  const listeners = [];
  const timers = new Map();
  let timerId = 0;
  context.setTimeout = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
  context.clearTimeout = id => timers.delete(id);
  const sdk = {
    auth: { currentUser: sdkUser ? { uid: sdkUser } : null }, db: {},
    doc: (_, collection, uid) => ({ collection, uid }),
    onSnapshot: (ref, options, next, error) => {
      const listener = { ref, options, next, error, active: true };
      listeners.push(listener);
      return () => { listener.active = false; };
    },
    signInWithEmailAndPassword: async (auth, email, password) => {
      assert.equal(password, 'test-password');
      auth.currentUser = { uid: email === 'b@example.com' ? 'B' : 'A' };
    },
    signOut: async auth => { auth.currentUser = null; }
  };
  context.testSdk = sdk;
  vm.runInContext('realtimeSdkTask = Promise.resolve(testSdk); loadRealtimeSdk = () => realtimeSdkTask;', context);
  const emit = (data, metadata = {}) => listeners.at(-1).next({
    exists: () => data !== null, data: () => data,
    metadata: { fromCache: false, hasPendingWrites: false, ...metadata }
  });
  const flush = async () => {
    const entry = [...timers].find(([, item]) => item.delay === 100);
    if (entry) { timers.delete(entry[0]); entry[1].callback(); await tick(); }
  };
  return { listeners, timers, sdk, emit, flush };
}

test('Scripts JavaScript válidos', () => assert(scripts.length >= 2));
test('Armazenamento isolado por conta e modo local', () => {
  const { api, local, wallet, storage } = setup();
  local(wallet(100));
  api.AppState.user.uid = 'B';
  assert.equal(api.readLocalWallet(), null);
  api.AppState.isLocal = true;
  assert.equal(api.readLocalWallet(), null);
  assert(storage.has('royalLocalData_A'));
});
test('Migração antiga com dono conhecido preserva a cópia', () => {
  const { api, storage, wallet } = setup();
  storage.set('royalLocalData', JSON.stringify(wallet(100)));
  storage.set('royalToken', JSON.stringify({ uid: 'A' }));
  api.migrateLegacyStorage();
  assert(storage.has('royalLocalData_A'));
  assert(storage.has('royalLocalData'));
  assert.equal(storage.get('royalLegacyOwner'), 'A');
});
test('Migração sem sessão fica apenas no modo local', () => {
  const { api, storage, wallet } = setup();
  storage.set('royalLocalData', JSON.stringify(wallet(100)));
  api.migrateLegacyStorage();
  assert(storage.has('royalLocalData_device'));
  assert.equal(api.readLocalWallet('A'), null);
});
test('Conta nova não herda dados de outra conta', async () => {
  const { api, local, wallet, mock, storage } = setup();
  local(wallet(100, 'Conta A'));
  api.AppState.user.uid = 'B';
  let saved;
  mock(async (_, opts = {}) => {
    if (opts.method !== 'PATCH') return { ok: false, status: 404, data: {} };
    saved = JSON.parse(opts.body);
    return { ok: true, status: 200, data: { updateTime: 'created' } };
  });
  assert.equal(await api.syncCloudOnLogin(), true);
  assert.equal(saved.fields.movimentos.arrayValue.values.length, 0);
  assert(storage.has('royalLocalData_A'));
});
test('Fila antiga com dono conhecido é recuperada mesmo sem cópia local', async () => {
  const { api, wallet, mock, cloudResponse, storage } = setup();
  storage.set('royalCloudVersion_A', 'version-1');
  api.queueOfflineSnapshot(wallet(200, 'Compra offline'));
  mock(async (_, opts = {}) => opts.method === 'PATCH'
    ? { ok: true, status: 200, data: { updateTime: 'version-2' } }
    : cloudResponse(wallet(100)));
  assert.equal(await api.syncPendingCloud(), true);
  assert.equal(api.AppState.data.movimentos[0].desc, 'Compra offline');
  assert.equal(api.readLocalWallet().updatedAt, 200);
});
test('Falhas HTTP de leitura não causam gravação', async () => {
  for (const status of [401, 403, 429, 500]) {
    const { api, local, wallet, mock } = setup();
    local(wallet(200));
    let writes = 0;
    mock(async (_, opts = {}) => {
      if (opts.method === 'PATCH') writes++;
      if (String(_).includes('securetoken')) throw new Error('refresh indisponível');
      return { ok: false, status, data: {} };
    });
    await assert.rejects(api.syncCloudOnLogin());
    assert.equal(writes, 0);
    assert.equal(api.readLocalWallet().updatedAt, 200);
  }
});
test('Conflito entre aparelhos exige escolha antes de gravar', async () => {
  const { api, local, wallet, mock, cloudResponse, context, storage } = setup();
  local(wallet(200));
  storage.set('royalCloudAck_A', '100');
  storage.set('royalCloudVersion_A', 'old-version');
  api.queueOfflineSnapshot(wallet(200));
  let writes = 0;
  mock(async (_, opts = {}) => { if (opts.method === 'PATCH') writes++; return cloudResponse(wallet(300, 'Outro aparelho'), 'new-version'); });
  const syncing = api.syncCloudOnLogin();
  await tick();
  assert(context.modal);
  assert.equal(writes, 0);
  context.modal.buttons[1].onClick();
  assert.equal(await syncing, true);
  assert.equal(api.AppState.data.movimentos[0].desc, 'Outro aparelho');
  assert.equal(api.readOfflineQueue().length, 0);
});
test('Fechar conflito libera sincronização e mantém pendências', async () => {
  const { api, local, wallet, mock, cloudResponse, context } = setup();
  local(wallet(200)); api.queueOfflineSnapshot(wallet(200));
  mock(async () => cloudResponse(wallet(300)));
  const syncing = api.syncCloudOnLogin();
  await tick();
  assert(context.modal);
  api.closeModal();
  assert.equal(await syncing, false);
  assert.equal(api.readOfflineQueue().length, 1);
});
test('Escolha da versão local usa a versão remota mostrada no conflito', async () => {
  const { api, local, wallet, mock, cloudResponse, context } = setup();
  local(wallet(200)); api.queueOfflineSnapshot(wallet(200));
  let savedUrl;
  mock(async (url, opts = {}) => {
    if (opts.method !== 'PATCH') return cloudResponse(wallet(300), 'remote-version');
    savedUrl = url;
    return { ok: true, status: 200, data: { updateTime: 'chosen-local-version' } };
  });
  const syncing = api.syncCloudOnLogin();
  await tick();
  await context.modal.buttons[2].onClick();
  assert.equal(await syncing, true);
  assert(savedUrl.includes('currentDocument.updateTime=remote-version'));
  assert.equal(api.readOfflineQueue().length, 0);
  assert.equal(api.AppState.data.updatedAt, 200);
});
test('Envio offline usa versão do servidor como precondição', async () => {
  const { api, local, wallet, mock, cloudResponse, storage } = setup();
  local(wallet(200)); api.queueOfflineSnapshot(wallet(200));
  storage.set('royalCloudAck_A', '100'); storage.set('royalCloudVersion_A', 'version-1');
  let savedUrl;
  mock(async (url, opts = {}) => {
    if (opts.method !== 'PATCH') return cloudResponse(wallet(100));
    savedUrl = url;
    return { ok: true, status: 200, data: { updateTime: 'version-2' } };
  });
  assert.equal(await api.syncPendingCloud(), true);
  assert(savedUrl.includes('currentDocument.updateTime=version-1'));
  assert.equal(storage.get('royalCloudVersion_A'), 'version-2');
  assert.equal(api.readOfflineQueue().length, 0);
});
test('Mudança da nuvem durante envio preserva dados pendentes', async () => {
  const { api, local, wallet, mock, cloudResponse, storage } = setup();
  local(wallet(200)); api.queueOfflineSnapshot(wallet(200));
  storage.set('royalCloudVersion_A', 'version-1');
  mock(async (_, opts = {}) => opts.method === 'PATCH' ? { ok: false, status: 400, data: {} } : cloudResponse(wallet(100)));
  assert.equal(await api.syncPendingCloud(), false);
  assert.equal(api.readOfflineQueue()[0].data.updatedAt, 200);
});
test('Resposta antiga não sobrescreve alterações locais mais novas', async () => {
  const { api, local, wallet, mock, storage } = setup();
  local(wallet(200));
  let release;
  mock(async () => new Promise(resolve => { release = resolve; }));
  const sending = api.mcSaveDoc('A', 'token-A', wallet(200), { cloud: null });
  await tick();
  local(wallet(300)); api.queueOfflineSnapshot(wallet(300));
  release({ ok: true, status: 200, data: { updateTime: 'version-2' } });
  await sending;
  assert.equal(api.readLocalWallet().updatedAt, 300);
  assert.equal(api.readOfflineQueue()[0].data.updatedAt, 300);
  assert.equal(storage.get('royalCloudAck_A'), '200');
});
test('Edição durante sincronização agenda envio do estado mais novo', async () => {
  const { api, local, wallet, mock, cloudResponse, context, storage } = setup();
  local(wallet(200)); api.queueOfflineSnapshot(wallet(200));
  storage.set('royalCloudVersion_A', 'version-1');
  const scheduled = [];
  context.setTimeout = (callback, delay) => { scheduled.push({ callback, delay }); return 1; };
  let release;
  mock(async (_, opts = {}) => {
    if (opts.method !== 'PATCH') return cloudResponse(wallet(100));
    return new Promise(resolve => { release = resolve; });
  });
  const sending = api.syncPendingCloud();
  await tick();
  local(wallet(300)); api.queueOfflineSnapshot(wallet(300));
  release({ ok: true, status: 200, data: { updateTime: 'version-2' } });
  assert.equal(await sending, true);
  assert(scheduled.some(item => item.delay === 700));
  assert.equal(api.readOfflineQueue()[0].data.updatedAt, 300);
});
test('Falha antiga não substitui fila mais recente', () => {
  const { api, wallet } = setup();
  api.queueOfflineSnapshot(wallet(300)); api.queueOfflineSnapshot(wallet(200));
  assert.equal(api.readOfflineQueue()[0].data.updatedAt, 300);
});
test('Sair mantém backup da conta e limpa estado exibido', () => {
  const { api, local, wallet, storage } = setup();
  api.AppState.data = wallet(100); local(api.AppState.data);
  api.logout();
  assert.equal(api.AppState.user, null);
  assert.equal(api.AppState.data.movimentos.length, 0);
  assert(storage.has('royalLocalData_A'));
});
test('Exclusão apaga carteira antes da autenticação', async () => {
  const { api, mock } = setup();
  const calls = [];
  mock(async (url, opts = {}) => {
    calls.push([url, opts.method]);
    if (url.includes('lookup')) return { ok: true, status: 200, data: { users: [{ localId: 'A' }] } };
    return { ok: true, status: 200, data: {} };
  });
  await api.mcDeleteAccount('token-A', 'A');
  assert.equal(calls[1][1], 'DELETE');
  assert(calls[2][0].includes('delete?'));
});
test('Falha ao apagar carteira mantém autenticação', async () => {
  const { api, mock } = setup();
  let authDelete = false;
  mock(async url => {
    if (url.includes('lookup')) return { ok: true, status: 200, data: { users: [{ localId: 'A' }] } };
    if (url.includes('delete?')) authDelete = true;
    return { ok: false, status: 403, data: {} };
  });
  await assert.rejects(api.mcDeleteAccount('token-A', 'A'));
  assert.equal(authDelete, false);
});
test('CSV rejeita datas impossíveis e aceita ano bissexto', () => {
  const { api } = setup();
  for (const value of ['31/02/2026', '29/02/2026', '2026-13-01', '2026-10-08lixo']) assert.equal(api.parseCsvDate(value), '');
  assert.equal(api.parseCsvDate('29/02/2024'), '2024-02-29');
  assert.equal(api.parseCsvDate('2026-10-08T23:00:00-03:00'), '2026-10-08');
});
test('CSV preserva duas compras iguais e não duplica reimportação', () => {
  const { api } = setup();
  const csv = 'Data;Descrição;Valor\n08/10/2026;Mercado;-10,00\n08/10/2026;Mercado;-10,00';
  api.AppState.data = api.emptyWallet();
  const first = api.prepareCsvImport(csv);
  assert.equal(first.items.length, 2);
  api.AppState.data.movimentos.push(...first.items);
  assert.equal(api.prepareCsvImport(csv).items.length, 0);
  api.AppState.data.movimentos.pop();
  assert.equal(api.prepareCsvImport(csv).items.length, 1);
});
test('CSV suporta descrição multilinha e aspas escapadas', () => {
  const { api } = setup();
  const parsed = api.csvToRows('Data;Descrição;Valor\n08/10/2026;"Compra\nLoja ""ABC""";-10,00');
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0][1], 'Compra\nLoja "ABC"');
  assert.throws(() => api.csvToRows('Data;Descrição;Valor\n08/10/2026;"Compra;-10'));
});

test('Dados locais antigos em formato v1 continuam legíveis', () => {
  const { api, storage, wallet } = setup();
  storage.set('royalLocalData_A', JSON.stringify({ dados: JSON.stringify(wallet(200)) }));
  assert.equal(api.readLocalWallet().movimentos.length, 1);
  assert.equal(api.readLocalWallet().updatedAt, 200);
});
test('Nuvem inválida e armazenamento corrompido não viram carteira vazia', async () => {
  const { api, storage, mock } = setup();
  storage.set('royalLocalData_A', '{invalid');
  assert.throws(() => api.readLocalWallet());
  mock(async () => ({ ok: true, status: 200, data: { fields: { dados: { stringValue: '{invalid' } } } }));
  await assert.rejects(api.mcLoadDoc('A', 'token-A'));
  assert.equal(storage.get('royalLocalData_A'), '{invalid');
});
test('Exclusão parcial bloqueia recriação automática da carteira', async () => {
  const { api, local, wallet, storage, mock } = setup();
  local(wallet(200));
  mock(async (url, opts = {}) => {
    if (url.includes('lookup')) return { ok: true, status: 200, data: { users: [{ localId: 'A' }] } };
    if (opts.method === 'DELETE') return { ok: true, status: 200, data: {} };
    return { ok: false, status: 400, data: {} };
  });
  await assert.rejects(api.mcDeleteAccount('token-A', 'A'));
  assert.equal(storage.get('royalDeletionPending_A'), '1');
  let requests = 0;
  mock(async () => { requests++; throw new Error('Não deveria enviar'); });
  assert.equal(await api.syncPendingCloud(), false);
  assert.equal(requests, 0);
  assert.equal(api.AppState.data.movimentos.length, 1);
});
test('Service Worker remove apenas caches próprios e preserva HTML em caso de erro HTTP', async () => {
  const handlers = {};
  const removed = [];
  let stored = 0;
  const context = vm.createContext({
    URL, setTimeout, clearTimeout, Response,
    self: { addEventListener: (name, handler) => { handlers[name] = handler; },
      clients: { claim: async () => {} }, location: { origin: 'https://wallet.example' } },
      caches: { keys: async () => ['royal-wallet-shell-v1', 'royal-wallet-shell-v5', 'other-app'], match: async () => undefined,
      delete: async key => removed.push(key), open: async () => ({ put: async () => stored++ }) },
    fetch: async () => ({ ok: false, status: 503 })
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), context);
  let activation;
  handlers.activate({ waitUntil: task => { activation = task; } });
  await activation;
  assert.deepEqual(removed, ['royal-wallet-shell-v1']);
  let response;
  handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://wallet.example/' },
    respondWith: task => { response = task; }, waitUntil() {} });
  assert.equal((await response).status, 503);
  assert.equal(stored, 0);
});

test('Abertura offline usa HTML local quando a rede falha, trava ou retorna erro', async () => {
  for (const mode of ['rejected', 'hung', 'http-error']) {
    const handlers = {}; const cached = { ok: true, marker: 'cached-app' }; const background = [];
    const context = vm.createContext({ URL, Response,
      setTimeout: callback => setTimeout(callback, 0), clearTimeout,
      self: { addEventListener: (name, callback) => { handlers[name] = callback; }, location: { origin: 'https://wallet.example' } },
      caches: { match: async () => cached, open: async () => ({ put: async () => { throw Error('Não guardar resposta de erro'); } }) },
      fetch: () => mode === 'hung' ? new Promise(() => {}) : mode === 'rejected' ? Promise.reject(new Error('offline')) : Promise.resolve({ ok: false, status: 503 })
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), context);
    let response;
    handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://wallet.example/index.html' },
      respondWith: task => { response = task; }, waitUntil: task => background.push(task) });
    assert.equal((await response).marker, 'cached-app', mode);
    if (mode !== 'hung') await Promise.all(background);
  }
});
test('Falha de rede é distinguida de rejeição HTTP mesmo com indicador online', async () => {
  const { api, context } = setup();
  vm.runInContext('fetch = async () => { throw new TypeError("Failed to fetch"); };', context);
  await assert.rejects(api.fbFetch('https://wallet.example'), error => error.code === 'NETWORK_UNAVAILABLE');
  context.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'expired' }) });
  assert.equal((await api.fbFetch('https://wallet.example')).status, 401);
});

test('Listener aplica atualização remota enquanto a carteira está aberta', async () => {
  const env = setup();
  const { api, wallet, local, storage, mock, cloudResponse } = env;
  local(wallet(100)); storage.set('royalCloudAck_A', '100'); storage.set('royalCloudVersion_A', 'version-1');
  let reads = 0;
  mock(async () => { reads++; return cloudResponse(wallet(200, 'Outro aparelho'), 'version-2'); });
  const live = realtimeHarness(env);
  await api.startRealtimeSync();
  assert.equal(live.listeners.length, 1);
  assert.equal(live.listeners[0].ref.uid, 'A');
  live.emit({ atualizadoEm: 200 }); await live.flush();
  assert.equal(reads, 1);
  assert.equal(api.AppState.data.movimentos[0].desc, 'Outro aparelho');
  assert.equal(storage.get('royalCloudVersion_A'), 'version-2');
  live.emit({ atualizadoEm: 200 }); await live.flush();
  assert.equal(reads, 1);
});
test('Listener ignora cache e escrita ainda não confirmada', async () => {
  const env = setup(); const live = realtimeHarness(env);
  await env.api.startRealtimeSync();
  live.emit({ atualizadoEm: 200 }, { fromCache: true });
  live.emit({ atualizadoEm: 200 }, { hasPendingWrites: true });
  assert.equal(live.timers.size, 0);
});
test('Listener preserva alteração local e mostra conflito com mudança remota', async () => {
  const env = setup();
  const { api, wallet, local, storage, mock, cloudResponse, context } = env;
  local(wallet(200, 'Local')); api.queueOfflineSnapshot(wallet(200, 'Local'));
  storage.set('royalCloudVersion_A', 'version-1');
  let writes = 0;
  mock(async (_, options = {}) => { if (options.method === 'PATCH') writes++; return cloudResponse(wallet(300), 'version-2'); });
  const live = realtimeHarness(env); await api.startRealtimeSync();
  live.emit({ atualizadoEm: 300 }); await live.flush();
  assert(context.modal);
  assert.equal(api.AppState.data.movimentos[0].desc, 'Local');
  assert.equal(writes, 0);
  context.modal.buttons[0].onClick(); await tick();
  assert.equal(api.readOfflineQueue().length, 1);
  context.modal = null;
  await api.syncPendingCloud({ background: true });
  assert.equal(context.modal, null);
});
test('Formulário aberto adia atualização sem interromper preenchimento', async () => {
  const env = setup(); const live = realtimeHarness(env);
  let reads = 0; env.mock(async () => { reads++; throw new Error('Não deve ler ainda'); });
  await env.api.startRealtimeSync();
  env.context.document.getElementById('genericModalBackdrop').classList.add('active');
  live.emit({ atualizadoEm: 200 }); await live.flush();
  assert.equal(reads, 0);
  assert([...live.timers.values()].some(item => item.delay === 1000));
});
test('Reinício e saída encerram listeners e ignoram eventos antigos', async () => {
  const env = setup(); const live = realtimeHarness(env);
  await env.api.startRealtimeSync();
  const old = live.listeners[0];
  await env.api.startRealtimeSync();
  assert.equal(old.active, false);
  assert.equal(live.listeners.filter(item => item.active).length, 1);
  env.api.logout(); await tick();
  assert.equal(live.listeners.filter(item => item.active).length, 0);
  old.next({ exists: () => true, data: () => ({ atualizadoEm: 400 }), metadata: {} });
  assert.equal(live.timers.size, 0);
  assert.equal(live.sdk.auth.currentUser, null);
});
test('Modo local e offline não abrem listener', async () => {
  const env = setup(); const live = realtimeHarness(env);
  env.api.AppState.isLocal = true; await env.api.startRealtimeSync();
  env.api.AppState.isLocal = false; env.context.navigator.onLine = false;
  await env.api.startRealtimeSync();
  assert.equal(live.listeners.length, 0);
});
test('Sessão antiga usa atualização de 15 segundos; novo login ativa listener', async () => {
  const env = setup(); const live = realtimeHarness(env, null);
  await env.api.startRealtimeSync();
  assert.equal(live.listeners.length, 0);
  assert([...live.timers.values()].some(item => item.delay === 15000));
  await env.api.startRealtimeSync({ email: 'a@example.com', password: 'test-password' });
  assert.equal(live.listeners.length, 1);
  assert.equal(live.timers.size, 0);
});
test('Carteira removida em outro aparelho não é recriada pelo listener', async () => {
  const env = setup(); const live = realtimeHarness(env);
  const { api, wallet, local, storage, mock } = env;
  local(wallet(100)); storage.set('royalCloudAck_A', '100'); storage.set('royalCloudVersion_A', 'version-1');
  let writes = 0;
  mock(async (_, opts = {}) => { if (opts.method === 'PATCH') writes++; return { ok: false, status: 404, data: {} }; });
  await api.startRealtimeSync(); live.emit(null); await live.flush();
  assert.equal(writes, 0);
  assert.equal(api.readLocalWallet().updatedAt, 100);
});

test('Cartão separa compra, pagamento e saldo sem duplicar gastos', () => {
  const { api, context } = setup(); const f = context.window.WalletFeatures;
  api.AppState.data = { ...api.emptyWallet(), contas: [{ id: 'bank', nome: 'Banco', saldoInicial: 1000 }],
    cartoes: [{ id: 'card', nome: 'Cartão', fechamento: 20, vencimento: 10 }],
    movimentos: [{ id: 'purchase', tipo: 'despesa', cartaoId: 'card', faturaMes: '2026-10', data: '2026-10-01', valor: 200 }] };
  assert.equal(f.accountBalance('bank'), 1000);
  assert.equal(f.invoices()[0].restante, 200);
  f.payInvoice('card', '2026-10', 'bank', 75.25, '2026-10-08');
  assert.equal(f.accountBalance('bank'), 924.75);
  assert.equal(f.invoices()[0].restante, 124.75);
  assert.equal(f.summaryInsights(new Date(2026, 9, 8)).monthCosts, 200);
  assert.throws(() => f.payInvoice('card', '2026-10', 'bank', 125, '2026-10-08'));
  assert.throws(() => f.payInvoice('card', '2026-10', 'missing', 1, '2026-10-08'));
  assert.equal(api.AppState.data.movimentos.length, 2);
});
test('Fechamento de fatura respeita virada de mês, ano e fevereiro', () => {
  const f = setup().context.window.WalletFeatures;
  const card = { fechamento: 20, vencimento: 10 };
  assert.equal(f.invoiceMonth(card, '2026-12-20'), '2027-01');
  assert.equal(f.invoiceMonth(card, '2026-12-21'), '2027-02');
  assert.equal(f.invoiceMonth({ fechamento: 5, vencimento: 15 }, '2026-10-05'), '2026-10');
});
test('Lixeira restaura pagamentos sem perder vínculos e protege contas vinculadas', () => {
  const { api, context, wallet } = setup(); const f = context.window.WalletFeatures;
  api.AppState.data = wallet(100); api.AppState.data.contas.push({ id: 'bank', nome: 'Banco', saldoInicial: 100 });
  Object.assign(api.AppState.data.movimentos[0], { contaId: 'bank', classe: 'pagamento_fatura', cartaoId: 'card', faturaMes: '2026-10' });
  const original = JSON.stringify(api.AppState.data.movimentos[0]);
  const id = f.trashEntry('movimentos', 'm1');
  assert.equal(api.AppState.data.movimentos.length, 0);
  assert.throws(() => f.trashEntry('contas', 'bank'));
  f.restoreTrash(id);
  assert.equal(JSON.stringify(api.AppState.data.movimentos[0]), original);
  assert.equal(api.AppState.data.lixeira.length, 0);
  assert.throws(() => f.restoreTrash(id));
});
test('Edição preserva identificador e pagamentos anteriores', () => {
  const { api, context } = setup(); const f = context.window.WalletFeatures;
  api.AppState.data = api.emptyWallet();
  api.AppState.data.parcelas.push({ id: 'p', desc: 'Compra', valor: 30, pagas: 2, total: 10, data1: '2026-01-31' });
  f.saveEntry('parcelas', 'p', { desc: 'Compra corrigida', valor: 35 });
  assert.equal(api.AppState.data.parcelas[0].pagas, 2);
  assert.equal(api.AppState.data.parcelas[0].id, 'p');
  assert.equal(api.AppState.data.parcelas.length, 1);
  assert.throws(() => f.saveEntry('parcelas', 'missing', { valor: 10 }));
});
test('CSV importa somente seleção e mantém categoria corrigida', () => {
  const f = setup().context.window.WalletFeatures;
  const picked = f.selectedCsvItems([{ id: '1', cat: 'Outros', possibleDuplicate: true }, { id: '2', cat: 'Outros' }],
    [{ selected: true, category: 'Saúde' }, { selected: false }], 'bank');
  assert.equal(picked.length, 1); assert.equal(picked[0].cat, 'Saúde');
  assert.equal(picked[0].categoria, 'Saúde'); assert.equal(picked[0].contaId, 'bank');
  assert.equal('possibleDuplicate' in picked[0], false);
});
test('Duplicação mensal ajusta dia e fatura e bloqueia pagamento duplicado', () => {
  const { api, context } = setup(); api.AppState.isLocal = true;
  api.AppState.data = api.emptyWallet();
  api.AppState.data.cartoes.push({ id: 'card', fechamento: 20, vencimento: 10 });
  api.AppState.data.movimentos.push({ id: 'purchase', tipo: 'despesa', valor: 10, data: '2026-01-31', cartaoId: 'card', faturaMes: '2026-03' });
  context.window.handleDuplicateNextMonth('purchase');
  assert.equal(api.AppState.data.movimentos[1].data, '2026-02-28');
  assert.equal(api.AppState.data.movimentos[1].faturaMes, '2026-04');
  context.alert = () => {};
  api.AppState.data.movimentos[0].classe = 'pagamento_fatura';
  context.window.handleDuplicateNextMonth('purchase');
  assert.equal(api.AppState.data.movimentos.length, 2);
});
test('Normalização preserva contas, cartões, lixeira e vínculos de faturas', () => {
  const { api, wallet } = setup(); const raw = wallet(100);
  raw.contas.push({ id: 'bank', nome: 'Banco', saldoInicial: 100.15 });
  raw.cartoes.push({ id: 'card', nome: 'Cartão', fechamento: 20, vencimento: 10 });
  Object.assign(raw.movimentos[0], { contaId: 'bank', cartaoId: 'card', classe: 'pagamento_fatura', faturaMes: '2026-10' });
  raw.lixeira.push({ id: 'trash', colecao: 'dividas', item: { id: 'debt', total: 10, pago: 5 } });
  const normalized = api.normalizeDataStructure(JSON.parse(JSON.stringify(raw)), 'teste');
  assert.equal(normalized.contas[0].saldoInicial, 100.15);
  assert.equal(normalized.cartoes[0].fechamento, 20);
  assert.equal(normalized.movimentos[0].classe, 'pagamento_fatura');
  assert.equal(normalized.lixeira[0].item.pago, 5);
});

(async () => {
  for (const [name, run] of cases) {
    await run();
    console.log('OK:', name);
  }
  console.log(`${cases.length} verificações passaram. Nenhuma chamada à nuvem real.`);
})().catch(err => { console.error(err); process.exitCode = 1; });
