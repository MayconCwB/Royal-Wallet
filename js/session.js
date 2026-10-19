    /* ===== AUTH LOGIC ===== */
    let isRegisterMode = false;

    function setAuthError(msg) {
      const el = document.getElementById('authAlert');
      if (!msg) {
        el.style.display = 'none';
        return;
      }
      el.style.display = 'block';
      el.style.background = 'rgba(192, 57, 43, 0.2)';
      el.style.color = '#ff8f8f';
      el.style.border = '1px solid #c0392b';
      el.textContent = msg;
    }

    async function handleAuthSubmit(event) {
      event?.preventDefault();
      setAuthError('');
      const email = document.getElementById('authEmail').value.trim();
      const password = document.getElementById('authPassword').value;
      const nome = document.getElementById('authNome').value.trim();

      if (!email || !password) {
        setAuthError("Preencha e-mail e senha.");
        return;
      }

      const btn = document.getElementById('btnAuthSubmit');
      btn.disabled = true;
      btn.textContent = "Aguarde...";

      try {
        if (isRegisterMode) {
          const res = await mcSignup(email, password, nome);
          logEvent("Cadastro finalizado no Firebase REST.");
          AppState.user = {
            uid: res.localId,
            email: res.email,
            idToken: res.idToken,
            refreshToken: res.refreshToken,
            nome: nome || email.split('@')[0],
            tokenExpiresAt: Date.now() + (Number(res.expiresIn || 3600) * 1000)
          };
          AppState.isLocal = false;
          persistUserSession(AppState.user);
          // Carrega apenas o armazenamento desta identidade.
          await WalletPrivacy.prepare(AppState.user);
          await syncCloudOnLogin();
          enterApp({ email, password });
        } else {
          const res = await mcSignin(email, password);
          logEvent("Login realizado com sucesso no Firebase REST.");
          AppState.user = {
            uid: res.localId,
            email: res.email,
            idToken: res.idToken,
            refreshToken: res.refreshToken,
            nome: res.displayName || email.split('@')[0],
            tokenExpiresAt: Date.now() + (Number(res.expiresIn || 3600) * 1000)
          };
          AppState.isLocal = false;
          persistUserSession(AppState.user);

          // Check cloud doc vs local
          await WalletPrivacy.prepare(AppState.user);
          await syncCloudOnLogin();
          enterApp({ email, password });
        }
      } catch (err) {
        setAuthError(err.message);
        logEvent("Falha de autenticação: " + err.message);
      } finally {
        document.getElementById('authPassword').value = '';
        btn.disabled = false;
        btn.textContent = isRegisterMode ? "Cadastrar Conta" : "Entrar na Conta";
      }
    }

    async function syncCloudOnLogin(options = {}) {
      if (deletingAccount || !AppState.user || AppState.isLocal) return false;
      if (walletStorage.getItem(`royalDeletionPending_${AppState.user.uid}`)) {
        AppState.data = readLocalWallet() || emptyWallet();
        setSyncBadge('⚠️ Exclusão incompleta — repita a exclusão da conta');
        return false;
      }
      if (cloudSyncTask) return cloudSyncTask;
      const task = reconcileCloud(options);
      cloudSyncTask = task;
      const syncUid = AppState.user.uid;
      let completed = false;
      try { completed = await task; return completed; }
      finally {
        if (cloudSyncTask === task) cloudSyncTask = null;
        // Se houve edição durante o envio, sincroniza o snapshot que ficou pendente.
        if (completed && AppState.user?.uid === syncUid && readOfflineQueue().some(q => q.uid === syncUid)) {
          setTimeout(() => { if (AppState.user?.uid === syncUid) syncPendingCloud(); }, 700);
        }
      }
    }

    async function reconcileCloud(options = {}) {
      const user = { ...AppState.user };
      setSyncBadge('☁️ Buscando dados...');
      const cloud = await mcLoadDoc(user.uid, user.idToken);
      if (AppState.user?.uid !== user.uid || deletingAccount) return false;
      let local = readLocalWallet(user.uid);
      const queued = readOfflineQueue().filter(q => q.uid === user.uid);
      const latestQueued = queued.reduce((latest, q) => !latest || Number(q.data?.updatedAt || 0) > Number(latest.data?.updatedAt || 0) ? q : latest, null);
      // A fila antiga já identifica o dono e pode conter uma versão que ainda
      // não foi migrada para o armazenamento separado por conta.
      if (latestQueued?.data && (!local || Number(latestQueued.data.updatedAt || 0) > Number(local.updatedAt || 0))) {
        local = normalizeDataStructure(latestQueued.data, 'fila offline desta conta');
        walletStorage.setItem(localDataKey(user.uid), JSON.stringify(local));
      }
      const ack = Number(walletStorage.getItem(`royalCloudAck_${user.uid}`) || 0);
      const version = walletStorage.getItem(`royalCloudVersion_${user.uid}`);
      if (!cloud && (version || ack > 0)) {
        throw new Error('A carteira foi removida na nuvem. Os dados deste aparelho foram preservados; nenhuma recriação automática foi realizada.');
      }
      const pending = queued.length > 0;
      const dirty = local && (pending || Number(local.updatedAt) > ack);
      const unchanged = cloud && (version ? version === cloud._cloudUpdateTime : ack > 0 && ack === cloud.updatedAt);
      const useCloud = async () => {
        if (AppState.user?.uid !== user.uid || deletingAccount) return false;
        AppState.data = cloud;
        walletStorage.setItem(localDataKey(user.uid), JSON.stringify(cloud));
        walletStorage.setItem(`royalCloudAck_${user.uid}`, String(cloud.updatedAt));
        if (cloud._cloudUpdateTime) walletStorage.setItem(`royalCloudVersion_${user.uid}`, cloud._cloudUpdateTime);
        writeOfflineQueue(readOfflineQueue().filter(q => q.uid !== user.uid));
        await WalletStorage.flush();
        if (WalletPrivacy.needsMigration(user.uid)) {
          const saved = await mcSaveDoc(user.uid, AppState.user.idToken, cloud, { cloud, force: true });
          if (!saved) throw Error('A migração criptografada ainda não foi confirmada na nuvem. A cópia local foi preservada.');
        }
        setSyncBadge('🔐 Sincronizado e criptografado');
        renderAll();
        return true;
      };
      if (!cloud || (dirty && unchanged)) {
        AppState.data = local || emptyWallet();
        const ok = await mcSaveDoc(user.uid, AppState.user.idToken, AppState.data, { cloud });
        if (!ok) setSyncBadge('⚠️ Sincronização pendente');
        return ok;
      }
      if (!dirty) return useCloud();
      if (options.background && realtimeDeferredVersion === cloud._cloudUpdateTime) {
        setSyncBadge('⚠️ Conflito — aguardando sua escolha');
        return false;
      }
      // Ambas as versões mudaram: a escolha ocorre antes de qualquer escrita.
      AppState.data = local;
      setSyncBadge('⚠️ Conflito de versões');
      return new Promise(resolve => {
        let finished = false;
        const finish = value => {
          if (finished) return;
          finished = true;
          if (!value) realtimeDeferredVersion = cloud._cloudUpdateTime;
          cancelConflict = null;
          closeModal();
          resolve(value);
        };
        cancelConflict = () => finish(false);
        openModal('Conflito de Versões',
          '<p>Este aparelho e a nuvem têm alterações diferentes. Escolha qual carteira deseja manter. A versão escolhida substituirá a outra.</p>', [
          { label: 'Decidir depois', onClick: () => { setSyncBadge('⚠️ Sincronização pendente'); finish(false); } },
          { label: '☁️ Usar da nuvem', onClick: () => finish(useCloud()) },
          { label: '📱 Usar deste aparelho', primary: true, onClick: async () => {
            if (AppState.user?.uid !== user.uid || deletingAccount) return finish(false);
            const latest = readLocalWallet(user.uid) || local;
            const ok = await mcSaveDoc(user.uid, AppState.user.idToken, latest, { cloud, force: true });
            if (ok) { renderAll(); finish(true); }
            else { showToast('A nuvem mudou ou está indisponível. Sincronize novamente.'); finish(false); }
          } }
        ]);
      });
    }

    function enterApp(credentials = null) {
      if (!AppState.user || !WalletPrivacy.ready()) return;
      document.getElementById('loginOverlay').style.display = 'none';
      const userText = AppState.isLocal ? "📱 Sem conta (local)" : (AppState.user?.nome || AppState.user?.email || "Usuário");
      document.getElementById('headerUser').textContent = userText;
      document.getElementById('cfgEmailText').textContent = AppState.isLocal ? "Modo Local (Apenas neste aparelho)" : AppState.user?.email;
      document.getElementById('cfgNomeInput').value = AppState.user?.nome || "";
      document.getElementById('diagSessionStatus').textContent = AppState.isLocal ? "📱 Local" : "✅ Ativa (via lookup real)";
      document.getElementById('diagDocPath').textContent = AppState.isLocal ? "localStorage" : `carteiras/${AppState.user?.uid}`;

      // Show/hide cloud risk zone in Config
      const riskEl = document.getElementById('boxRiscoConta');
      if (riskEl) {
        riskEl.style.display = AppState.isLocal ? 'none' : 'block';
      }

      if (AppState.isLocal) setSyncBadge("📱 Sem conta (local)");
      renderAll();
      startRealtimeSync(credentials);
    }

    function clearWalletView() {
      if (cancelConflict) cancelConflict();
      closeModal();
      closeDrawer();
      AppState.data = emptyWallet();
      AppState.eventsLog = [];
      renderAll();
      document.getElementById('eventLogBox').textContent = '';
      for (const id of ['headerUser', 'cfgEmailText', 'diagDocPath', 'diagSessionStatus']) {
        document.getElementById(id).textContent = '';
      }
      document.querySelectorAll('#appMain input, #appMain textarea').forEach(input => { input.value = ''; });
    }

    function logout() {
      WalletPrivacy.endSession();
      stopRealtimeSync();
      clearRealtimeIdentity();
      if (AppState.saveQueueTimeout) clearTimeout(AppState.saveQueueTimeout);
      if (cancelConflict) cancelConflict();
      cloudSyncTask = null;
      clearWalletView();
      clearUserSession();
      AppState.user = null;
      AppState.isLocal = false;
      document.getElementById('loginOverlay').style.display = 'flex';
      logEvent("Usuário saiu do aplicativo.");
    }
