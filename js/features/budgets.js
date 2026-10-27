/* Limites mensais calculados sobre lançamentos existentes; seguem no envelope cifrado. */
(() => {
  'use strict';
  const monthNow = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; };
  const validMonth = value => typeof value === 'string' && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value);
  const categoryKey = value => String(value || '').trim().normalize('NFC').toLocaleLowerCase('pt-BR');
  const money = value => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : 0;
  let selectedMonth = monthNow();
  function normalize(items) {
    const seen = new Set();
    return (Array.isArray(items) ? items : []).flatMap(item => {
      if (!item || !validMonth(item.mes) || typeof item.categoria !== 'string') return [];
      const categoria = item.categoria.trim(), limit = money(item.limite), key = item.mes + ':' + categoryKey(categoria);
      if (!categoria || categoria.length > 80 || limit <= 0 || limit > 100000000000 || seen.has(key)) return [];
      seen.add(key);
      return [{ id: String(item.id || uidGen()), mes: item.mes, categoria, limite: limit / 100 }];
    });
  }
  const baseNormalize = normalizeDataStructure;
  normalizeDataStructure = (raw, source) => ({ ...baseNormalize(raw, source), orcamentos: normalize(raw?.orcamentos) });
  const baseEmpty = emptyWallet;
  emptyWallet = () => ({ ...baseEmpty(), orcamentos: [] });
  function summarize(data, month) {
    const totals = new Map();
    for (const item of data.movimentos || []) {
      if (item.tipo !== 'despesa' || item.classe === 'pagamento_fatura' || typeof item.data !== 'string' || item.data.slice(0, 7) !== month || parseCsvDate(item.data) !== item.data) continue;
      const key = categoryKey(item.cat || item.categoria || 'Geral');
      totals.set(key, (totals.get(key) || 0) + money(item.valor));
    }
    const rows = normalize(data.orcamentos).filter(item => item.mes === month).map(item => {
      const spent = Math.max(0, totals.get(categoryKey(item.categoria)) || 0), limit = money(item.limite);
      return { ...item, gasto: spent / 100, restante: (limit - spent) / 100, percentual: Math.round(spent / limit * 100),
        status: spent > limit ? 'excedido' : spent === limit ? 'atingido' : spent >= limit * .8 ? 'atencao' : 'normal' };
    });
    const planned = new Set(rows.map(item => categoryKey(item.categoria)));
    return { rows, limiteTotal: rows.reduce((sum, item) => sum + money(item.limite), 0) / 100,
      gastoTotal: rows.reduce((sum, item) => sum + money(item.gasto), 0) / 100,
      semLimite: [...totals].filter(([key]) => !planned.has(key)).reduce((sum, [, amount]) => sum + Math.max(0, amount), 0) / 100 };
  }
  function requireUnlocked() { if (!WalletPrivacy.ready()) throw Error('Desbloqueie a carteira para alterar o orçamento.'); }
  function save({ id, mes, categoria, limite }) {
    requireUnlocked();
    const candidate = normalize([{ id: id || uidGen(), mes, categoria, limite }])[0];
    if (!candidate) throw Error('Informe um mês válido, uma categoria e um limite maior que zero.');
    const items = AppState.data.orcamentos || [];
    if (id && !items.some(item => item.id === id)) throw Error('Este orçamento foi removido. Abra a lista novamente.');
    if (items.some(item => item.id !== id && item.mes === mes && categoryKey(item.categoria) === categoryKey(candidate.categoria))) throw Error('Esta categoria já tem limite neste mês. Edite o limite existente.');
    AppState.data.orcamentos = [...items.filter(item => item.id !== id), candidate];
    triggerAutoSave(); renderAll(); return candidate;
  }
  function remove(id) { requireUnlocked(); AppState.data.orcamentos = (AppState.data.orcamentos || []).filter(item => item.id !== id); triggerAutoSave(); renderAll(); }
  function previousMonth(month) { const [year, number] = month.split('-').map(Number); const date = new Date(year, number - 2, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`; }
  function copyPrevious(month) {
    requireUnlocked(); if (!validMonth(month)) throw Error('Escolha um mês válido.');
    const items = normalize(AppState.data.orcamentos), existing = new Set(items.filter(item => item.mes === month).map(item => categoryKey(item.categoria)));
    const copied = items.filter(item => item.mes === previousMonth(month) && !existing.has(categoryKey(item.categoria))).map(item => ({ ...item, id: uidGen(), mes: month }));
    if (copied.length) { AppState.data.orcamentos = [...items, ...copied]; triggerAutoSave(); renderAll(); }
    return copied.length;
  }
  globalThis.WalletBudgets = Object.freeze({ normalize, summarize, save, remove, copyPrevious });
})();
