# Criptografia e ativação da versão 1.1

## Estado e alcance

O cliente e as regras E2EE foram publicados após autorização do responsável pelo projeto. Nenhuma carteira real foi migrada pelos testes de desenvolvimento. A proteção começa quando cada usuário abre a nova versão, cria a senha da carteira e confirma que guardou a chave de recuperação. Uma implantação de código não significa que todas as contas existentes já tenham sido convertidas. A revisão posterior está registrada em [Revisão de segurança](SECURITY-REVIEW.md).

O Firestore já utiliza criptografia do provedor e HTTPS. A camada nova cifra os dados financeiros no aparelho, antes de enviá-los ao Firestore. Movimentos, valores, descrições, contas, cartões, dívidas, metas, histórico e lixeira ficam dentro do conteúdo cifrado, inclusive nas cópias locais, filas offline e novos backups exportados.

E-mail, perfil de autenticação e tokens continuam sendo gerenciados pelo Firebase Auth. Identificação da carteira, versão do formato, horário de alteração, tamanhos dos dados e parâmetros públicos de criptografia continuam visíveis. A proteção não oculta esses metadados nem protege uma carteira já desbloqueada contra um aparelho comprometido, extensões maliciosas ou código adulterado servido pelo responsável pelo site.

## Chaves e formatos

- Chave de dados aleatória de 256 bits, gerada por `crypto.getRandomValues`.
- AES-256-GCM via Web Crypto, com IV aleatório de 96 bits a cada operação e tag de autenticação de 128 bits.
- Chave de encapsulamento derivada da senha com PBKDF2-SHA256, 600.000 iterações e salt aleatório de 128 bits. Senha mínima de 12 caracteres; frases longas são preferíveis.
- Chave de recuperação independente, aleatória, de 256 bits. O arquivo de recuperação contém essa chave e deve ser guardado pelo usuário fora do aparelho.
- A chave de dados é encapsulada separadamente pela senha e pela recuperação. Na nuvem e nos backups são persistidos somente encapsulamentos e parâmetros públicos. Para manter o acesso local, o navegador também persiste um CryptoKey AES não extraível no IndexedDB, separado por UID.
- Identidade, identificador da chave, versão e finalidade entram nos dados adicionais autenticados. Cópias de nuvem, armazenamento local e backup têm contextos distintos.
- Chaves AES não são exportáveis. Senha e recuperação não são gravadas em localStorage. Em novas carteiras conectadas, o mesmo valor da senha de login protege o envelope da carteira; esse valor é processado pelo Firebase Auth no login. A chave de dados e a recuperação não são enviadas ao provedor.

O documento `carteiras/{uid}` passa a conter somente `v=e2ee-1`, `atualizadoEm`, `encryption` e `payload`. O conteúdo autenticado inclui também a versão lógica da carteira; inconsistências com o horário externo são rejeitadas.

## Migração

1. A sessão de login identifica a carteira e verifica os parâmetros públicos da nuvem.
2. Para uma carteira nova ou legada, o usuário cria a senha e guarda a recuperação antes de prosseguir.
3. A cópia local e a fila são cifradas e decifradas para verificação antes da substituição das cópias legadas correspondentes. O armazenamento novo usa nomes separados: `royalVaultData_<uid>` e `royalVaultQueue_<uid>`.
4. O fluxo normal de conflitos escolhe qual snapshot utilizar. O envio cifra o snapshot e usa a mesma precondição de versão do Firestore para evitar substituir uma alteração simultânea.
5. A conversão da nuvem só é considerada concluída depois da confirmação do servidor. Falhas preservam a cópia local e as pendências.

Contas de outros usuários presentes no mesmo aparelho só são migradas quando o respectivo dono desbloqueia sua carteira. Cópias históricas do provedor, exportações antigas e arquivos externos em texto aberto não são recriptografados por esta mudança. Feche abas e versões antigas antes da ativação. Uma cópia legada mais recente encontrada após a migração causa bloqueio de segurança e preservação de ambas as versões para recuperação, sem sobrescrita automática.

## Desbloqueio, recuperação e perdas

Depois da primeira ativação, o navegador salva o acesso e pode reabrir a carteira offline sem pedir a senha. A primeira ativação de uma conta autenticada exige internet, para evitar criar uma chave diferente da existente na nuvem. Carteiras antigas podem exigir a senha anterior uma vez por aparelho; novas carteiras conectadas reutilizam a senha de login. No modo local a senha inicial continua sendo criada no aparelho.

