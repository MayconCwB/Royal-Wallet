    /* ===== BACKUP & NUVEM ===== */
    async function exportBackupJson() {
      try {
      const structuredExport = {
        v: "2",
        nome: AppState.user?.nome || '',
        atualizadoEm: AppState.data.updatedAt || Date.now(),
        updatedAt: AppState.data.updatedAt || Date.now(),
        movimentos: AppState.data.movimentos || [],
        recorrentes: AppState.data.recorrentes || [],
        parcelas: AppState.data.parcelas || [],
        dividas: AppState.data.dividas || [],
        metas: AppState.data.metas || [],
        historico: AppState.data.historico || [],
        contas: AppState.data.contas || [],
        cartoes: AppState.data.cartoes || [],
        lixeira: AppState.data.lixeira || [],
        orcamentos: AppState.data.orcamentos || [],
        rendasPrevistas: AppState.data.rendasPrevistas || [],
        avisosAtivos: AppState.data.avisosAtivos === true
      };
      await WalletPrivacy.exportBackup(structuredExport);
      showToast('Download do backup criptografado iniciado.');
      } catch (error) { alert(error.message); }
    }

    function importBackupJson(file) {
      const importOwner = localDataKey();
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          if (!WalletPrivacy.ready() || localDataKey() !== importOwner) throw Error('A sessão mudou durante a leitura do arquivo.');
          let imported = JSON.parse(e.target.result);
          if (imported.format === 'royal-wallet-encrypted-backup') imported = await WalletPrivacy.importBackup(imported);
          if (!WalletPrivacy.ready() || localDataKey() !== importOwner) throw Error('A sessão mudou durante a importação.');
          let label = "v2 estruturado (arquivo)";
          // Compatibilidade: se o arquivo JSON contiver campo "dados" ou "payload" em string (v1)
          if (imported && typeof imported.dados === 'string') {
            label = "v1 string (arquivo)";
            try { imported = JSON.parse(imported.dados); } catch(_) {}
          } else if (imported && typeof imported.payload === 'string') {
            label = "v1 string (arquivo)";
            try { imported = JSON.parse(imported.payload); } catch(_) {}
          }

          if (confirm("Deseja substituir seus dados atuais pelos dados deste backup?")) {
            AppState.data = normalizeDataStructure(imported, label);
            triggerAutoSave();
            renderAll();
            showToast("Backup restaurado com sucesso!");
            logEvent("Backup importado com sucesso via JSON.");
          }
        } catch (err) {
          alert("Não foi possível importar: " + err.message);
        }
      };
      reader.readAsText(file);
    }
