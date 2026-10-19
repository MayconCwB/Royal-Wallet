/* Avalia apenas casos sintéticos na API de regras; não publica regras nem grava documentos. */
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const cliRoot = process.argv[2];
  if (!cliRoot) throw Error('Informe o diretório lib de uma instalação autenticada do firebase-tools.');
  const auth = require(path.join(cliRoot, 'auth'));
  const options = { project: 'minha-carteira-app-7b58d', projectId: 'minha-carteira-app-7b58d' };
  const account = auth.getGlobalDefaultAccount(); if (!account) throw Error('Entre no Firebase CLI antes de validar as regras.');
  auth.setActiveAccount(options, account); await require(path.join(cliRoot, 'requireAuth')).requireAuth(options);
  const api = require(path.join(cliRoot, 'api')); const { Client } = require(path.join(cliRoot, 'apiv2'));
  const client = new Client({ urlPrefix: api.rulesOrigin(), apiVersion: 'v1' });
  const source = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const wrapper = { iv: 'A'.repeat(16), ciphertext: 'A'.repeat(64) };
  const metadata = { version: 1, algorithm: 'AES-256-GCM', keyId: 'A'.repeat(24),
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: 'A'.repeat(24) }, password: wrapper, recovery: wrapper };
  const encrypted = { v: 'e2ee-1', atualizadoEm: 1000, encryption: metadata,
    payload: { format: 'royal-wallet-e2ee', version: 1, keyId: metadata.keyId, iv: 'A'.repeat(16), ciphertext: 'A'.repeat(80) } };
  const legacy = { v: '2', movimentos: [] };
  const resource = data => ({ data, id: 'synthetic-owner', __name__: '/databases/(default)/documents/carteiras/synthetic-owner' });
  const cases = [];
  function test(name, expectation, method, uid, data, existing) {
    const request = { method, path: '/databases/(default)/documents/carteiras/synthetic-owner', auth: uid ? { uid } : null };
    if (data) request.resource = resource(data);
    const entry = { expectation, request }; if (existing) entry.resource = resource(existing);
    cases.push({ name, entry });
  }
  test('Dono lê carteira', 'ALLOW', 'get', 'synthetic-owner', null, legacy);
  test('Outro usuário não lê', 'DENY', 'get', 'someone-else', null, encrypted);
  test('Sem login não lê', 'DENY', 'get', null, null, legacy);
  test('Listagem é proibida', 'DENY', 'list', 'synthetic-owner');
  test('Dono cria cifrado', 'ALLOW', 'create', 'synthetic-owner', encrypted);
  test('Outro usuário não cria', 'DENY', 'create', 'someone-else', encrypted);
  test('Dados em claro são proibidos', 'DENY', 'create', 'synthetic-owner', legacy);
  test('Campo financeiro extra é proibido', 'DENY', 'create', 'synthetic-owner', { ...encrypted, movimentos: [] });
  test('Campo obrigatório ausente é proibido', 'DENY', 'create', 'synthetic-owner', { v: 'e2ee-1' });
  test('KDF fraca é proibida', 'DENY', 'create', 'synthetic-owner', { ...encrypted, encryption: { ...metadata, kdf: { ...metadata.kdf, iterations: 1 } } });
  test('Migração é permitida', 'ALLOW', 'update', 'synthetic-owner', encrypted, legacy);
  test('Atualização cifrada é permitida', 'ALLOW', 'update', 'synthetic-owner', encrypted, encrypted);
  test('Downgrade é proibido', 'DENY', 'update', 'synthetic-owner', legacy, encrypted);
  test('Troca silenciosa da chave é proibida', 'DENY', 'update', 'synthetic-owner', { ...encrypted, encryption: { ...metadata, keyId: 'B'.repeat(24) }, payload: { ...encrypted.payload, keyId: 'B'.repeat(24) } }, encrypted);
  test('Dono pode excluir', 'ALLOW', 'delete', 'synthetic-owner', null, encrypted);
  test('Outro usuário não pode excluir', 'DENY', 'delete', 'someone-else', null, encrypted);
  const result = await client.post(`/projects/${options.project}:test`, { source: { files: [{ name: 'firestore.rules', content: source }] }, testSuite: { testCases: cases.map(item => item.entry) } }, { skipLog: { body: true } });
  if (result.body.issues?.some(issue => issue.severity === 'ERROR')) throw Error(JSON.stringify(result.body.issues));
  const results = result.body.testResults || [];
  if (results.length !== cases.length) throw Error('A API não retornou todos os testes.');
  results.forEach((item, index) => {
    if (item.state !== 'SUCCESS') throw Error(cases[index].name + ': ' + JSON.stringify(item));
    console.log('OK:', cases[index].name);
  });
  console.log(`${cases.length} testes de regras passaram. Nenhuma publicação de regras ou gravação em carteiras.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
