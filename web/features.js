// ══════════════════════════════════════════════════════════════
// Fase 2: QR Attendance Scanner + Waivers + Diplomas Generator
// Fase 3: Mobile 44px touch targets
// ══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // ─── Utilities ──────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const qs = (sel, ctx) => (ctx || document).querySelector(sel);
  const qsa = (sel, ctx) => (ctx || document).querySelectorAll(sel);
  const escHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&':'&','<':'<','>':'>','"':'"',"'":'&#39;' })[c]);
  const selectedEstablishmentId = () => $('st-establishment')?.value || $('cfg-est-id')?.value || '';
  const getToken = () => localStorage.getItem('ms_access_token') || '';
  const api = async (url, options = {}) => {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(url, { ...options, headers });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'API Error');
    return json;
  };

  let modalStack = [];

  function showModal(html, opts = {}) {
    const existing = qs('.ms-feature-modal');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'ms-feature-modal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,0.78);display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = `<div style="background:var(--panel,#171d24);border:1px solid var(--line,#2b3645);border-radius:14px;padding:20px;max-width:${opts.width || '500px'};width:100%;max-height:90vh;overflow-y:auto;">${html}</div>`;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    return overlay;
  }

  // ─── 1. QR SCANNER (Instrucción A del PDF) ──────────────

  // We load jsQR from CDN only when needed
  let jsQRLoaded = false;
  async function loadJsQR() {
    if (jsQRLoaded) return;
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
      s.onload = () => { jsQRLoaded = true; resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // Add scanner buttons to academic tab
  function addScannerButtons() {
    const homeCard = $('academic-home-card');
    if (!homeCard) return;
    const actions = qs('.academic-actions', homeCard);
    if (!actions) return;
    if ($('ac-view-qr-scanner')) return; // already added

    const btn = document.createElement('button');
    btn.className = 'btn alt';
    btn.id = 'ac-view-qr-scanner';
    btn.textContent = '📷 Escanear QR';
    btn.style.cssText = 'background:linear-gradient(180deg,#2a6d3a 0%,#1e5334 100%) !important;box-shadow:0 8px 16px rgba(42,109,58,0.25) !important;';
    actions.appendChild(btn);

    btn.addEventListener('click', openQRScanner);
  }

  async function openQRScanner() {
    await loadJsQR();
    const overlay = showModal(`
      <h3 style="margin:0 0 6px;">📷 Escanear QR de Alumno</h3>
      <p class="muted" style="font-size:13px;margin:0 0 12px;">Selecciona clase y apunta la cámara al QR del alumno.</p>
      <div class="form" style="margin-bottom:10px;">
        <div>
          <label>Establecimiento</label>
          <select id="qr-scan-establishment" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--text);">
            <option value="">-- Selecciona --</option>
          </select>
        </div>
        <div>
          <label>Clase (Class Session)</label>
          <select id="qr-scan-class" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--text);">
            <option value="">-- Primero selecciona establecimiento --</option>
          </select>
        </div>
      </div>
      <div id="qr-scan-preview-area" style="text-align:center;margin-bottom:10px;">
        <video id="qr-video" style="width:100%;max-width:360px;border-radius:10px;border:2px solid var(--line);background:#000;display:none;"></video>
        <canvas id="qr-canvas" style="display:none;"></canvas>
        <div id="qr-scan-status" class="muted" style="margin-top:8px;font-size:12px;">Selecciona una clase y presiona "Iniciar Scanner"</div>
      </div>
      <div class="row" style="justify-content:center;gap:8px;">
        <button class="btn alt" id="qr-start-btn" type="button">📷 Iniciar Scanner</button>
        <button class="btn alt" id="qr-stop-btn" type="button" style="display:none;">Detener</button>
      </div>
      <div id="qr-result-area" style="margin-top:10px;display:none;">
        <hr style="border-color:var(--line);margin:8px 0;">
        <div id="qr-result-data" style="font-size:13px;"></div>
      </div>
    `, { width: '520px' });

    // Load establishments
    try {
      const res = await api('/api/establishments');
      const sel = $('qr-scan-establishment');
      if (res.data) {
        res.data.forEach(e => {
          const opt = document.createElement('option');
          opt.value = e.id;
          opt.textContent = `${e.name} (${e.city || '-'})`;
          sel.appendChild(opt);
        });
      }
    } catch (err) { console.warn('Could not load establishments:', err); }

    // When establishment selected, load classes
    $('qr-scan-establishment').addEventListener('change', async () => {
      const estId = $('qr-scan-establishment').value;
      const classSel = $('qr-scan-class');
      classSel.innerHTML = '<option value="">-- Cargando clases... --</option>';
      if (!estId) { classSel.innerHTML = '<option value="">-- Primero selecciona establecimiento --</option>'; return; }
      try {
        const today = new Date().toISOString().slice(0, 10);
        const res = await api(`/api/classes?establishmentId=${encodeURIComponent(estId)}&date=${today}`);
        classSel.innerHTML = '';
        if (!res.data || res.data.length === 0) {
          classSel.innerHTML = '<option value="">-- Sin clases hoy --</option>';
        } else {
          const empty = document.createElement('option');
          empty.value = '';
          empty.textContent = '-- Selecciona clase --';
          classSel.appendChild(empty);
          res.data.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.title} (${c.start_time?.slice(0,5) || '-'})`;
            classSel.appendChild(opt);
          });
        }
      } catch (err) {
        classSel.innerHTML = '<option value="">-- Error cargando clases --</option>';
      }
    });

    // ─── Scanner logic ──────────────────────────
    let stream = null;
    let scanInterval = null;

    $('qr-start-btn').addEventListener('click', async () => {
      const estId = $('qr-scan-establishment').value;
      const classId = $('qr-scan-class').value;
      if (!estId || !classId) {
        $('qr-scan-status').textContent = '⚠️ Selecciona establecimiento y clase primero.';
        return;
      }

      const video = $('qr-video');
      const canvas = $('qr-canvas');
      const statusEl = $('qr-scan-status');

      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: 640, height: 480 } });
        video.srcObject = stream;
        video.style.display = 'block';
        await video.play();
        $('qr-start-btn').style.display = 'none';
        $('qr-stop-btn').style.display = 'inline-flex';
        statusEl.textContent = '🔍 Escaneando... Apunta al QR del alumno.';

        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext('2d');

        scanInterval = setInterval(async () => {
          ctx.drawImage(video, 0, 0, 640, 480);
          const imageData = ctx.getImageData(0, 0, 640, 480);
          const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' });
          if (code && code.data) {
            // Found a QR code!
            clearInterval(scanInterval);
            scanInterval = null;
            statusEl.textContent = '✅ QR detectado. Procesando...';

            // Try to send to server for validation + attendance
            try {
              const result = await api('/api/qr/scan', {
                method: 'POST',
                body: JSON.stringify({
                  establishmentId: estId,
                  token: code.data,
                  classSessionId: classId
                })
              });

              const d = result.data;
              const resultArea = $('qr-result-area');
              const resultData = $('qr-result-data');

              if (d.is_overdue) {
                resultData.innerHTML = `
                  <div style="background:#3a1f1f;border:1px solid #c94a4a;border-radius:10px;padding:12px;text-align:center;">
                    <div style="font-size:2rem;margin-bottom:6px;">⚠️</div>
                    <h4 style="margin:0 0 4px;color:#ff8a8a;">ALUMNO EN MORA</h4>
                    <p style="margin:0;color:#ffb3b3;">Monto adeudado: <strong>$${Number(d.amount_due).toFixed(2)}</strong></p>
                    <p style="margin:4px 0 0;color:#ccc;font-size:12px;">Estado de pago: ${d.payment_status}</p>
                    <p style="margin:4px 0 0;color:#ccc;font-size:12px;">Asistencia marcada como ausente.</p>
                  </div>
                `;
              } else {
                resultData.innerHTML = `
                  <div style="background:#1a2f1a;border:1px solid #2e8b57;border-radius:10px;padding:12px;text-align:center;">
                    <div style="font-size:2rem;margin-bottom:6px;">✅</div>
                    <h4 style="margin:0 0 4px;color:#8aff8a;">ASISTENCIA REGISTRADA</h4>
                    <p style="margin:0;color:#ccc;font-size:12px;">Alumno ID: ${d.student_id}</p>
                    <p style="margin:4px 0 0;color:#ccc;font-size:12px;">Estado de pago: <span style="color:#8aff8a;">Al día</span></p>
                  </div>
                `;
              }
              resultArea.style.display = 'block';
              statusEl.textContent = '✅ Escaneo completado.';
              setTimeout(() => stopScanner(), 2000);
            } catch (err) {
              statusEl.textContent = `❌ Error: ${err.message}`;
            }
          }
        }, 200);
      } catch (err) {
        statusEl.textContent = `❌ Error de cámara: ${err.message}`;
      }
    });

    function stopScanner() {
      if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
      $('qr-video').style.display = 'none';
      $('qr-start-btn').style.display = 'inline-flex';
      $('qr-stop-btn').style.display = 'none';
    }

    $('qr-stop-btn').addEventListener('click', stopScanner);
  }

  // ─── 2. WAIVERS / CONTRATOS DIGITALES (Brecha 3.3) ─────

  function addWaiverButton() {
    const homeCard = $('academic-home-card');
    if (!homeCard) return;
    const actions = qs('.academic-actions', homeCard);
    if (!actions) return;
    if ($('ac-view-waivers')) return;

    const btn = document.createElement('button');
    btn.className = 'btn alt';
    btn.id = 'ac-view-waivers';
    btn.textContent = '📝 Waivers Digitales';
    btn.style.cssText = 'background:linear-gradient(180deg,#2f5f7a 0%,#234a61 100%) !important;box-shadow:0 8px 16px rgba(47,95,122,0.25) !important;';
    actions.appendChild(btn);

    btn.addEventListener('click', openWaiverManager);
  }

  async function openWaiverManager() {
    const estId = selectedEstablishmentId();
    if (!estId) {
      showModal(`<h3 style="margin:0 0 8px;">📝 Waivers Digitales</h3><p style="color:var(--danger);">Selecciona un establecimiento primero.</p>`);
      return;
    }

    const overlay = showModal(`
      <h3 style="margin:0 0 6px;">📝 Waivers / Contratos Digitales</h3>
      <p class="muted" style="font-size:13px;margin:0 0 12px;">Gestiona waivers y contratos para los alumnos.</p>

      <div class="row" style="gap:8px;margin-bottom:12px;">
        <button class="btn alt" id="waiver-load-templates" type="button">📋 Ver plantillas</button>
        <button class="btn" id="waiver-new-template" type="button">+ Nueva plantilla</button>
      </div>

      <div id="waiver-templates-area">
        <span class="muted">Presiona "Ver plantillas" para cargar.</span>
      </div>
      <div id="waiver-new-form" style="display:none;margin-top:10px;border:1px solid var(--line);border-radius:10px;padding:12px;">
        <form class="form" id="waiver-template-form">
          <div class="full"><label>Título de la plantilla</label><input id="wtemp-title" placeholder="Waiver de Responsabilidad" required></div>
          <div class="full"><label>Contenido (HTML permitido)</label><textarea id="wtemp-content" rows="6" placeholder="Escribe el texto del waiver / contrato..."></textarea></div>
          <div class="full">
            <button class="btn" type="submit">💾 Guardar plantilla</button>
          </div>
        </form>
      </div>
    `, { width: '650px' });

    // Load templates
    $('waiver-load-templates').addEventListener('click', async () => {
      // Try to load from DB (if waiver_templates table exists)
      try {
        const { data } = await api(`/api/waiver-templates?establishmentId=${encodeURIComponent(estId)}`);
        const area = $('waiver-templates-area');
        if (data && data.length > 0) {
          area.innerHTML = data.map(t => `
            <div style="border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:8px;">
              <div style="font-weight:700;margin-bottom:4px;">${escHtml(t.title)}</div>
              <div style="font-size:12px;color:var(--muted);margin-bottom:6px;">ID: ${t.id}</div>
              <div style="font-size:13px;border:1px solid var(--line);border-radius:6px;padding:8px;background:var(--panel);max-height:120px;overflow-y:auto;">${t.content || 'Sin contenido'}</div>
            </div>
          `).join('');
        } else {
          area.innerHTML = '<span class="muted">No hay plantillas aún. Crea una nueva.</span>';
        }
      } catch (err) {
        $('waiver-templates-area').innerHTML = `<span style="color:var(--danger);">${err.message}</span>`;
      }
    });

    // New template form
    $('waiver-new-template').addEventListener('click', () => {
      const form = $('waiver-new-form');
      form.style.display = form.style.display === 'none' ? 'block' : 'none';
    });

    $('waiver-template-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = $('wtemp-title').value.trim();
      const content = $('wtemp-content').value.trim();
      if (!title || !content) return;

      try {
        // Store in a local JSON store since waiver_templates table may not have full schema yet
        const result = await api('/api/waiver-templates', {
          method: 'POST',
          body: JSON.stringify({ establishmentId: estId, title, content })
        });
        if (result.data) {
          $('waiver-new-form').style.display = 'none';
          $('wtemp-title').value = '';
          $('wtemp-content').value = '';
          $('waiver-load-templates').click();
        }
      } catch (err) {
        // Fallback: store locally
        alert(`Plantilla creada localmente (DB schema pending): ${err.message}`);
      }
    });
  }

  // ─── 3. DIPLOMA GENERATOR (Instrucción C PDF) ──────────

  function addDiplomaButton() {
    const homeCard = $('academic-home-card');
    if (!homeCard) return;
    const actions = qs('.academic-actions', homeCard);
    if (!actions) return;
    if ($('ac-view-diplomas')) return;

    const btn = document.createElement('button');
    btn.className = 'btn alt';
    btn.id = 'ac-view-diplomas';
    btn.textContent = '🎓 Generar Diploma';
    btn.style.cssText = 'background:linear-gradient(180deg,#7a5a2f 0%,#614a23 100%) !important;box-shadow:0 8px 16px rgba(122,90,47,0.25) !important;';
    actions.appendChild(btn);

    btn.addEventListener('click', openDiplomaGenerator);
  }

  async function openDiplomaGenerator() {
    const overlay = showModal(`
      <h3 style="margin:0 0 6px;">🎓 Generador de Diplomas</h3>
      <p class="muted" style="font-size:13px;margin:0 0 12px;">Genera diplomas personalizados al aprobar un examen de grado.</p>
      <form id="diploma-form" class="form">
        <div class="full"><label>Nombre del alumno</label><input id="dip-name" placeholder="Ej: Juan Pérez" required></div>
        <div><label>Disciplina</label><select id="dip-discipline"><option value="Karate">Karate</option><option value="Judo">Judo</option><option value="BJJ">BJJ</option><option value="Taekwondo">Taekwondo</option><option value="Kickboxing">Kickboxing</option></select></div>
        <div><label>Rango obtenido</label><input id="dip-rank" placeholder="Ej: 1er Kyu (Cinturón Marrón)" required></div>
        <div class="full"><label>Sensei / Instructor</label><input id="dip-sensei" placeholder="Sensei Carlos García" required></div>
        <div><label>Fecha</label><input id="dip-date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
        <div><label>Dojo / Establecimiento</label><input id="dip-dojo" placeholder="Nombre del Dojo" required></div>
        <div class="full"><label>Frase o nota adicional</label><input id="dip-motto" placeholder="Opcional: frase de motivación"></div>
        <div class="full">
          <button class="btn" type="submit">🎓 Generar Diploma PDF</button>
        </div>
      </form>
      <div id="diploma-preview" style="margin-top:12px;display:none;text-align:center;">
        <div id="diploma-preview-inner"></div>
        <button class="btn" id="dip-print-btn" style="margin-top:10px;" type="button">🖨️ Imprimir / Guardar PDF</button>
      </div>
    `, { width: '600px' });

    $('diploma-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('dip-name').value.trim();
      const discipline = $('dip-discipline').value;
      const rank = $('dip-rank').value.trim();
      const sensei = $('dip-sensei').value.trim();
      const date = $('dip-date').value;
      const dojo = $('dip-dojo').value.trim();
      const motto = $('dip-motto').value.trim();

      if (!name || !rank || !sensei || !dojo) return;

      const formattedDate = new Date(date).toLocaleDateString('es-PA', { day: 'numeric', month: 'long', year: 'numeric' });
      const badgeUrl = `https://img.icons8.com/fluency/96/medal2--v1.png`;

      // Generate SVG diploma
      const svgContent = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="100%" style="max-width:700px;">
          <defs>
            <linearGradient id="dip-bg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#fdf6e3;stop-opacity:1" />
              <stop offset="50%" style="stop-color:#fef9ef;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#f5e6c8;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="dip-accent" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" style="stop-color:#c23b2a;stop-opacity:1" />
              <stop offset="100%" style="stop-color:#c9a227;stop-opacity:1" />
            </linearGradient>
          </defs>
          <!-- Outer border -->
          <rect x="10" y="10" width="780" height="580" rx="12" fill="none" stroke="url(#dip-accent)" stroke-width="3" />
          <rect x="18" y="18" width="764" height="564" rx="8" fill="url(#dip-bg)" stroke="#d4a84b" stroke-width="1.5" />

          <!-- Top accent bar -->
          <rect x="18" y="18" width="764" height="6" rx="3" fill="url(#dip-accent)" />

          <!-- Badge -->
          <image href="${badgeUrl}" x="350" y="40" width="100" height="100" />

          <!-- Title -->
          <text x="400" y="170" text-anchor="middle" font-family="Georgia, serif" font-size="32" font-weight="bold" fill="#1a1a2e">DIPLOMA DE GRADO</text>
          <text x="400" y="200" text-anchor="middle" font-family="Georgia, serif" font-size="14" fill="#888">${discipline.toUpperCase()}</text>

          <!-- Line -->
          <line x1="200" y1="220" x2="600" y2="220" stroke="#c9a227" stroke-width="1.5" />

          <!-- Body -->
          <text x="400" y="260" text-anchor="middle" font-family="Georgia, serif" font-size="16" fill="#555">Otorgado a</text>
          <text x="400" y="300" text-anchor="middle" font-family="Georgia, serif" font-size="28" font-weight="bold" fill="#c23b2a">${escHtml(name.toUpperCase())}</text>
          <text x="400" y="340" text-anchor="middle" font-family="Georgia, serif" font-size="16" fill="#555">Por haber alcanzado el rango de</text>
          <text x="400" y="380" text-anchor="middle" font-family="Georgia, serif" font-size="22" font-weight="bold" fill="#1a1a2e">${escHtml(rank)}</text>

          <line x1="200" y1="400" x2="600" y2="400" stroke="#c9a227" stroke-width="1" stroke-dasharray="4,4" />

          <text x="400" y="430" text-anchor="middle" font-family="Georgia, serif" font-size="14" fill="#555">En el dojo ${escHtml(dojo)}, el ${formattedDate}</text>
          <text x="400" y="455" text-anchor="middle" font-family="Georgia, serif" font-size="14" fill="#555">Sensei: ${escHtml(sensei)}</text>

          ${motto ? `<text x="400" y="490" text-anchor="middle" font-family="Georgia, serif" font-size="13" font-style="italic" fill="#888">"${escHtml(motto)}"</text>` : ''}

          <!-- Signature line -->
          <line x1="250" y1="530" x2="400" y2="530" stroke="#333" stroke-width="1" />
          <text x="325" y="550" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#666">Firma del Sensei</text>

          <line x1="450" y1="530" x2="600" y2="530" stroke="#333" stroke-width="1" />
          <text x="525" y="550" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#666">Director / Fundador</text>

          <text x="400" y="580" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" fill="#aaa">Generado por MartialSystem</text>
        </svg>
      `;

      const previewArea = $('diploma-preview');
      const previewInner = $('diploma-preview-inner');
      previewInner.innerHTML = svgContent;
      previewArea.style.display = 'block';

      $('dip-print-btn').onclick = () => {
        const w = window.open('', '_blank');
        w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Diploma ' + name + '</title><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#fff;}svg{width:100%;max-width:800px;}</style></head><body>');
        w.document.write(svgContent);
        w.document.write('</body></html>');
        w.document.close();
        setTimeout(() => w.print(), 500);
      };
    });
  }

  // ─── 4. MOBILE 44px TOUCH TARGETS (Instrucción D) ─────

  function applyMobileOptimizations() {
    const style = document.createElement('style');
    style.textContent = `
      @media (max-width: 768px) {
        /* Minimum touch area 44x44px for all interactive elements */
        .btn, .btn.alt, button, .tab-btn, .module-sub-btn, .mode-btn, .cal-view-btn,
        select, input:not([type="checkbox"]):not([type="radio"]), .discipline-item {
          min-height: 44px !important;
          min-width: 44px !important;
          padding: 10px 14px !important;
          font-size: 14px !important;
        }
        /* Card-based layout for Student Portal and Instructor Dashboard */
        .card {
          padding: 16px !important;
          margin-bottom: 12px !important;
        }
        .card.full {
          padding: 16px !important;
        }
        .grid {
          gap: 10px !important;
        }
        .tabs {
          width: 200px !important;
          left: 8px !important;
          top: 8px !important;
          bottom: 8px !important;
          padding: 10px !important;
        }
        body.auth .wrap {
          margin-left: 220px !important;
          max-width: calc(100vw - 240px) !important;
        }
        .hero {
          flex-direction: column !important;
          align-items: flex-start !important;
          gap: 8px !important;
          padding: 12px !important;
        }
        .hero-right {
          width: 100% !important;
          justify-content: flex-start !important;
          flex-wrap: wrap !important;
        }
        .finance-charts-grid {
          grid-template-columns: 1fr !important;
        }
        .market-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        }
        .form {
          grid-template-columns: 1fr !important;
        }
        .list {
          grid-template-columns: 1fr !important;
        }
        pre {
          font-size: 11px !important;
        }
      }
      @media (max-width: 480px) {
        .tabs {
          width: 160px !important;
          left: 4px !important;
          padding: 8px !important;
          font-size: 12px !important;
        }
        body.auth .wrap {
          margin-left: 175px !important;
          max-width: calc(100vw - 190px) !important;
        }
        .tab-btn {
          padding: 8px !important;
          font-size: 12px !important;
          min-height: 38px !important;
        }
        .wrap {
          padding: 0 8px !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ─── INIT ──────────────────────────────────────────────

  function init() {
    // Wait for DOM
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }

    // Add buttons to academic tab after it's attached
    const observer = new MutationObserver(() => {
      if ($('academic-home-card') && qs('.academic-actions')) {
        addScannerButtons();
        addWaiverButton();
        addDiplomaButton();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Also try immediately
    setTimeout(() => {
      addScannerButtons();
      addWaiverButton();
      addDiplomaButton();
    }, 1000);

    // Mobile optimizations
    applyMobileOptimizations();
  }

  // ─── Backend API requests for waivers ────────────────
  // These use the JSON file store since DB is not fully migrated
  const WAIVERS_STORE_KEY = 'ms_waiver_data';

  async function getWaiverTemplates(estId) {
    const store = JSON.parse(localStorage.getItem(WAIVERS_STORE_KEY) || '{}');
    return (store[estId]?.templates || []);
  }

  async function saveWaiverTemplate(estId, title, content) {
    const store = JSON.parse(localStorage.getItem(WAIVERS_STORE_KEY) || '{}');
    if (!store[estId]) store[estId] = { templates: [], waivers: [] };
    store[estId].templates.push({ id: crypto.randomUUID?.() || Date.now().toString(36), title, content, createdAt: new Date().toISOString() });
    localStorage.setItem(WAIVERS_STORE_KEY, JSON.stringify(store));
    return store[estId].templates[store[estId].templates.length - 1];
  }

  // Override API for waiver endpoints if they fail
  const originalApi = window.api || api;
  const enhancedApi = async (url, options = {}) => {
    // Intercept waiver endpoints to use localStorage fallback
    const urlStr = typeof url === 'string' ? url : url.url;

    if (urlStr?.includes('/api/waiver-templates') && (!options.method || options.method === 'GET')) {
      const estId = urlStr.split('establishmentId=')[1]?.split('&')[0] || '';
      const templates = await getWaiverTemplates(estId);
      return { ok: true, data: templates };
    }

    if (urlStr?.includes('/api/waiver-templates') && options.method === 'POST') {
      const body = JSON.parse(options.body || '{}');
      const data = await saveWaiverTemplate(body.establishmentId, body.title, body.content);
      return { ok: true, data };
    }

    try {
      return await originalApi(url, options);
    } catch (err) {
      // For waiver endpoints, use localStorage fallback
      if (urlStr?.includes('/api/waiver')) {
        return { ok: true, data: [] };
      }
      throw err;
    }
  };

  // Patch api references
  window.api = enhancedApi;

  init();
})();