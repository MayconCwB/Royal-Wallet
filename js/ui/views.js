    function renderMovimentos() {
      const tbody = document.getElementById('movimentosTbody');
      const termo = (document.getElementById('buscaMovimento')?.value || '').toLowerCase();
      const filtroTipo = document.getElementById('filtroTipoMovimento')?.value || 'todos';

      const items = AppState.data.movimentos.filter(m => {
        const descStr = (m.desc || m.descricao || '').toLowerCase();
        const catStr = (m.cat || m.categoria || '').toLowerCase();
        const matchesTermo = descStr.includes(termo) || catStr.includes(termo);
        const matchesTipo = filtroTipo === 'todos' || m.tipo === filtroTipo;
        return matchesTermo && matchesTipo;
      }).sort((a,b) => new Date(b.data) - new Date(a.data));

      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Nenhum lançamento encontrado.</td></tr>';
        return;
      }

      tbody.innerHTML = items.map(m => {
        const isRec = m.tipo === 'receita';
        const cor = isRec ? "var(--emerald)" : "var(--danger)";
        const sinal = isRec ? "+" : "-";
        return `
          <tr data-movement-id="${escapeHtml(String(m.id))}">
            <td>${escapeHtml(m.data ? m.data.split('-').reverse().join('/') : '-')}</td>
            <td><strong>${escapeHtml(m.desc || m.descricao)}</strong></td>
            <td><span class="shell-badge">${escapeHtml(m.cat || m.categoria || 'Geral')}</span></td>
            <td><span style="color:${cor}; font-weight:600;">${isRec ? 'Entrada' : 'Gasto'}</span></td>
            <td style="text-align:right; font-weight:700; color:${cor};">${sinal} ${fmtBRL(m.valor)}</td>
            <td style="text-align:center; white-space:nowrap;">
              <button class="btn-action-sm" data-action="handleDuplicateNextMonth" data-id="${escapeHtml(String(m.id))}" title="Duplicar para próximo mês">📋</button>
              <button class="btn-action-sm" data-action="handleEditMovimento" data-id="${escapeHtml(String(m.id))}" title="Editar">✏️</button>
              <button class="btn-action-sm" data-action="handleDeleteMovimento" data-id="${escapeHtml(String(m.id))}" title="Excluir">🗑️</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    function renderRecorrentes() {
      const tbody = document.getElementById('recorrentesTbody');
      const items = AppState.data.recorrentes;
      const curYYYYMM = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Nenhuma conta fixa cadastrada.</td></tr>';
        return;
      }

      tbody.innerHTML = items.map(r => {
        const isPago = r.ultimoMesPago ? (r.ultimoMesPago >= curYYYYMM) : Boolean(r.pagoNesteMes);
        const riscado = isPago ? "text-decoration:line-through; opacity:0.6;" : "";
        return `
          <tr style="${riscado}">
            <td><strong>Dia ${String(r.dia).padStart(2, '0')}</strong></td>
            <td><strong>${escapeHtml(r.desc || r.nome)}</strong></td>
            <td><span class="shell-badge">${escapeHtml(r.cat || r.categoria || 'Fixa')}</span></td>
            <td style="text-align:right; font-weight:700;">${fmtBRL(r.valor)}</td>
            <td>
              <button class="btn btn-sm ${isPago ? 'btn-outline' : 'btn-primary'}"
                style="${isPago ? 'border-color:var(--emerald); color:var(--emerald);' : 'background:#8b1e1e; border:none; color:#fff;'}"
                data-action="handleToggleRecorrentePago" data-id="${escapeHtml(String(r.id))}">
                ${isPago ? '✔ Paguei neste mês' : 'Marcar como Paga'}
              </button>
            </td>
            <td style="text-align:center; white-space:nowrap;">
              <button class="btn-action-sm" data-action="handleDeleteRecorrente" data-id="${escapeHtml(String(r.id))}" title="Excluir">🗑️</button>
              <button class="btn-action-sm" data-action="handleEditRecorrente" data-id="${escapeHtml(String(r.id))}" title="Editar conta fixa" aria-label="Editar conta fixa">✏️</button>
            </td>
          </tr>
        `;
      }).join('');
    }

    function renderParcelas() {
      const container = document.getElementById('parcelasGrid');
      const items = AppState.data.parcelas;

      if (items.length === 0) {
        container.innerHTML = '<div class="panel" style="grid-column:1/-1; text-align:center; padding:2rem; color:var(--text-muted);">Nenhuma compra parcelada cadastrada.</div>';
        return;
      }

      container.innerHTML = items.map(p => {
        const total = p.total || 1;
        const pagas = p.pagas || 0;
        const valor = Number(p.valor || p.valorParcela) || 0;
        const pct = Math.round((pagas / total) * 100);

        // Data da próxima parcela calculada de data1 + pagas meses
        let proxDataStr = "A definir";
        if (p.data1) {
          const nextInfo = getNextParcelaDate(p.data1, pagas);
          if (nextInfo) {
            proxDataStr = nextInfo.display;
          } else {
            try {
              logEvent(`ALERTA Parcela 'A definir' com data1: ${JSON.stringify(p).slice(0, 300)}`);
            } catch (_) {}
          }
        }

        return `
          <div class="panel" style="padding:1.25rem;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <h4 style="margin:0; font-size:1.15rem; color:var(--gold);">${escapeHtml(p.desc || p.descricao)}</h4>
              <button class="btn-action-sm" data-action="handleDeleteParcela" data-id="${escapeHtml(String(p.id))}">🗑️</button>
              <button class="btn-action-sm" data-action="handleEditParcela" data-id="${escapeHtml(String(p.id))}" title="Editar parcela" aria-label="Editar parcela">✏️</button>
            </div>

            <div style="margin:0.75rem 0; font-size:0.95rem;">
              <div>Parcela: <strong>${fmtBRL(valor)}</strong> / mês</div>
              <div>Total: ${fmtBRL(valor * total)}</div>
              <div style="color:var(--gold); font-size:0.9rem; margin-top:4px;">
                Próxima: <strong>${proxDataStr}</strong>
              </div>
            </div>

            <div class="progress-track">
              <div class="progress-fill" style="width:${pct}%;"></div>
            </div>

            <!-- Contador interativo de parcelas pagas com botões - / + -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin:0.75rem 0; background:rgba(0,0,0,0.2); padding:0.5rem 0.75rem; border-radius:8px; border:1px solid var(--border);">
              <div style="font-size:0.85rem; font-weight:600;">
                <span>${pct}% concluído</span>
              </div>
              <div style="display:flex; align-items:center; gap:8px;">
                <button type="button" class="btn-stepper btn-stepper-sm" data-action="handleAdjustParcelasPagas" data-id="${escapeHtml(String(p.id))}" data-delta="-1" aria-label="Diminuir parcelas pagas" ${pagas <= 0 ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>−</button>
                <strong style="min-width:65px; text-align:center; font-size:0.95rem; color:var(--gold);">${pagas} / ${total}</strong>
                <button type="button" class="btn-stepper btn-stepper-sm" data-action="handleAdjustParcelasPagas" data-id="${escapeHtml(String(p.id))}" data-delta="1" aria-label="Aumentar parcelas pagas" ${pagas >= total ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>+</button>
              </div>
            </div>


          </div>
        `;
      }).join('');
    }

    function renderDividas() {
      const container = document.getElementById('dividasGrid');
      const items = AppState.data.dividas;

      if (items.length === 0) {
        container.innerHTML = '<div class="panel" style="grid-column:1/-1; text-align:center; padding:2rem; color:var(--text-muted);">Nenhuma dívida pendente cadastrada. Parabéns! 🕊️</div>';
        return;
      }

      container.innerHTML = items.map(d => {
        const total = Number(d.total ?? d.valorTotal) || 0;
        const pago = Number(d.pago ?? d.valorPago) || 0;
        const rest = Math.max(0, total - pago);
        const pct = Math.min(100, Math.round((pago / (total || 1)) * 100));

        let vencStr = "Sem data";
        let isVencida = false;
        if (d.venc) {
          const parts = d.venc.split('-');
          if (parts.length >= 3) {
            const vy = parseInt(parts[0], 10);
            const vm = parseInt(parts[1], 10) - 1;
            const vd = parseInt(parts[2], 10);
            const dVenc = new Date(vy, vm, vd);
            const hoje = new Date();
            hoje.setHours(0,0,0,0);
            isVencida = dVenc < hoje;
            vencStr = `${String(vd).padStart(2,'0')}/${String(vm + 1).padStart(2,'0')}/${vy}`;
          }
        }

        return `
          <div class="panel" style="padding:1.25rem; ${isVencida ? 'border-color:#e67e22;' : ''}">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <h4 style="margin:0; font-size:1.15rem; color:var(--gold);">${escapeHtml(d.desc || d.credor)}</h4>
              <button class="btn-action-sm" data-action="handleDeleteDivida" data-id="${escapeHtml(String(d.id))}">🗑️</button>
              <button class="btn-action-sm" data-action="handleEditDivida" data-id="${escapeHtml(String(d.id))}" title="Editar dívida" aria-label="Editar dívida">✏️</button>
            </div>

            <div style="margin:0.75rem 0; font-size:0.95rem;">
              <div>Restante: <strong style="color:var(--danger); font-size:1.2rem;">${fmtBRL(rest)}</strong></div>
              <div style="font-size:0.85rem; color:var(--text-muted);">Total original: ${fmtBRL(total)}</div>
              <div style="margin-top:4px; font-size:0.85rem; ${isVencida ? 'color:#e67e22; font-weight:800;' : ''}">
                ${isVencida ? '⚠️ Vencida em:' : 'Vence em:'} ${vencStr}
              </div>
            </div>

            <div class="progress-track">
              <div class="progress-fill" style="width:${pct}%; background:var(--emerald);"></div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:0.75rem;">
              <span>${fmtBRL(pago)} quitado</span>
              <span>${pct}%</span>
            </div>

            <div style="display:flex; gap:8px;">
              <button class="btn btn-outline" style="flex:1;" data-action="handleAmortizarDivida" data-id="${escapeHtml(String(d.id))}">
                Pagar parte
              </button>
              <button class="btn btn-primary" style="flex:1; background:#8b1e1e; border:none; color:#fff;" data-action="handleQuitarDivida" data-id="${escapeHtml(String(d.id))}">
                Quitar tudo
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    function renderMetas() {
      const container = document.getElementById('metasGrid');
      const items = AppState.data.metas;

      if (items.length === 0) {
        container.innerHTML = '<div class="panel" style="grid-column:1/-1; text-align:center; padding:2rem; color:var(--text-muted);">Nenhuma meta de economia criada ainda.</div>';
        return;
      }

      container.innerHTML = items.map(m => {
        const atual = Number(m.guardado ?? m.valorAtual) || 0;
        const alvo = Number(m.alvo ?? m.valorAlvo) || 1;
        const pct = Math.min(100, Math.round((atual / alvo) * 100));

        return `
          <div class="panel" style="padding:1.25rem;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <h4 style="margin:0; font-size:1.15rem; color:var(--gold);">${escapeHtml(m.desc || m.titulo)}</h4>
              <button class="btn-action-sm" data-action="handleDeleteMeta" data-id="${escapeHtml(String(m.id))}">🗑️</button>
            </div>

            <div style="margin:0.75rem 0;">
              <div style="font-size:1.25rem; font-weight:800; color:var(--gold);">${fmtBRL(atual)}</div>
              <div style="font-size:0.85rem; color:var(--text-muted);">Objetivo: ${fmtBRL(alvo)}</div>
            </div>

            <div class="progress-track">
              <div class="progress-fill" style="width:${pct}%; background:var(--gold);"></div>
            </div>
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:0.75rem;">
              <span>Progresso</span>
              <span><strong>${pct}%</strong></span>
            </div>

            <button class="btn btn-primary" style="width:100%; background:#8b1e1e; border:none; color:#fff; font-weight:700;" data-action="handleAddValorMeta" data-id="${escapeHtml(String(m.id))}">
              + Adicionar R$
            </button>
          </div>
        `;
      }).join('');
    }

    function renderPlanejamento() {
      const baseDate = new Date();
      baseDate.setDate(1);
      baseDate.setMonth(baseDate.getMonth() + AppState.planOffset);

      const targetYear = baseDate.getFullYear();
      const targetMonth = baseDate.getMonth();
      const monthNames = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
      const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

      document.getElementById('planCurrentMonthLabel').textContent = `${monthNames[targetMonth]} ${targetYear}`;

      // O planejamento agora monta vários meses de uma vez.
      // Assim as parcelas futuras aparecem no mês correto, mesmo quando
      // o usuário está visualizando outro mês.
      const monthBlocks = [];

      for (let offset = 0; offset < 6; offset++) {
        const d = new Date(targetYear, targetMonth + offset, 1);
        const year = d.getFullYear();
        const month = d.getMonth();
        const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
        const daysMap = {};

        // 1. Recorrentes do mês
        AppState.data.recorrentes.forEach(r => {
          if (r.tipo === 'receita') return;
          const isPaid = r.ultimoMesPago
            ? (r.ultimoMesPago >= monthStr)
            : (offset === 0 && AppState.planOffset === 0 && Boolean(r.pagoNesteMes));
          const day = Math.min(new Date(year, month + 1, 0).getDate(), Math.max(1, Number(r.dia) || 1));
          if (!daysMap[day]) daysMap[day] = [];
          daysMap[day].push({
            tipo: 'Recorrente',
            nome: r.desc || r.nome,
            valor: Number(r.valor) || 0,
            pago: isPaid
          });
        });

        // 2. TODAS as parcelas que vencem neste mês
        AppState.data.parcelas.forEach(p => {
          const total = Math.max(1, parseInt(p.total, 10) || 1);
          const pagas = Math.max(0, parseInt(p.pagas, 10) || 0);
          const valor = Number(p.valor || p.valorParcela) || 0;
          if (pagas >= total || !p.data1 || valor <= 0) return;

          // Verifica cada parcela restante e coloca somente as que pertencem a este mês.
          for (let numero = pagas; numero < total; numero++) {
            const nextDate = getNextParcelaDate(p.data1, numero);
            if (!nextDate || nextDate.year !== year || nextDate.month !== month) continue;
            if (!daysMap[nextDate.day]) daysMap[nextDate.day] = [];
            daysMap[nextDate.day].push({
              tipo: 'Parcela',
              nome: `${p.desc || p.descricao || 'Compra parcelada'} (${numero + 1}/${total})`,
              valor,
              pago: false
            });
          }
        });

        // 3. Dívidas que vencem neste mês.
        AppState.data.dividas.forEach(dv => {
          const rest = (Number(dv.total ?? dv.valorTotal) || 0) - (Number(dv.pago ?? dv.valorPago) || 0);
          if (rest <= 0 || !dv.venc) return;
          const parts = dv.venc.split('-');
          if (parts.length < 3) return;
          const vy = parseInt(parts[0], 10);
          const vm = parseInt(parts[1], 10) - 1;
          const vd = parseInt(parts[2], 10);

          const isThisMonth = vy === year && vm === month;
          const isOverdueCurrent = offset === 0 && AppState.planOffset === 0 &&
            (vy < year || (vy === year && vm < month));

          if (isThisMonth || isOverdueCurrent) {
            const day = Math.min(new Date(year, month + 1, 0).getDate(), Math.max(1, vd));
            if (!daysMap[day]) daysMap[day] = [];
            daysMap[day].push({
              tipo: 'Dívida',
              nome: `${dv.desc || dv.credor}`,
              valor: rest,
              pago: false
            });
          }
        });

        if (window.WalletFeatures) {
          window.WalletFeatures.invoices().filter(invoice => invoice.mes === monthStr && invoice.restante > 0).forEach(invoice => {
            const day = Number(invoice.vencimento.slice(-2));
            if (!daysMap[day]) daysMap[day] = [];
            daysMap[day].push({ tipo: 'Fatura', nome: invoice.nome, valor: invoice.restante, pago: false });
          });
        }
        const sortedDays = Object.keys(daysMap).map(Number).sort((a,b) => a-b);
        let totalMes = 0;
        sortedDays.forEach(day => daysMap[day].forEach(item => {
          if (!item.pago) totalMes += item.valor;
        }));

        monthBlocks.push({ year, month, monthStr, daysMap, sortedDays, totalMes, offset });
      }

      // O KPI continua representando o mês selecionado, e não a soma dos 6 meses.
      const selectedBlock = monthBlocks[0];
      let plannedEntradas = 0;
      AppState.data.movimentos.forEach(m => {
        if (m.tipo === 'receita' && m.data) {
          const parts = m.data.split('-').map(Number);
          if (parts[0] === targetYear && (parts[1] - 1) === targetMonth) {
            plannedEntradas += Number(m.valor) || 0;
          }
        }
      });

      const totalAPagar = selectedBlock.totalMes;
      const saldoProjetado = plannedEntradas - totalAPagar;
      document.getElementById('planEntradasVal').textContent = fmtBRL(plannedEntradas);
      document.getElementById('planTotalPagarVal').textContent = fmtBRL(totalAPagar);
      const projEl = document.getElementById('planSaldoProjetadoVal');
      projEl.textContent = fmtBRL(saldoProjetado);
      projEl.className = "kpi-val " + (saldoProjetado >= 0 ? "val-emerald" : "val-danger");

      // Todos os meses ficam dentro da mesma área de planejamento.
      const daysContainer = document.getElementById('planDaysList');
      if (!monthBlocks.some(m => m.sortedDays.length)) {
        daysContainer.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:1.5rem;">Nenhum pagamento agendado nos próximos meses.</div>';
      } else {
        daysContainer.innerHTML = monthBlocks.map(grupo => {
          if (!grupo.sortedDays.length) {
            return `
              <div style="background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:1rem; margin-bottom:0.9rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                  <strong style="color:var(--gold); font-size:1.05rem;">${monthNames[grupo.month]} ${grupo.year}</strong>
                  <strong>Total do mês: ${fmtBRL(0)}</strong>
                </div>
              </div>`;
          }

          const diasHtml = grupo.sortedDays.map(dayNum => {
            const items = grupo.daysMap[dayNum];
            let daySum = 0;
            let allPaid = true;
            items.forEach(i => {
              if (!i.pago) { daySum += i.valor; allPaid = false; }
            });
            const dayDate = new Date(grupo.year, grupo.month, dayNum);
            const wDayName = weekdays[dayDate.getDay()];
            const sumColor = daySum > 500 ? "color:#c0392b; font-weight:800;" : "color:var(--gold); font-weight:700;";

            return `
              <div style="background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:0.75rem; margin-bottom:0.6rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:0.45rem; border-bottom:1px solid var(--border); padding-bottom:0.3rem;">
                  <span style="font-weight:800;">Dia ${String(dayNum).padStart(2,'0')} — ${wDayName}</span>
                  ${allPaid ? '<span style="color:var(--emerald); font-weight:700;">✔ dia quitado</span>' : `<span style="${sumColor}">Total do dia: ${fmtBRL(daySum)}</span>`}
                </div>
                <div style="font-size:0.9rem;">
                  ${items.map(it => `
                    <div style="display:flex; justify-content:space-between; gap:10px; padding:3px 0; ${it.pago ? 'text-decoration:line-through; opacity:0.6;' : ''}">
                      <span>• ${escapeHtml(it.nome)} <span class="shell-badge" style="font-size:0.7rem;">${it.tipo}</span></span>
                      <strong style="white-space:nowrap;">${fmtBRL(it.valor)}</strong>
                    </div>`).join('')}
                </div>
              </div>`;
          }).join('');

          return `
            <div style="border:1px solid var(--border); border-radius:10px; padding:1rem; margin-bottom:1rem; background:rgba(139,30,30,0.06);">
              <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:0.75rem; border-bottom:1px solid var(--border); padding-bottom:0.55rem;">
                <strong style="color:var(--gold); font-size:1.1rem;">${monthNames[grupo.month]} ${grupo.year}</strong>
                <strong style="font-size:1.05rem;">Total do mês: ${fmtBRL(grupo.totalMes)}</strong>
              </div>
              ${diasHtml}
            </div>`;
        }).join('');
      }

      renderSvgTrend();
    }

    function renderSvgTrend() {
      const container = document.getElementById('planSvgTrend');
      if (!container) return;

      const months = [];
      const now = new Date();
      for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        months.push({
          label: d.toLocaleDateString('pt-BR', { month: 'short' }),
          y: d.getFullYear(),
          m: d.getMonth()
        });
      }

      // Mock or compute each month
      const dataPoints = months.map(m => {
        let pagamentos = 0;
        AppState.data.recorrentes.forEach(r => pagamentos += Number(r.valor) || 0);
        return { label: m.label, valor: pagamentos };
      });

      const maxVal = Math.max(...dataPoints.map(d => d.valor), 100);
      const svgW = 400;
      const svgH = 120;
      const step = svgW / dataPoints.length;

      let barsHtml = dataPoints.map((dp, idx) => {
        const barH = (dp.valor / maxVal) * (svgH - 35);
        const x = idx * step + 15;
        const y = svgH - 20 - barH;
        return `
          <rect x="${x}" y="${y}" width="${step - 30}" height="${barH}" rx="4" fill="#8b1e1e" />
          <text x="${x + (step - 30)/2}" y="${svgH - 5}" font-size="11" fill="var(--text-royal-muted)" text-anchor="middle">${dp.label}</text>
          <text x="${x + (step - 30)/2}" y="${Math.max(12, y - 4)}" font-size="10" fill="var(--gold)" text-anchor="middle">R$ ${Math.round(dp.valor)}</text>
        `;
      }).join('');

      container.innerHTML = `
        <svg viewBox="0 0 ${svgW} ${svgH}" style="width:100%; max-width:550px; height:auto; overflow:visible;">
          ${barsHtml}
        </svg>
      `;
    }

    function renderHistorico() {
      const tbody = document.getElementById('historicoTbody');
      const termo = (document.getElementById('buscaHistorico')?.value || '').toLowerCase();
      const items = (AppState.data.historico || []).filter(h => {
        return (h.nome || '').toLowerCase().includes(termo) || (h.tipo || '').toLowerCase().includes(termo);
      });

      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:1.5rem;">Nenhum item no histórico.</td></tr>';
        return;
      }

      tbody.innerHTML = items.map(h => `
        <tr>
          <td><span class="shell-badge">${escapeHtml(h.tipo)}</span></td>
          <td><strong>${escapeHtml(h.nome)}</strong></td>
          <td>${fmtBRL(h.valorTotal)}</td>
          <td>${h.concluidoEm ? new Date(h.concluidoEm).toLocaleDateString('pt-BR') : '-'}</td>
          <td style="text-align:center;">
            <button class="btn btn-sm btn-outline" data-action="handleDevolverParaAtivos" data-id="${escapeHtml(String(h.id))}" title="Voltar para a aba ativa">
              ↩️ Devolver para ativos
            </button>
          </td>
        </tr>
      `).join('');
    }

    function renderAll() {
      renderResumo();
      renderMovimentos();
      renderRecorrentes();
      renderParcelas();
      renderDividas();
      renderMetas();
      renderPlanejamento();
      renderHistorico();
    }
