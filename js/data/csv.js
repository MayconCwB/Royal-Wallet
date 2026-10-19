    /* ===== IMPORTAÇÃO DE EXTRATO CSV ===== */
    function parseCsvLine(line, delimiter) {
      const out = [];
      let cur = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
          else quoted = !quoted;
        } else if (ch === delimiter && !quoted) {
          out.push(cur.trim()); cur = '';
        } else cur += ch;
      }
      out.push(cur.trim());
      return out;
    }

    function normalizeCsvHeader(v) {
      return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    }

    function detectCsvDelimiter(line) {
      const counts = [',',';','\t'].map(d => ({ d, n: parseCsvLine(line, d).length }));
      counts.sort((a,b) => b.n - a.n);
      return counts[0].n > 1 ? counts[0].d : ',';
    }

    function csvToRows(text) {
      const clean = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const records = [];
      let record = '', quoted = false;
      for (let i = 0; i < clean.length; i++) {
        const ch = clean[i];
        if (ch === '"') {
          record += ch;
          if (quoted && clean[i + 1] === '"') { record += clean[++i]; continue; }
          quoted = !quoted;
        } else if (ch === '\n' && !quoted) {
          if (record.trim()) records.push(record);
          record = '';
        } else record += ch;
      }
      if (quoted) throw new Error('O CSV contém aspas sem fechamento.');
      if (record.trim()) records.push(record);
      if (!records.length) return { headers: [], rows: [] };
      const delimiter = detectCsvDelimiter(records[0]);
      return { headers: parseCsvLine(records[0], delimiter), rows: records.slice(1).map(r => parseCsvLine(r, delimiter)), delimiter };
    }

    function csvFindColumn(headers, aliases) {
      const normalized = headers.map(normalizeCsvHeader);
      for (const alias of aliases) {
        const idx = normalized.indexOf(normalizeCsvHeader(alias));
        if (idx >= 0) return idx;
      }
      for (let i = 0; i < normalized.length; i++) {
        if (aliases.some(a => normalized[i].includes(normalizeCsvHeader(a)))) return i;
      }
      return -1;
    }

    function parseCsvMoney(value) {
      let s = String(value ?? '').trim().replace(/R\$|BRL/gi, '').replace(/\s/g, '');
      if (!s) return NaN;
      const negative = /^-/.test(s) || /\(.*\)/.test(s);
      s = s.replace(/[()]/g, '').replace(/[^0-9,.-]/g, '');
      if (s.includes(',') && s.includes('.')) {
        if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
        else s = s.replace(/,/g, '');
      } else if (s.includes(',')) {
        s = s.replace(',', '.');
      }
      const n = Number(s);
      return Number.isFinite(n) ? (negative ? -Math.abs(n) : n) : NaN;
    }

    function parseCsvDate(value) {
      const s = String(value || '').trim();
      let y, month, day;
      let m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
      if (m) {
        y = Number(m[3]); if (y < 100) y += 2000;
        month = Number(m[2]); day = Number(m[1]);
      } else {
        m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
        if (!m) return '';
        y = Number(m[1]); month = Number(m[2]); day = Number(m[3]);
      }
      if (y < 1000 || month < 1 || month > 12 || day < 1 || day > new Date(y, month, 0).getDate()) return '';
      return `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }

    function autoCategoryCsv(desc, tipo) {
      const s = String(desc || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (tipo === 'receita') {
        if (/salario|folha|pagamento/.test(s)) return 'Salário';
        if (/freela|freelance|servico|serviço/.test(s)) return 'Freelance';
        if (/venda|pix recebido|recebimento/.test(s)) return 'Venda';
        return 'Outros';
      }
      if (/mercado|supermercado|ifood|restaurante|lanch|padaria|food/.test(s)) return 'Alimentação';
      if (/uber|99|combust|posto|estacion|pedagio|pedágio|transito|transito/.test(s)) return 'Transporte';
      if (/aluguel|condominio|condomínio|luz|energia|agua|água|gas|gás|internet|telefone/.test(s)) return /internet|telefone/.test(s) ? 'Contas' : 'Moradia';
      if (/farmacia|farmácia|hospital|clinica|clínica|medic/.test(s)) return 'Saúde';
      if (/escola|faculdade|curso|livraria/.test(s)) return 'Educação';
      if (/netflix|spotify|cinema|jogo|steam|playstation|lazer/.test(s)) return 'Lazer';
      return 'Outros';
    }

    function prepareCsvImport(text, options = {}) {
      const parsed = csvToRows(text);
      if (!parsed.headers.length) throw new Error('O CSV está vazio.');
      const dateIdx = csvFindColumn(parsed.headers, ['data','date','data transacao','data transação']);
      const descIdx = csvFindColumn(parsed.headers, ['descricao','descrição','historico','histórico','lancamento','lançamento','description','memo','detalhe']);
      const valueIdx = csvFindColumn(parsed.headers, ['valor','value','amount','valor transacao','valor transação']);
      const creditIdx = csvFindColumn(parsed.headers, ['credito','crédito','credit']);
      const debitIdx = csvFindColumn(parsed.headers, ['debito','débito','debit']);
      if (dateIdx < 0 || descIdx < 0 || (valueIdx < 0 && creditIdx < 0 && debitIdx < 0)) {
        throw new Error('Não consegui identificar Data, Descrição e Valor. Confira o cabeçalho do CSV.');
      }
      const existing = new Map();
      for (const m of AppState.data.movimentos) {
        const key = [m.data, (m.desc || m.descricao || '').trim().toLowerCase(), Number(m.valor || 0), m.tipo].join('|');
        existing.set(key, (existing.get(key) || 0) + 1);
      }
      const occurrences = new Map();
      const items = [];
      let ignored = 0;
      parsed.rows.forEach(cols => {
        const data = parseCsvDate(cols[dateIdx]);
        const descricao = String(cols[descIdx] || '').trim();
        let valor = valueIdx >= 0 ? parseCsvMoney(cols[valueIdx]) : NaN;
        if (!Number.isFinite(valor) || valor === 0) {
          const cr = creditIdx >= 0 ? parseCsvMoney(cols[creditIdx]) : NaN;
          const db = debitIdx >= 0 ? parseCsvMoney(cols[debitIdx]) : NaN;
          if (Number.isFinite(cr) && cr !== 0) valor = Math.abs(cr);
          else if (Number.isFinite(db) && db !== 0) valor = -Math.abs(db);
        }
        if (!data || !descricao || !Number.isFinite(valor) || valor === 0) { ignored++; return; }
        const tipo = valor >= 0 ? 'receita' : 'despesa';
        const abs = Math.abs(valor);
        const key = [data, descricao.toLowerCase(), abs, tipo].join('|');
        const occurrence = (occurrences.get(key) || 0) + 1;
        occurrences.set(key, occurrence);
        const possibleDuplicate = occurrence <= (existing.get(key) || 0);
        if (possibleDuplicate && !options.includeDuplicates) { ignored++; return; }
        items.push({ id: uidGen(), tipo, desc: descricao, descricao, valor: abs, data, cat: autoCategoryCsv(descricao, tipo), categoria: autoCategoryCsv(descricao, tipo), origem: 'csv', possibleDuplicate });
      });
      return { items, ignored, headers: parsed.headers };
    }

    function openCsvPreview(importData) {
      const { items, ignored } = importData;
      if (!items.length) {
        alert('Nenhuma movimentação nova foi encontrada no CSV.');
        return;
      }
      const totalReceitas = items.filter(x => x.tipo === 'receita').reduce((s,x) => s + x.valor, 0);
      const totalDespesas = items.filter(x => x.tipo === 'despesa').reduce((s,x) => s + x.valor, 0);
      const preview = items.slice(0, 30).map(x => `
        <tr>
          <td>${x.data.split('-').reverse().join('/')}</td>
          <td>${escapeHtml(x.descricao)}</td>
          <td>${escapeHtml(x.categoria)}</td>
          <td style="text-align:right; color:${x.tipo === 'receita' ? 'var(--emerald)' : 'var(--danger)'}; font-weight:700;">${x.tipo === 'receita' ? '+' : '-'} ${fmtBRL(x.valor)}</td>
        </tr>`).join('');
      const html = `
        <p style="margin-top:0;">Encontrei <strong>${items.length}</strong> movimentações novas. ${ignored ? `<span style="color:var(--text-muted);">${ignored} linha(s) ignorada(s) por serem inválidas ou já existirem.</span>` : ''}</p>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:1rem;">
          <span class="shell-badge">Entradas: ${fmtBRL(totalReceitas)}</span>
          <span class="shell-badge">Gastos: ${fmtBRL(totalDespesas)}</span>
        </div>
        <div class="table-container" style="max-height:360px; overflow:auto;">
          <table class="custom-table">
            <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th style="text-align:right;">Valor</th></tr></thead>
            <tbody>${preview}</tbody>
          </table>
        </div>
        ${items.length > 30 ? `<p style="font-size:.8rem;color:var(--text-muted);">Mostrando as primeiras 30 de ${items.length}. Todas serão importadas.</p>` : ''}`;
      openModal('📄 Revisar importação CSV', html, [
        { label: 'Cancelar', onClick: closeModal },
        { label: `Importar ${items.length} movimentações`, primary: true, onClick: () => {
          AppState.data.movimentos.push(...items);
          triggerAutoSave();
          renderAll();
          closeModal();
          showToast(`${items.length} movimentações importadas!`);
        }}
      ]);
    }

    function importCsvFile(file) {
      const reader = new FileReader();
      reader.onload = () => {
        try { openCsvPreview(prepareCsvImport(reader.result, { includeDuplicates: true })); }
        catch (err) { alert('Não foi possível importar o CSV: ' + err.message); }
      };
      reader.onerror = () => alert('Não foi possível ler o arquivo CSV.');
      reader.readAsText(file, 'UTF-8');
    }
