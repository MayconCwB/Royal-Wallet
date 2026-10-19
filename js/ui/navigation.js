    /* ===== NAVIGATION DRAWER LOGIC ===== */
    function switchTab(tabId) {
      AppState.currentTab = tabId;
      document.querySelectorAll('.app-tab').forEach(el => el.style.display = 'none');
      const target = document.getElementById(`tab-${tabId}`);
      if (target) target.style.display = 'block';

      // Update Nav active classes
      document.querySelectorAll('.nav-item-btn').forEach(btn => {
        if (btn.dataset.tab === tabId) btn.classList.add('active');
        else btn.classList.remove('active');
      });

      closeDrawer();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      renderAll();
    }

    function openDrawer() {
      document.getElementById('drawerOverlay').classList.add('open');
    }
    function closeDrawer() {
      document.getElementById('drawerOverlay').classList.remove('open');
    }