Para recuperar o acesso, use a opção de chave de recuperação e escolha uma nova senha. Isso encapsula novamente a mesma chave de dados e preserva o conteúdo. A nova senha é sincronizada quando o envio é confirmado. A recuperação não revoga chaves ou encapsulamentos que um invasor já tenha copiado. Rotação por comprometimento da chave de dados exige um procedimento futuro específico.

Redefinir a senha de login do Firebase não recupera a senha da carteira. Se a senha da carteira e sua chave de recuperação forem perdidas, o conteúdo cifrado não pode ser recuperado pelo administrador. Nunca solicite essas credenciais pelo suporte.

Sair remove o acesso salvo desse UID e encerra a sessão criptográfica após concluir as gravações. Uma marca de revogação impede reutilizar o acesso se a exclusão no IndexedDB falhar. A restauração verifica UID, metadados e abertura dos envelopes existentes; falha não apaga os dados e permite entrar pela senha. Quem tiver acesso ao navegador conectado pode abrir a carteira: a chave não extraível não protege contra código malicioso executando na mesma origem. IndexedDB, acesso local salvo e tokens não entram nos backups.

Fechar o aplicativo mantém o acesso. Bloqueio manual interno encerra o acesso salvo e exige senha. Navegação privada, limpeza do navegador ou falha de armazenamento podem impedir a persistência; o cliente informa a falha e conserva o caminho por senha/recuperação. O teste com Chromium reinicia o processo e comprova reabertura offline, isolamento por UID, ausência de senha em disco e chave não extraível. Ainda depende de validação em aparelhos físicos.

A versão 1.1.1 compara os valores criptográficos em ordem fixa, sem depender da ordem das propriedades JSON devolvidas pelo servidor. Registros de acesso da versão anterior são lidos de forma compatível; uma alteração real na proteção continua invalidando o acesso. O teste de navegador reproduz respostas de nuvem reordenadas e comprova restauração de um registro antigo sem nova senha.

## Regras e publicação

As regras ativas do projeto foram consultadas sem ler carteiras e conferem com `firestore.rules`: restringem o acesso ao UID proprietário, proíbem listagem de carteiras, validam o envelope em criação e atualização e impedem a volta ao formato em texto aberto ou a troca silenciosa do identificador da chave. O Firestore não consegue provar que um blob é criptograficamente válido; essa verificação é feita pelo cliente com AES-GCM.

As regras publicadas passaram por 55 casos sintéticos usando a API de teste de regras. Essa avaliação não gravou documentos nem alterou as regras ativas. Clientes antigos que gravam o formato v2 não conseguem mais gravar; devem atualizar o aplicativo.

Sequência para futuras publicações:

1. Revisar o código e as regras, rodar `npm ci` e `npm test` e validar em aparelho real com uma conta exclusivamente de teste.
2. Publicar o cliente completo, incluindo os recursos de `app-assets.json`, pelo GitHub Pages e confirmar a nova versão.
3. Publicar as regras com `npx firebase-tools deploy --only firestore:rules --project minha-carteira-app-7b58d` e confirmar sua propagação.
4. Orientar os usuários a atualizar, fechar versões antigas, ativar a proteção e guardar a recuperação. Validar sincronização, modo avião e recuperação antes de uso amplo.

Não volte a publicar um cliente que só compreende v2 depois de contas terem migrado. Um rollback deve manter a capacidade de ler os envelopes e nunca substituir dados cifrados por uma carteira vazia.

## Validação e limites

O experimento de desbloqueio rápido foi retirado. O acesso usa a senha da carteira e a chave de recuperação, preservando o formato criptografado anterior. Ao abrir, o cliente remove somente as preferências locais do experimento.

Os testes cobrem senha incorreta, recuperação, IVs distintos, identidade e finalidade incorretas, conteúdo adulterado, armazenamento, fila, migração, erro de quota, transmissão cifrada, cache offline e dois aparelhos simulados. Há teste de interface para impedir que identificadores importados se tornem JavaScript executável. O HTML restringe scripts a arquivos locais e ao domínio oficial dos módulos Firebase por Content Security Policy; a autenticação não depende de handlers inline. O teste adicional em Chrome headless com viewport de 390px confirmou Web Crypto nativa, ausência de violações CSP, instalação do cache e reabertura/desbloqueio offline, com perfil temporário e dados fictícios.

Esses testes não equivalem a uma auditoria independente de criptografia, a um teste em celular real ou a uma certificação de conformidade. A implementação é específica desta aplicação e requer revisão de segurança antes de uso amplo.

Referências: [Firebase — criptografia e privacidade](https://firebase.google.com/support/privacy/), [OWASP — armazenamento criptográfico](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html), [OWASP — senhas e derivação](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Firebase — regras](https://firebase.google.com/docs/rules/manage-deploy).
