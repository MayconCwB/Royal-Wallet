# Revisão de segurança — 19/10/2026

Revisão feita pelo mesmo assistente que implementou a versão E2EE. Complementa
os testes e não equivale a auditoria independente, certificação ou garantia de
ausência de falhas. O ponto de partida foi a implementação publicada pelo PR #2.

## Escopo e método

Leitura de criptografia, recuperação, persistência local, sincronização,
importação, renderização, sessão, CSP e regras Firestore. Foram usados apenas
dados fictícios em DOM isolado e navegador temporário. As regras ativas foram
lidas e comparadas ao arquivo local; acessos e gravações foram avaliados pela
API de testes de regras, sem ler ou alterar carteiras reais.

## Achados e correções

| Achado | Impacto observado | Correção |
| --- | --- | --- |
| Data importada interpolada como HTML no movimento e em atributo do formulário | Um backup hostil podia criar elementos na interface. Reproduzido com um marcador de imagem; não foi demonstrada execução de JavaScript, que também é restringida pela CSP. | Escape de HTML nos dois contextos e teste com data hostil. |
| Saída e bloqueio deixavam conteúdo de interface/formulários | Sair limpava o estado financeiro, mas não redesenhava as listas. Modal fechado também conservava campos e callbacks. Isso permitia observar conteúdo já decifrado na página de um aparelho compartilhado. | Limpeza de listas, logs, formulários, identidade exibida e modal; redesenho vazio em logout e bloqueio, preservando o arquivo cifrado. |
| Arquivo protegido sem envelope era aceito como legado | A troca de royalVaultData por JSON em claro fazia o desbloqueio aceitar e recifrar conteúdo adulterado. Exige alteração prévia do armazenamento local; não permite obter a chave. | Arquivo no espaço protegido exige envelope reconhecido. Falha preserva o arquivo e não abre a sessão. Migração continua permitida no espaço legado. |
| Diagnóstico antigo criava conta com senha fixa e tentava escrever formato antigo | Rotina incompatível com a carteira E2EE e capaz de deixar contas de teste sem limpeza se alguma etapa falhasse. | Diagnóstico valida apenas a identidade autenticada e a leitura da própria carteira. Teste exige somente lookup e GET, sem novos cadastros ou gravações. |

Os achados têm alcance local, de interface ou operacional. Nenhum bypass de
acesso entre usuários foi identificado no escopo avaliado. As correções não
trocam a chave de dados, não exigem outra recuperação e não modificam o formato
das carteiras. O cache do aplicativo passa para v7 para distribuir os arquivos.

## Evidências de validação

- 54 verificações de regressão e criptografia passaram.
- Três fluxos completos de interface passaram: segurança de exibição/sessão,
  carteira local e migração/sincronização com segundo aparelho simulado.
- Chrome headless em viewport de 390 px confirmou Web Crypto nativa, CSP sem
  violações e reabertura/desbloqueio offline com perfil temporário.
- 55 casos sintéticos de regras passaram: proprietário, usuário diferente,
  acesso anônimo, listagem, migração, downgrade, troca de identificador, campos
  extras/ausentes, tipos, limites de tamanho e caminhos não autorizados.
- A fonte das regras ativas coincide com o arquivo avaliado. Nenhuma nova
  publicação de regras foi necessária nesta revisão.

A avaliação estruturada de regras está em [security-rules-audit.json](security-rules-audit.json).

## Limites e próximos cuidados

AES-GCM autentica o conteúdo e vincula usuário e finalidade; a recuperação
reencapsula a mesma chave de dados. Isso não revoga cópias anteriores da chave,
aparelhos já desbloqueados ou backups antigos. O administrador ainda vê
metadados e dados de autenticação; o código servido pelo site e um aparelho
comprometido continuam dentro dos limites descritos em [SECURITY.md](SECURITY.md).

Não foram inspecionados dados pessoais, políticas IAM, faturamento, sessões de
produção, cópias históricas ou todos os celulares/navegadores. Credenciais
administrativas podem contornar regras do Firestore. A revisão não substitui
um especialista externo em criptografia e segurança de aplicações.

Referências consultadas: [validação de campos do Firestore](https://firebase.google.com/docs/firestore/security/rules-fields),
[condições e identidade nas regras](https://firebase.google.com/docs/firestore/security/rules-conditions),
[parâmetros AES-GCM](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams).
