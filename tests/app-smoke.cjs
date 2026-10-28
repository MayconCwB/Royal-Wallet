/* Interface completa em DOM isolado. Nenhuma chamada a contas ou dados reais. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const paths = [...html.matchAll(/<script src="\.\/([^"]+)"/g)].map(match => match[1]);
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check, message) {
  const deadline = Date.now() + 10000;
  while (!check()) { if (Date.now() > deadline) throw Error(message); await tick(); }
}
function fixture(desc = 'Compra particular de teste') {
  return { movimentos: [{ id: 'test-1', desc, descricao: desc, tipo: 'despesa', valor: 19.95, cat: 'Outros', data: '2026-10-08' }],
    recorrentes: [], parcelas: [], dividas: [], metas: [], historico: [], contas: [], cartoes: [], lixeira: [], updatedAt: 1000 };
}
function launch(seed = {}, network = null) {
  const errors = [], requests = []; const vc = new VirtualConsole();
  vc.on('jsdomError', error => { if (error.type !== 'not-implemented') errors.push(error.message); });
  const dom = new JSDOM(html, { url: 'https://wallet.test/Royal-Wallet/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  Object.defineProperty(w, 'crypto', { value: webcrypto }); Object.defineProperty(w.navigator, 'onLine', { value: !!network, configurable: true });
  Object.assign(w, { TextEncoder, TextDecoder, AbortController });
  w.scrollTo = () => {}; w.alert = message => errors.push('Alerta: ' + message); w.confirm = () => true;
  w.URL.createObjectURL = blob => { w.lastDownload = blob; return 'blob:https://wallet.test/test-download'; };
  w.URL.revokeObjectURL = () => {};
  w.fetch = async (url, options = {}) => {
    requests.push(String(url));
    if (!network) throw new w.TypeError('Offline simulado');
    const result = await network(String(url), options);
    return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.data };
  };
  for (const [key, value] of Object.entries(seed)) w.localStorage.setItem(key, value);
  const ctx = dom.getInternalVMContext();
  for (const file of paths) new vm.Script(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file }).runInContext(ctx);
  const $ = id => w.document.getElementById(id);
  const state = () => vm.runInContext('AppState', ctx);
  return { dom, w, $, state, requests, errors };
}
async function activate(app, password) {
  await until(() => app.$('vaultPassword'), 'A tela de proteção não abriu.');
  app.$('vaultPassword').value = password; app.$('vaultConfirm').value = password;
  app.$('vaultForm').dispatchEvent(new app.w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => app.$('vaultRecoveryOutput')?.value, 'A chave de recuperação não foi gerada.');
  const recoveryKey = app.$('vaultRecoveryOutput').value;
  assert(recoveryKey.startsWith('RW1-'));
  assert.equal(app.$('vaultContinue').disabled, true);
  app.$('vaultRecoverySaved').checked = true; app.$('vaultRecoverySaved').dispatchEvent(new app.w.Event('change'));
  app.$('vaultContinue').click();
  await until(() => app.$('loginOverlay').style.display === 'none', 'A carteira não abriu após a confirmação da recuperação.');
  return recoveryKey;
}
async function unlock(app, password) {
  await until(() => app.$('vaultPassword'), 'A tela de desbloqueio não abriu.');
  app.$('vaultPassword').value = password;
  app.$('vaultForm').dispatchEvent(new app.w.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => app.$('loginOverlay').style.display === 'none', 'A carteira não abriu após o desbloqueio.');
}
async function localFlow() {
  const privateText = 'Compra particular de teste';
  const app = launch({ royalLocalData_device: JSON.stringify(fixture(privateText)) });
  try {
    await tick(); app.$('btnContinuarLocal').click();
    const recoveryKey = await activate(app, 'senha local bastante comprida');
    assert.equal(app.state().data.movimentos[0].desc, privateText);
    assert.equal(app.w.document.querySelectorAll('.vault-overlay').length, 0);
    app.state().data.movimentos[0].id = 'id\'\");alert(1);//';
    app.w.renderAll();
    app.w.document.getElementById('walletMovementAll').checked = true; app.w.renderAll();
    const edit = app.w.document.querySelector('[data-movement-id]');
    assert.equal(edit.getAttribute('onclick'), null); edit.click();
    [...app.$('genericModalFooter').querySelectorAll('button')].find(button => button.textContent === 'Editar').click();
    assert.equal(app.$('movDesc').value, privateText); app.w.closeModal();
    app.w.switchTab('movimentos'); app.$('btnNovoMovimento').click();
    app.$('movDesc').value = 'Novo registro privado'; app.$('movValor').value = '12,35'; app.$('movData').value = '2026-10-19';
    [...app.$('genericModalFooter').querySelectorAll('button')].find(button => button.textContent === 'Salvar').click();
    await app.w.WalletStorage.flush();
    assert(app.state().data.movimentos.some(item => item.desc === 'Novo registro privado'));
    const disk = Array.from({ length: app.w.localStorage.length }, (_, i) => app.w.localStorage.getItem(app.w.localStorage.key(i))).join('');
    assert(!disk.includes(privateText)); assert(!disk.includes('Novo registro privado')); assert(!disk.includes(recoveryKey));
    await app.w.WalletPrivacy.exportBackup(app.state().data);
    const backupText = await new Promise(resolve => { const reader = new app.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(app.w.lastDownload); });
    assert(!backupText.includes(privateText));
    assert.equal((await app.w.WalletPrivacy.importBackup(JSON.parse(backupText))).movimentos[0].desc, privateText);
    app.w.logout(); await app.w.WalletStorage.lock();
    app.$('btnContinuarLocal').click();
    await until(() => app.$('vaultPassword'), 'Desbloqueio offline não abriu.');
    app.$('vaultPassword').value = 'senha errada'; app.$('vaultForm').dispatchEvent(new app.w.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => app.$('vaultError')?.textContent.includes('incorreta'), 'Senha errada não foi rejeitada.');
    assert.notEqual(app.$('loginOverlay').style.display, 'none');
    app.$('vaultRecover').checked = true; app.$('vaultRecover').dispatchEvent(new app.w.Event('change'));
    app.$('vaultRecovery').value = recoveryKey; app.$('vaultPassword').value = 'nova senha local comprida'; app.$('vaultConfirm').value = 'nova senha local comprida';
    app.$('vaultForm').dispatchEvent(new app.w.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => app.$('loginOverlay').style.display === 'none', 'A recuperação offline não concluiu.');
    assert.equal(app.state().data.movimentos.length, 2);
    app.w.logout(); await app.w.WalletStorage.lock();
    app.$('btnContinuarLocal').click(); await unlock(app, 'nova senha local comprida');
    assert.equal(app.state().data.movimentos.length, 2); assert.equal(app.requests.length, 0);
    assert.deepEqual(app.errors, []);
    console.log('OK: interface abre offline, migra, grava cifrado, exporta/importa backup, bloqueia senha errada e recupera acesso.');
  } finally { app.dom.window.close(); }
}
async function cloudFlow() {
  const toFs = value => Array.isArray(value) ? { arrayValue: { values: value.map(toFs) } } : value && typeof value === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toFs(item)])) } } : typeof value === 'number' ? { doubleValue: value } : { stringValue: String(value) };
  let document = { updateTime: 'cloud-version-1', fields: { v: { stringValue: '2' }, atualizadoEm: toFs(1000), movimentos: toFs(fixture().movimentos) } };
  let writes = 0;
  const network = async (url, options) => {
    if (url.includes('securetoken.googleapis.com')) return { status: 200, data: { id_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600 } };
    if (url.includes('accounts:lookup')) return { status: 200, data: { users: [{ localId: 'A', email: 'test@example.com', displayName: 'Teste' }] } };
    if (url.includes('/documents/carteiras/A')) {
      if (options.method === 'PATCH') {
        assert.equal(new URL(url).searchParams.get('currentDocument.updateTime'), document.updateTime);
        const body = JSON.parse(options.body);
        assert.equal(body.fields.v.stringValue, 'e2ee-1'); assert(!options.body.includes('Compra particular de teste'));
        document = { fields: body.fields, updateTime: 'cloud-version-' + (++writes + 1) };
      }
      return { status: 200, data: document };
    }
    throw Error('Destino inesperado: ' + url);
  };
  const seed = { royalToken: JSON.stringify({ uid: 'A', email: 'test@example.com', refreshToken: 'test-refresh' }) };
  const app = launch(seed, network);
  try {
    await activate(app, 'senha privada entre aparelhos'); app.w.stopRealtimeSync();
    assert.equal(writes, 1); assert.equal(document.fields.v.stringValue, 'e2ee-1');
    assert.equal('movimentos' in document.fields, false);
    assert.equal(app.state().data.movimentos[0].desc, 'Compra particular de teste');
    const diagnosticsStart = app.requests.length;
    app.$('btnRunDiagnostics').click();
    await until(() => app.$('diagTestResult').textContent.includes('Sessão válida'), 'Diagnóstico somente de leitura não concluiu.');
    assert.equal(writes, 1);
    assert.equal(app.requests.length - diagnosticsStart, 2, 'Diagnóstico faz apenas lookup e leitura.');
    assert(app.requests.slice(diagnosticsStart).every(url => url.includes('accounts:lookup') || url.includes('/documents/carteiras/A')));
    await app.w.WalletStorage.flush();
    const second = launch(seed, network);
    try {
      await unlock(second, 'senha privada entre aparelhos'); second.w.stopRealtimeSync();
      assert.equal(second.state().data.movimentos[0].desc, 'Compra particular de teste');
      assert.equal(writes, 1); assert.deepEqual(second.errors, []);
      assert(!second.w.localStorage.getItem('royalVaultData_A').includes('Compra particular de teste'));
    } finally { second.dom.window.close(); }
    assert.deepEqual(app.errors, []);
    console.log('OK: interface migra nuvem legada com precondição e abre a carteira cifrada em outro aparelho simulado.');
  } finally { app.dom.window.close(); }
}
async function securityFlow() {
  const secret = 'Informacao privada que deve desaparecer ao sair';
  const app = launch({ royalLocalData_device: JSON.stringify(fixture(secret)) });
  try {
    await tick(); app.$('btnContinuarLocal').click();
    await activate(app, 'senha de teste para seguranca');
    const movement = app.state().data.movimentos[0];
    movement.data = '<img src="/probe" id="securityProbe">';
    app.w.renderMovimentos();
    assert.equal(app.$('securityProbe'), null, 'Data importada não pode criar HTML.');
    movement.data = '\"><img src="/probe" id="securityProbe">';
    app.w.openMovimentoForm(movement);
    assert.equal(app.$('securityProbe'), null, 'Data no formulário não pode escapar do atributo.');
    app.w.closeModal();
    movement.data = '2026-10-08';
    app.w.renderAll();
    app.w.handleEditMovimento(movement.id);
    assert.equal(app.$('movDesc').value, secret);
    app.state().eventsLog.push(secret);
    app.w.logout();
    await app.w.WalletStorage.lock();
    assert(!app.w.document.body.textContent.includes(secret), 'Sair deve remover dados exibidos e logs.');
    assert.equal(app.$('genericModalBody').childElementCount, 0, 'Sair deve limpar os campos do formulário.');
    assert.equal(app.$('genericModalBackdrop').classList.contains('active'), false);
    assert.equal(app.w.WalletStorage.ready('device'), false);
    app.$('btnContinuarLocal').click(); await unlock(app, 'senha de teste para seguranca');
    assert.equal(app.state().data.movimentos[0].desc, secret, 'A limpeza da tela preserva o arquivo cifrado.');
    app.w.handleEditMovimento(movement.id);
    const lockTask = app.w.WalletPrivacy.lock();
    await until(() => app.$('vaultPassword'), 'O bloqueio não pediu a senha.');
    assert(!app.w.document.body.textContent.includes(secret), 'Bloqueio deve limpar os dados exibidos.');
    assert.equal(app.$('genericModalBody').childElementCount, 0);
    await unlock(app, 'senha de teste para seguranca'); await lockTask;
    assert.equal(app.state().data.movimentos[0].desc, secret);
    assert.deepEqual(app.errors, []);
    console.log('OK: datas hostis não criam HTML e logout limpa tela, formulário, logs e sessão sem apagar a carteira.');
  } finally { app.dom.window.close(); }
}
async function approvedFeaturesFlow() {
  const app = launch({royalQuickUnlock_device: JSON.stringify({retired:true})});
  const click = text => {
    const button = [...app.$('genericModalFooter').querySelectorAll('button')].find(b => b.textContent === text);
    assert(button, `Botão ${text} disponível`); button.click();
  };
  try {
    await tick(); app.$('btnContinuarLocal').click(); await activate(app, 'senha longa dos recursos novos');
    const { w } = app, data = app.state().data;
    assert.equal(w.localStorage.getItem('royalQuickUnlock_device'), null);
    assert.equal(app.$('quickUnlockSetup'), null); assert.equal(app.$('vaultQuickUnlock'), null);
    assert.equal(typeof w.WalletQuickUnlock, 'undefined');
    const today = new Date(), month = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`, date = month+'-01';
    assert.equal(data.movimentos.length, 0); assert.equal(data.rendasPrevistas.length, 0);
    assert.equal(app.$('walletPendingIncome').hidden, true);
    assert.equal(w.document.querySelector('[data-tab="contascartoes"]'), null);
    assert(!/Royal Pro|Comparar planos|Meu plano|Essencial/.test(w.document.body.textContent));
    w.WalletExperience.configureIncome();
    app.$('incomeAmount0').value='2000'; app.$('incomeDay0').value='5';
    app.$('incomeAmount1').value='800'; app.$('incomeDay1').value='20'; click('Salvar');
    assert.equal(w.WalletExperience.pending(), 2800);
    assert.equal(w.calcMonthlyFinancials().saldoReal, 0); assert.equal(w.calcMonthlyFinancials().saldoPrevisto, 2800);
    // Vincular uma entrada existente evita duplicar salário importado.
    data.movimentos.push({ id:'salary-existing', tipo:'receita', desc:'Salário importado', valor:2000, data:date, cat:'Salário' }); w.renderAll();
    app.$('walletPendingIncome').querySelector('button').click(); [...app.$('genericModalFooter').querySelectorAll('button')].find(b=>b.textContent.startsWith('Salário · ')).click();
    app.$('incomeExisting').value='salary-existing'; click('Confirmar entrada');
    assert.equal(data.movimentos.length,1); assert.equal(w.WalletExperience.pending(),800);
    assert.equal(w.calcMonthlyFinancials().saldoPrevisto,2800);
    app.$('walletPendingIncome').querySelector('button').click(); if(app.$('incomeExisting'))app.$('incomeExisting').value='new'; click('Confirmar entrada');
    assert.equal(data.movimentos.length,2); assert.equal(w.WalletExperience.pending(),0); assert.equal(app.$('walletPendingIncome').hidden,true);
    // Referências de mês antigo não confirmam o recebimento do mês novo.
    const income=data.rendasPrevistas[0], entry=data.movimentos.find(x=>x.id==='salary-existing'), originalSource=entry.origem;
    entry.origem=`renda:${income.id}:2001-01`; assert.equal(w.WalletExperience.received(income),false);entry.origem=originalSource;
    data.recorrentes.push({id:'rent',desc:'Aluguel de teste',valor:700,dia:10,tipo:'despesa',cat:'Moradia'});
    w.handleToggleRecorrentePago('rent'); assert.equal(w.calcMonthlyFinancials().saldoReal,2100);
    assert.equal(w.calcMonthlyFinancials().compromissosMes,0);
    w.handleToggleRecorrentePago('rent'); assert.equal(w.calcMonthlyFinancials().saldoReal,2800);
    w.handleToggleRecorrentePago('rent'); assert.equal(data.movimentos.filter(x=>x.origem===`fixa:rent:${month}`).length,1);
    // Mês anterior pago volta a ficar pendente e gera uma saída atual só uma vez.
    data.recorrentes[0].ultimoMesPago='2001-01'; w.handleToggleRecorrentePago('rent');
    assert.equal(data.movimentos.filter(x=>x.origem===`fixa:rent:${month}`).length,1);
    w.openParcelaForm();app.$('editNome').value='Compra longa';app.$('editValor').value='10';app.$('editTotal').value='1000000';app.$('editPagas').value='0';app.$('editData').value=date;
    assert.equal(app.$('editTotal').hasAttribute('max'),false);click('Salvar');
    const installment=data.parcelas[0]; assert.equal(installment.total,1000000);
    w.handleAdjustParcelasPagas(installment.id,1);assert.equal(w.calcMonthlyFinancials().saldoReal,2090);
    w.handleAdjustParcelasPagas(installment.id,-1);assert.equal(w.calcMonthlyFinancials().saldoReal,2100);
    w.WalletBudgets.save({mes:month,categoria:'Moradia',limite:800});
    assert.equal(w.WalletBudgets.summarize(data,month).rows[0].gasto,700);
    const ofx='<OFX><BANKID>123<ACCTID>conta-teste<STMTTRN><DTPOSTED>'+month.replace('-','')+'02<TRNAMT>-12.35<FITID>abc<NAME>Mercado de teste</STMTTRN></OFX>';
    const parsed=w.WalletExperience.parseOfx(ofx);assert.equal(parsed[0].valor,12.35);
    w.WalletExperience.importOfx(ofx);click('Importar selecionados');
    w.WalletExperience.importOfx(ofx);assert.equal(app.$('ofxPick0').disabled,true);click('Importar selecionados');
    assert.equal(data.movimentos.filter(x=>x.id===parsed[0].id).length,1);
    const normalized=w.normalizeDataStructure(data,'test');assert.equal(normalized.rendasPrevistas.length,2);assert.equal(normalized.orcamentos.length,1);
    data.recorrentes[0].assinatura=true;assert.equal(w.normalizeDataStructure(data,'test').recorrentes[0].assinatura,true);
    await w.exportBackupJson();
    const rawBackup=await new Promise(resolve=>{const reader=new w.FileReader();reader.onload=()=>resolve(reader.result);reader.readAsText(w.lastDownload);});
    assert(!rawBackup.includes('rendasPrevistas'));const restored=await w.WalletPrivacy.importBackup(JSON.parse(rawBackup));
    assert.equal(restored.rendasPrevistas.length,2);assert.equal(restored.orcamentos.length,1);assert.equal(restored.recorrentes[0].assinatura,true);
    await w.WalletStorage.flush();w.logout();await w.WalletStorage.lock();app.$('btnContinuarLocal').click();await unlock(app,'senha longa dos recursos novos');
    assert.equal(app.state().data.rendasPrevistas.length,2);assert.equal(app.state().data.orcamentos.length,1);
    assert.deepEqual(app.errors,[]);
    console.log('OK: salário/vale sem duplicação, pagamentos reversíveis, milhão de parcelas sem travar, limites, OFX sem reimportação e backup cifrado dos novos recursos.');
  } finally { app.dom.window.close(); }
}
(async () => { await approvedFeaturesFlow(); await securityFlow(); await localFlow(); await cloudFlow(); })().catch(error => { console.error(error); process.exitCode = 1; });
