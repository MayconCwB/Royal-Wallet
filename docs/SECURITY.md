# Criptografia e ativação da versão 1.1

## Estado e alcance

Esta implementação e as regras são uma proposta para revisão antes da publicação em produção. Nenhuma carteira real foi migrada durante o desenvolvimento. A proteção começa quando cada usuário abre a nova versão, cria a senha da carteira e confirma que guardou a chave de recuperação. Uma implantação de código não significa que todas as contas existentes já tenham sido convertidas.

O Firestore já utiliza criptografia do provedor e HTTPS. A camada nova cifra os dados financeiros no aparelho, antes de enviá-los ao Firestore. Movimentos, valores, descrições, contas, cartões, dívidas, metas, histórico e lixeira ficam dentro do conteúdo cifrado, inclusive nas cópias locais, filas offline e novos backups exportados.

E-mail, perfil de autenticação e tokens continuam sendo gerenciados pelo Firebase Auth. Identificação da carteira, versão do formato, horário de alteração, tamanhos dos dados e parâmetros públicos de criptografia continuam visíveis. A proteção não oculta esses metadados nem protege uma carteira já desbloqueada contra um aparelho comprometido, extensões maliciosas ou código adulterado servido pelo responsável pelo site.

## Chaves e formatos

- Chave de dados aleatória de 256 bits, gerada por `crypto.getRandomValues`.
- AES-256-GCM via Web Crypto, com IV aleatório de 96 bits a cada operação e tag de autenticação de 128 bits.
- Chave de encapsulamento derivada da senha com PBKDF2-SHA256, 600.000 iterações e salt aleatório de 128 bits. Senha mínima de 12 caracteres; frases longas são preferíveis.
- Chave de recuperação independente, aleatória, de 256 bits. O arquivo de recuperação contém essa chave e deve ser guardado pelo usuário fora do aparelho.
- A chave de dados é encapsulada separadamente pela senha e pela recuperação. Só os encapsulamentos e parâmetros públicos são persistidos.
- Identidade, identificador da chave, versão e finalidade entram nos dados adicionais autenticados. Cópias de nuvem, armazenamento local e backup têm contextos distintos.
- Chaves AES de sessão não são exportáveis e ficam em memória. Senha e recuperação não são gravadas em localStorage nem enviadas ao Firebase.

O documento `carteiras/{uid}` passa a conter somente `v=e2ee-1`, `atualizadoEm`, `encryption` e `payload`. O conteúdo autenticado inclui também a versão lógica da carteira; inconsistências com o horário externo são rejeitadas.

## Migração

1. A sessão de login identifica a carteira e verifica os parâmetros públicos da nuvem.
2. Para uma carteira nova ou legada, o usuário cria a senha e guarda a recuperação antes de prosseguir.
3. A cópia local e a fila são cifradas e decifradas para verificação antes da substituição das cópias legadas correspondentes. O armazenamento novo usa nomes separados: `royalVaultData_<uid>` e `royalVaultQueue_<uid>`.
4. O fluxo normal de conflitos escolhe qual snapshot utilizar. O envio cifra o snapshot e usa a mesma precondição de versão do Firestore para evitar substituir uma alteração simultânea.
5. A conversão da nuvem só é considerada concluída depois da confirmação do servidor. Falhas preservam a cópia local e as pendências.

Contas de outros usuários presentes no mesmo aparelho só são migradas quando o respectivo dono desbloqueia sua carteira. Cópias históricas do provedor, exportações antigas e arquivos externos em texto aberto não são recriptografados por esta mudança. Feche abas e versões antigas antes da ativação. Uma cópia legada mais recente encontrada após a migração causa bloqueio de segurança e preservação de ambas as versões para recuperação, sem sobrescrita automática.

## Desbloqueio, recuperação e perdas

Depois da primeira ativação, a carteira pode ser aberta offline com sua senha. A primeira ativação de uma conta autenticada exige internet, para evitar criar uma chave diferente da existente na nuvem. O modo local tem sua própria senha e recuperação.

Para recuperar o acesso, use a opção de chave de recuperação e escolha uma nova senha. Isso encapsula novamente a mesma chave de dados e preserva o conteúdo. A nova senha é sincronizada quando o envio é confirmado. A recuperação não revoga chaves ou encapsulamentos que um invasor já tenha copiado. Rotação por comprometimento da chave de dados exige um procedimento futuro específico.

Redefinir a senha de login do Firebase não recupera a senha da carteira. Se a senha da carteira e sua chave de recuperação forem perdidas, o conteúdo cifrado não pode ser recuperado pelo administrador. Nunca solicite essas credenciais pelo suporte.

O botão Bloquear remove as chaves e os dados em memória após concluir as gravações; sair também encerra a sessão criptográfica. A troca de conta aguarda a persistência anterior. O aplicativo sinaliza gravações pendentes e solicita confirmação de saída quando o navegador suporta esse aviso; fechar o processo ou desligar o aparelho pode interromper uma gravação ainda não concluída.

## Regras e publicação

As regras atuais do projeto foram consultadas sem ler carteiras: já restringem o acesso ao UID proprietário. O novo `firestore.rules` é um **protótipo para revisão**: mantém esse isolamento, proíbe listagem de carteiras, valida o envelope em criação e atualização e impede a volta a texto aberto ou a troca silenciosa do identificador da chave. O Firestore não consegue provar que um blob é criptograficamente válido; essa verificação é feita pelo cliente com AES-GCM.

O protótipo passou por 16 casos sintéticos usando a API de teste de regras. Não foi publicado e não altera as regras ativas. Revise e verifique as regras antes de distribuir amplamente o aplicativo. Clientes antigos que gravam o formato v2 deixarão de conseguir gravar após a implantação dessas regras.

Sequência proposta para aprovação:

1. Revisar o código e as regras, rodar `npm ci` e `npm test` e validar em aparelho real com uma conta exclusivamente de teste.
2. Publicar o cliente completo, incluindo os recursos de `app-assets.json`, pelo GitHub Pages e confirmar a nova versão.
3. Publicar as regras com `npx firebase-tools deploy --only firestore:rules --project minha-carteira-app-7b58d` e confirmar sua propagação.
4. Orientar os usuários a atualizar, fechar versões antigas, ativar a proteção e guardar a recuperação. Validar sincronização, modo avião e recuperação antes de uso amplo.

Não volte a publicar um cliente que só compreende v2 depois de contas terem migrado. Um rollback deve manter a capacidade de ler os envelopes e nunca substituir dados cifrados por uma carteira vazia.

## Validação e limites

Os testes cobrem senha incorreta, recuperação, IVs distintos, identidade e finalidade incorretas, conteúdo adulterado, armazenamento, fila, migração, erro de quota, transmissão cifrada, cache offline e dois aparelhos simulados. Há teste de interface para impedir que identificadores importados se tornem JavaScript executável. O HTML restringe scripts a arquivos locais e ao domínio oficial dos módulos Firebase por Content Security Policy; a autenticação não depende de handlers inline. O teste adicional em Chrome headless com viewport de 390px confirmou Web Crypto nativa, ausência de violações CSP, instalação do cache e reabertura/desbloqueio offline, com perfil temporário e dados fictícios.

Esses testes não equivalem a uma auditoria independente de criptografia, a um teste em celular real ou a uma certificação de conformidade. A implementação é específica desta aplicação e requer revisão de segurança antes de uso amplo.

Referências: [Firebase — criptografia e privacidade](https://firebase.google.com/support/privacy/), [OWASP — armazenamento criptográfico](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html), [OWASP — senhas e derivação](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Firebase — regras](https://firebase.google.com/docs/rules/manage-deploy).
