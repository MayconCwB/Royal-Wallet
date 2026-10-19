# Organização do Royal Wallet

O aplicativo continua estático, com publicação pelo GitHub Pages ou pelo Firebase Hosting. Não precisa de um servidor de aplicação nem de um empacotador para executar no navegador.

| Caminho | Responsabilidade |
| --- | --- |
| `index.html` | Estrutura das telas e ordem dos scripts |
| `assets/css/` | Estilos locais, formulários e tela de desbloqueio |
| `assets/brand/` | PNG da marca, sem repetir a imagem dentro do HTML |
| `js/config.js` | Configuração pública do Firebase e estado em memória |
| `js/data/` | Normalização, formato Firestore, CSV e backups |
| `js/finance/` | Cálculos financeiros |
| `js/services/` | Autenticação REST, conflitos, fila e sincronização em tempo real |
| `js/ui/` | Telas, formulários, navegação, ações, gráficos e identidade visual |
| `js/features/` | Ferramentas de contas, cartões, faturas, edição e lixeira |
| `js/security/` | Criptografia, persistência cifrada, desbloqueio e recuperação |
| `js/session.js` | Sessão de login, reconciliação e saída |
| `js/bootstrap.js` | Inicialização e eventos do aplicativo |
| `app-assets.json` | Lista única de arquivos da publicação e do cache offline |
| `sw.js` | Cache e abertura offline |
| `tests/` | Regressão, criptografia, migração e interface em DOM isolado |

## Carregamento

Os scripts são clássicos e carregam na ordem explícita do HTML. Isso preserva os contratos usados pelas funções existentes, sem uma reescrita das regras financeiras. Os módulos de segurança carregam antes da sessão e do desbloqueio. As ações de listas usam eventos delegados e identificadores tratados como dados; não há JavaScript inline nas telas.

Ao adicionar um recurso local, inclua-o no HTML quando necessário e em `app-assets.json`. O teste de cache verifica os caminhos do HTML e a existência dos arquivos. A preparação da publicação copia somente a lista permitida e rejeita arquivos inesperados na pasta `public`.

O script de serviço instala todos esses recursos antes de substituir o cache anterior. A imagem e os estilos são locais. O SDK do Firebase é usado online; a abertura offline não depende dele.

## Desenvolvimento

1. `npm ci`
2. `npm test`
3. Servir a pasta por HTTP em localhost para desenvolvimento ou HTTPS para publicação.
4. `npm run prepare:release`

Dependências de testes ficam fora da publicação. A saída de `npm test` distingue os testes de regressão dos fluxos da interface simulada; estes não substituem o teste final em um celular real.
