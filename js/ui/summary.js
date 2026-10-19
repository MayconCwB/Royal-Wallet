    function renderResumo() {
      const fin = calcMonthlyFinancials();
      const curDate = new Date();
      const curYear = curDate.getFullYear();
      const curMonth = curDate.getMonth();
      const curMonthStr = `${curYear}-${String(curMonth + 1).padStart(2, '0')}`;
      const monthNames = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

      const tagEl = document.getElementById('resumoMonthTag');
      if (tagEl) tagEl.textContent = `${monthNames[curMonth]} ${curYear}`;

      document.getElementById('kpiSaldoReal').textContent = fmtBRL(fin.saldoReal);
      document.getElementById('kpiEntradas').textContent = fmtBRL(fin.entradasMes);
      document.getElementById('kpiGastos').textContent = fmtBRL(fin.gastosMes);
      document.getElementById('kpiCompromissos').textContent = fmtBRL(fin.compromissosMes);
      document.getElementById('kpiPrecisoTer').textContent = fmtBRL(fin.precisoTer);

      const prevEl = document.getElementById('kpiSaldoPrevisto');
      prevEl.textContent = fmtBRL(fin.saldoPrevisto);
      prevEl.className = "kpi-val " + (fin.saldoPrevisto >= 0 ? "val-emerald" : "val-danger");

      // Categorias Bar rendering
      const catTotals = {};
      AppState.data.movimentos.forEach(m => {
        if (m.tipo === 'despesa' && m.classe !== 'pagamento_fatura' && m.data?.startsWith(curMonthStr)) {
          const cat = m.cat || m.categoria || 'Outros';
          catTotals[cat] = (catTotals[cat] || 0) + Number(m.valor || 0);
        }
      });

      const chartBox = document.getElementById('chartBoxCategorias');
      chartBox.innerHTML = '';
      const catKeys = Object.keys(catTotals);
      if (catKeys.length === 0) {
        chartBox.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:1.5rem;">Nenhum gasto registrado para formar categorias.</div>';
      } else {
        const maxVal = Math.max(...Object.values(catTotals), 1);
        catKeys.forEach(cat => {
          const val = catTotals[cat];
          const pct = Math.round((val / maxVal) * 100);
          const row = document.createElement('div');
          row.style.marginBottom = "0.75rem";
          row.innerHTML = `
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:3px;">
              <span><strong>${escapeHtml(cat)}</strong></span>
              <span>${fmtBRL(val)}</span>
            </div>
            <div class="progress-track" style="margin:0;">
              <div class="progress-fill" style="width:${pct}%; background:#8b1e1e;"></div>
            </div>
          `;
          chartBox.appendChild(row);
        });
      }

      // Próximos 7 dias
      const proxEl = document.getElementById('proximosDiasList');
      const proximos = [];
      const hoje = new Date();
      hoje.setHours(0,0,0,0);

      // Recorrentes deste mês
      AppState.data.recorrentes.forEach(r => {
        if (r.tipo === 'receita') return;
        const isPago = r.ultimoMesPago ? (r.ultimoMesPago >= curMonthStr) : Boolean(r.pagoNesteMes);
        if (!isPago) {
          const dVenc = new Date(hoje.getFullYear(), hoje.getMonth(), Number(r.dia) || 1);
          const diffDays = Math.ceil((dVenc - hoje) / (1000 * 60 * 60 * 24));
          if (diffDays >= 0 && diffDays <= 7) {
            proximos.push({
              nome: r.desc || r.nome,
              tipo: 'Conta Fixa',
              valor: r.valor,
              dia: r.dia,
              diffDays
            });
          }
        }
      });

      // Parcelas com próxima parcela nos próximos 7 dias
      AppState.data.parcelas.forEach(p => {
        const total = p.total || 1;
        const pagas = p.pagas || 0;
        if (pagas < total && p.data1) {
          const nextDate = getNextParcelaDate(p.data1, pagas);
          if (nextDate) {
            const dVenc = new Date(nextDate.year, nextDate.month, nextDate.day);
            const diffDays = Math.ceil((dVenc - hoje) / (1000 * 60 * 60 * 24));
            if (diffDays >= 0 && diffDays <= 7) {
              proximos.push({
                nome: `${p.desc || p.descricao} (${pagas + 1}/${total})`,
                tipo: 'Parcela',
                valor: p.valor || p.valorParcela,
                dia: nextDate.day,
                diffDays
              });
            }
          }
        }
      });

      // Dívidas vencendo nos próximos 7 dias
      AppState.data.dividas.forEach(d => {
        if (d.venc) {
          const parts = d.venc.split('-');
          if (parts.length >= 3) {
            const dVenc = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            const diffDays = Math.ceil((dVenc - hoje) / (1000 * 60 * 60 * 24));
            const rest = (Number(d.total ?? d.valorTotal) || 0) - (Number(d.pago ?? d.valorPago) || 0);
            if (rest > 0 && diffDays >= 0 && diffDays <= 7) {
              proximos.push({
                nome: d.desc || d.credor,
                tipo: 'Dívida',
                valor: rest,
                dia: dVenc.getDate(),
                diffDays
              });
            }
          }
        }
      });

      if (proximos.length === 0) {
        proxEl.innerHTML = '<span style="color:var(--text-muted);">Nenhum pagamento agendado para os próximos 7 dias. Tudo tranquilo! ✨</span>';
      } else {
        proxEl.innerHTML = proximos.map(item => {
          const alertColor = item.diffDays <= 3 ? "color:#c0392b; font-weight:800;" : "color:var(--gold);";
          return `
            <div style="display:flex; justify-content:space-between; align-items:center; padding:0.5rem 0; border-bottom:1px solid var(--border);">
              <div>
                <strong>${escapeHtml(item.nome)}</strong>
                <span class="shell-badge" style="font-size:0.75rem; margin-left:6px;">${item.tipo}</span>
                <div style="font-size:0.8rem; ${alertColor}">
                  ${item.diffDays === 0 ? '⚠️ VENCE HOJE!' : (item.diffDays === 1 ? '⚠️ Vence amanhã' : `Vence em ${item.diffDays} dias`)} (Dia ${item.dia})
                </div>
              </div>
              <strong style="font-size:1.05rem;">${fmtBRL(item.valor)}</strong>
            </div>
          `;
        }).join('');
      }
    }
