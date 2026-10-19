    /* ===== WIRE BRAND ICONS & MANIFEST ===== */
    function applyBrandIcons(src) {
      const loginEl = document.getElementById('logoLogin');
      const headerEl = document.getElementById('headerLogo');
      const drawerEl = document.getElementById('drawerLogo');

      if (src) {
        // a) Login 96px (quadrado, aspect-ratio 1/1, object-fit contain)
        if (loginEl) {
          loginEl.innerHTML = `<img src="${src}" alt="Royal Wallet" width="96" height="96" style="width:96px; height:96px; aspect-ratio:1/1; object-fit:contain; border-radius:18px; display:block;">`;
        }
        // b) Header 32px
        if (headerEl) {
          headerEl.innerHTML = `<img src="${src}" alt="Royal Wallet" width="32" height="32" style="width:32px; height:32px; aspect-ratio:1/1; object-fit:contain; border-radius:6px; display:block;">`;
        }
        // Drawer logo 32px
        if (drawerEl) {
          drawerEl.innerHTML = `<img src="${src}" alt="Royal Wallet" width="32" height="32" style="width:32px; height:32px; aspect-ratio:1/1; object-fit:contain; border-radius:6px; display:block;">`;
        }

        // c) Favicon (link rel=icon com data URI resolvido)
        let linkFavicon = document.querySelector("link[rel~='icon']");
        if (!linkFavicon) {
          linkFavicon = document.createElement('link');
          linkFavicon.rel = 'icon';
          document.head.appendChild(linkFavicon);
        }
        linkFavicon.type = 'image/png';
        linkFavicon.href = src;

        // d) Apple-touch-icon
        let appleIcon = document.querySelector("link[rel='apple-touch-icon']");
        if (!appleIcon) {
          appleIcon = document.createElement('link');
          appleIcon.rel = 'apple-touch-icon';
          document.head.appendChild(appleIcon);
        }
        appleIcon.href = src;

        // e) Manifest icons 192 e 512 via Blob do data URI (type image/png, purpose "any maskable")
        try {
          const manifestObj = {
            name: "Royal Wallet",
            short_name: "Royal",
            description: "Controle financeiro pessoal e familiar",
            id: new URL('./index.html', location.href).href,
            start_url: new URL('./index.html', location.href).href,
            scope: new URL('./', location.href).href,
            display: "standalone",
            theme_color: "#8b1e1e",
            background_color: "#14100f",
            icons: [
              { src: src, sizes: "192x192", type: "image/png", purpose: "any maskable" },
              { src: src, sizes: "512x512", type: "image/png", purpose: "any maskable" }
            ]
          };
          const blob = new Blob([JSON.stringify(manifestObj)], { type: 'application/json' });
          const manifestURL = URL.createObjectURL(blob);
          let linkManifest = document.querySelector("link[rel='manifest']");
          if (!linkManifest) {
            linkManifest = document.createElement('link');
            linkManifest.rel = 'manifest';
            document.head.appendChild(linkManifest);
          }
          linkManifest.href = manifestURL;
        } catch (e) {
          console.warn("Manifest icon generation:", e);
        }
      } else {
        // Placeholder neutro (quadrado do tema com 👑) — SEM QUALQUER DESENHO VETORIAL
        const placeholderSquare = (size, radius, font) => `
          <div style="width:${size}px; height:${size}px; aspect-ratio:1/1; border-radius:${radius}px; background:rgba(139,30,30,0.35); border:1px solid var(--gold); display:flex; align-items:center; justify-content:center; font-size:${font}px; user-select:none;">👑</div>
        `;

        if (loginEl) loginEl.innerHTML = placeholderSquare(96, 18, 44);
        if (headerEl) headerEl.innerHTML = placeholderSquare(32, 6, 18);
        if (drawerEl) drawerEl.innerHTML = placeholderSquare(32, 6, 18);
      }

      // Atualiza diagnóstico na aba de Backup
      const diagEl = document.getElementById('diagIconStatus');
      if (diagEl) {
        diagEl.textContent = activeIconDiagnostic;
      }
    }

    async function setupBrandAssets() {
      const iconSrc = await getIconSrc();
      applyBrandIcons(iconSrc);
    }
