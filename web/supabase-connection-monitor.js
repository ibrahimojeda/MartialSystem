// ─── Supabase Connection Monitor ────────────────────────────────────
// Panel de diagnóstico para la APK: semáforo de conexión + logs
// Solo se activa en Capacitor/Android (no en web/Express)

(function () {
  'use strict';

  const SUPABASE_URL = 'https://obwtpmzgwepqyawfvkjn.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9id3RwbXpnd2VwcXlhd2Z2a2puIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNzA3OTcsImV4cCI6MjA5Mzk0Njc5N30.lFHz0duREEzjnGVgbmC3xar30OzUCTg7OZrqALXjGpw';

  let isNative = false;
  let connectionStatus = 'checking'; // 'checking' | 'connected' | 'error'
  let logs = [];
  let panelVisible = true;
  let logExpanded = true;

  // ─── Detect if running in Capacitor (APK) ──────────────────────────
  function detectNative() {
    try {
      if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        isNative = true;
        return true;
      }
    } catch (_) { /* not Capacitor */ }
    return false;
  }

  // ─── Create semáforo + log panel ───────────────────────────────────
  function createPanel() {
    // Remove existing if any
    const existing = document.getElementById('ms-conn-monitor');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'ms-conn-monitor';
    container.style.cssText = `
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 30000;
      font-family: "Manrope", "Segoe UI", sans-serif;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      pointer-events: none;
    `;

    // ─── Semáforo (siempre visible) ──────────────────────────────────
    const semaforo = document.createElement('div');
    semaforo.id = 'ms-semaforo';
    semaforo.style.cssText = `
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #d18a2e;
      border: 3px solid #a0681e;
      box-shadow: 0 0 16px rgba(209, 138, 46, 0.5);
      cursor: pointer;
      pointer-events: auto;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      transition: background 0.3s, border-color 0.3s, box-shadow 0.3s;
      position: relative;
    `;
    semaforo.title = 'Estado de conexión Supabase';
    semaforo.innerHTML = '📡';
    semaforo.addEventListener('click', togglePanel);

    // ─── Log panel (colapsable) ──────────────────────────────────────
    const logPanel = document.createElement('div');
    logPanel.id = 'ms-log-panel';
    logPanel.style.cssText = `
      background: rgba(10, 14, 20, 0.97);
      border: 1px solid #2b3645;
      border-radius: 12px;
      width: min(420px, 92vw);
      max-height: 320px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      pointer-events: auto;
    `;

    logPanel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #2b3645;background:#111a27;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span id="ms-status-dot" style="width:10px;height:10px;border-radius:50%;background:#d18a2e;display:inline-block;"></span>
          <span id="ms-status-text" style="font-size:13px;font-weight:700;color:#eaf0f7;">Conectando...</span>
        </div>
        <div style="display:flex;gap:6px;">
          <button id="ms-log-toggle" style="background:none;border:1px solid #3a4960;color:#aab7c8;border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;">${logExpanded ? '▼' : '▲'}</button>
          <button id="ms-log-clear" style="background:none;border:1px solid #3a4960;color:#aab7c8;border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;">Limpiar</button>
        </div>
      </div>
      <div id="ms-log-body" style="flex:1;overflow-y:auto;padding:8px 12px;font-size:11px;font-family:Consolas,monospace;color:#bcc8d8;line-height:1.5;max-height:260px;">
        <div style="color:#aab7c8;">[Monitor] Iniciando diagnóstico de conexión...</div>
      </div>
    `;

    container.appendChild(semaforo);
    container.appendChild(logPanel);
    document.body.appendChild(container);

    // Event listeners
    document.getElementById('ms-log-toggle').addEventListener('click', () => {
      logExpanded = !logExpanded;
      const body = document.getElementById('ms-log-body');
      const btn = document.getElementById('ms-log-toggle');
      if (body) body.style.display = logExpanded ? '' : 'none';
      if (btn) btn.textContent = logExpanded ? '▼' : '▲';
    });

    document.getElementById('ms-log-clear').addEventListener('click', () => {
      logs = [];
      const body = document.getElementById('ms-log-body');
      if (body) body.innerHTML = '<div style="color:#aab7c8;">[Monitor] Logs limpiados</div>';
    });
  }

  function togglePanel() {
    const logPanel = document.getElementById('ms-log-panel');
    if (logPanel) {
      panelVisible = !panelVisible;
      logPanel.style.display = panelVisible ? '' : 'none';
    }
  }

  // ─── Update semáforo status ────────────────────────────────────────
  function setStatus(status, message) {
    connectionStatus = status;
    const dot = document.getElementById('ms-status-dot');
    const text = document.getElementById('ms-status-text');
    const semaforo = document.getElementById('ms-semaforo');

    const colors = {
      checking: { bg: '#d18a2e', border: '#a0681e', shadow: 'rgba(209,138,46,0.5)', dot: '#d18a2e', emoji: '📡' },
      connected: { bg: '#2e8b57', border: '#1e6b3f', shadow: 'rgba(46,139,87,0.5)', dot: '#2e8b57', emoji: '🟢' },
      error: { bg: '#c94a4a', border: '#a03030', shadow: 'rgba(201,74,74,0.5)', dot: '#c94a4a', emoji: '🔴' }
    };

    const c = colors[status] || colors.checking;

    if (dot) dot.style.background = c.dot;
    if (text) {
      text.textContent = message || (status === 'connected' ? 'Conectado' : status === 'error' ? 'Error' : 'Conectando...');
      text.style.color = c.dot;
    }
    if (semaforo) {
      semaforo.style.background = c.bg;
      semaforo.style.borderColor = c.border;
      semaforo.style.boxShadow = `0 0 16px ${c.shadow}`;
      semaforo.innerHTML = c.emoji;
    }
  }

  // ─── Add log entry ─────────────────────────────────────────────────
  function addLog(type, message, detail) {
    const now = new Date();
    const time = now.toLocaleTimeString('es-PA', { hour12: false });
    logs.push({ time, type, message, detail });

    const body = document.getElementById('ms-log-body');
    if (!body) return;

    const colors = {
      request: '#7ec6ff',
      response: '#84f0be',
      error: '#ff8a8a',
      info: '#aab7c8',
      success: '#84f0be'
    };

    const color = colors[type] || '#aab7c8';
    const entry = document.createElement('div');
    entry.style.cssText = `margin-bottom:3px;word-break:break-all;`;
    entry.innerHTML = `<span style="color:#60748f;">${time}</span> <span style="color:${color};font-weight:700;">[${type.toUpperCase()}]</span> ${message}`;
    if (detail) {
      entry.innerHTML += ` <span style="color:#60748f;font-size:10px;">${detail}</span>`;
    }
    body.appendChild(entry);
    body.scrollTop = body.scrollHeight;

    // Keep max 200 log entries
    if (body.children.length > 200) {
      body.removeChild(body.firstChild);
    }
  }

  // ─── Test Supabase connection ──────────────────────────────────────
  async function testConnection() {
    addLog('info', 'Probando conexión a Supabase...');
    setStatus('checking', 'Verificando conexión...');

    try {
      // Test 1: Basic HTTP reachability
      addLog('request', `GET ${SUPABASE_URL}/rest/v1/`, '');
      const start = Date.now();
      const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });
      const elapsed = Date.now() - start;
      addLog('response', `HTTP ${res.status} ${res.statusText}`, `${elapsed}ms`);

      if (!res.ok) {
        addLog('error', `Supabase respondió con error HTTP ${res.status}`, res.statusText);
        setStatus('error', `HTTP ${res.status}`);
        return;
      }

      // Test 2: Database query (disciplines table - public read)
      addLog('request', `GET ${SUPABASE_URL}/rest/v1/disciplines?select=count`, '');
      const start2 = Date.now();
      const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/disciplines?select=count`, {
        method: 'GET',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
      });
      const elapsed2 = Date.now() - start2;

      if (dbRes.ok) {
        const data = await dbRes.json();
        const count = Array.isArray(data) ? data.length : (data?.count || '?');
        addLog('response', `HTTP ${dbRes.status} OK - ${count} disciplinas encontradas`, `${elapsed2}ms`);
        addLog('success', '✅ Conexión a Supabase establecida correctamente');
        setStatus('connected', 'Conectado a Supabase');
      } else {
        const errText = await dbRes.text().catch(() => '');
        addLog('error', `Error consultando disciplinas: HTTP ${dbRes.status}`, errText.substring(0, 100));
        addLog('error', '⚠️ La base de datos responde pero las consultas fallan. ¿Ejecutaste 013_login_fix.sql?');
        setStatus('error', 'DB Error');
      }
    } catch (err) {
      addLog('error', `Error de conexión: ${err.message}`);
      addLog('error', '⚠️ No se puede alcanzar Supabase. Verifica tu conexión a internet.');
      setStatus('error', 'Sin conexión');
    }
  }

  // ─── Intercept fetch calls to Supabase ─────────────────────────────
  function interceptFetch() {
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input?.url || '');

      // Only log Supabase calls
      if (url.includes('supabase.co')) {
        const method = (init?.method || 'GET').toUpperCase();
        const shortUrl = url.replace(SUPABASE_URL, '');
        addLog('request', `${method} ${shortUrl}`, '');

        const startTime = Date.now();
        return originalFetch(input, init).then((response) => {
          const elapsed = Date.now() - startTime;
          const clone = response.clone();
          // Try to read body for error details
          clone.text().then((body) => {
            let detail = `${elapsed}ms`;
            if (!response.ok && body) {
              try {
                const json = JSON.parse(body);
                detail = `HTTP ${response.status} - ${json.message || json.error || body.substring(0, 80)}`;
              } catch (_) {
                detail = `HTTP ${response.status} - ${body.substring(0, 80)}`;
              }
            }
            addLog(response.ok ? 'response' : 'error', `HTTP ${response.status} ${shortUrl}`, detail);
          }).catch(() => {
            addLog(response.ok ? 'response' : 'error', `HTTP ${response.status} ${shortUrl}`, `${elapsed}ms`);
          });
          return response;
        }).catch((err) => {
          addLog('error', `FETCH ERROR ${shortUrl}`, err.message);
          throw err;
        });
      }

      return originalFetch(input, init);
    };
  }

  // ─── Init ──────────────────────────────────────────────────────────
  function init() {
    if (!detectNative()) {
      console.log('[ConnectionMonitor] No es plataforma nativa, monitor desactivado');
      return;
    }

    console.log('[ConnectionMonitor] APK detectada, iniciando monitor de conexión');
    addLog('info', 'APK detectada - Monitor de conexión activado');

    // Wait for DOM
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        createPanel();
        interceptFetch();
        // Delay test to let Supabase SDK initialize
        setTimeout(testConnection, 1500);
      });
    } else {
      createPanel();
      interceptFetch();
      setTimeout(testConnection, 1500);
    }
  }

  // ─── Expose API ─────────────────────────────────────────────────────
  window.MartialConnectionMonitor = {
    addLog,
    setStatus,
    testConnection,
    togglePanel,
    getStatus: () => connectionStatus,
    getLogs: () => logs
  };

  // ─── Start ─────────────────────────────────────────────────────────
  init();
})();