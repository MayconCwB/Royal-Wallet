    globalThis.WalletDates = Object.freeze({
      today(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; },
      isFutureIncome(item, today = this.today()) { return item.tipo === 'receita' && typeof item.data === 'string' && parseCsvDate(item.data) === item.data && item.data > today; }
    });
    function calcMonthlyFinancials() {
      const now = new Date();
      const curYear = now.getFullYear();
      const curMonth = now.getMonth(); // 0-11
      const curMonthStr = `${curYear}-${String(curMonth + 1).padStart(2, '0')}`;

      // Entradas & Gastos do mês
      let entradasMes = 0;
      let gastosMes = 0;
      let saldoReal = 0;

      // Movimentos
      AppState.data.movimentos.forEach(m => {
        if (WalletDates.isFutureIncome(m)) return;
        const val = Number(m.valor) || 0;
        if (m.data) {
          const parts = m.data.split('-').map(Number);
          const y = parts[0];
          const mm = parts[1];
          if (m.tipo === 'receita') {
            saldoReal += val;
            if (y === curYear && (mm - 1) === curMonth) entradasMes += val;
          } else {
            saldoReal -= val;
            if (y === curYear && (mm - 1) === curMonth) gastosMes += val;
          }
        } else {
          if (m.tipo === 'receita') saldoReal += val;
          else saldoReal -= val;
        }
      });

      // Recorrentes do mês: dia no mês E (ultimoMesPago < mês selecionado) para despesa
      let recorrentesPendentes = 0;
      AppState.data.recorrentes.forEach(r => {
        if (r.tipo === 'receita') return;
        const isPago = r.ultimoMesPago ? (r.ultimoMesPago >= curMonthStr) : Boolean(r.pagoNesteMes);
        if (!isPago) {
          recorrentesPendentes += Number(r.valor) || 0;
        }
      });

      // Parcelas do mês: toda parcela cuja "próxima parcela" cai dentro do mês selecionado (e parcelas restantes > 0)
      let parcelasMes = 0;
      AppState.data.parcelas.forEach(p => {
        const total = p.total || 1;
        const pagas = p.pagas || 0;
        if (pagas < total && p.data1) {
          const nextDate = getNextParcelaDate(p.data1, pagas);
          if (nextDate && nextDate.year === curYear && nextDate.month === curMonth) {
            parcelasMes += Number(p.valor || p.valorParcela) || 0;
          }
        }
      });

      // Dívidas do mês: venc dentro do mês E (total - pago) > 0 (e vencidas anteriores não quitadas)
      let dividasMes = 0;
      AppState.data.dividas.forEach(d => {
        const rest = (Number(d.total ?? d.valorTotal) || 0) - (Number(d.pago ?? d.valorPago) || 0);
        if (rest > 0 && d.venc) {
          const parts = d.venc.split('-');
          if (parts.length >= 3) {
            const vy = parseInt(parts[0], 10);
            const vm = parseInt(parts[1], 10) - 1;
            if (vy < curYear || (vy === curYear && vm <= curMonth)) {
              dividasMes += rest;
            }
          }
        }
      });

      const compromissosMes = recorrentesPendentes + parcelasMes + dividasMes;
      const precisoTer = Math.max(0, compromissosMes - (entradasMes - gastosMes));
      const saldoPrevisto = saldoReal + (entradasMes - gastosMes) - compromissosMes;

      return {
        saldoReal,
        entradasMes,
        gastosMes,
        compromissosMes,
        precisoTer,
        saldoPrevisto
      };
    }
