# Verificação do Royal Wallet

Execute `node tests/wallet-regression.cjs` na pasta do projeto. Os testes usam
uma nuvem simulada e não entram em contas nem alteram dados reais.

Para verificar também a interface, execute `npm ci` e `npm test`. O arquivo
`app-smoke.cjs` carrega os mesmos scripts da página em um DOM isolado, com rede
simulada. Ele cobre ativação, desbloqueio offline, recuperação, backup cifrado,
migração da nuvem legada, abertura em um segundo aparelho simulado, rejeição de
HTML em datas importadas, limpeza da interface ao sair/bloquear e diagnóstico
da conexão sem criação de contas ou gravação de carteiras.

Os testes de regressão verificam os contratos financeiros e de sincronização;
os casos marcados AES, recuperação, persistência e nuvem cifrada carregam os
módulos reais de segurança. Os demais usam uma fachada de armazenamento para
manter os cenários antigos independentes da tela de desbloqueio.

As regras foram avaliadas com 55 casos sintéticos por
`scripts/check-rules.cjs`, usando a sessão autenticada do Firebase CLI.
Esse procedimento usa apenas a API de avaliação de regras, não publica regras
e não grava documentos. O argumento opcional `--verify-active`, depois do
diretório `lib` do Firebase CLI, também compara o arquivo local com a publicação
ativa. Consulte `docs/SECURITY.md` antes de implantar.

`npm run test:browser` usa Chrome/Edge headless com perfil temporário, viewport
de 390px, sem conexão externa. Verifica Web Crypto nativa, política CSP,
cache do Service Worker e reabertura/desbloqueio offline. Para outro executável
Chromium, informe `ROYAL_TEST_BROWSER`. A evidência com dados fictícios fica
em `.artifacts/offline-criptografado.png`, fora do repositório e da publicação.

Para conferir o carregamento do Firebase no navegador, sirva a pasta do projeto
e abra `/tests/sdk-browser-smoke.html`. O resultado esperado é "OK".

## Atualizações entre aparelhos

O aplicativo usa `onSnapshot` do SDK oficial do Firebase para acompanhar somente
o documento `carteiras/<uid>` da conta aberta. As notificações acionam a leitura
REST e a resolução de conflitos já existentes. O listener apenas lê o documento;
as gravações continuam usando a precondição de versão do servidor, com as mesmas
regras de acesso existentes.

O login estabelece também a sessão do SDK. Sessões anteriores à implementação
usam uma consulta a cada 15 segundos até que o usuário saia e entre novamente.
O mesmo fallback é usado caso o carregamento do SDK falhe. O indicador inferior
mostra qual modo está ativo.

O listener é encerrado ao sair, entrar no modo local, perder a conexão ou iniciar
a exclusão da conta. É reiniciado quando a conexão retorna. Consultas automáticas
pausam enquanto a página está oculta e alterações recebidas aguardam o fechamento
de formulários. Um conflito adiado não reaparece automaticamente para a mesma
versão remota; a sincronização manual permite revisar essa escolha.

Uma carteira já sincronizada que tenha sido removida da nuvem não é recriada
automaticamente. A cópia local é preservada para recuperação.

## Validação entre dois aparelhos

Após publicar os arquivos atualizados, entre na mesma conta nos dois aparelhos.
Confira o indicador "Online • tempo real". Crie ou altere um lançamento em um
aparelho e confira a atualização no outro, sem recarregar a página. Confira também
alterações simultâneas, edição offline e retorno da conexão. Este teste integrado
precisa de uma conta de teste e ainda não foi executado contra o Firebase real.

Referências oficiais:

- https://firebase.google.com/docs/firestore/query-data/listen
- https://firebase.google.com/docs/auth/web/auth-state-persistence
