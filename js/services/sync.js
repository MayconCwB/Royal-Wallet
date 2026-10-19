    // Firestore Doc Save/Load — com fila offline e sincronização automática.
    const OFFLINE_QUEUE_KEY = 'royalSyncQueueV1';
    function localDataKey(uid = AppState.isLocal ? null : AppState.user?.uid) {
      return uid ? `royalLocalData_${uid}` : 'royalLocalData_device';
    }

    function emptyWallet() {
      return { movimentos: [], recorrentes: [], parcelas: [], dividas: [], metas: [], historico: [], updatedAt: Date.now() };
    }

    function readLocalWallet(uid = AppState.isLocal ? null : AppState.user?.uid) {
      const raw = walletStorage.getItem(localDataKey(uid));
      if (!raw) return null;
      // Um arquivo corrompido deve ser recuperado pelo usuário, nunca sobrescrito.
      let parsed = JSON.parse(raw);
      if (typeof parsed?.dados === 'string') parsed = JSON.parse(parsed.dados);
      else if (typeof parsed?.payload === 'string') parsed = JSON.parse(parsed.payload);
      return normalizeDataStructure(parsed, 'dados deste aparelho');
    }

    function migrateLegacyStorage() {
      // Lê somente o formato antigo nesta etapa. A proteção é aplicada no desbloqueio.
      const legacy = localStorage.getItem('royalLocalData');
      if (!legacy || localStorage.getItem('royalLegacyMigratedV2')) return;
      let session = null;
      try { session = JSON.parse(localStorage.getItem('royalToken') || 'null'); } catch (_) {}
      const key = session?.uid ? localDataKey(session.uid) : localDataKey(null);
      if (!localStorage.getItem(key)) localStorage.setItem(key, legacy);
      if (session?.uid) {
        localStorage.setItem('royalLegacyOwner', session.uid);
        const erased = localStorage.getItem('royalApagadoEm');
        if (erased) localStorage.setItem(`royalApagadoEm_${session.uid}`, erased);
      }
      // A cópia original é mantida para recuperação manual.
      localStorage.setItem('royalLegacyMigratedV2', '1');
    }

    let cloudSyncTask = null;
    let cancelConflict = null;
    let deletingAccount = false;
    const saveTasks = new Map();
    let realtimeSdkTask = null;
    let realtimeGeneration = 0;
    let realtimeUnsubscribe = null;
    let realtimeTimer = null;
    let realtimePending = false;
    let realtimeProcessing = false;
    let realtimeFallback = false;
    let realtimeDeferredVersion = null;
    let realtimeIdentityTask = Promise.resolve();

    async function loadRealtimeSdk() {
      if (!realtimeSdkTask) {
        realtimeSdkTask = (async () => {
          const [appApi, authApi, firestoreApi] = await Promise.all([
            import('https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js'),
            import('https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js'),
            import('https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js')
          ]);
          const app = appApi.initializeApp({ apiKey: FB_API_KEY, projectId: FB_PROJECT,
            authDomain: `${FB_PROJECT}.firebaseapp.com` }, 'royal-wallet-realtime');
          const auth = authApi.getAuth(app);
          await auth.authStateReady();
          return { auth, db: firestoreApi.getFirestore(app), ...authApi, ...firestoreApi };
        })().catch(err => { realtimeSdkTask = null; throw err; });
      }
      return realtimeSdkTask;
    }

    function stopRealtimeSync() {
      realtimeGeneration++;
      if (realtimeUnsubscribe) realtimeUnsubscribe();
      realtimeUnsubscribe = null;
      if (realtimeTimer) clearTimeout(realtimeTimer);
      realtimeTimer = null;
      realtimePending = false;
      realtimeFallback = false;
      realtimeProcessing = false;
      realtimeDeferredVersion = null;
      const pill = document.getElementById('offlineSyncPill');
      if (pill && navigator.onLine) pill.textContent = '🌐 Online';
    }

    function realtimeAllowed(uid, generation) {
      return generation === realtimeGeneration && AppState.user?.uid === uid &&
        !AppState.isLocal && !deletingAccount && navigator.onLine &&
        !walletStorage.getItem(`royalDeletionPending_${uid}`);
    }

    function scheduleRealtimeCheck(uid, generation, delay = 100) {
      if (realtimeTimer) clearTimeout(realtimeTimer);
      realtimeTimer = setTimeout(() => {
        realtimeTimer = null;
        processRealtimeChange(uid, generation);
      }, delay);
    }

    async function processRealtimeChange(uid, generation) {
      if (!realtimeAllowed(uid, generation)) return;
      if (document.visibilityState === 'hidden') return;
      // Não interrompe o preenchimento de um formulário nem abre outro conflito.
      if (document.getElementById('genericModalBackdrop')?.classList.contains('active')) {
        scheduleRealtimeCheck(uid, generation, 1000);
        return;
      }
      if (realtimeProcessing) return;
      realtimeProcessing = true;
      try {
        if (cloudSyncTask) await cloudSyncTask;
        if (!realtimeAllowed(uid, generation)) return;
        if (realtimePending) {
          realtimePending = false;
          await syncPendingCloud({ background: true });
        }
      } finally {
        if (generation === realtimeGeneration) {
          realtimeProcessing = false;
          if (realtimeAllowed(uid, generation) && (realtimePending || realtimeFallback)) {
            if (realtimeFallback) realtimePending = true;
            scheduleRealtimeCheck(uid, generation, realtimeFallback ? 15000 : 100);
          }
        }
      }
    }

    async function startRealtimeSync(credentials = null) {
      stopRealtimeSync();
      if (!AppState.user || AppState.isLocal || deletingAccount || !navigator.onLine) return;
      const uid = AppState.user.uid;
      const generation = realtimeGeneration;
      try {
        const sdk = await loadRealtimeSdk();
        await realtimeIdentityTask.catch(() => {});
        if (!realtimeAllowed(uid, generation)) return;
        if (credentials) {
          // A senha é usada apenas nesta chamada; não é armazenada pelo aplicativo.
          const previousIdentityTask = realtimeIdentityTask;
          realtimeIdentityTask = previousIdentityTask.catch(() => {}).then(async () => {
            if (realtimeAllowed(uid, generation)) {
              await sdk.signInWithEmailAndPassword(sdk.auth, credentials.email, credentials.password);
            }
          });
          await realtimeIdentityTask;
          if (!realtimeAllowed(uid, generation)) return;
        }
        if (sdk.auth.currentUser?.uid !== uid) {
          throw new Error('Entre novamente para ativar a conexão em tempo real nesta sessão.');
        }
        let lastSnapshot = null;
        realtimeUnsubscribe = sdk.onSnapshot(sdk.doc(sdk.db, 'carteiras', uid),
          { includeMetadataChanges: true }, snapshot => {
            if (!realtimeAllowed(uid, generation) || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
            const fingerprint = snapshot.exists() ? JSON.stringify(snapshot.data()) : 'documento-removido';
            if (fingerprint === lastSnapshot) return;
            lastSnapshot = fingerprint;
            realtimePending = true;
            scheduleRealtimeCheck(uid, generation);
          }, err => {
            if (!realtimeAllowed(uid, generation)) return;
            if (realtimeUnsubscribe) realtimeUnsubscribe();
            realtimeUnsubscribe = null;
            if (err.code === 'permission-denied' || err.code === 'unauthenticated') {
              setSyncBadge('⚠️ Conexão em tempo real sem acesso — entre novamente');
              const pill = document.getElementById('offlineSyncPill');
              if (pill) pill.textContent = '🌐 Online • atualização pausada';
              logEvent('Listener sem acesso: ' + err.message);
              return;
            }
            enableRealtimeFallback(uid, generation, err.message);
          });
        logEvent('Atualizações em tempo real ativadas para esta conta.');
        const pill = document.getElementById('offlineSyncPill');
        if (pill) pill.textContent = '🌐 Online • tempo real';
      } catch (err) {
        if (realtimeAllowed(uid, generation)) enableRealtimeFallback(uid, generation, err.message);
      }
    }

    function enableRealtimeFallback(uid, generation, reason) {
      realtimeFallback = true;
      realtimePending = true;
      const pill = document.getElementById('offlineSyncPill');
      if (pill) pill.textContent = '🌐 Online • atualização a cada 15 s';
      logEvent('Atualização automática a cada 15 segundos: ' + reason);
      scheduleRealtimeCheck(uid, generation, 15000);
    }

    async function clearRealtimeIdentity() {
      // Não inicializa o SDK só para sair de uma sessão antiga ou local.
      if (!realtimeSdkTask) return;
      const sdkTask = realtimeSdkTask;
      const previousIdentityTask = realtimeIdentityTask;
      realtimeIdentityTask = previousIdentityTask.catch(() => {}).then(async () => {
        try { const sdk = await sdkTask; await sdk.signOut(sdk.auth); } catch (_) {}
      });
      await realtimeIdentityTask;
    }

    function readOfflineQueue() {
      try { return JSON.parse(walletStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); } catch { return []; }
    }

    function writeOfflineQueue(queue) {
      try { walletStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue)); } catch (e) { console.warn('Fila offline:', e); }
      const queueEl = document.getElementById('diagQueueCount');
      if (queueEl) queueEl.textContent = queue.length ? String(queue.length) + ' pendente(s)' : '0';
    }

    function queueOfflineSnapshot(dataObj) {
      const queue = readOfflineQueue();
      // Mantemos somente o snapshot mais recente: o estado completo já contém todas as alterações.
      const item = {
        uid: AppState.isLocal ? null : AppState.user?.uid || null,
        data: JSON.parse(JSON.stringify(dataObj)),
        queuedAt: Date.now()
      };
      if (!item.uid) return;
      if (queue.some(q => q.uid === item.uid && Number(q.data?.updatedAt || 0) > Number(dataObj.updatedAt || 0))) return;
      const filtered = queue.filter(q => q.uid && item.uid && q.uid !== item.uid);
      filtered.push(item);
      writeOfflineQueue(filtered);
    }

    async function mcSaveDoc(uid, idToken, dataObj, options = {}) {
      const snapshot = JSON.parse(JSON.stringify(dataObj));
      const previous = saveTasks.get(uid) || Promise.resolve();
      const task = previous.catch(() => {}).then(() => saveCloudSnapshot(uid, idToken, snapshot, options));
      saveTasks.set(uid, task);
      try { return await task; }
      finally { if (saveTasks.get(uid) === task) saveTasks.delete(uid); }
    }

    async function saveCloudSnapshot(uid, idToken, dataObj, options = {}) {
      await WalletStorage.flush();
      if (!uid) {
        const current = walletStorage.getItem(localDataKey(uid));
        if (!current || Number(JSON.parse(current).updatedAt || 0) <= Number(dataObj.updatedAt || 0)) {
          walletStorage.setItem(localDataKey(uid), JSON.stringify(dataObj));
        }
        await WalletStorage.flush();
        setSyncBadge("📱 Salvo no aparelho");
        return true;
      }

      // Sempre salva primeiro localmente. Se a rede falhar, a fila garante o envio posterior.
      const current = walletStorage.getItem(localDataKey(uid));
      if (!current || Number(JSON.parse(current).updatedAt || 0) <= Number(dataObj.updatedAt || 0)) {
        walletStorage.setItem(localDataKey(uid), JSON.stringify(dataObj));
      }
      await WalletStorage.flush();
      if (walletStorage.getItem(`royalDeletionPending_${uid}`)) {
        setSyncBadge('⚠️ Exclusão incompleta — repita a exclusão da conta');
        return false;
      }

      if (!navigator.onLine) {
        queueOfflineSnapshot(dataObj);
        setSyncBadge("📴 Offline — salvo no aparelho");
        logEvent("Sem internet: alteração colocada na fila de sincronização.");
        return false;
      }

      setSyncBadge("☁️ Sincronizando...");
      let url = `${FS_URL}/${uid}`;
      const firestoreBody = { fields: await WalletPrivacy.encodeCloud(uid, dataObj) };

      try {
        const cloud = Object.hasOwn(options, 'cloud') ? options.cloud : await mcLoadDoc(uid, idToken);
        const ack = Number(walletStorage.getItem(`royalCloudAck_${uid}`) || 0);
        const version = walletStorage.getItem(`royalCloudVersion_${uid}`);
        const unchanged = cloud && (version ? version === cloud._cloudUpdateTime : ack > 0 && ack === cloud.updatedAt);
        if (cloud && !options.force && !unchanged) {
          if (AppState.user?.uid === uid) queueOfflineSnapshot(dataObj);
          setSyncBadge('⚠️ Conflito — sincronize para escolher a versão');
          return false;
        }
        if (cloud && !cloud._cloudUpdateTime) throw new Error('A versão da nuvem não pôde ser verificada.');
        url += cloud ? `?currentDocument.updateTime=${encodeURIComponent(cloud._cloudUpdateTime)}` : '?currentDocument.exists=false';
        if (deletingAccount && !options.diagnostic) return false;
        let res = await fbFetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
          body: JSON.stringify(firestoreBody)
        });

        if (res.status === 401 && AppState.user?.uid === uid && AppState.user?.refreshToken && navigator.onLine) {
          logEvent("Token expirado, renovando sessão...");
          const refreshed = await mcRefresh(AppState.user.refreshToken);
          if (AppState.user?.uid !== uid || deletingAccount) return false;
          AppState.user.idToken = refreshed.idToken;
          AppState.user.refreshToken = refreshed.refreshToken;
          AppState.user.tokenExpiresAt = Date.now() + (Number(refreshed.expiresIn || 3600) * 1000);
          persistUserSession(AppState.user);
          res = await fbFetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${refreshed.idToken}` },
            body: JSON.stringify(firestoreBody)
          });
        }

        if (res.status === 200) {
          WalletPrivacy.cloudSaved(uid);
          // Remove somente o snapshot desta conta que já foi confirmado.
          const confirmedAt = Number(dataObj.updatedAt || 0);
          const queue = readOfflineQueue().filter(q => !(q.uid === uid && Number(q.data?.updatedAt || 0) <= confirmedAt));
          writeOfflineQueue(queue);

          // Guarda uma confirmação explícita da versão que chegou ao Firestore.
          // Isso evita que o próprio dado recém-sincronizado seja tratado como
          // "conflito" no próximo login.
          try {
            walletStorage.setItem(`royalCloudAck_${uid}`, String(confirmedAt));
            if (res.data.updateTime) walletStorage.setItem(`royalCloudVersion_${uid}`, res.data.updateTime);
          } catch (_) {}

          // Uma resposta antiga não substitui alterações feitas durante o envio.
          const current = walletStorage.getItem(localDataKey(uid));
          if (!current || Number(JSON.parse(current).updatedAt || 0) <= Number(dataObj.updatedAt || 0)) {
            walletStorage.setItem(localDataKey(uid), JSON.stringify(dataObj));
          }
          await WalletStorage.flush();
          if (AppState.user?.uid === uid) {
            const pending = readOfflineQueue().some(q => q.uid === uid);
            setSyncBadge(pending ? '⚠️ Alterações pendentes' : '☁️ Sincronizado');
          }
          const lastSyncEl = document.getElementById('diagLastSync');
          if (lastSyncEl) lastSyncEl.textContent = new Date().toLocaleTimeString('pt-BR');
          logEvent("Sincronização com a nuvem confirmada.");
          return true;
        }

        if (AppState.user?.uid === uid) {
          queueOfflineSnapshot(dataObj);
        }
        setSyncBadge("⚠️ Aguardando sincronização");
        logEvent(`Nuvem indisponível: HTTP ${res.status}. Dados preservados no aparelho.`);
        return false;
      } catch (err) {
        if (AppState.user?.uid === uid) queueOfflineSnapshot(dataObj);
        setSyncBadge("📴 Sem conexão — aguardando sincronização");
        logEvent("Falha de rede: dados preservados no aparelho e na fila offline.");
        return false;
      }
    }

    async function syncPendingCloud(options = {}) {
      if (deletingAccount || AppState.isLocal || !AppState.user || !navigator.onLine) return false;
      try { return await syncCloudOnLogin(options); }
      catch (err) {
        setSyncBadge('⚠️ Sincronização pendente');
        logEvent('Sincronização preservada para tentar novamente: ' + err.message);
        return false;
      }
    }

    async function mcLoadDoc(uid, idToken) {
      if (!uid) {
        const raw = walletStorage.getItem(localDataKey());
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.dados === 'string') {
            return normalizeDataStructure(JSON.parse(parsed.dados), "v1 string (local)");
          }
          if (parsed && typeof parsed.payload === 'string') {
            return normalizeDataStructure(JSON.parse(parsed.payload), "v1 string (local)");
          }
          return normalizeDataStructure(parsed, "v2 estruturado (local)");
        } catch {
          return null;
        }
      }

      const url = `${FS_URL}/${uid}`;
      let res = await fbFetch(url, {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });

      if (res.status === 401 && AppState.user?.uid === uid && AppState.user?.refreshToken) {
        const refreshed = await mcRefresh(AppState.user.refreshToken);
        if (AppState.user?.uid !== uid) throw new Error('A conta ativa mudou durante a leitura.');
        AppState.user.idToken = refreshed.idToken;
        AppState.user.refreshToken = refreshed.refreshToken;
        persistUserSession(AppState.user);
        res = await fbFetch(url, {
          headers: { 'Authorization': `Bearer ${refreshed.idToken}` }
        });
      }

      if (res.status === 404) {
        logEvent("Documento na nuvem ainda não existe (404).");
        return null;
      }

      if (res.ok && res.data?.fields) {
        const f = res.data.fields;
        if (f.v?.stringValue === 'e2ee-1') return { ...normalizeDataStructure(await WalletPrivacy.decodeCloud(uid, f), 'carteira criptografada'), _cloudUpdateTime: res.data.updateTime };
        if (walletStorage.getItem(`royalE2eeActivated_${uid}`) === '1') throw Error('A carteira já foi criptografada; o formato recebido não é confiável. Nenhum dado foi substituído.');

        // PRIORIDADE 1: Formato novo estruturado (v2) com campos nativos
        const isV2 = f.v?.stringValue === '2' || f.movimentos || f.recorrentes || f.parcelas || f.dividas || f.metas || f.historico;
        if (isV2 && (f.movimentos?.arrayValue || f.recorrentes?.arrayValue || f.parcelas?.arrayValue || f.dividas?.arrayValue || f.metas?.arrayValue || f.historico?.arrayValue || f.v?.stringValue === '2')) {
          const tsVal = f.atualizadoEm ? fromFsValue(f.atualizadoEm) : (f.updatedAt ? fromFsValue(f.updatedAt) : Date.now());
          const rawV2 = {
            movimentos: f.movimentos ? fromFsValue(f.movimentos) || [] : [],
            recorrentes: f.recorrentes ? fromFsValue(f.recorrentes) || [] : [],
            parcelas: f.parcelas ? fromFsValue(f.parcelas) || [] : [],
            dividas: f.dividas ? fromFsValue(f.dividas) || [] : [],
            metas: f.metas ? fromFsValue(f.metas) || [] : [],
            historico: f.historico ? fromFsValue(f.historico) || [] : [],
            contas: f.contas ? fromFsValue(f.contas) || [] : [],
            cartoes: f.cartoes ? fromFsValue(f.cartoes) || [] : [],
            lixeira: f.lixeira ? fromFsValue(f.lixeira) || [] : [],
            updatedAt: Number(tsVal) || Date.now(),
            v: "2",
            nome: f.nome ? fromFsValue(f.nome) : (AppState.user?.nome || '')
          };
          return { ...normalizeDataStructure(rawV2, 'v2 estruturado'), _cloudUpdateTime: res.data.updateTime };
        }

        // PRIORIDADE 2: Compatibilidade com formato antigo (v1) onde vinha string em "dados" ou "payload"
        const oldString = f.dados?.stringValue || f.payload?.stringValue;
        if (oldString) {
          try {
            const parsed = JSON.parse(oldString);
            return { ...normalizeDataStructure(parsed, 'v1 string'), _cloudUpdateTime: res.data.updateTime };
          } catch (err) {
            throw new Error("Os dados da nuvem estão inválidos; nenhuma gravação foi realizada.");
          }
        }
      }
      throw new Error(`Não foi possível ler a carteira da nuvem (HTTP ${res.status}). Nenhum dado foi substituído.`);
    }

    function setSyncBadge(txt) {
      const el = document.getElementById('syncStatus');
      if (el) el.textContent = txt;
    }

    function persistUserSession(u) {
      walletStorage.setItem('royalToken', JSON.stringify(u));
    }

    function clearUserSession() {
      walletStorage.removeItem('royalToken');
    }

    function triggerAutoSave() {
      AppState.data.updatedAt = Math.max(Date.now(), Number(AppState.data.updatedAt || 0) + 1);
      walletStorage.setItem(localDataKey(), JSON.stringify(AppState.data));
      setSyncBadge("🔐 Salvando no aparelho...");

      if (AppState.saveQueueTimeout) clearTimeout(AppState.saveQueueTimeout);
      queueOfflineSnapshot(AppState.data);

      AppState.saveQueueTimeout = setTimeout(async () => {
        try { await WalletStorage.flush(); } catch (_) { setSyncBadge("⚠️ Não salvo — mantenha o aplicativo aberto"); return; }
        if (!AppState.isLocal && AppState.user && navigator.onLine) {
          await syncPendingCloud();
        } else if (AppState.isLocal) {
          setSyncBadge("📱 Salvo no aparelho");
        } else {
          setSyncBadge("📴 Offline — salvo no aparelho");
        }
      }, 700);
    }
