/* Melhorias de uso diário. Mantém o cliente REST e o isolamento por usuário. */
(() => {
  'use strict';
  const categories = ['Alimentação', 'Moradia', 'Transporte', 'Saúde', 'Educação', 'Lazer', 'Contas', 'Salário', 'Investimentos', 'Freelance', 'Venda', 'Outros'];
  const esc = escapeHtml;
  const cents = value => Math.round((Number(value) || 0) * 100);
  const amount = value => cents(value) / 100;
  const dateISO = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const monthISO = (date = new Date()) => dateISO(date).slice(0, 7);
  const collections = ['movimentos', 'recorrentes', 'parcelas', 'dividas', 'metas', 'historico', 'contas', 'cartoes', 'lixeira'];
  let undoTimer = null;
  const identity = () => localDataKey();
  function ensureData() {
    for (const key of collections) if (!Array.isArray(AppState.data[key])) AppState.data[key] = [];
  }
  const baseNormalize = normalizeDataStructure;
  normalizeDataStructure = (raw, source) => {
    const result = baseNormalize(raw, source);
    const accounts = Array.isArray(raw?.contas) ? raw.contas : [];
    result.contas = accounts.filter(x => x && x.id).map(x => ({ id: String(x.id), nome: String(x.nome || 'Conta'), saldoInicial: amount(x.saldoInicial) }));
    const cards = Array.isArray(raw?.cartoes) ? raw.cartoes : [];
    result.cartoes = cards.filter(x => x && x.id).map(x => ({ id: String(x.id), nome: String(x.nome || 'Cartão'),
      fechamento: Math.min(31, Math.max(1, Number(x.fechamento) || 20)), vencimento: Math.min(31, Math.max(1, Number(x.vencimento) || 10)), limite: Math.max(0, amount(x.limite)) }));
    result.lixeira = (Array.isArray(raw?.lixeira) ? raw.lixeira : []).filter(x => x && x.id && collections.includes(x.colecao) && x.colecao !== 'lixeira' && x.item?.id);
    const originalMovements = new Map((Array.isArray(raw?.movimentos) ? raw.movimentos : []).filter(Boolean).map(x => [String(x.id ?? x.ID), x]));
    result.movimentos.forEach(m => {
      const original = originalMovements.get(m.id) || {};
      for (const key of ['contaId', 'cartaoId', 'faturaMes', 'classe', 'origem']) if (original[key]) m[key] = String(original[key]);
    });
    return result;
  };
  const baseEmpty = emptyWallet;
  emptyWallet = () => ({ ...baseEmpty(), contas: [], cartoes: [], lixeira: [] });

  function accountBalance(accountId = '') {
    ensureData();
    let total = cents(AppState.data.contas.find(c => c.id === accountId)?.saldoInicial);
    for (const m of AppState.data.movimentos) {
      if ((m.contaId || '') !== accountId || (m.cartaoId && m.classe !== 'pagamento_fatura')) continue;
      total += (m.tipo === 'receita' ? 1 : -1) * cents(m.valor);
    }
    return total / 100;
  }
  function invoiceMonth(card, purchaseDate) {
    const [y, m, day] = purchaseDate.split('-').map(Number);
    // O mês identifica o vencimento; o fechamento acontece antes dele.
    const dueOffset = (day > card.fechamento ? 1 : 0) + (card.vencimento <= card.fechamento ? 1 : 0);
    return monthISO(new Date(y, m - 1 + dueOffset, 1));
  }
  function invoices() {
    ensureData();
    const result = [];
    for (const card of AppState.data.cartoes) {
      const grouped = new Map();
      for (const movement of AppState.data.movimentos.filter(m => m.cartaoId === card.id)) {
        const mes = movement.faturaMes || invoiceMonth(card, movement.data || dateISO());
        if (!grouped.has(mes)) grouped.set(mes, { total: 0, pago: 0 });
        const group = grouped.get(mes);
        if (movement.classe === 'pagamento_fatura') group.pago += cents(movement.valor);
        else if (movement.tipo === 'despesa') group.total += cents(movement.valor);
      }
      for (const [mes, group] of grouped) {
        const [y, m] = mes.split('-').map(Number);
        const dueDay = Math.min(card.vencimento, new Date(y, m, 0).getDate());
        result.push({ cartaoId: card.id, nome: card.nome, mes, total: group.total / 100, pago: group.pago / 100,
          restante: Math.max(0, group.total - group.pago) / 100, vencimento: `${mes}-${String(dueDay).padStart(2, '0')}` });
      }
    }
    return result.sort((a, b) => a.mes.localeCompare(b.mes));
  }
  function monthlyExpenses(mes) {
    return AppState.data.movimentos.filter(m => m.tipo === 'despesa' && m.classe !== 'pagamento_fatura' && m.data?.startsWith(mes))
      .reduce((sum, m) => sum + cents(m.valor), 0) / 100;
  }
  const baseCalc = calcMonthlyFinancials;
  calcMonthlyFinancials = () => {
    ensureData();
    const base = baseCalc();
    const mes = monthISO();
    let saldo = AppState.data.contas.reduce((sum, c) => sum + cents(c.saldoInicial), 0);
    AppState.data.movimentos.forEach(m => {
      if (m.cartaoId && m.classe !== 'pagamento_fatura') return;
      saldo += (m.tipo === 'receita' ? 1 : -1) * cents(m.valor);
    });
    const cardPending = invoices().filter(i => i.mes <= mes).reduce((sum, i) => sum + cents(i.restante), 0) / 100;
    const saldoReal = saldo / 100;
    const compromissosMes = amount(base.compromissosMes + cardPending);
    return { ...base, saldoReal, gastosMes: monthlyExpenses(mes), compromissosMes,
      precisoTer: Math.max(0, amount(compromissosMes - saldoReal)), saldoPrevisto: amount(saldoReal - compromissosMes) };
  };
  HELP_DICTIONARY['Saldo Real'] = 'Saldo inicial das contas mais entradas e saídas já registradas. Compras no cartão só reduzem esse saldo quando a fatura é paga.';
  HELP_DICTIONARY['Gastos do Mês'] = 'Despesas pela data da compra, incluindo cartão. O pagamento da fatura não conta como um novo gasto.';
  HELP_DICTIONARY['Quanto Preciso Ter'] = 'Quanto falta no saldo disponível para cobrir os compromissos do mês, incluindo faturas pendentes e dívidas vencidas.';
  HELP_DICTIONARY['Saldo Previsto Final'] = 'Saldo disponível menos os compromissos ainda pendentes. As entradas já registradas não são somadas novamente.';

  function saveEntry(collection, id, values) {
    ensureData();
    if (id) {
      const entry = AppState.data[collection].find(x => x.id === id);
      if (!entry) throw new Error('Este item foi removido. Feche o formulário e atualize a lista.');
      Object.assign(entry, values);
      return entry;
    }
    const entry = { id: uidGen(), ...values };
    AppState.data[collection].push(entry);
    return entry;
  }
  function commit() { triggerAutoSave(); renderAll(); }
  function form(title, html, save) {
    const owner = identity();
    openModal(title, html, [{ label: 'Cancelar', onClick: closeModal }, { label: 'Salvar', primary: true, onClick: () => {
      try {
        if (identity() !== owner) throw new Error('A conta ativa mudou. Abra o formulário novamente.');
        save(); commit(); closeModal(); showToast('Salvo com sucesso.');
      } catch (error) { alert(error.message); }
    } }]);
    attachQuickValListeners(document.getElementById('genericModalBody'));
  }
  const field = (id, label, value = '', type = 'text', extra = '') => `<div class="form-group"><label for="${id}">${esc(label)}</label><input id="${id}" class="input-field" type="${type}" value="${esc(String(value))}" ${extra}></div>`;
  const moneyField = (id, label, value = '') => field(id, label, value === '' ? '' : Number(value).toFixed(2).replace('.', ','), 'text', 'inputmode="decimal"');
  const value = id => document.getElementById(id).value.trim();
  const number = id => parseNumericInput(value(id));
  const choice = (id, label, choices, selected = '') => `<div class="form-group"><label for="${id}">${esc(label)}</label><select class="input-field" id="${id}">${choices.map(([key, text]) => `<option value="${esc(key)}" ${key === selected ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></div>`;
  const categoryChoices = selected => [...new Set([...categories, selected].filter(Boolean))].map(x => [x, x]);
  const accountChoices = () => [['', 'Sem conta definida'], ...AppState.data.contas.map(c => [c.id, c.nome])];

  function editCommitment(collection, id = null) {
    ensureData();
    const existing = id ? AppState.data[collection].find(x => x.id === id) : null;
    if (id && !existing) return;
    const item = existing || {};
    const recurrent = collection === 'recorrentes', installment = collection === 'parcelas';
    const name = recurrent ? 'Conta fixa' : installment ? 'Compra parcelada' : 'Dívida';
    let html = field('editNome', recurrent ? 'Nome da conta fixa' : installment ? 'Descrição da compra' : 'Credor / descrição', item.desc || item.descricao || item.nome || item.credor || '');
    html += moneyField('editValor', recurrent ? 'Valor mensal (R$)' : installment ? 'Valor de cada parcela (R$)' : 'Valor total (R$)', item.valor ?? item.total ?? '');
    if (recurrent) html += field('editDia', 'Dia do vencimento', item.dia || 10, 'number', 'min="1" max="31" step="1"') + choice('editCat', 'Categoria', categoryChoices(item.cat), item.cat || 'Contas');
    else {
      if (installment) html += field('editTotal', 'Quantidade de parcelas', item.total || 10, 'number', 'min="1" max="120" step="1"') + field('editPagas', 'Parcelas já pagas', item.pagas || 0, 'number', 'min="0" step="1"');
      else html += moneyField('editPago', 'Valor já pago (R$)', item.pago || 0);
      html += field('editData', installment ? 'Data da primeira parcela' : 'Vencimento', item.data1 || item.venc || dateISO(), 'date');
    }
    form(`${id ? 'Editar' : 'Nova'} ${name}`, html, () => {
      const desc = value('editNome'), valor = number('editValor');
      if (!desc || !Number.isFinite(valor) || valor <= 0) throw new Error('Informe uma descrição e um valor maior que zero.');
      const values = { desc, descricao: desc };
      if (recurrent) {
        const dia = Number(value('editDia')), cat = value('editCat');
        if (!Number.isInteger(dia) || dia < 1 || dia > 31) throw new Error('O dia deve ser de 1 a 31.');
        Object.assign(values, { nome: desc, valor: amount(valor), dia, cat, categoria: cat, tipo: item.tipo || 'despesa', ultimoMesPago: item.ultimoMesPago || '', pagoNesteMes: !!item.pagoNesteMes });
      } else {
        const date = parseCsvDate(value('editData'));
        if (!date) throw new Error('Informe uma data válida.');
        if (installment) {
          const total = Number(value('editTotal')), pagas = Number(value('editPagas'));
          if (!Number.isInteger(total) || total < 1 || total > 120 || !Number.isInteger(pagas) || pagas < 0 || pagas > total) throw new Error('Confira a quantidade de parcelas e quantas já foram pagas.');
          Object.assign(values, { valor: amount(valor), valorParcela: amount(valor), total, pagas, data1: date, dataPrimeira: date, cat: item.cat || 'Geral', categoria: item.cat || 'Geral' });
        } else {
          const pago = number('editPago');
          if (!Number.isFinite(pago) || pago < 0 || pago > valor) throw new Error('O valor já pago deve estar entre zero e o total da dívida.');
          Object.assign(values, { credor: desc, total: amount(valor), valorTotal: amount(valor), pago: amount(pago), valorPago: amount(pago), venc: date, dataVencimento: date });
        }
      }
      saveEntry(collection, id, values);
    });
  }
  openRecorrenteForm = () => editCommitment('recorrentes');
  openParcelaForm = () => editCommitment('parcelas');
  openDividaForm = () => editCommitment('dividas');
  window.handleEditRecorrente = id => editCommitment('recorrentes', id);
  window.handleEditParcela = id => editCommitment('parcelas', id);
  window.handleEditDivida = id => editCommitment('dividas', id);

  function trashEntry(collection, id) {
    ensureData();
    const index = AppState.data[collection].findIndex(x => x.id === id);
    if (index < 0) return null;
    if (['contas', 'cartoes'].includes(collection)) {
      const key = collection === 'contas' ? 'contaId' : 'cartaoId';
      if (AppState.data.movimentos.some(m => m[key] === id) || AppState.data.lixeira.some(x => x.item?.[key] === id)) throw new Error('Há lançamentos vinculados a este item. Remova ou altere esses vínculos antes de excluí-lo.');
    }
    const [item] = AppState.data[collection].splice(index, 1);
    const entry = { id: uidGen(), colecao: collection, item: JSON.parse(JSON.stringify(item)), indice: index, excluidoEm: Date.now() };
    AppState.data.lixeira.push(entry);
    return entry.id;
  }
  function restoreTrash(id) {
    ensureData();
    const entry = AppState.data.lixeira.find(x => x.id === id);
    if (!entry) throw new Error('O item já foi restaurado ou não está mais na lixeira.');
    if (AppState.data[entry.colecao].some(x => x.id === entry.item.id)) throw new Error('Já existe um item com esse identificador. Nenhum dado foi substituído.');
    AppState.data[entry.colecao].splice(Math.min(entry.indice || 0, AppState.data[entry.colecao].length), 0, entry.item);
    AppState.data.lixeira = AppState.data.lixeira.filter(x => x.id !== id);
  }
  function removeWithUndo(collection, id) {
    try {
      const owner = identity(), trashId = trashEntry(collection, id);
      if (!trashId) return;
      commit();
      const toast = document.getElementById('walletUndoToast');
      toast.replaceChildren();
      const message = document.createElement('span'); message.textContent = 'Item movido para a lixeira.';
      const button = document.createElement('button'); button.className = 'btn btn-outline'; button.textContent = 'Desfazer';
      button.onclick = () => {
        if (owner !== identity()) return;
        try { restoreTrash(trashId); commit(); toast.hidden = true; } catch (error) { alert(error.message); }
      };
      toast.append(message, button); toast.hidden = false;
      if (undoTimer) clearTimeout(undoTimer);
      undoTimer = setTimeout(() => { toast.hidden = true; }, 10000);
    } catch (error) { alert(error.message); }
  }
  for (const [handler, collection] of Object.entries({ handleDeleteMovimento: 'movimentos', handleDeleteRecorrente: 'recorrentes', handleDeleteParcela: 'parcelas', handleDeleteDivida: 'dividas', handleDeleteMeta: 'metas' })) {
    window[handler] = id => removeWithUndo(collection, id);
  }
  window.handleDuplicateNextMonth = id => {
    const item = AppState.data.movimentos.find(m => m.id === id);
    if (!item) return;
    if (item.classe === 'pagamento_fatura') return alert('Registre o pagamento na fatura correspondente para conferir o valor pendente.');
    const [year, month, day] = item.data.split('-').map(Number);
    const next = new Date(year, month, 1);
    next.setDate(Math.min(day, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
    const copy = { ...item, id: uidGen(), data: dateISO(next) };
    if (item.cartaoId) {
      const [invoiceYear, invoiceMonthNumber] = (item.faturaMes || invoiceMonth(AppState.data.cartoes.find(c => c.id === item.cartaoId), item.data)).split('-').map(Number);
      copy.faturaMes = monthISO(new Date(invoiceYear, invoiceMonthNumber, 1));
    }
    AppState.data.movimentos.push(copy); commit(); showToast('Duplicado para o próximo mês.');
  };

  openMovimentoForm = (editing = null) => {
    ensureData();
    if (editing?.classe === 'pagamento_fatura') return alert('Para corrigir um pagamento de fatura, exclua-o e registre o pagamento correto. A exclusão pode ser desfeita.');
    const card = editing?.cartaoId || '';
    const html = choice('movTipo', 'Tipo', [['despesa', 'Gasto'], ['receita', 'Entrada']], editing?.tipo || 'despesa') +
      field('movDesc', 'Descrição', editing?.desc || editing?.descricao || '') + moneyField('movValor', 'Valor (R$)', editing?.valor ?? '') +
      field('movData', 'Data', editing?.data || dateISO(), 'date') + choice('movCategoria', 'Categoria', categoryChoices(editing?.cat), editing?.cat || 'Outros') +
      choice('movOrigem', 'Conta ou cartão', [...accountChoices().map(([id, text]) => [id ? 'conta:' + id : '', text]), ...AppState.data.cartoes.map(c => ['cartao:' + c.id, 'Cartão — ' + c.nome])], card ? 'cartao:' + card : editing?.contaId ? 'conta:' + editing.contaId : '') +
      field('movFatura', 'Mês de vencimento da fatura (para cartão)', editing?.faturaMes || '', 'month') + '<p class="wallet-muted">Compras no cartão entram nos gastos. O saldo da conta muda quando a fatura é paga.</p>';
    form(editing ? 'Editar lançamento' : 'Novo lançamento', html, () => {
      const desc = value('movDesc'), valor = number('movValor'), data = parseCsvDate(value('movData')), tipo = value('movTipo'), cat = value('movCategoria');
      if (!desc || !Number.isFinite(valor) || valor <= 0 || !data) throw new Error('Preencha descrição, valor e data válidos.');
      const source = value('movOrigem'), contaId = source.startsWith('conta:') ? source.slice(6) : '', cartaoId = source.startsWith('cartao:') ? source.slice(7) : '';
      const selectedCard = AppState.data.cartoes.find(c => c.id === cartaoId);
      if (cartaoId && tipo !== 'despesa') throw new Error('Use uma conta para registrar entradas.');
      const faturaMes = selectedCard ? value('movFatura') || invoiceMonth(selectedCard, data) : '';
      if (selectedCard && !/^\d{4}-(0[1-9]|1[0-2])$/.test(faturaMes)) throw new Error('Informe um mês de fatura válido.');
      saveEntry('movimentos', editing?.id, { desc, descricao: desc, valor: amount(valor), data, tipo, cat, categoria: cat, contaId, cartaoId, faturaMes });
    });
  };
  function editAccount(id = null) {
    ensureData(); const item = AppState.data.contas.find(x => x.id === id) || {};
    form(id ? 'Editar conta' : 'Nova conta', field('contaNome', 'Nome da conta', item.nome || '') + moneyField('contaSaldo', 'Saldo inicial (R$)', item.saldoInicial || 0) +
      '<p class="wallet-muted">Use o saldo anterior aos lançamentos registrados nesta conta, para não somar o mesmo dinheiro duas vezes.</p>', () => {
      const nome = value('contaNome'), saldoInicial = number('contaSaldo');
      if (!nome || !Number.isFinite(saldoInicial)) throw new Error('Informe o nome e um saldo válido.');
      saveEntry('contas', id, { nome, saldoInicial: amount(saldoInicial) });
    });
  }
  function editCard(id = null) {
    ensureData(); const item = AppState.data.cartoes.find(x => x.id === id) || {};
    form(id ? 'Editar cartão' : 'Novo cartão', field('cartaoNome', 'Nome do cartão', item.nome || '') + moneyField('cartaoLimite', 'Limite (R$)', item.limite || 0) +
      field('cartaoFecha', 'Dia do fechamento', item.fechamento || 20, 'number', 'min="1" max="31"') + field('cartaoVence', 'Dia do vencimento', item.vencimento || 10, 'number', 'min="1" max="31"') +
      '<p class="wallet-muted">O dia de fechamento é incluído na fatura que está fechando. Você pode ajustar o mês da fatura em cada compra conforme o extrato do banco.</p>', () => {
      const nome = value('cartaoNome'), limite = number('cartaoLimite'), fechamento = Number(value('cartaoFecha')), vencimento = Number(value('cartaoVence'));
      if (!nome || !Number.isFinite(limite) || limite < 0 || ![fechamento, vencimento].every(x => Number.isInteger(x) && x >= 1 && x <= 31)) throw new Error('Confira o nome, limite e os dias de 1 a 31.');
      saveEntry('cartoes', id, { nome, limite: amount(limite), fechamento, vencimento });
    });
  }
  function payInvoice(cardId, mes, contaId, paidAmount, data) {
    const invoice = invoices().find(i => i.cartaoId === cardId && i.mes === mes);
    if (!invoice || !Number.isFinite(paidAmount) || cents(paidAmount) <= 0 || cents(paidAmount) > cents(invoice.restante)) throw new Error('O pagamento deve ser maior que zero e não superar o valor pendente.');
    if (contaId && !AppState.data.contas.some(c => c.id === contaId)) throw new Error('A conta selecionada não existe.');
    if (!parseCsvDate(data)) throw new Error('Informe uma data válida.');
    return saveEntry('movimentos', null, { tipo: 'despesa', classe: 'pagamento_fatura', cartaoId: cardId, faturaMes: mes, contaId, valor: amount(paidAmount), data,
      desc: `Pagamento da fatura — ${invoice.nome} (${mes})`, descricao: `Pagamento da fatura — ${invoice.nome} (${mes})`, cat: 'Fatura', categoria: 'Fatura' });
  }
  function openInvoicePayment(cardId, mes) {
    const invoice = invoices().find(i => i.cartaoId === cardId && i.mes === mes);
    if (!invoice || invoice.restante <= 0) return;
    form('Registrar pagamento da fatura', `<p>${esc(invoice.nome)} • ${esc(mes)} • pendente: <strong>${fmtBRL(invoice.restante)}</strong></p>` +
      choice('pagaConta', 'Conta de onde saiu o dinheiro', accountChoices()) + moneyField('pagaValor', 'Valor pago (R$)', invoice.restante) + field('pagaData', 'Data do pagamento', dateISO(), 'date'),
      () => payInvoice(cardId, mes, value('pagaConta'), number('pagaValor'), value('pagaData')));
  }

  function selectedCsvItems(items, decisions, contaId = '') {
    return items.flatMap((item, index) => {
      const decision = decisions[index];
      if (!decision?.selected) return [];
      const cat = String(decision.category || item.cat || 'Outros');
      const { possibleDuplicate, ...clean } = item;
      return [{ ...clean, contaId, cat, categoria: cat }];
    });
  }
  openCsvPreview = ({ items, ignored }) => {
    ensureData();
    if (!items.length) return alert('Nenhuma linha válida encontrada no CSV.');
    const owner = identity();
    const html = `<div id="walletCsvReview"><p>Confira as linhas antes de importar. Possíveis duplicatas vêm desmarcadas. ${ignored || 0} linha(s) inválida(s) ignorada(s).</p>` +
      choice('csvConta', 'Conta deste extrato', accountChoices()) + '<p id="csvTotals" aria-live="polite"></p>' +
      `<div class="table-container" style="max-height:380px;overflow:auto"><table class="custom-table"><thead><tr><th>Importar</th><th>Data / descrição</th><th>Categoria</th><th>Valor</th></tr></thead><tbody>${items.map((item, i) =>
        `<tr><td><input type="checkbox" id="csvPick${i}" aria-label="Importar linha ${i + 1}" ${item.possibleDuplicate ? '' : 'checked'}></td><td>${esc(item.data)}<br><strong>${esc(item.desc)}</strong>${item.possibleDuplicate ? '<br><span class="wallet-muted">Possível duplicata — confira</span>' : ''}</td><td><select id="csvCat${i}" class="input-field" aria-label="Categoria da linha ${i + 1}">${categoryChoices(item.cat).map(([key]) => `<option ${key === item.cat ? 'selected' : ''}>${esc(key)}</option>`).join('')}</select></td><td>${item.tipo === 'receita' ? '+' : '-'} ${fmtBRL(item.valor)}</td></tr>`).join('')}</tbody></table></div></div>`;
    const selected = () => selectedCsvItems(items, items.map((_, i) => ({ selected: document.getElementById(`csvPick${i}`).checked, category: value(`csvCat${i}`) })), value('csvConta'));
    openModal('Revisar importação CSV', html, [{ label: 'Cancelar', onClick: closeModal }, { label: 'Importar selecionadas', primary: true, onClick: () => {
      if (identity() !== owner) return alert('A conta ativa mudou. Abra o arquivo novamente.');
      const picked = selected();
      if (!picked.length) return alert('Selecione pelo menos uma linha.');
      AppState.data.movimentos.push(...picked); commit(); closeModal(); showToast(`${picked.length} movimentações importadas.`);
    } }]);
    const refreshTotals = () => {
      const picked = selected();
      const receipts = picked.filter(x => x.tipo === 'receita').reduce((s, x) => s + cents(x.valor), 0) / 100;
      const expenses = picked.filter(x => x.tipo === 'despesa').reduce((s, x) => s + cents(x.valor), 0) / 100;
      document.getElementById('csvTotals').textContent = `${picked.length} selecionada(s) • Entradas: ${fmtBRL(receipts)} • Gastos: ${fmtBRL(expenses)}`;
    };
    document.getElementById('walletCsvReview').addEventListener('change', refreshTotals);
    refreshTotals();
  };

  function summaryInsights(now = new Date()) {
    ensureData();
    const today = dateISO(now), mes = monthISO(now), previous = monthISO(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const monthCosts = monthlyExpenses(mes), previousCosts = monthlyExpenses(previous), overdue = [];
    for (const r of AppState.data.recorrentes) {
      const paid = r.ultimoMesPago ? r.ultimoMesPago >= mes : r.pagoNesteMes;
      const day = Math.min(r.dia, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate());
      if (!paid && r.tipo !== 'receita' && `${mes}-${String(day).padStart(2, '0')}` < today) overdue.push({ nome: r.desc || r.nome, valor: r.valor });
    }
    for (const d of AppState.data.dividas) if (d.venc && d.venc < today && d.total > d.pago) overdue.push({ nome: d.desc || d.credor, valor: amount(d.total - d.pago) });
    for (const p of AppState.data.parcelas) {
      if (p.pagas >= p.total) continue;
      const next = getNextParcelaDate(p.data1, p.pagas);
      if (next && dateISO(new Date(next.year, next.month, next.day)) < today) overdue.push({ nome: p.desc || p.descricao, valor: p.valor });
    }
    for (const i of invoices()) if (i.restante > 0 && i.vencimento < today) overdue.push({ nome: `Fatura — ${i.nome}`, valor: i.restante });
    return { monthCosts, previousCosts, difference: amount(monthCosts - previousCosts), overdue };
  }
  function renderExtras() {
    ensureData();
    const insight = summaryInsights();
    const summary = document.getElementById('walletInsights');
    if (summary) summary.innerHTML = `<h3>Atenção e evolução</h3><p>Gastos deste mês: <strong>${fmtBRL(insight.monthCosts)}</strong> • Mês anterior: ${fmtBRL(insight.previousCosts)}</p><p class="wallet-muted">${insight.previousCosts ? `${insight.difference >= 0 ? 'Aumento' : 'Redução'} de ${fmtBRL(Math.abs(insight.difference))} em relação ao mês anterior completo.` : 'Ainda não há gastos do mês anterior para comparar.'}</p><p><strong>${insight.overdue.length} compromisso(s) vencido(s)</strong></p>${insight.overdue.length ? `<ul>${insight.overdue.map(x => `<li>${esc(x.nome)} — ${fmtBRL(x.valor)}</li>`).join('')}</ul>` : '<p class="wallet-muted">Nenhum vencimento pendente identificado.</p>'}`;
    const accounts = document.getElementById('walletAccounts');
    if (accounts) {
      accounts.replaceChildren();
      for (const c of AppState.data.contas) {
        const panel = document.createElement('div'); panel.className = 'panel wallet-card';
        panel.innerHTML = `<h3>${esc(c.nome)}</h3><p class="kpi-val">${fmtBRL(accountBalance(c.id))}</p>`;
        panel.append(action('Editar', () => editAccount(c.id)), action('Excluir', () => removeWithUndo('contas', c.id))); accounts.append(panel);
      }
      const unassigned = document.createElement('div'); unassigned.className = 'panel wallet-card'; unassigned.innerHTML = `<h3>Sem conta definida</h3><p>${fmtBRL(accountBalance())}</p><p class="wallet-muted">Lançamentos antigos permanecem aqui até você vinculá-los a uma conta.</p>`; accounts.append(unassigned);
    }
    const cards = document.getElementById('walletCards');
    if (cards) {
      cards.replaceChildren();
      const allInvoices = invoices();
      for (const c of AppState.data.cartoes) {
        const panel = document.createElement('div'); panel.className = 'panel wallet-card';
        const used = allInvoices.filter(i => i.cartaoId === c.id).reduce((s, i) => s + cents(i.restante), 0) / 100;
        panel.innerHTML = `<h3>${esc(c.nome)}</h3><p>Fechamento: dia ${c.fechamento} • Vencimento: dia ${c.vencimento}</p><p>Pendente: <strong>${fmtBRL(used)}</strong>${c.limite ? ` • Limite disponível estimado: ${fmtBRL(c.limite - used)}` : ''}</p>`;
        panel.append(action('Editar', () => editCard(c.id)), action('Excluir', () => removeWithUndo('cartoes', c.id)));
        for (const invoice of allInvoices.filter(i => i.cartaoId === c.id)) {
          const row = document.createElement('div'); row.className = 'wallet-invoice';
          row.innerHTML = `<strong>Fatura ${esc(invoice.mes)}</strong><p>Vence em ${esc(invoice.vencimento.split('-').reverse().join('/'))} • Total: ${fmtBRL(invoice.total)} • Pago: ${fmtBRL(invoice.pago)} • Pendente: ${fmtBRL(invoice.restante)}</p>`;
          if (invoice.restante > 0) row.append(action('Registrar pagamento', () => openInvoicePayment(c.id, invoice.mes)));
          panel.append(row);
        }
        if (!allInvoices.some(i => i.cartaoId === c.id)) { const empty = document.createElement('p'); empty.textContent = 'Nenhuma compra vinculada a este cartão.'; panel.append(empty); }
        cards.append(panel);
      }
      if (!AppState.data.cartoes.length) cards.textContent = 'Cadastre um cartão e selecione-o ao lançar uma compra.';
    }
    const trash = document.getElementById('walletTrash');
    if (trash) {
      trash.replaceChildren();
      for (const entry of [...AppState.data.lixeira].reverse()) {
        const row = document.createElement('div'); row.className = 'wallet-invoice';
        const text = document.createElement('span'); text.textContent = `${entry.item.desc || entry.item.nome || entry.item.titulo || 'Item'} • ${new Date(entry.excluidoEm).toLocaleDateString('pt-BR')} `;
        row.append(text, action('Restaurar', () => { try { restoreTrash(entry.id); commit(); showToast('Item restaurado.'); } catch (error) { alert(error.message); } })); trash.append(row);
      }
      if (!AppState.data.lixeira.length) trash.textContent = 'Nenhum item excluído.';
    }
    // Identifica a origem de cada movimento sem alterar os botões já existentes.
    document.querySelectorAll('#movimentosTbody tr').forEach(row => {
      const button = row.querySelector('[onclick*="handleEditMovimento"]');
      const id = button?.getAttribute('onclick')?.match(/handleEditMovimento\('([^']+)'\)/)?.[1];
      const m = AppState.data.movimentos.find(x => x.id === id);
      if (!m) return;
      const text = m.classe === 'pagamento_fatura' ? 'Pagamento de fatura' : m.cartaoId ? 'Compra no cartão' : AppState.data.contas.find(c => c.id === m.contaId)?.nome;
      if (text) { const label = document.createElement('div'); label.className = 'wallet-muted'; label.textContent = text; row.cells[1].append(label); }
    });
  }
  function action(label, callback) { const button = document.createElement('button'); button.className = 'btn btn-outline'; button.textContent = label; button.addEventListener('click', callback); return button; }
  const baseRender = renderAll;
  renderAll = () => { ensureData(); baseRender(); renderExtras(); };
  const baseLogout = logout;
  logout = () => { const toast = document.getElementById('walletUndoToast'); if (toast) toast.hidden = true; if (undoTimer) clearTimeout(undoTimer); baseLogout(); };
  window.WalletFeatures = { accountBalance, invoiceMonth, invoices, payInvoice, selectedCsvItems, summaryInsights, trashEntry, restoreTrash, saveEntry, ensureData };
  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '.wallet-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:1rem}.wallet-card{padding:1.25rem;overflow-wrap:anywhere}.wallet-card .btn{margin:4px}.wallet-muted{font-size:.85rem;color:var(--text-muted)}.wallet-invoice{padding:1rem 0;border-top:1px solid var(--border)}#walletUndoToast{position:fixed;left:16px;right:16px;bottom:60px;z-index:550;background:var(--surface);border:1px solid var(--gold);border-radius:12px;padding:12px;max-width:480px;margin:auto;box-shadow:0 8px 32px #0006}#walletUndoToast button{margin-left:12px}#walletInsights{padding:1.25rem;margin-bottom:1rem}';
    document.head.append(style);
    const nav = document.getElementById('drawerNav');
    const navButton = document.createElement('button'); navButton.className = 'nav-item-btn'; navButton.dataset.tab = 'contascartoes'; navButton.textContent = '🏦 Contas e cartões'; navButton.onclick = () => switchTab('contascartoes'); nav.append(navButton);
    const trashButton = document.createElement('button'); trashButton.className = 'nav-item-btn'; trashButton.dataset.tab = 'lixeira'; trashButton.textContent = '↩️ Lixeira'; trashButton.onclick = () => switchTab('lixeira'); nav.append(trashButton);
    const section = document.createElement('section'); section.id = 'tab-contascartoes'; section.className = 'app-tab'; section.style.display = 'none';
    section.innerHTML = '<h2>🏦 Contas e cartões</h2><p class="wallet-muted">Controle os saldos e registre compras e pagamentos de faturas. Valores informados manualmente; não há conexão com bancos.</p><div id="walletAccountActions"></div><h3>Contas</h3><div id="walletAccounts" class="wallet-grid"></div><h3>Cartões e faturas</h3><div id="walletCards" class="wallet-grid"></div>';
    document.getElementById('appMain').append(section);
    document.getElementById('walletAccountActions').append(action('+ Nova conta', () => editAccount()), action('+ Novo cartão', () => editCard()));
    const trashSection = document.createElement('section'); trashSection.id = 'tab-lixeira'; trashSection.className = 'app-tab'; trashSection.style.display = 'none'; trashSection.innerHTML = '<h2>↩️ Lixeira</h2><p>Itens excluídos podem ser restaurados. Eles também são preservados no backup.</p><div class="panel wallet-card" id="walletTrash"></div>'; document.getElementById('appMain').append(trashSection);
    const insights = document.createElement('div'); insights.id = 'walletInsights'; insights.className = 'panel'; document.getElementById('tab-resumo').insertBefore(insights, document.getElementById('tab-resumo').children[2]);
    const toast = document.createElement('div'); toast.id = 'walletUndoToast'; toast.hidden = true; toast.setAttribute('role', 'status'); document.body.append(toast);
    renderExtras();
  });
})();
