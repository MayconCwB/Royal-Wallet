    /* ===== CRUD ACTIONS ===== */

    // 1. Movimentos
    window.handleEditMovimento = (id) => {
      const item = AppState.data.movimentos.find(m => m.id === id);
      if (!item) return;
      openMovimentoForm(item);
    };

    window.handleDeleteMovimento = (id) => {
      AppState.data.movimentos = AppState.data.movimentos.filter(m => m.id !== id);
      triggerAutoSave();
      renderAll();
      showToast("Lançamento removido");
    };

    window.handleDuplicateNextMonth = (id) => {
      const item = AppState.data.movimentos.find(m => m.id === id);
      if (!item) return;
      const [ano, mes, dia] = item.data.split('-').map(Number);
      const nextDate = new Date(ano, mes, dia);
      const yyyy = nextDate.getFullYear();
      const mm = String(nextDate.getMonth() + 1).padStart(2, '0');
      const dd = String(nextDate.getDate()).padStart(2, '0');

      AppState.data.movimentos.push({
        ...item,
        id: uidGen(),
        data: `${yyyy}-${mm}-${dd}`
      });
      triggerAutoSave();
      renderAll();
      showToast("Duplicado para o próximo mês!");
    };

    function openMovimentoForm(editing = null) {
      const isEdit = Boolean(editing);
      const valInitial = editing ? editing.valor : '';
      const html = `
        <div class="form-group">
          <label>Tipo:</label>
          <select id="movFormTipo" class="input-field">
            <option value="despesa" ${editing?.tipo === 'despesa' ? 'selected' : ''}>Gasto (Despesa)</option>
            <option value="receita" ${editing?.tipo === 'receita' ? 'selected' : ''}>Entrada (Receita)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Descrição:</label>
          <input type="text" id="movFormDesc" class="input-field" placeholder="Ex: Supermercado, Salário" value="${editing ? escapeHtml(editing.descricao) : ''}">
        </div>
        ${generateQuickValHtml({ id: 'movFormValor', label: 'Valor (R$):', value: valInitial, defaultStep: 10, placeholder: '0,00' })}
        <div class="form-group">
          <label>Data:</label>
          <input type="date" id="movFormData" class="input-field" value="${editing ? editing.data : new Date().toISOString().split('T')[0]}">
        </div>
        <div class="form-group">
          <label>Categoria:</label>
          <select id="movFormCat" class="input-field">
            <option value="Alimentação">Alimentação</option>
            <option value="Moradia">Moradia</option>
            <option value="Transporte">Transporte</option>
            <option value="Saúde">Saúde</option>
            <option value="Educação">Educação</option>
            <option value="Lazer">Lazer</option>
            <option value="Contas">Contas</option>
            <option value="Salário">Salário</option>
            <option value="Investimentos">Investimentos</option>
            <option value="Freelance">Freelance</option>
            <option value="Venda">Venda</option>
            <option value="Outros">Outros</option>
          </select>
        </div>
      `;

      openModal(isEdit ? "Editar Lançamento" : "Novo Lançamento", html, [
        { label: "Cancelar", onClick: closeModal },
        {
          label: "Salvar",
          primary: true,
          onClick: () => {
            const tipo = document.getElementById('movFormTipo').value;
            const descricao = document.getElementById('movFormDesc').value.trim();
            const valor = parseNumericInput(document.getElementById('movFormValor').value);
            const data = document.getElementById('movFormData').value;
            const categoria = document.getElementById('movFormCat').value;

            if (!descricao || isNaN(valor) || valor <= 0) {
              alert("Por favor, preencha descrição e valor válidos.");
              return;
            }

            if (isEdit) {
              editing.tipo = tipo;
              editing.descricao = descricao;
              editing.valor = valor;
              editing.data = data;
              editing.categoria = categoria;
            } else {
              AppState.data.movimentos.push({
                id: uidGen(),
                tipo,
                desc: descricao,
                descricao,
                valor,
                data,
                cat: categoria,
                categoria
              });
            }

            triggerAutoSave();
            renderAll();
            closeModal();
            showToast("Lançamento salvo com sucesso!");
          }
        }
      ]);

      attachQuickValListeners(document.getElementById('genericModalBody'));
      if (editing && editing.categoria) {
        document.getElementById('movFormCat').value = editing.categoria;
      }
    }

    // 2. Recorrentes
    window.handleToggleRecorrentePago = (id) => {
      const item = AppState.data.recorrentes.find(r => r.id === id);
      if (!item) return;
      const curYYYYMM = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      if (item.ultimoMesPago === curYYYYMM || item.pagoNesteMes) {
        item.ultimoMesPago = "";
        item.pagoNesteMes = false;
      } else {
        item.ultimoMesPago = curYYYYMM;
        item.pagoNesteMes = true;
      }
      triggerAutoSave();
      renderAll();
    };

    window.handleDeleteRecorrente = (id) => {
      AppState.data.recorrentes = AppState.data.recorrentes.filter(r => r.id !== id);
      triggerAutoSave();
      renderAll();
      showToast("Conta fixa removida");
    };

    function openRecorrenteForm() {
      const html = `
        <div class="form-group">
          <label>Nome da Conta Fixa:</label>
          <input type="text" id="recFormNome" class="input-field" placeholder="Ex: Aluguel, Netflix, Internet">
        </div>
        ${generateQuickValHtml({ id: 'recFormValor', label: 'Valor Mensal (R$):', value: '', defaultStep: 10, placeholder: '0,00' })}
        ${generateIntStepperHtml({ id: 'recFormDia', label: 'Dia do Vencimento (1 a 31):', value: 10, min: 1, max: 31, step: 1 })}
        <div class="form-group">
          <label>Categoria:</label>
          <input type="text" id="recFormCat" class="input-field" placeholder="Ex: Moradia, Contas">
        </div>
      `;

      openModal("Nova Conta Fixa", html, [
        { label: "Cancelar", onClick: closeModal },
        {
          label: "Salvar",
          primary: true,
          onClick: () => {
            const nome = document.getElementById('recFormNome').value.trim();
            const valor = parseNumericInput(document.getElementById('recFormValor').value);
            const dia = parseInt(document.getElementById('recFormDia').value, 10);
            const categoria = document.getElementById('recFormCat').value.trim() || 'Contas';

            if (!nome || isNaN(valor) || valor <= 0 || isNaN(dia) || dia < 1 || dia > 31) {
              alert("Por favor preencha nome, valor e dia de 1 a 31 corretamente.");
              return;
            }

            AppState.data.recorrentes.push({
              id: uidGen(),
              tipo: "despesa",
              desc: nome,
              nome,
              descricao: nome,
              valor,
              dia,
              cat: categoria,
              categoria,
              ultimoMesPago: "",
              pagoNesteMes: false
            });

            triggerAutoSave();
            renderAll();
            closeModal();
            showToast("Conta fixa cadastrada!");
          }
        }
      ]);
      attachQuickValListeners(document.getElementById('genericModalBody'));
    }

    // 3. Parcelas
    window.handleAdjustParcelasPagas = (id, delta) => {
      const item = AppState.data.parcelas.find(p => p.id === id);
      if (!item) return;
      const total = item.total || 1;
      let curr = item.pagas || 0;
      let next = Math.max(0, Math.min(total, curr + delta));
      if (next === curr) return;

      item.pagas = next;
      const val = Number(item.valor || item.valorParcela) || 0;

      if (item.pagas >= total) {
        AppState.data.historico.push({
          id: item.id,
          tipo: 'Parcela',
          desc: item.desc || item.descricao,
          nome: item.desc || item.descricao,
          valorTotal: val * total,
          concluidoEm: Date.now(),
          original: { ...item }
        });
        AppState.data.parcelas = AppState.data.parcelas.filter(p => p.id !== id);
        showToast("🎉 Parabéns! Parcela finalizada com sucesso!");
      } else {
        showToast(`Parcelas atualizadas: ${item.pagas}/${total}`);
      }
      triggerAutoSave();
      renderAll();
    };

    window.handlePagarUmaParcela = (id) => {
      window.handleAdjustParcelasPagas(id, 1);
    };

    window.handleDeleteParcela = (id) => {
      AppState.data.parcelas = AppState.data.parcelas.filter(p => p.id !== id);
      triggerAutoSave();
      renderAll();
      showToast("Parcela excluída");
    };

    function openParcelaForm() {
      const html = `
        <div class="form-group">
          <label>Descrição da Compra:</label>
          <input type="text" id="parcFormDesc" class="input-field" placeholder="Ex: Geladeira Nova, Smartphone">
        </div>
        ${generateQuickValHtml({ id: 'parcFormVal', label: 'Valor de CADA Parcela (R$):', value: '', defaultStep: 10, placeholder: '0,00' })}
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
          ${generateIntStepperHtml({ id: 'parcFormTotal', label: 'Total Parcelas:', value: 10, min: 1, max: 120, step: 1 })}
          ${generateIntStepperHtml({ id: 'parcFormPagas', label: 'Já Pagas:', value: 0, min: 0, max: 10, step: 1 })}
        </div>
        <div class="form-group">
          <label>Data da 1ª Parcela:</label>
          <input type="date" id="parcFormData1" class="input-field" value="${new Date().toISOString().split('T')[0]}">
        </div>
        <div id="parcFormPreview" style="background:rgba(240,185,11,0.1); border-radius:6px; padding:0.65rem; font-size:0.85rem; color:var(--gold);">
          Prévia: Total de R$ 0,00
        </div>
      `;

      openModal("Nova Compra Parcelada", html, [
        { label: "Cancelar", onClick: closeModal },
        {
          label: "Salvar",
          primary: true,
          onClick: () => {
            const descricao = document.getElementById('parcFormDesc').value.trim();
            const valorParcela = parseNumericInput(document.getElementById('parcFormVal').value);
            const total = parseInt(document.getElementById('parcFormTotal').value, 10) || 1;
            const pagas = Math.min(total, Math.max(0, parseInt(document.getElementById('parcFormPagas').value, 10) || 0));
            const dataPrimeira = document.getElementById('parcFormData1').value;

            if (!descricao || isNaN(valorParcela) || valorParcela <= 0 || total <= 0) {
              alert("Por favor preencha valores válidos.");
              return;
            }

            AppState.data.parcelas.push({
              id: uidGen(),
              desc: descricao,
              descricao,
              valor: valorParcela,
              valorParcela,
              total,
              pagas,
              data1: dataPrimeira,
              dataPrimeira,
              cat: "Geral",
              categoria: "Geral"
            });

            triggerAutoSave();
            renderAll();
            closeModal();
            showToast("Parcela cadastrada com sucesso!");
          }
        }
      ]);

      attachQuickValListeners(document.getElementById('genericModalBody'));

      // Keep max of pagas linked to total
      const totalInput = document.getElementById('parcFormTotal');
      const pagasCtrl = document.querySelector('.quick-int-control[data-stepper-for="parcFormPagas"]');
      const pagasInput = document.getElementById('parcFormPagas');

      const updatePreview = () => {
        const val = parseNumericInput(document.getElementById('parcFormVal')?.value);
        const tot = parseInt(totalInput?.value, 10) || 0;
        const pgs = parseInt(pagasInput?.value, 10) || 0;
        if (pagasCtrl) {
          pagasCtrl.dataset.max = String(Math.max(0, tot));
          if (pgs > tot && tot > 0) {
            pagasInput.value = String(tot);
          }
        }
        const d1 = document.getElementById('parcFormData1')?.value;
        const el = document.getElementById('parcFormPreview');
        if (el) {
          el.textContent = `Prévia: Compra de ${fmtBRL(val * tot)} em ${tot}x de ${fmtBRL(val)}. Primeira cobrança: ${d1 ? d1.split('-').reverse().join('/') : '-'}`;
        }
      };

      document.getElementById('parcFormVal').addEventListener('input', updatePreview);
      totalInput.addEventListener('input', updatePreview);
      totalInput.addEventListener('change', updatePreview);
      pagasInput.addEventListener('input', updatePreview);
      document.getElementById('parcFormData1').addEventListener('change', updatePreview);
      updatePreview();
    }

    // 4. Dívidas
    window.handleAmortizarDivida = (id) => {
      const item = AppState.data.dividas.find(d => d.id === id);
      if (!item) return;
      const totalVal = Number(item.total ?? item.valorTotal) || 0;
      const pagoVal = Number(item.pago ?? item.valorPago) || 0;
      const rest = Math.max(0, totalVal - pagoVal);

      const html = `
        <p>Restante a pagar: <strong style="color:var(--gold);">${fmtBRL(rest)}</strong></p>
        ${generateQuickValHtml({ id: 'amortFormVal', label: 'Valor que vai pagar agora (R$):', value: '', defaultStep: 50, placeholder: '0,00' })}
      `;

      openModal("Pagar Parte da Dívida", html, [
        { label: "Cancelar", onClick: closeModal },
        {
          label: "Confirmar Pagamento",
          primary: true,
          onClick: () => {
            const v = parseNumericInput(document.getElementById('amortFormVal').value);
            if (isNaN(v) || v <= 0) return alert("Informe um valor válido.");
            const novoPago = (Number(item.pago ?? item.valorPago) || 0) + v;
            item.pago = novoPago;
            item.valorPago = novoPago;

            if (novoPago >= totalVal) {
              AppState.data.historico.push({
                id: item.id,
                tipo: 'Dívida',
                nome: item.desc || item.credor,
                valorTotal: totalVal,
                concluidoEm: Date.now(),
                original: { ...item }
              });
              AppState.data.dividas = AppState.data.dividas.filter(d => d.id !== id);
              showToast("🎉 Dívida totalmente quitada!");
            } else {
              showToast("Amortização registrada!");
            }
            triggerAutoSave();
            renderAll();
            closeModal();
          }
        }
      ]);
      attachQuickValListeners(document.getElementById('genericModalBody'));
    };

    window.handleQuitarDivida = (id) => {
      const item = AppState.data.dividas.find(d => d.id === id);
      if (!item) return;
      if (!confirm(`Confirmar quitação total de ${item.credor}?`)) return;

      item.valorPago = item.valorTotal;
      AppState.data.historico.push({
        id: item.id,
        tipo: 'Dívida',
        nome: item.credor,
        valorTotal: item.valorTotal,
        concluidoEm: Date.now(),
        original: { ...item }
      });
      AppState.data.dividas = AppState.data.dividas.filter(d => d.id !== id);
      triggerAutoSave();
      renderAll();
      showToast("🎉 Dívida quitada com sucesso!");
    };

    window.handleDeleteDivida = (id) => {
      AppState.data.dividas = AppState.data.dividas.filter(d => d.id !== id);
      triggerAutoSave();
      renderAll();
      showToast("Dívida removida");
    };

    function openDividaForm() {
      const html = `
        <div class="form-group">
          <label>Nome do Credor / Dívida:</label>
          <input type="text" id="divFormCredor" class="input-field" placeholder="Ex: Empréstimo Banco, Cartão">
        </div>
        ${generateQuickValHtml({ id: 'divFormTotal', label: 'Valor Total da Dívida (R$):', value: '', defaultStep: 50, placeholder: '0,00' })}
        ${generateQuickValHtml({ id: 'divFormPago', label: 'Já Pago / Entrada (R$):', value: '0,00', defaultStep: 50, placeholder: '0,00' })}
        <div class="form-group">
          <label>Data Limite / Vencimento:</label>
          <input type="date" id="divFormDataVenc" class="input-field" value="${new Date().toISOString().split('T')[0]}">
        </div>
      `;

      openModal("Nova Dívida", html, [
        { label: "Cancelar", onClick: closeModal },
        {
          label: "Salvar",
          primary: true,
          onClick: () => {
            const credor = document.getElementById('divFormCredor').value.trim();
            const valorTotal = parseNumericInput(document.getElementById('divFormTotal').value);
            const valorPago = parseNumericInput(document.getElementById('divFormPago').value) || 0;
            const dataVencimento = document.getElementById('divFormDataVenc').value;

            if (!credor || isNaN(valorTotal) || valorTotal <= 0) {
              alert("Por favor informe o credor e o valor total.");
              return;
            }

            AppState.data.dividas.push({
              id: uidGen(),
              desc: credor,
              credor,
              descricao: credor,
              total: valorTotal,
              valorTotal,
              pago: valorPago,
              valorPago,
              venc: dataVencimento,
              dataVencimento
            });

            triggerAutoSave();
            renderAll();
            closeModal();
            showToast("Dívida cadastrada!");
          }
        }
      ]);
      attachQuickValListeners(document.getElementById('genericModalBody'));
    }

    // 5. Metas
    window.handleAddValorMeta = (id) => {
      const item = AppState.data.metas.find(m => m.id === id);
      if (!item) return;
      const alvoVal = Number(item.alvo ?? item.valorAlvo) || 0;
      const guardadoVal = Number(item.guardado ?? item.valorAtual) || 0;

      const html = `
        <p>Meta: <strong>${escapeHtml(item.desc || item.titulo)}</strong> (Alvo: ${fmtBRL(alvoVal)} · Atual: ${fmtBRL(guardadoVal)})</p>
        ${generateQuickValHtml({ id: 'metaAddVal', label: 'Quanto deseja guardar agora (R$)?', value: '', defaultStep: 50, placeholder: '0,00' })}
      `;

      openModal("Adicionar à Meta", html, [
        { label: "Cancelar", onClick: closeModal },
        {
          label: "Adicionar",
          primary: true,
          onClick: () => {
            const v = parseNumericInput(document.getElementById('metaAddVal').value);
            if (isNaN(v) || v <= 0) return alert("Valor inválido.");
            const novoGuardado = (Number(item.guardado ?? item.valorAtual) || 0) + v;
            item.guardado = novoGuardado;
            item.valorAtual = novoGuardado;

            if (novoGuardado >= alvoVal) {
              AppState.data.historico.push({
                id: item.id,
                tipo: 'Meta',
                nome: item.desc || item.titulo,
                valorTotal: alvoVal,
                concluidoEm: Date.now(),
                original: { ...item }
              });
              AppState.data.metas = AppState.data.metas.filter(m => m.id !== id);
              showToast("🎉 100% atingido! Meta enviada para o Histórico de Vitórias!");
            } else {
              showToast("Valor adicionado à meta!");
            }
            triggerAutoSave();
            renderAll();
            closeModal();
          }
        }
      ]);
      attachQuickValListeners(document.getElementById('genericModalBody'));
    };

    window.handleDeleteMeta = (id) => {
      AppState.data.metas = AppState.data.metas.filter(m => m.id !== id);
      triggerAutoSave();
      renderAll();
      showToast("Meta removida");
    };

    function openMetaForm() {
      const html = `
        <div class="form-group">
          <label>Título do Objetivo:</label>
          <input type="text" id="metaFormTitulo" class="input-field" placeholder="Ex: Viagem de Férias, Notebook Novo">
        </div>
        ${generateQuickValHtml({ id: 'metaFormAlvo', label: 'Valor Alvo (R$):', value: '', defaultStep: 50, placeholder: '0,00' })}
        ${generateQuickValHtml({ id: 'metaFormAtual', label: 'Já economizado (R$):', value: '0,00', defaultStep: 50, placeholder: '0,00' })}
      `;

      openModal("Nova Meta de Economia", html, [
        { label: "Cancelar", onClick: closeModal },
        {
          label: "Salvar",
          primary: true,
          onClick: () => {
            const titulo = document.getElementById('metaFormTitulo').value.trim();
            const valorAlvo = parseNumericInput(document.getElementById('metaFormAlvo').value);
            const valorAtual = parseNumericInput(document.getElementById('metaFormAtual').value) || 0;

            if (!titulo || isNaN(valorAlvo) || valorAlvo <= 0) {
              alert("Por favor informe um título e o valor alvo.");
              return;
            }

            AppState.data.metas.push({
              id: uidGen(),
              desc: titulo,
              titulo,
              descricao: titulo,
              alvo: valorAlvo,
              valorAlvo,
              guardado: valorAtual,
              valorAtual
            });

            triggerAutoSave();
            renderAll();
            closeModal();
            showToast("Meta criada!");
          }
        }
      ]);
      attachQuickValListeners(document.getElementById('genericModalBody'));
    }

    // 6. Histórico Devolver
    window.handleDevolverParaAtivos = (id) => {
      const idx = (AppState.data.historico || []).findIndex(h => h.id === id);
      if (idx === -1) return;
      const item = AppState.data.historico[idx];

      if (item.tipo === 'Parcela') {
        const orig = item.original || {
          id: item.id,
          descricao: item.nome,
          valorParcela: item.valorTotal / 10,
          total: 10,
          pagas: 9,
          dataPrimeira: new Date().toISOString().split('T')[0]
        };
        orig.pagas = Math.max(0, orig.total - 1);
        AppState.data.parcelas.push(orig);
      } else if (item.tipo === 'Dívida') {
        const orig = item.original || {
          id: item.id,
          credor: item.nome,
          valorTotal: item.valorTotal,
          valorPago: 0,
          dataVencimento: new Date().toISOString().split('T')[0]
        };
        AppState.data.dividas.push(orig);
      } else if (item.tipo === 'Meta') {
        const orig = item.original || {
          id: item.id,
          titulo: item.nome,
          valorAlvo: item.valorTotal,
          valorAtual: Math.max(0, item.valorTotal - 100)
        };
        AppState.data.metas.push(orig);
      }

      AppState.data.historico.splice(idx, 1);
      triggerAutoSave();
      renderAll();
      showToast("Item devolvido para os ativos!");
    };
