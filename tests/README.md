# Verificação do Royal Wallet

Execute `node tests/wallet-regression.cjs` na pasta do projeto. Os testes usam
uma nuvem simulada e não entram em contas nem alteram dados reais.

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
