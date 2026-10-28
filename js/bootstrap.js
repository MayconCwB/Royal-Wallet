    /* ===== INITIALIZATION ===== */
    document.addEventListener('DOMContentLoaded', async () => {
      // Prepara a abertura offline antes de qualquer chamada de autenticação.
      if ('serviceWorker' in navigator && window.isSecureContext) {
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(registration => {
          const checkUpdate = () => { if (navigator.onLine) registration.update().catch(() => {}); };
          window.addEventListener('online', checkUpdate);window.addEventListener('focus', checkUpdate);
          return navigator.serviceWorker.ready;
        }).then(() => {
          logEvent('Aplicativo preparado para abrir offline neste aparelho.');
        }).catch(e => logEvent('Preparação offline pendente: ' + e.message));
      }
      migrateLegacyStorage();
      // 1. Brand icons (PNG real exclusivo ou placeholder neutro)
      await setupBrandAssets();

      // 2. Theme setup
      const savedTheme = walletStorage.getItem('royalTema') || 'dark';
      document.documentElement.setAttribute('data-theme', savedTheme);

      document.getElementById('btnToggleTheme')?.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme');
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        walletStorage.setItem('royalTema', next);
        showToast(`Tema alterado para ${next === 'dark' ? 'Escuro' : 'Claro'}`);
      });

      // 3. Navigation Listeners
      document.getElementById('btnMenu').addEventListener('click', openDrawer);
      document.getElementById('btnCloseDrawer').addEventListener('click', closeDrawer);
      document.getElementById('drawerOverlay').addEventListener('click', (e) => {
        if (e.target.id === 'drawerOverlay') closeDrawer();
      });

      document.querySelectorAll('.nav-item-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
      });

      // Accordion in Passo a Passo
      document.querySelectorAll('.faq-header').forEach(header => {
        header.addEventListener('click', () => {
          const item = header.parentElement;
          const isActive = item.classList.contains('active');
          document.querySelectorAll('.faq-item').forEach(i => i.classList.remove('active'));
          if (!isActive) item.classList.add('active');
        });
      });

      // ? Explanations Delegated Listener
      document.addEventListener('click', (e) => {
        const btn = e.target.closest('.help-bubble-btn');
        if (btn) {
          const term = btn.getAttribute('data-help');
          if (term) showExplanationModal(term);
        }
      });

      // Generic Modal Close
      document.getElementById('btnGenericModalClose').addEventListener('click', closeModal);

      // Buttons for Actions
      document.getElementById('btnNovoMovimento').addEventListener('click', () => openMovimentoForm());
      document.getElementById('btnImportarCsv').addEventListener('click', () => document.getElementById('inputImportarCsv').click());
      document.getElementById('inputImportarCsv').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) importCsvFile(file);
        e.target.value = '';
      });
      document.getElementById('btnNovoRecorrente').addEventListener('click', () => openRecorrenteForm());
      document.getElementById('btnNovaParcela').addEventListener('click', () => openParcelaForm());
      document.getElementById('btnNovaDivida').addEventListener('click', () => openDividaForm());
      document.getElementById('btnNovaMeta').addEventListener('click', () => openMetaForm());

      // Filters
      document.getElementById('buscaMovimento').addEventListener('input', renderMovimentos);
      document.getElementById('filtroTipoMovimento').addEventListener('change', renderMovimentos);
      document.getElementById('buscaHistorico').addEventListener('input', renderHistorico);

      // Planning Month Nav
      document.getElementById('btnPlanPrevMonth').addEventListener('click', () => {
        AppState.planOffset -= 1;
        renderPlanejamento();
      });
      document.getElementById('btnPlanNextMonth').addEventListener('click', () => {
        AppState.planOffset += 1;
        renderPlanejamento();
      });

      // Backup Buttons
      document.getElementById('btnExportJson').addEventListener('click', exportBackupJson);
      document.getElementById('inputImportJson').addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          importBackupJson(e.target.files[0]);
        }
      });

      document.getElementById('btnSyncNow').addEventListener('click', async () => {
        if (AppState.user && !AppState.isLocal) {
          const ok = await syncPendingCloud();
          if (ok) showToast("Sincronizado com a nuvem!");
        } else {
          showToast("Dados salvos no aparelho!");
        }
      });

      // Diagnóstico somente de leitura: nunca cria contas nem altera carteiras.
      document.getElementById('btnRunDiagnostics').addEventListener('click', async () => {
        const diagEl = document.getElementById('diagTestResult');
        if (AppState.isLocal || !AppState.user || !WalletPrivacy.ready()) {
          diagEl.textContent = 'Entre e desbloqueie sua carteira para verificar a conexão.';
          return;
        }
        const user = { ...AppState.user };
        diagEl.textContent = 'Verificando sessão e leitura da carteira...';
        try {
          const identity = await mcLookup(user.idToken);
          if (identity.localId !== user.uid) throw Error('A sessão não corresponde à conta.');
          const loaded = await mcLoadDoc(user.uid, user.idToken);
          if (AppState.user?.uid !== user.uid || !WalletPrivacy.ready()) return;
          diagEl.textContent = loaded ? '✅ Sessão válida e leitura da carteira verificada.' : '✅ Sessão válida. Carteira ainda não encontrada na nuvem.';
          logEvent('Diagnóstico de leitura concluído sem alterar contas ou carteiras.');
        } catch (err) {
          diagEl.textContent = "❌ Falha: " + err.message;
          logEvent("Falha no teste diagnóstico: " + err.message);
        }
      });

      // Config: Update Profile Name
      document.getElementById('btnSalvarNome').addEventListener('click', async () => {
        const newName = document.getElementById('cfgNomeInput').value.trim();
        if (!newName) return;
        if (AppState.user) {
          AppState.user.nome = newName;
          persistUserSession(AppState.user);
          if (!AppState.isLocal) {
            await mcUpdateProfile(AppState.user.idToken, newName).catch(() => {});
          }
        }
        document.getElementById('headerUser').textContent = newName;
        showToast("Nome atualizado com sucesso!");
      });

      // Config: Reset Password
      document.getElementById('btnResetPassEmail').addEventListener('click', async () => {
        if (AppState.isLocal || !AppState.user?.email) {
          alert("Disponível apenas para contas conectadas com e-mail.");
          return;
        }
        try {
          await mcResetPassword(AppState.user.email);
          alert(`E-mail de redefinição enviado para ${AppState.user.email}! Verifique sua caixa de entrada.`);
          logEvent("E-mail de redefinição enviado.");
        } catch (err) {
          alert(err.message);
        }
      });

      // Config: Alterar Senha Modal
      document.getElementById('btnOpenChangePass').addEventListener('click', () => {
        if (AppState.isLocal || !AppState.user?.idToken) {
          alert("Disponível apenas para contas conectadas.");
          return;
        }
        const html = `
          <div class="form-group">
            <label>Nova Senha:</label>
            <input type="password" id="cfgNewPassInput" class="input-field" placeholder="Mínimo 6 caracteres">
          </div>
        `;
        openModal("Alterar Minha Senha", html, [
          { label: "Cancelar", onClick: closeModal },
          {
            label: "Salvar Nova Senha",
            primary: true,
            onClick: async () => {
              const p = document.getElementById('cfgNewPassInput').value;
              if (!p || p.length < 6) return alert("A senha deve ter no mínimo 6 caracteres.");
              try {
                const url = `${AUTH_URL}update?key=${FB_API_KEY}`;
                const res = await fbFetch(url, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ idToken: AppState.user.idToken, password: p, returnSecureToken: true })
                });
                if (!res.ok) throw new Error("Falha ao atualizar senha.");
                AppState.user.idToken = res.data.idToken;
                AppState.user.refreshToken = res.data.refreshToken;
                persistUserSession(AppState.user);
                closeModal();
                showToast("Senha alterada com sucesso!");
                logEvent("Senha do usuário alterada.");
              } catch (err) {
                alert(err.message);
              }
            }
          }
        ]);
      });

      // Safe Deletion: Delete Account
      document.getElementById('btnDeleteAccountAction').addEventListener('click', async () => {
        const val = document.getElementById('inputConfirmExcluirConta').value.trim();
        if (val !== 'EXCLUIR') {
          alert("Para excluir, você precisa digitar exatamente EXCLUIR.");
          return;
        }

        if (confirm("ATENÇÃO: Sua conta e dados na nuvem serão excluídos permanentemente. Continuar?")) {
          try {
            deletingAccount = true;
            stopRealtimeSync();
            if (AppState.saveQueueTimeout) clearTimeout(AppState.saveQueueTimeout);
            if (cancelConflict) cancelConflict();
            await Promise.allSettled([...saveTasks.values()]);
            const user = { ...AppState.user };
            const fresh = await mcRefresh(user.refreshToken);
            await mcDeleteAccount(fresh.idToken, user.uid);
            await clearRealtimeIdentity();
            writeOfflineQueue(readOfflineQueue().filter(q => q.uid !== user.uid));
            await WalletStorage.flush();
            for (const key of [localDataKey(user.uid), `royalCloudAck_${user.uid}`, `royalCloudVersion_${user.uid}`, `royalApagadoEm_${user.uid}`]) walletStorage.removeItem(key);
            // Remove também a cópia de migração se pertencia a esta conta.
            if (walletStorage.getItem('royalLegacyOwner') === user.uid) walletStorage.removeItem('royalLocalData');
            clearUserSession();
            alert("Conta excluída com sucesso.");
            location.reload();
          } catch (err) {
            alert("Não foi possível excluir a conta: " + err.message);
            logEvent("Falha na exclusão de conta: " + err.message);
          } finally {
            deletingAccount = false;
            if (AppState.user) startRealtimeSync();
          }
        }
      });

      // Danger Zone: APAGAR Tudo
      document.getElementById('btnZerarDadosAction').addEventListener('click', async () => {
        const val = document.getElementById('inputConfirmZerarDados').value.trim();
        if (val !== 'APAGAR') {
          alert("Para zerar tudo, você precisa digitar exatamente APAGAR.");
          return;
        }

        if (confirm("ATENÇÃO: Todos os lançamentos, dívidas, metas e contas serão zerados. Deseja prosseguir?")) {
          const nowTs = Math.max(Date.now(), Number(AppState.data.updatedAt || 0) + 1);
          walletStorage.setItem(`royalApagadoEm_${AppState.isLocal ? 'device' : AppState.user.uid}`, String(nowTs));
          AppState.data = { ...emptyWallet(), updatedAt: nowTs };
          walletStorage.setItem(localDataKey(), JSON.stringify(AppState.data));

          if (!AppState.isLocal && AppState.user) {
            queueOfflineSnapshot(AppState.data);
            await syncPendingCloud();
          }

          document.getElementById('inputConfirmZerarDados').value = '';
          renderAll();
          showToast("Todos os dados foram zerados.");
          logEvent("Comando APAGAR executado com sucesso.");
        }
      });

      // Auth tabs toggle
      document.getElementById('tabBtnEntrar').addEventListener('click', () => {
        isRegisterMode = false;
        document.getElementById('tabBtnEntrar').classList.add('active');
        document.getElementById('tabBtnCriar').classList.remove('active');
        document.getElementById('grpNomeCadastro').style.display = 'none';
        document.getElementById('btnAuthSubmit').textContent = "Entrar na Conta";
        setAuthError('');
      });

      document.getElementById('tabBtnCriar').addEventListener('click', () => {
        isRegisterMode = true;
        document.getElementById('tabBtnCriar').classList.add('active');
        document.getElementById('tabBtnEntrar').classList.remove('active');
        document.getElementById('grpNomeCadastro').style.display = 'block';
        document.getElementById('btnAuthSubmit').textContent = "Cadastrar Conta";
        setAuthError('');
      });

      document.getElementById('btnToggleAuthPass').addEventListener('click', () => {
        const pInput = document.getElementById('authPassword');
        pInput.type = pInput.type === 'password' ? 'text' : 'password';
      });

      document.getElementById('authForm').addEventListener('submit', handleAuthSubmit);
      document.getElementById('btnContinuarLocal').addEventListener('click', async () => {
        try {
        stopRealtimeSync();
        clearRealtimeIdentity();
        AppState.isLocal = true;
        AppState.user = {
          uid: "local_" + uidGen(),
          email: "local@aparelho",
          nome: "Sem conta (local)"
        };
        await WalletPrivacy.prepare(AppState.user);
        const raw = walletStorage.getItem(localDataKey());
        AppState.data = raw ? normalizeDataStructure(JSON.parse(raw), "v2 estruturado (local)") : emptyWallet();
        enterApp();
        logEvent("Iniciado no modo local.");
        } catch (error) { setAuthError(error.message); }
      });

      document.getElementById('linkEsqueciSenha').addEventListener('click', (e) => {
        e.preventDefault();
        const em = document.getElementById('authEmail').value.trim();
        if (!em) {
          alert("Digite seu e-mail no campo acima para receber o link de recuperação.");
          return;
        }
        mcResetPassword(em).then(() => {
          alert(`Link de redefinição enviado para ${em}.`);
        }).catch(err => {
          alert(err.message);
        });
      });

      document.getElementById('btnHeaderLogout').addEventListener('click', logout);

      // PWA Install prompt listener
      let deferredPrompt = null;
      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        const installBtn = document.getElementById('btnPwaInstall');
        if (installBtn) {
          installBtn.style.display = 'block';
          installBtn.addEventListener('click', async () => {
            if (deferredPrompt) {
              deferredPrompt.prompt();
              const { outcome } = await deferredPrompt.userChoice;
              if (outcome === 'accepted') {
                installBtn.style.display = 'none';
              }
              deferredPrompt = null;
            }
          });
        }
      });

      // 4. Session restoration — permite abrir a conta com dados locais mesmo sem internet.
      const sessionRaw = walletStorage.getItem('royalToken');
      if (sessionRaw) {
        try {
          const sess = JSON.parse(sessionRaw);
          logEvent("Restaurando sessão anterior...");

          if (!navigator.onLine) {
            // Modo offline autenticado: usamos a identidade e os dados já cacheados.
            AppState.user = sess;
            AppState.isLocal = false;
            await WalletPrivacy.prepare(AppState.user);
            const raw = walletStorage.getItem(localDataKey());
            if (raw) {
              try { AppState.data = normalizeDataStructure(JSON.parse(raw), "v2 estruturado (offline)"); } catch (_) {}
            }
            setSyncBadge("📴 Offline — dados locais");
            enterApp();
            logEvent("Aplicativo aberto offline com sessão em cache.");
          } else {
            // Online: valida/renova a sessão normalmente e sincroniza.
            const refreshed = await mcRefresh(sess.refreshToken);
            const lookupUser = await mcLookup(refreshed.idToken);
            AppState.user = {
              uid: lookupUser.localId,
              email: lookupUser.email,
              idToken: refreshed.idToken,
              refreshToken: refreshed.refreshToken,
              nome: lookupUser.displayName || sess.nome || lookupUser.email.split('@')[0],
              tokenExpiresAt: Date.now() + (Number(refreshed.expiresIn || 3600) * 1000)
            };
            AppState.isLocal = false;
            persistUserSession(AppState.user);
            await WalletPrivacy.prepare(AppState.user);
            await syncCloudOnLogin();
            enterApp();
          }
        } catch (err) {
          if (err.code !== 'VAULT_CANCELLED' && (!navigator.onLine || err.code === 'NETWORK_UNAVAILABLE')) {
            // Mesmo com token antigo, os dados locais continuam disponíveis offline.
            try {
              const sess = JSON.parse(sessionRaw);
              AppState.user = sess;
              AppState.isLocal = false;
              await WalletPrivacy.prepare(AppState.user);
              const raw = walletStorage.getItem(localDataKey());
              if (raw) AppState.data = normalizeDataStructure(JSON.parse(raw), "v2 estruturado (offline-fallback)");
              setSyncBadge("📴 Offline — aguardando internet");
              enterApp();
              logEvent("Sessão de cache usada para acesso offline.");
            } catch (_) {
              document.getElementById('loginOverlay').style.display = 'flex';
            }
          } else {
            logEvent("Sessão inválida: " + err.message);
            setAuthError("Sessão inválida detectada — entre novamente.");
            document.getElementById('loginOverlay').style.display = 'flex';
          }
        }
      } else {
        document.getElementById('loginOverlay').style.display = 'flex';
      }

      // 5. Conectividade: toda alteração offline é enviada automaticamente quando a rede volta.
      const updateConnectionUI = () => {
        const pill = document.getElementById('offlineSyncPill');
        if (!pill) return;
        if (navigator.onLine) {
          pill.textContent = '🌐 Online';
          pill.style.opacity = '0.55';
          if (AppState.user && !AppState.isLocal) {
            setTimeout(() => syncPendingCloud(), 250);
          }
        } else {
          pill.textContent = '📴 Offline — salvo no aparelho';
          pill.style.opacity = '0.96';
          if (AppState.user && !AppState.isLocal) setSyncBadge('📴 Offline — salvo no aparelho');
        }
      };
      window.addEventListener('online', async () => {
        updateConnectionUI();
        if (AppState.user && !AppState.isLocal) {
          // Dá um pequeno tempo para a conexão estabilizar antes do primeiro envio.
          setTimeout(async () => {
            try {
              if (!AppState.user || AppState.isLocal || deletingAccount) return;
              const reconnectUid = AppState.user.uid;
              if (AppState.user.refreshToken && (!AppState.user.tokenExpiresAt || Date.now() >= AppState.user.tokenExpiresAt - 60000)) {
                const refreshed = await mcRefresh(AppState.user.refreshToken);
                if (AppState.user?.uid !== reconnectUid || deletingAccount) return;
                AppState.user.idToken = refreshed.idToken;
                AppState.user.refreshToken = refreshed.refreshToken;
                AppState.user.tokenExpiresAt = Date.now() + (Number(refreshed.expiresIn || 3600) * 1000);
                persistUserSession(AppState.user);
              }
              await syncPendingCloud();
              renderAll();
              startRealtimeSync();
            } catch (e) {
              setSyncBadge('⚠️ Sincronização pendente');
              logEvent('Internet voltou, mas a sincronização ainda não foi concluída: ' + e.message);
            }
          }, 800);
        }
      });
      window.addEventListener('offline', () => { stopRealtimeSync(); updateConnectionUI(); });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden' && AppState.user && !AppState.isLocal && navigator.onLine) {
          if (realtimeUnsubscribe || realtimeFallback) {
            realtimePending = true;
            scheduleRealtimeCheck(AppState.user.uid, realtimeGeneration);
          } else startRealtimeSync();
        }
      });
      updateConnectionUI();

    });
