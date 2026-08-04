// ══════════════════════════════════════════════════════════════
// dashboard.js — Lógica del frontend del Simulador
// ══════════════════════════════════════════════════════════════
(function() {
  'use strict';

  const API = '';
  let pollInterval = null;
  let maintDays = [];
  let maintDayIndex = 0;

  // ─── Utility ───
  const $ = id => document.getElementById(id);
  const api = async (url, opts = {}) => {
    const res = await fetch(API + url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    return res.json();
  };
  const ts = () => new Date().toLocaleTimeString('es-PA');
  const escHtml = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&','<':'<','>':'>','"':'"',"'":'&#39;'}[c]));

  // ─── Tabs ───
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'cleanup') loadCleanupData();
      if (btn.dataset.tab === 'history') loadHistory();
    });
  });

  // ─── Slider labels ───
  $('sim-evalChance').addEventListener('input', e => $('sim-evalLabel').textContent = e.target.value + '%');
  $('sim-payChance').addEventListener('input', e => $('sim-payLabel').textContent = e.target.value + '%');
  $('sim-chaosRate').addEventListener('input', e => $('sim-chaosLabel').textContent = e.target.value + '%');

  // ─── Discipline checkboxes ───
  const discCodes = ['karate','judo','bjj','taekwondo','kickboxing','muay_thai','boxing','mma','aikido','kendo'];
  const discLabels = {karate:'🥋 Karate',judo:'🏯 Judo',bjj:'👊 BJJ',taekwondo:'🦶 Taekwondo',kickboxing:'🥊 Kickboxing',muay_thai:'🇹🇭 Muay Thai',boxing:'🥊 Boxeo',mma:'🤼 MMA',aikido:'🌊 Aikido',kendo:'⚔️ Kendo'};
  $('sim-disciplines').innerHTML = discCodes.map(code =>
    `<label class="check-item"><input type="checkbox" value="${code}" ${['karate','judo'].includes(code)?'checked':''}><span class="check-label">${discLabels[code]||code}</span></label>`
  ).join('');

  // ─── Health check ───
  async function checkHealth() {
    try {
      const res = await api('/api/health');
      if (res.ok) {
        $('connDot').className = 'status-dot';
        $('connText').textContent = 'Simulador: OK';
      }
    } catch(_) {
      $('connDot').className = 'status-dot danger';
      $('connText').textContent = 'Simulador: OFF';
    }
    try {
      const res = await api('/api/system/info');
      if (res.ok && res.data) {
        const c = res.data.tableCounts || {};
        $('dbDot').className = res.data.supabaseConnected ? 'status-dot' : 'status-dot danger';
        $('dbText').textContent = `DB: ${Object.values(c).reduce((a,b)=>a+b,0)} registros`;
      }
    } catch(_) {
      $('dbDot').className = 'status-dot danger';
      $('dbText').textContent = 'DB: Sin conexión';
    }
  }
  checkHealth();
  setInterval(checkHealth, 15000);

  // ══════════════════════════════════════════════════════════════
  // TAB 1: SIMULACIÓN
  // ══════════════════════════════════════════════════════════════

  function getSimParams() {
    return {
      establishmentCount: parseInt($('sim-estCount').value) || 2,
      studentCount: parseInt($('sim-studCount').value) || 20,
      instructorsPerEst: parseInt($('sim-instrCount').value) || 2,
      senseisPerEst: parseInt($('sim-senseiCount').value) || 1,
      daysToSimulate: parseInt($('sim-days').value) || 30,
      classesPerWeek: parseInt($('sim-classesPerWeek').value) || 5,
      evaluationChance: parseInt($('sim-evalChance').value) / 100,
      paymentChance: parseInt($('sim-payChance').value) / 100,
      chaosRate: parseInt($('sim-chaosRate').value),
      speed: $('sim-speed').value,
      concurrency: parseInt($('sim-concurrency').value) || 1,
      disciplineCodes: [...document.querySelectorAll('#sim-disciplines input:checked')].map(cb => cb.value)
    };
  }

  function addLog(msg, type = 'info') {
    const el = $('sim-log');
    el.innerHTML += `<div class="log-entry ${type}"><span class="ts">[${ts()}]</span>${escHtml(msg)}</div>`;
    el.scrollTop = el.scrollHeight;
  }

  function setSimRunning(running) {
    $('btn-sim-start').disabled = running;
    $('btn-sim-pause').disabled = !running;
    $('btn-sim-stop').disabled = !running;
    $('btn-sim-start').textContent = running ? '⏳ Ejecutando...' : '▶️ Iniciar';
  }

  $('btn-sim-start').addEventListener('click', async () => {
    const params = getSimParams();
    if (params.disciplineCodes.length === 0) { addLog('Selecciona al menos una disciplina', 'error'); return; }
    addLog(`Iniciando simulación: ${params.establishmentCount} establecimientos, ${params.studentCount} alumnos, ${params.daysToSimulate} días`, 'info');
    setSimRunning(true);
    try {
      const res = await api('/api/simulation/start', { method: 'POST', body: params });
      if (res.ok) {
        addLog('Simulación lanzada en segundo plano', 'success');
        startPolling();
      } else {
        addLog('Error: ' + (res.error || 'Unknown'), 'error');
        setSimRunning(false);
      }
    } catch(err) {
      addLog('Error de conexión: ' + err.message, 'error');
      setSimRunning(false);
    }
  });

  $('btn-sim-pause').addEventListener('click', async () => {
    const btn = $('btn-sim-pause');
    if (btn.textContent.includes('Pausar')) {
      await api('/api/simulation/pause', { method: 'POST' });
      btn.textContent = '▶️ Reanudar';
      addLog('Simulación pausada', 'warn');
    } else {
      await api('/api/simulation/resume', { method: 'POST' });
      btn.textContent = '⏸️ Pausar';
      addLog('Simulación reanudada', 'info');
    }
  });

  $('btn-sim-stop').addEventListener('click', async () => {
    await api('/api/simulation/stop', { method: 'POST' });
    addLog('Simulación detenida', 'error');
    setSimRunning(false);
    stopPolling();
  });

  $('btn-sim-clear-log').addEventListener('click', () => $('sim-log').innerHTML = '');

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(pollStatus, 1000);
  }
  function stopPolling() { if (pollInterval) { clearInterval(pollInterval); pollInterval = null; } }

  async function pollStatus() {
    try {
      const res = await api('/api/simulation/status');
      if (!res.ok) return;
      const d = res.data;
      const s = d.summary || {};

      $('sim-ops').textContent = s.totalOperations || 0;
      $('sim-success').textContent = s.successCount || 0;
      $('sim-errors').textContent = s.errorCount || 0;
      const health = s.healthStatus || 'idle';
      $('sim-health').textContent = health.toUpperCase();
      $('sim-health').className = 'kpi-value ' + (health === 'excellent' ? 'ok' : health === 'good' ? 'ok' : health === 'warning' ? 'warn' : health === 'critical' ? 'danger' : '');

      const rate = s.successRate || 0;
      $('sim-progress').style.width = rate + '%';
      $('sim-progress').className = 'fill ' + (rate >= 90 ? 'ok' : rate >= 70 ? 'warn' : 'danger');
      $('sim-progress').textContent = rate + '%';

      // Endpoint ranking
      if (s.endpointRanking && s.endpointRanking.length > 0) {
        const tbody = $('sim-endpoint-table').querySelector('tbody');
        tbody.innerHTML = s.endpointRanking.map(ep => `
          <tr>
            <td>${escHtml(ep.endpoint)}</td>
            <td>${ep.calls}</td>
            <td style="color:var(--ok)">${ep.successes}</td>
            <td style="color:${ep.errors>0?'var(--danger)':'var(--muted)'}">${ep.errors}</td>
            <td><span class="chip ${ep.successRate>=90?'ok':ep.successRate>=70?'warn':'danger'}">${ep.successRate}%</span></td>
            <td>${ep.avgResponseTime}ms</td>
          </tr>
        `).join('');
      }

      // Anomalies
      if (s.anomalies && s.anomalies.length > 0) {
        $('sim-anomalies').innerHTML = s.anomalies.map(a =>
          `<div style="margin-bottom:6px;"><span class="chip ${a.severity==='critical'?'danger':'warn'}">${a.severity}</span> ${escHtml(a.message)}</div>`
        ).join('');
      }

      // If not running, stop polling and show completion
      if (!d.running && !d.idle) {
        stopPolling();
        setSimRunning(false);
        addLog(`✅ Simulación completada — ${s.totalOperations} ops, ${s.errorCount} errores, ${s.successRate}% éxito`, 'success');
        loadHistory();
      }
    } catch(_) {}
  }

  // ─── Export CSV ───
  $('btn-sim-export-csv').addEventListener('click', async () => {
    const res = await api('/api/simulation/status');
    if (!res.ok || !res.data?.summary) return;
    const s = res.data.summary;
    let csv = 'Endpoint,Llamadas,Exitos,Errores,%Exito,AvgMs\n';
    (s.endpointRanking||[]).forEach(ep => {
      csv += `"${ep.endpoint}",${ep.calls},${ep.successes},${ep.errors},${ep.successRate},${ep.avgResponseTime}\n`;
    });
    downloadFile(csv, 'simulacion_reporte.csv', 'text/csv');
  });

  // ─── Export PDF simulation ───
  $('btn-sim-export-pdf').addEventListener('click', async () => {
    const res = await api('/api/simulation/status');
    if (!res.ok || !res.data?.summary) { addLog('No hay datos para exportar', 'error'); return; }
    const s = res.data.summary;
    generateSimPDF(s);
  });

  function generateSimPDF(s) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(20);
    doc.text('MartialSystem — Reporte de Simulación', 14, 22);
    doc.setFontSize(10);
    doc.text(`Fecha: ${new Date().toLocaleString('es-PA')}`, 14, 30);
    doc.text(`Operaciones: ${s.totalOperations} | Éxitos: ${s.successCount} | Errores: ${s.errorCount} | Tasa: ${s.successRate}%`, 14, 38);

    doc.setFontSize(14);
    doc.text('Ranking de Endpoints', 14, 50);
    const epData = (s.endpointRanking||[]).map(ep => [ep.endpoint, ep.calls, ep.successes, ep.errors, ep.successRate+'%', ep.avgResponseTime+'ms']);
    doc.autoTable({ startY: 54, head: [['Endpoint','Llamadas','Éxitos','Errores','% Éxito','Avg ms']], body: epData, styles: { fontSize: 8 } });

    if (s.anomalies && s.anomalies.length > 0) {
      const y = doc.lastAutoTable.finalY + 10;
      doc.setFontSize(14);
      doc.text('Anomalías Detectadas', 14, y);
      const anomData = s.anomalies.map(a => [a.severity, a.message]);
      doc.autoTable({ startY: y+4, head: [['Severidad','Mensaje']], body: anomData, styles: { fontSize: 8 } });
    }

    doc.save('simulacion_martialsystem.pdf');
    addLog('PDF exportado exitosamente', 'success');
  }

  // ══════════════════════════════════════════════════════════════
  // TAB 2: MANTENIMIENTO
  // ══════════════════════════════════════════════════════════════

  // Set default dates
  const today = new Date().toISOString().slice(0, 10);
  const ninetyAgo = new Date(Date.now() - 90*86400000).toISOString().slice(0, 10);
  $('maint-from').value = ninetyAgo;
  $('maint-to').value = today;

  $('btn-maint-replay').addEventListener('click', async () => {
    const from = $('maint-from').value;
    const to = $('maint-to').value;
    const step = parseInt($('maint-step').value) || 1;
    $('btn-maint-replay').disabled = true;
    $('btn-maint-replay').textContent = '⏳ Cargando...';
    try {
      const res = await api('/api/maintenance/timeline', { method: 'POST', body: { dateFrom: from, dateTo: to, stepDays: step } });
      if (res.ok && res.data) {
        maintDays = res.data.days || [];
        maintDayIndex = 0;
        const stats = res.data.stats || {};
        $('maint-est').textContent = stats.establishments || 0;
        $('maint-stud').textContent = stats.students || 0;
        $('maint-classes').textContent = stats.classes || 0;
        $('maint-payments').textContent = stats.payments || 0;

        $('maint-player-controls').style.display = 'flex';
        $('maint-day-metrics').style.display = 'grid';
        renderMaintDay();
      }
    } catch(err) {
      alert('Error: ' + err.message);
    }
    $('btn-maint-replay').disabled = false;
    $('btn-maint-replay').textContent = '▶️ Reproducir';
  });

  $('btn-maint-prev').addEventListener('click', () => { if (maintDayIndex > 0) { maintDayIndex--; renderMaintDay(); } });
  $('btn-maint-next').addEventListener('click', () => { if (maintDayIndex < maintDays.length - 1) { maintDayIndex++; renderMaintDay(); } });

  function renderMaintDay() {
    if (!maintDays[maintDayIndex]) return;
    const day = maintDays[maintDayIndex];
    const m = day.metrics || {};

    $('maint-current-day').textContent = day.date;
    $('maint-day-counter').textContent = `${maintDayIndex+1} / ${maintDays.length}`;
    $('maint-m-students').textContent = m.studentsActive || 0;
    $('maint-m-att').textContent = (m.attendanceRate || 0) + '%';
    $('maint-m-income').textContent = '$' + (m.totalIncome || 0).toFixed(2);
    $('maint-m-evals').textContent = m.evaluationsHeld || 0;

    // Color attendance
    const attRate = m.attendanceRate || 0;
    $('maint-m-att').className = 'kpi-value ' + (attRate >= 70 ? 'ok' : attRate >= 50 ? 'warn' : 'danger');

    // Timeline
    const container = $('maint-timeline');
    container.innerHTML = '';

    // Show a window of days around current
    const start = Math.max(0, maintDayIndex - 5);
    const end = Math.min(maintDays.length, maintDayIndex + 10);
    for (let i = start; i < end; i++) {
      const d = maintDays[i];
      const isCurrent = i === maintDayIndex;
      const hasEvents = (d.eventCount || 0) > 0;
      const hasAnomaly = (d.anomalies || []).length > 0;
      const cls = isCurrent ? ' has-events' : (hasAnomaly ? ' has-anomaly' : '');
      const bg = isCurrent ? 'background:rgba(47,111,163,0.15);border-radius:8px;padding:8px;' : '';

      let eventsHtml = '';
      if (d.events && d.events.length > 0) {
        eventsHtml = d.events.slice(0, 8).map(e =>
          `<div>${e.icon} ${escHtml(e.label)}</div>`
        ).join('');
        if (d.events.length > 8) eventsHtml += `<div style="color:var(--muted);">... y ${d.events.length - 8} más</div>`;
      } else {
        eventsHtml = '<span style="color:var(--muted);">Sin eventos</span>';
      }

      let anomalyHtml = '';
      if (d.anomalies && d.anomalies.length > 0) {
        anomalyHtml = d.anomalies.map(a =>
          `<div style="color:var(--warn);font-size:11px;">⚠️ ${escHtml(a.message)}</div>`
        ).join('');
      }

      container.innerHTML += `
        <div class="timeline-day${cls}" style="${bg}">
          <div class="timeline-date">${d.date} ${isCurrent ? '◀' : ''} ${hasEvents ? `<span class="chip ok">${d.eventCount} eventos</span>` : ''} ${day.dayIncome > 0 ? `<span class="chip info">$${day.dayIncome.toFixed(2)}</span>` : ''}</div>
          <div class="timeline-events">${eventsHtml}${anomalyHtml}</div>
        </div>
      `;
    }

    container.scrollTop = container.scrollHeight;
  }

  // Audit
  $('btn-maint-audit').addEventListener('click', async () => {
    $('btn-maint-audit').disabled = true;
    $('btn-maint-audit').textContent = '⏳ Escaneando...';
    try {
      const res = await api('/api/maintenance/integrity');
      if (res.ok && res.data) {
        $('maint-audit-card').style.display = 'block';
        const summary = res.data.summary || {};
        const score = summary.healthScore || 0;
        const color = score >= 80 ? 'var(--ok)' : score >= 50 ? 'var(--warn)' : 'var(--danger)';
        $('maint-audit-score').innerHTML = `
          <div class="kpi-tile" style="display:inline-block;min-width:200px;">
            <div class="kpi-label">Salud del Sistema</div>
            <div class="kpi-value" style="color:${color};font-size:2rem;">${score}/100</div>
            <div style="font-size:12px;color:var(--muted);">${summary.critical} críticos, ${summary.warnings} warnings, ${summary.info} info</div>
          </div>
        `;
        $('maint-findings').innerHTML = (res.data.findings || []).map(f => {
          const icon = f.severity === 'critical' ? '🔴' : f.severity === 'warning' ? '🟡' : '🔵';
          return `<div style="margin-bottom:8px;padding:8px;border:1px solid var(--line);border-radius:8px;">
            <span class="chip ${f.severity === 'critical' ? 'danger' : f.severity === 'warning' ? 'warn' : 'info'}">${f.category}</span>
            ${icon} ${escHtml(f.message)}
          </div>`;
        }).join('');
      }
    } catch(err) { alert('Error: ' + err.message); }
    $('btn-maint-audit').disabled = false;
    $('btn-maint-audit').textContent = '🔍 Auditar';
  });

  // ══════════════════════════════════════════════════════════════
  // TAB 3: LIMPIEZA
  // ══════════════════════════════════════════════════════════════

  async function loadCleanupData() {
    try {
      const [tablesRes, countsRes] = await Promise.all([
        api('/api/cleanup/tables'),
        api('/api/cleanup/counts')
      ]);

      if (tablesRes.ok) {
        $('cleanup-tables').innerHTML = (tablesRes.data || []).map(t =>
          `<label class="check-item"><input type="checkbox" value="${t.id}" checked><span class="check-label">${escHtml(t.label)}</span><span class="check-count" id="count-${t.id}">--</span></label>`
        ).join('');
      }

      if (countsRes.ok) {
        const counts = countsRes.data || {};
        Object.entries(counts).forEach(([table, count]) => {
          const el = $('count-' + table);
          if (el) el.textContent = count >= 0 ? count + ' filas' : 'N/A';
        });
        $('cleanup-counts').innerHTML = Object.entries(counts).map(([t, c]) =>
          `<div style="display:flex;justify-content:space-between;padding:3px 0;"><span>${t}</span><span style="font-weight:700;">${c >= 0 ? c : 'N/A'}</span></div>`
        ).join('');
      }
    } catch(_) {}

    loadSnapshots();
  }

  async function loadSnapshots() {
    try {
      const res = await api('/api/snapshots');
      if (res.ok && res.data && res.data.length > 0) {
        $('snapshots-list').innerHTML = res.data.map(s => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px;">
            <div>
              <strong>${escHtml(s.name)}</strong>
              <span style="font-size:11px;color:var(--muted);"> — ${s.totalRows || 0} registros — ${s.timestamp ? new Date(s.timestamp).toLocaleString('es-PA') : ''}</span>
            </div>
            <div class="row">
              <button class="btn btn-accent btn-sm" onclick="restoreSnapshot('${escHtml(s.name)}')">🔄 Restaurar</button>
              <button class="btn btn-danger btn-sm" onclick="deleteSnapshot('${escHtml(s.name)}')">🗑️</button>
            </div>
          </div>
        `).join('');
      } else {
        $('snapshots-list').innerHTML = '<span style="color:var(--muted);">No hay snapshots guardados.</span>';
      }
    } catch(_) { $('snapshots-list').innerHTML = '<span style="color:var(--muted);">Error cargando snapshots.</span>'; }
  }

  window.restoreSnapshot = async function(name) {
    if (!confirm(`¿Restaurar snapshot "${name}"?\nEsto borrará TODOS los datos actuales y los reemplazará con los del snapshot.`)) return;
    try {
      const res = await api(`/api/snapshots/${name}/restore`, { method: 'POST' });
      if (res.ok) { alert('Snapshot restaurado exitosamente'); loadCleanupData(); }
      else alert('Error: ' + (res.error || 'Unknown'));
    } catch(err) { alert('Error: ' + err.message); }
  };

  window.deleteSnapshot = async function(name) {
    if (!confirm(`¿Eliminar snapshot "${name}"?`)) return;
    try {
      await api(`/api/snapshots/${name}`, { method: 'DELETE' });
      loadSnapshots();
    } catch(_) {}
  };

  $('btn-cleanup-select-all').addEventListener('click', () => {
    document.querySelectorAll('#cleanup-tables input[type="checkbox"]').forEach(cb => cb.checked = true);
  });
  $('btn-cleanup-select-none').addEventListener('click', () => {
    document.querySelectorAll('#cleanup-tables input[type="checkbox"]').forEach(cb => cb.checked = false);
  });
  $('btn-cleanup-refresh').addEventListener('click', loadCleanupData);

  function getSelectedTables() {
    return [...document.querySelectorAll('#cleanup-tables input:checked')].map(cb => cb.value);
  }

  $('btn-cleanup-dryrun').addEventListener('click', async () => {
    const tables = getSelectedTables();
    if (tables.length === 0) { alert('Selecciona al menos una tabla'); return; }
    try {
      const res = await api('/api/cleanup/dry-run', { method: 'POST', body: { tables } });
      if (res.ok) {
        const d = res.data;
        let html = `<div style="margin-bottom:10px;font-weight:700;">Total de registros a eliminar: <span style="color:var(--danger);font-size:1.3rem;">${d.totalWouldDelete}</span></div>`;
        html += Object.entries(d.results || {}).map(([t, r]) =>
          `<div style="padding:4px 0;">${t}: <strong>${r.wouldDelete}</strong> ${r.error ? `<span style="color:var(--danger);">(${escHtml(r.error)})</span>` : ''}</div>`
        ).join('');
        $('cleanup-result-card').style.display = 'block';
        $('cleanup-result').innerHTML = html;
      }
    } catch(err) { alert('Error: ' + err.message); }
  });

  $('btn-cleanup-snapshot').addEventListener('click', async () => {
    const label = prompt('Etiqueta para el snapshot (opcional):') || '';
    try {
      const res = await api('/api/snapshots', { method: 'POST', body: { label } });
      if (res.ok) { alert(`Snapshot creado: ${res.data.name} (${res.data.totalRows} registros)`); loadSnapshots(); }
    } catch(err) { alert('Error: ' + err.message); }
  });

  $('btn-cleanup-execute').addEventListener('click', async () => {
    const tables = getSelectedTables();
    if (tables.length === 0) { alert('Selecciona al menos una tabla'); return; }
    const confirmText = prompt(`⚠️ ESCRIBE "BORRAR" PARA CONFIRMAR:\nSe eliminarán ${tables.length} tipos de datos.`);
    if (confirmText !== 'BORRAR') { alert('Cancelado.'); return; }
    try {
      const estId = $('cleanup-estId').value.trim() || undefined;
      const beforeDate = $('cleanup-before-date').value || undefined;
      const res = await api('/api/cleanup/execute', { method: 'POST', body: { tables, establishmentId: estId, beforeDate, createBackup: true } });
      if (res.ok) {
        const log = res.data;
        let html = `<div style="margin-bottom:10px;">Total eliminados: <strong>${log.totalDeleted}</strong></div>`;
        html += Object.entries(log.deleted || {}).map(([t, n]) => `<div style="color:var(--ok);">✅ ${t}: ${n} eliminados</div>`).join('');
        html += Object.entries(log.errors || {}).map(([t, e]) => `<div style="color:var(--danger);">❌ ${t}: ${escHtml(e)}</div>`).join('');
        if (log.backup) html += `<div style="margin-top:8px;">📸 Backup: ${escHtml(log.backup.name)}</div>`;
        $('cleanup-result-card').style.display = 'block';
        $('cleanup-result').innerHTML = html;
        loadCleanupData();
      }
    } catch(err) { alert('Error: ' + err.message); }
  });

  // ══════════════════════════════════════════════════════════════
  // TAB 4: HISTORIAL
  // ══════════════════════════════════════════════════════════════

  async function loadHistory() {
    try {
      const res = await api('/api/simulation/history');
      if (!res.ok || !res.data || res.data.length === 0) {
        $('history-list').innerHTML = '<span style="color:var(--muted);">No hay simulaciones ejecutadas aún.</span>';
        return;
      }
      $('history-list').innerHTML = res.data.map((h, i) => {
        const s = h.summary || {};
        const rate = s.successRate || 0;
        const chip = rate >= 90 ? 'ok' : rate >= 70 ? 'warn' : 'danger';
        return `
          <div style="padding:10px;border:1px solid var(--line);border-radius:8px;margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <strong>Simulación #${h.id}</strong>
                <span style="font-size:12px;color:var(--muted);"> — ${new Date(h.timestamp).toLocaleString('es-PA')}</span>
              </div>
              <div class="row">
                <span class="chip ${chip}">${rate}% éxito</span>
                <span style="font-size:12px;">${s.totalOperations || 0} ops</span>
                ${h.concurrency ? `<span class="chip info">x${h.concurrency}</span>` : ''}
              </div>
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px;">
              Errores: ${s.errorCount || 0} | Tiempo: ${s.elapsedFormatted || '--'}
            </div>
          </div>
        `;
      }).reverse().join('');
    } catch(_) {}
  }

  // ─── Export general PDF ───
  $('btn-history-export-pdf').addEventListener('click', async () => {
    try {
      const [histRes, sysRes] = await Promise.all([
        api('/api/simulation/history'),
        api('/api/system/info')
      ]);

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      let y = 20;

      doc.setFontSize(22);
      doc.text('MartialSystem — Reporte General del Simulador', 14, y); y += 12;
      doc.setFontSize(10);
      doc.text(`Generado: ${new Date().toLocaleString('es-PA')}`, 14, y); y += 10;

      // System info
      if (sysRes.ok && sysRes.data?.tableCounts) {
        doc.setFontSize(14);
        doc.text('Estado Actual de la Base de Datos', 14, y); y += 6;
        const rows = Object.entries(sysRes.data.tableCounts).map(([t, c]) => [t, String(c)]);
        doc.autoTable({ startY: y, head: [['Tabla', 'Registros']], body: rows, styles: { fontSize: 9 } });
        y = doc.lastAutoTable.finalY + 10;
      }

      // Simulation history
      if (histRes.ok && histRes.data && histRes.data.length > 0) {
        doc.setFontSize(14);
        doc.text('Historial de Simulaciones', 14, y); y += 6;
        const rows = histRes.data.map(h => [
          `#${h.id}`,
          new Date(h.timestamp).toLocaleString('es-PA'),
          h.summary?.totalOperations || 0,
          h.summary?.errorCount || 0,
          (h.summary?.successRate || 0) + '%',
          h.summary?.elapsedFormatted || '--'
        ]);
        doc.autoTable({ startY: y, head: [['#', 'Fecha', 'Ops', 'Errores', '% Éxito', 'Tiempo']], body: rows, styles: { fontSize: 9 } });
      }

      doc.save('reporte_general_simulador.pdf');
    } catch(err) { alert('Error: ' + err.message); }
  });

  // ─── Export CSV ───
  $('btn-history-export-csv').addEventListener('click', async () => {
    try {
      const res = await api('/api/simulation/history');
      if (!res.ok || !res.data) return;
      let csv = 'ID,Fecha,Operaciones,Errores,%Exito,Tiempo\n';
      res.data.forEach(h => {
        csv += `${h.id},"${new Date(h.timestamp).toLocaleString('es-PA')}",${h.summary?.totalOperations||0},${h.summary?.errorCount||0},${h.summary?.successRate||0},${h.summary?.elapsedFormatted||''}\n`;
      });
      downloadFile(csv, 'historial_simulaciones.csv', 'text/csv');
    } catch(_) {}
  });

  // ─── Download helper ───
  function downloadFile(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── Init cleanup data on load ───
  loadCleanupData();
})();