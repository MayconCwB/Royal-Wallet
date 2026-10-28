    /* ===== FIREBASE REST CLIENT ===== */
    async function fbFetch(url, options = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const resp = await fetch(url, { ...options, signal: options.signal || controller.signal });
        const data = await resp.json().catch(() => ({}));
        return { ok: resp.ok, status: resp.status, data };
      } catch (error) {
        if (error.name === 'AbortError' || error instanceof TypeError) error.code = 'NETWORK_UNAVAILABLE';
        throw error;
      } finally { clearTimeout(timer); }
    }

    async function mcSignup(email, password, displayName) {
      logEvent(`REST: Cadastrando ${email}...`);
      const url = `${AUTH_URL}signUp?key=${FB_API_KEY}`;
      const res = await fbFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      });

      if (!res.ok) {
        const errMsg = res.data?.error?.message || "";
        if (errMsg.includes("EMAIL_EXISTS")) throw new Error("Este e-mail já tem conta — use a aba 🔐 Entrar.");
        if (errMsg.includes("WEAK_PASSWORD")) throw new Error("A senha precisa de no mínimo 6 caracteres.");
        if (errMsg.includes("OPERATION_NOT_ALLOWED")) throw new Error("Cadastro desativado no Firebase Console.");
        throw new Error(errMsg || "Falha no cadastro.");
      }

      if (displayName) {
        await mcUpdateProfile(res.data.idToken, displayName).catch(() => {});
      }
      return res.data;
    }

    async function mcSignin(email, password) {
      logEvent(`REST: Autenticando ${email}...`);
      const url = `${AUTH_URL}signInWithPassword?key=${FB_API_KEY}`;
      const res = await fbFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      });

      if (!res.ok) {
        const errMsg = res.data?.error?.message || "";
        if (errMsg.includes("EMAIL_NOT_FOUND")) throw new Error("Nenhuma conta com esse e-mail.");
        if (errMsg.includes("INVALID_PASSWORD") || errMsg.includes("INVALID_LOGIN_CREDENTIALS")) {
          throw new Error("E-mail ou senha incorretos.");
        }
        throw new Error(errMsg || "Falha ao entrar.");
      }
      return res.data;
    }

    async function mcRefresh(refreshToken) {
      const res = await fbFetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
      });
      if (!res.ok) throw new Error("Sessão expirada no servidor.");
      return {
        idToken: res.data.id_token,
        refreshToken: res.data.refresh_token,
        uid: res.data.user_id,
        expiresIn: res.data.expires_in
      };
    }

    async function mcLookup(idToken) {
      const url = `${AUTH_URL}lookup?key=${FB_API_KEY}`;
      const res = await fbFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });
      if (!res.ok || !res.data.users || !res.data.users[0]) {
        throw new Error("Lookup de sessão falhou.");
      }
      return res.data.users[0]; // has localId, email, displayName, createdAt
    }

    async function mcUpdateProfile(idToken, displayName) {
      const url = `${AUTH_URL}update?key=${FB_API_KEY}`;
      const res = await fbFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, displayName, returnSecureToken: false })
      });
      if (!res.ok) throw new Error("Falha ao atualizar perfil.");
      return res.data;
    }

    async function mcResetPassword(email) {
      const url = `${AUTH_URL}sendOobCode?key=${FB_API_KEY}`;
      const res = await fbFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: "PASSWORD_RESET", email })
      });
      if (!res.ok) throw new Error("Falha ao enviar e-mail de redefinição.");
      return res.data;
    }

    async function mcDeleteAccount(idToken, uid) {
      if (!uid) throw new Error('Conta não identificada.');
      // Valida a sessão antes de apagar a carteira.
      const identity = await mcLookup(idToken);
      if (identity.localId !== uid) throw new Error('A sessão não corresponde à conta.');
      const removed = await fbFetch(`${FS_URL}/${uid}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (!removed.ok && removed.status !== 404) throw new Error('Não foi possível excluir os dados da nuvem. A conta foi mantida.');
      walletStorage.setItem(`royalDeletionPending_${uid}`, '1');
      const url = `${AUTH_URL}delete?key=${FB_API_KEY}`;
      const res = await fbFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken })
      });
      if (!res.ok) throw new Error("A carteira foi excluída da nuvem, mas a conta não foi removida. Entre novamente e repita a exclusão.");
      walletStorage.removeItem(`royalDeletionPending_${uid}`);
      globalThis.WalletQuickUnlock?.disable(uid);
      return res.data;
    }
