    /* ===== NÚMEROS & STEPPERS (+ / −) AMIGÁVEIS COM DIGITAÇÃO MANUAL ===== */
    function parseNumericInput(raw) {
      if (typeof raw === 'number') return isNaN(raw) ? 0 : raw;
      if (!raw) return 0;
      let s = String(raw).trim().replace(/[R$\s]/g, '');
      if (s.includes(',') && s.includes('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else if (s.includes(',')) {
        s = s.replace(',', '.');
      }
      const val = parseFloat(s);
      return isNaN(val) ? 0 : val;
    }

    function formatNumberForInput(num, isInteger = false) {
      const n = Math.max(0, Number(num) || 0);
      if (isInteger) return String(Math.round(n));
      return n.toFixed(2).replace('.', ',');
    }

    function generateQuickValHtml({ id, label, value = '', steps = [1, 5, 10, 50, 100], defaultStep = 10, placeholder = "0,00", showClear = true }) {
      const formattedVal = value !== '' && value !== null && value !== undefined ? (typeof value === 'number' ? formatNumberForInput(value) : value) : '';
      const chipsHtml = steps.map(s => {
        const isActive = s === defaultStep ? ' active' : '';
        return `<button type="button" class="step-chip-btn${isActive}" data-step="${s}">R$ ${s}</button>`;
      }).join('');

      return `
        <div class="form-group quick-val-control" data-stepper-for="${id}" data-current-step="${defaultStep}">
          <label for="${id}">${escapeHtml(label)}</label>
          <div class="step-chips-bar" role="group" aria-label="Passos de ajuste">
            ${chipsHtml}
          </div>
          <div class="stepper-row">
            <button type="button" class="btn-stepper" data-action="dec" aria-label="Diminuir valor">−</button>
            <div class="stepper-input-wrap">
              <input type="text" inputmode="decimal" id="${id}" class="input-field" placeholder="${placeholder}" value="${escapeHtml(formattedVal)}">
              ${showClear ? `<button type="button" class="btn-stepper-clear" data-action="clear" title="Zerar campo" aria-label="Zerar valor">⌫</button>` : ''}
            </div>
            <button type="button" class="btn-stepper" data-action="inc" aria-label="Aumentar valor">+</button>
          </div>
        </div>
      `;
    }

    function generateIntStepperHtml({ id, label, value = 0, min = 0, max = 9999, step = 1, showClear = false }) {
      return `
        <div class="form-group quick-int-control" data-stepper-for="${id}" data-min="${min}" data-max="${max}" data-step="${step}">
          <label for="${id}">${escapeHtml(label)}</label>
          <div class="stepper-row compact-stepper-row">
            <button type="button" class="btn-stepper btn-stepper-sm" data-action="dec" aria-label="Diminuir">−</button>
            <div class="stepper-input-wrap">
              <input type="number" inputmode="numeric" min="${min}" max="${max}" id="${id}" class="input-field" style="text-align:center; padding-right: ${showClear ? '36px' : '10px'};" value="${value}">
              ${showClear ? `<button type="button" class="btn-stepper-clear" data-action="clear" title="Zerar campo" aria-label="Zerar valor">⌫</button>` : ''}
            </div>
            <button type="button" class="btn-stepper btn-stepper-sm" data-action="inc" aria-label="Aumentar">+</button>
          </div>
        </div>
      `;
    }

    function attachQuickValListeners(container = document) {
      // 1. Currency Steppers with chips
      container.querySelectorAll('.quick-val-control').forEach(ctrl => {
        const inputId = ctrl.dataset.stepperFor;
        const inputEl = ctrl.querySelector(`#${inputId}`);
        if (!inputEl) return;

        let currentStep = parseFloat(ctrl.dataset.currentStep) || 10;

        ctrl.querySelectorAll('.step-chip-btn').forEach(chip => {
          chip.addEventListener('click', (e) => {
            e.preventDefault();
            ctrl.querySelectorAll('.step-chip-btn').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            currentStep = parseFloat(chip.dataset.step) || 10;
            ctrl.dataset.currentStep = String(currentStep);
          });
        });

        const decBtn = ctrl.querySelector('[data-action="dec"]');
        const incBtn = ctrl.querySelector('[data-action="inc"]');
        const clearBtn = ctrl.querySelector('[data-action="clear"]');

        const adjustValue = (delta) => {
          let curr = parseNumericInput(inputEl.value);
          let updated = Math.max(0, curr + delta);
          // format with 2 decimals
          inputEl.value = formatNumberForInput(updated);
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        };

        if (decBtn) {
          decBtn.addEventListener('click', (e) => {
            e.preventDefault();
            adjustValue(-currentStep);
          });
        }
        if (incBtn) {
          incBtn.addEventListener('click', (e) => {
            e.preventDefault();
            adjustValue(currentStep);
          });
        }
        if (clearBtn) {
          clearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            inputEl.value = "0,00";
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
            inputEl.focus();
          });
        }
      });

      // 2. Integer Steppers (pagas & dias)
      container.querySelectorAll('.quick-int-control').forEach(ctrl => {
        const inputId = ctrl.dataset.stepperFor;
        const inputEl = ctrl.querySelector(`#${inputId}`);
        if (!inputEl) return;

        const getMin = () => parseInt(ctrl.dataset.min, 10) || 0;
        const getMax = () => {
          const m = ctrl.dataset.max;
          return (m !== undefined && m !== '') ? parseInt(m, 10) : 9999;
        };
        const step = parseInt(ctrl.dataset.step, 10) || 1;

        const decBtn = ctrl.querySelector('[data-action="dec"]');
        const incBtn = ctrl.querySelector('[data-action="inc"]');
        const clearBtn = ctrl.querySelector('[data-action="clear"]');

        const adjustInt = (delta) => {
          let curr = parseInt(inputEl.value, 10) || 0;
          let minVal = getMin();
          let maxVal = getMax();
          let updated = Math.min(maxVal, Math.max(minVal, curr + delta));
          inputEl.value = String(updated);
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        };

        if (decBtn) {
          decBtn.addEventListener('click', (e) => {
            e.preventDefault();
            adjustInt(-step);
          });
        }
        if (incBtn) {
          incBtn.addEventListener('click', (e) => {
            e.preventDefault();
            adjustInt(step);
          });
        }
        if (clearBtn) {
          clearBtn.addEventListener('click', (e) => {
            e.preventDefault();
            inputEl.value = String(getMin());
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            inputEl.dispatchEvent(new Event('change', { bubbles: true }));
          });
        }
      });
    }

    // Helper: Safe ID
    const uidGen = () => Date.now().toString(36) + Math.random().toString(36).substring(2, 7);

    // Event Logger
    function logEvent(msg) {
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      const entry = `[${timeStr}] ${msg}`;
      AppState.eventsLog.unshift(entry);
      if (AppState.eventsLog.length > 12) AppState.eventsLog.pop();

      const el = document.getElementById('eventLogBox');
      const counterEl = document.getElementById('logCounter');
      if (el) {
        el.innerHTML = AppState.eventsLog.map(e => `<div>${escapeHtml(e)}</div>`).join('');
      }
      if (counterEl) {
        counterEl.textContent = `${AppState.eventsLog.length} eventos`;
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function showToast(msg) {
      const t = document.getElementById('appToast');
      if (!t) return;
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2000);
    }
