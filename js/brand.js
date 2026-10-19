    /* ===== A) ÍCONE DA MARCA — PNG LOCAL DO APLICATIVO ===== */
    // A logo é um recurso local incluído no cache offline.
    // Não depende de um servidor de imagens externo.
    const ICON_SRC = "./assets/brand/royal-wallet.png";

    let activeResolvedIcon = ICON_SRC;
    let activeIconDiagnostic = 'Ícone: PNG local disponível offline';

    async function getIconSrc() {
      return new URL(activeResolvedIcon, location.href).href;
    }
