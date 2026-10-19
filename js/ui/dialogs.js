    /* ===== ? EXPLANATION DIALOGS ===== */
    const HELP_DICTIONARY = {
      "Saldo Real": "O dinheiro que você tem de verdade hoje, somando tudo que entrou e saiu.",
      "Entradas do Mês": "Tudo que você recebeu neste mês.",
      "Gastos do Mês": "Tudo que você pagou neste mês.",
      "Compromissos do Mês": "Tudo que você já se comprometeu a pagar neste mês: contas fixas não pagas, parcelas e dívidas.",
      "Quanto Preciso Ter": "O mínimo que precisa ter hoje para pagar tudo até o fim do mês.",
      "Saldo Previsto Final": "Estimativa de quanto vai sobrar no fim do mês, se pagar tudo e receber as entradas.",
      "Recorrentes": "Conta fixa: o que repete todo mês no mesmo dia, como aluguel e escola. Marque 'Paguei neste mês' quando pagar, e ela sai da soma do mês.",
      "Parcelas": "Compra dividida em partes iguais. Informe o valor de cada parte, quantas são no total e quantas já pagou.",
      "Dívidas": "Dinheiro que você deve a alguém. Pode pagar em partes até quitar. Se vencer sem quitar, o app avisa no próximo mês.",
      "Metas": "Objetivo de juntar dinheiro, como uma viagem ou uma compra. Adicione valores aos poucos até chegar em 100%.",
      "Planejamento": "Mostra os dias do mês seguinte em que você vai pagar algo e o total de cada dia, para não ser pego de surpresa."
    };

    function showExplanationModal(term) {
      const text = HELP_DICTIONARY[term] || "Sem explicação disponível para este item.";
      openModal(`ℹ️ ${term}`, `<p style="font-size:1.05rem; line-height:1.6;">${text}</p>`, [
        { label: "Entendido", primary: true, onClick: closeModal }
      ]);
    }

    /* ===== MODAL CONTROLLER ===== */
    function openModal(title, bodyHtml, buttons = []) {
      const backdrop = document.getElementById('genericModalBackdrop');
      document.getElementById('genericModalTitle').textContent = title;
      document.getElementById('genericModalBody').innerHTML = bodyHtml;

      const footer = document.getElementById('genericModalFooter');
      footer.innerHTML = '';
      buttons.forEach(btn => {
        const b = document.createElement('button');
        b.className = btn.primary ? "btn btn-primary" : "btn btn-outline";
        if (btn.primary) {
          b.style.background = "#8b1e1e";
          b.style.borderColor = "#8b1e1e";
          b.style.color = "#ffffff";
        }
        b.textContent = btn.label;
        b.addEventListener('click', () => {
          if (btn.onClick) btn.onClick();
        });
        footer.appendChild(b);
      });

      backdrop.classList.add('active');
    }

    function closeModal() {
      if (cancelConflict) { cancelConflict(); return; }
      document.getElementById('genericModalBackdrop').classList.remove('active');
      document.getElementById('genericModalBody').textContent = '';
      document.getElementById('genericModalFooter').textContent = '';
    }

    /* ===== 4) CÁLCULOS DO PLANEJAMENTO E RESUMO (CAMPOS MAPEADOS) ===== */
