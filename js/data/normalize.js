    /* ===== 1) FUNÇÃO GENÉRICA PICK & AUXILIARES ===== */
    function pick(obj, ...aliases) {
      if (!obj || typeof obj !== 'object') return undefined;
      const target = (obj.mapValue && obj.mapValue.fields) ? obj.mapValue.fields : obj;
      for (const key of aliases) {
        if (key in target && target[key] !== undefined && target[key] !== null) {
          const unwrapped = fromFsValue(target[key]);
          if (unwrapped !== undefined && unwrapped !== null) {
            return unwrapped;
          }
        }
      }
      return undefined;
    }

    function safeUnwrap(val) {
      if (val && typeof val === 'object') {
        return fromFsValue(val);
      }
      return val;
    }

    function safeNum(val) {
      const unwrapped = safeUnwrap(val);
      if (unwrapped === null || unwrapped === undefined || unwrapped === '') return 0;
      const n = Number(unwrapped);
      return isNaN(n) ? 0 : n;
    }

    function safeDateStr(val) {
      const unwrapped = safeUnwrap(val);
      if (!unwrapped) return "";
      if (typeof unwrapped === 'string') {
        if (unwrapped.includes('T')) return unwrapped.split('T')[0].trim();
        return unwrapped.trim();
      }
      if (typeof unwrapped === 'number') {
        try {
          const d = new Date(unwrapped);
          if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
        } catch (_) {}
      }
      if (typeof unwrapped === 'object') {
        if (unwrapped.seconds) {
          const d = new Date(unwrapped.seconds * 1000);
          return d.toISOString().split('T')[0];
        }
        const inner = unwrapped.data1 || unwrapped.dataPrimeira || unwrapped.data || unwrapped.venc || unwrapped.vencimento;
        if (inner) return safeDateStr(inner);
      }
      return String(unwrapped).trim();
    }

    /* ===== 3) CONVERSÃO DE DATAS & PRÓXIMA PARCELA ===== */
    function getNextParcelaDate(data1Str, pagas) {
      if (!data1Str || typeof data1Str !== 'string') return null;
      const clean = data1Str.includes('T') ? data1Str.split('T')[0] : data1Str.trim();
      const parts = clean.split('-');
      if (parts.length < 3) return null;
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10); // 1-12
      const d = parseInt(parts[2], 10);
      if (isNaN(y) || isNaN(m) || isNaN(d) || y < 1900) return null;

      const p = Math.max(0, parseInt(pagas, 10) || 0);
      const totalMonths = (m - 1) + p;
      const targetYear = y + Math.floor(totalMonths / 12);
      const targetMonth = ((totalMonths % 12) + 12) % 12; // 0-11

      // Último dia do mês alvo
      const maxDays = new Date(targetYear, targetMonth + 1, 0).getDate();
      const targetDay = Math.min(d, maxDays);

      const mmStr = String(targetMonth + 1).padStart(2, '0');
      const ddStr = String(targetDay).padStart(2, '0');
      return {
        year: targetYear,
        month: targetMonth, // 0-11
        day: targetDay,
        iso: `${targetYear}-${mmStr}-${ddStr}`,
        display: `${ddStr}/${mmStr}/${targetYear}`
      };
    }

    /* ===== 2 & 5) NORMALIZAÇÃO COMPATÍVEL & DIAGNÓSTICO DO BANCO REAL ===== */
    function normalizeDataStructure(rawObj, sourceLabel) {
      if (!rawObj || typeof rawObj !== 'object') {
        rawObj = {};
      }

      logEvent(`Nuvem lida: ${sourceLabel}`);

      // 1. Parcelas: {"id","desc","valor","total","pagas","data1","cat"}
      const rawParc = Array.isArray(rawObj.parcelas) ? rawObj.parcelas : [];
      let pValPos = 0;
      let pDate1Count = 0;
      const parcelas = rawParc.map(item => {
        if (!item || typeof item !== 'object') return null;
        const id = String(pick(item, 'id', 'ID') ?? uidGen());
        const desc = String(pick(item, 'desc', 'descricao', 'nome') ?? "Parcela");
        let valor = safeNum(pick(item, 'valor', 'valorParcela', 'valor_parcela'));
        const total = Math.max(1, parseInt(pick(item, 'total', 'nTotal', 'numParcelas', 'parcelas'), 10) || 1);
        const pagas = Math.max(0, parseInt(pick(item, 'pagas', 'parcelasPagas', 'pagasTotal'), 10) || 0);
        const data1 = safeDateStr(pick(item, 'data1', 'dataPrimeira', 'data1a', 'data', 'data_primeira', 'primeiraData', 'vencimento'));
        const cat = String(pick(item, 'cat', 'categoria') ?? "Geral");

        if (valor === 0) {
          const vt = safeNum(pick(item, 'valorTotal'));
          if (vt > 0 && total > 0) valor = vt / total;
        }

        if (valor > 0) pValPos++;
        if (data1 && data1.includes('-')) pDate1Count++;

        return {
          id,
          desc,
          descricao: desc,
          valor,
          valorParcela: valor,
          total,
          pagas,
          data1,
          dataPrimeira: data1,
          cat,
          categoria: cat
        };
      }).filter(Boolean);

      // 2. Dívidas: {"id","desc","total","pago","venc"}
      const rawDiv = Array.isArray(rawObj.dividas) ? rawObj.dividas : [];
      let dValPos = 0;
      let dDateCount = 0;
      const dividas = rawDiv.map(item => {
        if (!item || typeof item !== 'object') return null;
        const id = String(pick(item, 'id', 'ID') ?? uidGen());
        const desc = String(pick(item, 'desc', 'descricao', 'credor', 'nome') ?? "Dívida");
        const total = safeNum(pick(item, 'total', 'valor', 'valorTotal'));
        const pago = safeNum(pick(item, 'pago', 'valorPago'));
        const venc = safeDateStr(pick(item, 'venc', 'vencimento', 'dataVencimento', 'data', 'dia'));

        if (total > 0) dValPos++;
        if (venc && venc.includes('-')) dDateCount++;

        return {
          id,
          desc,
          credor: desc,
          descricao: desc,
          total,
          valorTotal: total,
          pago,
          valorPago: pago,
          venc,
          dataVencimento: venc
        };
      }).filter(Boolean);

      // 3. Recorrentes: {"id","tipo","desc","valor","dia","cat","ultimoMesPago"}
      const rawRec = Array.isArray(rawObj.recorrentes) ? rawObj.recorrentes : [];
      let rValPos = 0;
      let rDiaCount = 0;
      const curYYYYMM = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      const recorrentes = rawRec.map(item => {
        if (!item || typeof item !== 'object') return null;
        const id = String(pick(item, 'id', 'ID') ?? uidGen());
        const desc = String(pick(item, 'desc', 'descricao', 'nome') ?? "Conta Fixa");
        const valor = safeNum(pick(item, 'valor', 'valorMensal'));
        const diaRaw = safeNum(pick(item, 'dia', 'vencimento') ?? 1);
        const dia = Math.min(31, Math.max(1, parseInt(diaRaw, 10) || 1));
        const cat = String(pick(item, 'cat', 'categoria') ?? "Fixa");
        const tipo = String(pick(item, 'tipo') ?? "despesa");
        const ultimoMesPago = String(pick(item, 'ultimoMesPago', 'ultimo_mes_pago') ?? "").trim();
        const pagoNesteMes = ultimoMesPago ? (ultimoMesPago >= curYYYYMM) : Boolean(pick(item, 'pagoNesteMes', 'pago'));

        if (valor > 0) rValPos++;
        if (dia >= 1 && dia <= 31) rDiaCount++;

        return {
          id,
          desc,
          nome: desc,
          descricao: desc,
          valor,
          dia,
          cat,
          categoria: cat,
          tipo,
          ultimoMesPago,
          pagoNesteMes
        };
      }).filter(Boolean);

      // 4. Metas: {"id","desc","alvo","guardado"}
      const rawMetas = Array.isArray(rawObj.metas) ? rawObj.metas : [];
      let metasValPos = 0;
      const metas = rawMetas.map(item => {
        if (!item || typeof item !== 'object') return null;
        const id = String(pick(item, 'id', 'ID') ?? uidGen());
        const desc = String(pick(item, 'desc', 'descricao', 'titulo', 'nome') ?? "Meta");
        const alvo = safeNum(pick(item, 'alvo', 'meta', 'valorAlvo', 'total'));
        const guardado = safeNum(pick(item, 'guardado', 'poupado', 'valorAtual', 'atual'));

        if (alvo > 0) metasValPos++;

        return {
          id,
          desc,
          titulo: desc,
          descricao: desc,
          alvo,
          valorAlvo: alvo,
          guardado,
          valorAtual: guardado
        };
      }).filter(Boolean);

      // 5. Movimentos: {"id","tipo","desc","valor","data","cat"}
      const rawMov = Array.isArray(rawObj.movimentos) ? rawObj.movimentos : [];
      let mValPos = 0;
      let mDateCount = 0;
      const movimentos = rawMov.map(item => {
        if (!item || typeof item !== 'object') return null;
        const id = String(pick(item, 'id', 'ID') ?? uidGen());
        const desc = String(pick(item, 'desc', 'descricao', 'nome') ?? "Sem descrição");
        const valor = safeNum(pick(item, 'valor', 'valorTotal', 'quantia'));
        const data = safeDateStr(pick(item, 'data', 'dataISO', 'dataMovimento', 'criadoEm'));
        const cat = String(pick(item, 'cat', 'categoria') ?? "Geral");
        const tipo = String(pick(item, 'tipo') ?? "despesa");

        if (valor > 0) mValPos++;
        if (data && data.includes('-')) mDateCount++;

        return {
          id,
          desc,
          descricao: desc,
          valor,
          data,
          cat,
          categoria: cat,
          tipo
        };
      }).filter(Boolean);

      // 6. Histórico
      const rawHist = Array.isArray(rawObj.historico) ? rawObj.historico : [];
      const historico = rawHist.map(item => {
        if (!item || typeof item !== 'object') return null;
        const id = String(pick(item, 'id', 'ID') ?? uidGen());
        const tipo = String(pick(item, 'tipo') ?? "Outro");
        const desc = String(pick(item, 'desc', 'nome', 'descricao', 'titulo') ?? "");
        const valorTotal = safeNum(pick(item, 'valorTotal', 'total', 'valor'));
        const concluidoEm = pick(item, 'concluidoEm', 'pagoEm', 'data') ?? Date.now();
        const original = pick(item, 'original') || null;
        return {
          id,
          tipo,
          desc,
          nome: desc,
          descricao: desc,
          valorTotal,
          concluidoEm,
          original
        };
      }).filter(Boolean);

      // 5) DIAGNÓSTICO no Registro de Eventos
      logEvent(`Parcelas: ${parcelas.length} itens, ${pDate1Count} com data1, ${pValPos} com valor>0`);
      logEvent(`Dívidas: ${dividas.length} itens, ${dDateCount} com venc, ${dValPos} com valor>0`);
      logEvent(`Recorrentes: ${recorrentes.length} itens, ${rDiaCount} com dia, ${rValPos} com valor>0`);
      logEvent(`Movimentos: ${movimentos.length} itens, ${mDateCount} com data, ${mValPos} com valor>0`);
      logEvent(`Metas: ${metas.length} itens, ${metasValPos} com alvo>0`);

      // Se um item tiver data1 presente mas o app mostrar "A definir", registrar o item cru
      rawParc.forEach((rawItem, idx) => {
        const p = parcelas[idx];
        const rawD1 = pick(rawItem, 'data1', 'dataPrimeira', 'data1a', 'data');
        if (rawD1) {
          const nextCalc = getNextParcelaDate(p.data1, p.pagas);
          if (!nextCalc) {
            try {
              const rawStr = JSON.stringify(rawItem).slice(0, 300);
              logEvent(`ALERTA Parcela 'A definir' com data1: ${rawStr}`);
            } catch (_) {}
          }
        }
      });

      return {
        movimentos,
        recorrentes,
        parcelas,
        dividas,
        metas,
        historico,
        updatedAt: Number(pick(rawObj, 'updatedAt', 'atualizadoEm')) || Date.now(),
        v: "2",
        nome: String(pick(rawObj, 'nome') ?? AppState.user?.nome ?? "")
      };
    }
