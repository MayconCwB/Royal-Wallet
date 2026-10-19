    /* ===== B) REST FIREBASE CONFIG ===== */
    const FB_API_KEY = "AIzaSyC8MP3RmMg1MaK7r-x-edjMuE9v6gn_jCA";
    const FB_PROJECT = "minha-carteira-app-7b58d";
    const AUTH_URL = "https://identitytoolkit.googleapis.com/v1/accounts:";
    const TOKEN_URL = "https://securetoken.googleapis.com/v1/token?key=" + FB_API_KEY;
    const FS_URL = "https://firestore.googleapis.com/v1/projects/" + FB_PROJECT + "/databases/(default)/documents/carteiras";

    // Application State
    const AppState = {
      user: null, // { uid, email, idToken, refreshToken, exp, nome }
      isLocal: false,
      currentTab: 'resumo',
      planOffset: 0, // 0 = current month, 1 = next month, etc.
      eventsLog: [],
      saveQueueTimeout: null,
      data: {
        movimentos: [],
        recorrentes: [],
        parcelas: [],
        dividas: [],
        metas: [],
        historico: [],
        updatedAt: 0
      }
    };

    // Helper: Formatter BRL
    const fmtBRL = (val) => {
      const num = Number(val) || 0;
      return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };
