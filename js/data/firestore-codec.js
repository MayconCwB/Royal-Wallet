
    /* ===== CONVERSORES REST FIRESTORE ESTRUTURADOS (JS <-> FIRESTORE) ===== */
    function toFsValue(v) {
      try {
        if (v === null || v === undefined) {
          return { nullValue: null };
        }
        if (typeof v === 'boolean') {
          return { booleanValue: v };
        }
        if (typeof v === 'number') {
          if (Number.isInteger(v)) {
            return { integerValue: String(v) };
          }
          return { doubleValue: v };
        }
        if (typeof v === 'string') {
          return { stringValue: v };
        }
        if (Array.isArray(v)) {
          return { arrayValue: { values: v.map(toFsValue) } };
        }
        if (typeof v === 'object') {
          const fields = {};
          for (const k of Object.keys(v)) {
            fields[k] = toFsValue(v[k]);
          }
          return { mapValue: { fields } };
        }
        return { stringValue: String(v) };
      } catch (err) {
        console.error("Erro em toFsValue:", err);
        return { nullValue: null };
      }
    }

    const FS_WRAPPER_KEYS = [
      'stringValue',
      'integerValue',
      'doubleValue',
      'booleanValue',
      'nullValue',
      'arrayValue',
      'mapValue',
      'timestampValue'
    ];

    function fromFsValue(f) {
      try {
        if (f === null || f === undefined) return f;
        if (typeof f !== 'object') return f;
        if (Array.isArray(f)) {
          return f.map(fromFsValue);
        }

        const keys = Object.keys(f);
        const wrapperKey = FS_WRAPPER_KEYS.find(k => k in f);

        // Se tem exatamente uma das chaves do Firestore ou se uma das chaves do wrapper está presente
        if (wrapperKey) {
          if ('stringValue' in f) return String(f.stringValue);
          if ('integerValue' in f) {
            const n = Number(f.integerValue);
            return isNaN(n) ? 0 : n;
          }
          if ('doubleValue' in f) {
            const n = Number(f.doubleValue);
            return isNaN(n) ? 0 : n;
          }
          if ('booleanValue' in f) return Boolean(f.booleanValue);
          if ('nullValue' in f) return null;
          if ('timestampValue' in f) return String(f.timestampValue);
          if ('arrayValue' in f) {
            const vals = f.arrayValue?.values || [];
            return vals.map(fromFsValue);
          }
          if ('mapValue' in f) {
            const res = {};
            const fields = f.mapValue?.fields || {};
            for (const k of Object.keys(fields)) {
              res[k] = fromFsValue(fields[k]);
            }
            return res;
          }
        }

        // Se NÃO é wrapper do Firestore (não tem nenhuma dessas chaves): tratar como map/objeto comum e converter recursivamente cada propriedade
        const res = {};
        for (const k of keys) {
          res[k] = fromFsValue(f[k]);
        }
        return res;
      } catch (err) {
        logEvent("Erro em fromFsValue: " + (err?.message || String(err)));
        return null;
      }
    }
