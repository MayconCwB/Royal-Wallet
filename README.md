# Royal Wallet

Controle financeiro pessoal em PT-BR, com contas individuais no Firebase e modo local offline.

## Recursos

- Sincronização por usuário, conflitos entre aparelhos e fila offline.
- Atualizações do Firestore em tempo real após novo login; sessões antigas usam consulta de 15 segundos.
- Edição de contas fixas, parcelas e dívidas, preservando pagamentos anteriores.
- Exclusões recuperáveis pela lixeira e botão Desfazer.
- CSV com seleção de linhas, edição de categorias e indicação de possíveis duplicatas.
- Contas, cartões e faturas. A compra conta como gasto; o pagamento da fatura reduz o saldo sem duplicar a despesa.
- Comparação com o mês anterior e indicação de compromissos vencidos.

## Testar

Execute `node tests/wallet-regression.cjs`. Consulte `tests/README.md` para os testes entre aparelhos.
Para testar localmente, sirva a pasta por HTTP e abra `index.html`.

## Publicar uma versão de teste

1. Execute `node scripts/prepare-release.cjs`.
2. Execute `npx firebase-tools hosting:channel:deploy royal-wallet-melhorias --expires 7d --project minha-carteira-app-7b58d`.

A pasta `public` inclui somente os três arquivos do aplicativo. Backups pessoais, testes e imagens soltas não são publicados.
O canal de teste usa o mesmo Firebase do aplicativo: alterações feitas com uma conta real são sincronizadas nessa conta. Use uma conta de teste para a validação entre aparelhos.

## Convenções financeiras

O saldo inicial de cada conta deve representar o valor anterior aos lançamentos registrados. Lançamentos antigos ficam em “Sem conta definida” até serem vinculados.
O mês da fatura identifica seu vencimento; o dia do fechamento pertence à fatura que está fechando. É possível ajustar o mês de cada compra conforme o extrato do banco.
O pagamento de fatura é um registro manual: o aplicativo não faz pagamentos nem se conecta a bancos.
