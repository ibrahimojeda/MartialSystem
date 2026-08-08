// ─── Mobile Connector v2: Direct Supabase + Auto-Update ──────────────
// La APK se conecta directamente a Supabase sin depender de localhost.
// Incluye verificación automática de actualizaciones al abrir la app.
// Si hay una nueva versión, muestra un banner para que el usuario actualice.

(function () {
  'use strict';

  const STORAGE_KEY = 'ms_server_url';
  const VERSION_URL = 'https://raw.githubusercontent.com/ibrahimojeda/MartialSystem/main/web/version.json';
  const APK_DOWNLOAD_URL = 'https://github.com/ibrahimojeda/MartialSystem/releases/download/Martial_System/app-debug.apk';
  const CURRENT_VERSION = '1.0.0';
  const VERSION_CHECK_KEY = 'ms_last_version_check';
  const UPDATE_DISMISSED_KEY = 'ms_update_dismissed';

  let serverUrl = '';

  // ─── Load saved server URL (opcional, para modo híbrido) ────────────
  async function loadServerUrl() {
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
        const { Preferences } = window.Capacitor.Plugins;
        const result = await Preferences.get({ key: STORAGE_KEY });
        if (result && result.value) {
          serverUrl = result.value.replace(/\/+$/, '');
          return serverUrl;
        }
      }
    } catch (_) { /* Capacitor not available */ }

    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        serverUrl = saved.replace(/\/+$/, '');
        return serverUrl;
      }
    } catch (_) { /* localStorage not available */ }

    // Por defecto: sin servidor intermedio (usa Supabase directo)
    serverUrl = '';
    return serverUrl;
  }

  async function saveServerUrl(url) {
    const clean = (url || '').replace(/\/+$/, '');
    serverUrl = clean;

    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
        const { Preferences } = window.Capacitor.Plugins;
        await Preferences.set({ key: STORAGE_KEY, value: clean });
      }
    } catch (_) { /* Capacitor not available */ }

    try {
      localStorage.setItem(STORAGE_KEY, clean);
    } catch (_) { /* localStorage not available */ }
  }

  // ─── Fetch interceptor (solo si hay servidor configurado) ───────────
  const originalFetch = window.fetch;
  window.fetch = function (input, init) {
    let url = typeof input === 'string' ? input : input.url;

    if (serverUrl && (url.startsWith('/api/') || url.startsWith('/uploads/'))) {
      url = serverUrl + url;
    }

    if (typeof input === 'string') {
      return originalFetch(url, init);
    }
    return originalFetch(new Request(url, input), init);
  };

  // ─── Version Check & Auto-Update ────────────────────────────────────
  async function checkForUpdates(silent = true) {
    try {
      const lastCheck = localStorage.getItem(VERSION_CHECK_KEY);
      const now = Date.now();
      // Solo verificar cada 30 minutos máximo
      if (lastCheck && (now - Number(lastCheck)) < 1800000) {
        if (!silent) {
          console.log('[UpdateChecker] Última verificación reciente, saltando...');
        }
        return null;
      }

      localStorage.setItem(VERSION_CHECK_KEY, String(now));

      const res = await fetch(VERSION_URL + '?t=' + now, { cache: 'no-store' });
      if (!res.ok) {
        console.warn('[UpdateChecker] No se pudo obtener version.json:', res.status);
        return null;
      }

      const manifest = await res.json();
      const latestVersion = manifest.version;
      const updateMessage = manifest.message || 'Nueva versión disponible';
      const forceUpdate = manifest.forceUpdate || false;
      const apkUrl = manifest.apkUrl || APK_DOWNLOAD_URL;

      console.log('[UpdateChecker] Versión actual:', CURRENT_VERSION, '| Última:', latestVersion);

      if (isNewerVersion(latestVersion, CURRENT_VERSION)) {
        // Verificar si el usuario ya descartó esta versión
        const dismissed = localStorage.getItem(UPDATE_DISMISSED_KEY);
        if (dismissed === latestVersion && !forceUpdate) {
          console.log('[UpdateChecker] Usuario ya descartó la versión', latestVersion);
          return null;
        }

        return {
          currentVersion: CURRENT_VERSION,
          latestVersion,
          updateMessage,
          forceUpdate,
          apkUrl
        };
      }

      return null;
    } catch (err) {
      console.warn('[UpdateChecker] Error verificando actualizaciones:', err.message);
      return null;
    }
  }

  function isNewerVersion(latest, current) {
    const latestParts = String(latest).split('.').map(Number);
    const currentParts = String(current).split('.').map(Number);
    const maxLen = Math.max(latestParts.length, currentParts.length);

    for (let i = 0; i < maxLen; i++) {
      const l = latestParts[i] || 0;
      const c = currentParts[i] || 0;
      if (l > c) return true;
      if (l < c) return false;
    }
    return false;
  }

  // ─── Show Update Banner ─────────────────────────────────────────────
  function showUpdateBanner(updateInfo) {
    // Remove existing banner
    const existing = document.getElementById('ms-update-banner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'ms-update-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 20000;
      background: linear-gradient(135deg, #1a3a2a 0%, #0d2818 100%);
      border-bottom: 2px solid #2e8b57;
      color: #c8f3d7;
      padding: 14px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-family: "Manrope", "Segoe UI", sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      animation: msSlideDown 0.35s ease;
    `;

    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex:1;">
        <span style="font-size:24px;">🔄</span>
        <div>
          <div style="font-weight:800;font-size:15px;">¡Actualización disponible!</div>
          <div style="font-size:12px;opacity:0.85;margin-top:2px;">
            ${updateInfo.updateMessage} (v${updateInfo.latestVersion})
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        ${updateInfo.forceUpdate ? '' : '<button id="ms-update-dismiss" style="border:1px solid #3a6b52;border-radius:8px;background:transparent;color:#a0d8b8;padding:8px 14px;cursor:pointer;font-weight:600;font-size:12px;white-space:nowrap;">Ahora no</button>'}
        <button id="ms-update-download" style="border:0;border-radius:8px;background:linear-gradient(180deg,#2e8b57,#1e6b3f);color:#fff;padding:8px 16px;cursor:pointer;font-weight:700;font-size:12px;white-space:nowrap;box-shadow:0 4px 12px rgba(46,139,87,0.3);">
          📥 Descargar APK
        </button>
      </div>
    `;

    // Add slide-down animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes msSlideDown {
        from { transform: translateY(-100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    banner.appendChild(style);

    document.body.prepend(banner);

    // Adjust body padding
    document.body.style.paddingTop = (banner.offsetHeight + 8) + 'px';

    // Event listeners
    document.getElementById('ms-update-download').addEventListener('click', () => {
      window.open(updateInfo.apkUrl, '_blank');
    });

    const dismissBtn = document.getElementById('ms-update-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', () => {
        localStorage.setItem(UPDATE_DISMISSED_KEY, updateInfo.latestVersion);
        banner.style.animation = 'msSlideUp 0.3s ease forwards';
        setTimeout(() => {
          banner.remove();
          document.body.style.paddingTop = '';
        }, 300);
      });
    }

    // Add slide-up animation
    const styleUp = document.createElement('style');
    styleUp.textContent = `
      @keyframes msSlideUp {
        from { transform: translateY(0); opacity: 1; }
        to { transform: translateY(-100%); opacity: 0; }
      }
    `;
    banner.appendChild(styleUp);
  }

  // ─── Show server config UI (modo híbrido opcional) ──────────────────
  function showServerConfig(callback) {
    const existing = document.getElementById('ms-server-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ms-server-modal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:10000;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;';

    const card = document.createElement('div');
    card.style.cssText = 'background:#171d24;border:1px solid #2b3645;border-radius:14px;padding:24px;max-width:440px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.5);color:#eaf0f7;font-family:"Manrope","Segoe UI",sans-serif;';

    card.innerHTML = `
      <div style="font-size:40px;margin-bottom:12px;">🔗</div>
      <h3 style="margin:0 0 8px;color:#eaf0f7;font-family:Rajdhani,sans-serif;font-size:1.3rem;">Configurar Servidor</h3>
      <p style="margin:0 0 16px;font-size:13px;color:#aab7c8;">
        La app se conecta directamente a Supabase.<br>
        Solo configura un servidor si usas modo híbrido.
      </p>
      <div style="text-align:left;font-size:11px;color:#aab7c8;margin-bottom:12px;line-height:1.6;">
        <div>📱 <b>Misma red WiFi:</b> http://192.168.X.X:8010</div>
        <div>🤖 <b>Emulador Android:</b> http://10.0.2.2:8010</div>
        <div>🌐 <b>Dominio HTTPS:</b> https://tuapp.com</div>
      </div>
      <input id="ms-server-input" type="text" placeholder="http://192.168.1.100:8010" value="${serverUrl || ''}" style="width:100%;padding:10px;border-radius:8px;border:1px solid #3a4960;background:#111a27;color:#eaf0f7;font-size:14px;margin-bottom:12px;box-sizing:border-box;">
      <div style="display:flex;gap:8px;">
        <button id="ms-server-save" style="flex:1;border:0;border-radius:10px;background:linear-gradient(180deg,#c64834,#a73727);color:#fff;padding:10px 14px;cursor:pointer;font-weight:700;font-size:13px;">Conectar</button>
        <button id="ms-server-skip" style="flex:1;border:1px solid #3a4960;border-radius:10px;background:transparent;color:#aab7c8;padding:10px 14px;cursor:pointer;font-weight:600;font-size:13px;">Usar Supabase Directo</button>
      </div>
      <p id="ms-server-msg" style="margin-top:10px;font-size:12px;color:#2e8b57;display:none;"></p>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const input = document.getElementById('ms-server-input');
    const saveBtn = document.getElementById('ms-server-save');
    const skipBtn = document.getElementById('ms-server-skip');
    const msg = document.getElementById('ms-server-msg');

    saveBtn.addEventListener('click', async () => {
      const url = input.value.trim();
      if (!url) {
        msg.textContent = 'Ingresa una URL válida';
        msg.style.color = '#c94a4a';
        msg.style.display = 'block';
        return;
      }
      saveBtn.textContent = 'Probando...';
      saveBtn.disabled = true;
      try {
        const testUrl = url.replace(/\/+$/, '') + '/api/health';
        const res = await originalFetch(testUrl);
        const data = await res.json();
        if (data && data.ok) {
          await saveServerUrl(url);
          msg.textContent = '✅ Conectado a ' + url;
          msg.style.color = '#2e8b57';
          msg.style.display = 'block';
          setTimeout(() => {
            overlay.remove();
            if (callback) callback(serverUrl);
          }, 800);
        } else {
          throw new Error('Respuesta inválida');
        }
      } catch (err) {
        msg.textContent = '❌ No se pudo conectar. Verifica la URL y que el servidor esté corriendo.';
        msg.style.color = '#c94a4a';
        msg.style.display = 'block';
        saveBtn.textContent = 'Conectar';
        saveBtn.disabled = false;
      }
    });

    skipBtn.addEventListener('click', async () => {
      await saveServerUrl('');
      overlay.remove();
      if (callback) callback('');
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveBtn.click();
    });

    input.focus();
  }

  // ─── Expose API ─────────────────────────────────────────────────────
  window.MartialMobile = {
    getServerUrl: () => serverUrl,
    setServerUrl: saveServerUrl,
    showConfig: showServerConfig,
    load: loadServerUrl,
    checkForUpdates,
    showUpdateBanner,
    getCurrentVersion: () => CURRENT_VERSION
  };

  // ─── Auto-load on script execution ─────────────────────────────────
  loadServerUrl().then((url) => {
    console.log('[MobileConnector] Modo:', url ? 'Híbrido (' + url + ')' : 'Supabase Directo');

    // Verificar actualizaciones al iniciar
    setTimeout(async () => {
      const update = await checkForUpdates(true);
      if (update) {
        showUpdateBanner(update);
      }
    }, 2000);
  });
})();