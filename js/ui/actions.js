/* Eventos delegados: identificadores importados nunca viram código JavaScript. */
document.addEventListener('DOMContentLoaded', () => {
  const allowed = new Set(['handleDuplicateNextMonth', 'handleEditMovimento', 'handleDeleteMovimento',
    'handleToggleRecorrentePago', 'handleDeleteRecorrente', 'handleEditRecorrente',
    'handleDeleteParcela', 'handleEditParcela', 'handleAdjustParcelasPagas',
    'handleDeleteDivida', 'handleEditDivida', 'handleAmortizarDivida', 'handleQuitarDivida',
    'handleDeleteMeta', 'handleAddValorMeta', 'handleDevolverParaAtivos']);
  document.getElementById('appMain').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled || !allowed.has(button.dataset.action)) return;
    const handler = window[button.dataset.action]; if (typeof handler !== 'function') return;
    try {
      const result = button.dataset.action === 'handleAdjustParcelasPagas' ? handler(button.dataset.id, Number(button.dataset.delta) === -1 ? -1 : 1) : handler(button.dataset.id);
      Promise.resolve(result).catch(error => alert(error.message));
    } catch (error) { alert(error.message); }
  });
});
