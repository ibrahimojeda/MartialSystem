// ══════════════════════════════════════════════════════════════
// server.js — Servidor del Simulador MartialSystem (puerto 8011)
// ══════════════════════════════════════════════════════════════

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const { WorkflowEngine } = require('./workflow-engine');
const { AuditEngine } = require('./audit-engine');
const { CleanupEngine } = require('./cleanup-engine');
const { SnapshotManager } = require('./snapshot-manager');
const { ErrorTracker } = require('./error-tracker');
const { RoleAuditEngine } = require('./role-audit-engine');
const { generateSimulationPdf, REPORTS_DIR } = require('./pdf-report');
const fs = require('fs');

const app = express();
const PORT = 8011;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Supabase admin client
const sbUrl = process.env.SUPABASE_URL;
const sbServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let sb = null;

if (sbUrl && sbServiceKey) {
  sb = createClient(sbUrl, sbServiceKey, { auth: { persistSession: false } });
  console.log('[SIMULATOR] Supabase connected:', sbUrl);
} else {
  console.warn('[SIMULATOR] Supabase env vars missing — run from MartialSystem root with .env configured');
}

// Engine instances
let currentWorkflow = null;
let activeWorkflows = [];
let globalTracker = new ErrorTracker();
let simulationHistory = [];
let progressBuffer = [];
let sseClients = [];

// Aggregate status across all active (possibly concurrent) workflows
function getActiveStatus() {
  if (activeWorkflows.length === 0) {
    return { running: false, idle: true, operations: 0, errors: 0, activeWorkflows: 0 };
  }
  let running = false, paused = false, operations = 0, errors = 0;
  activeWorkflows.forEach((w) => {
    if (!w) return;
    const s = w.getStatus();
    if (s.running) running = true;
    if (s.paused) paused = true;
    operations += s.operations || 0;
    errors += s.errors || 0;
  });
  return { running, paused, stopped: false, operations, errors, activeWorkflows: activeWorkflows.length };
}

// Aggregate summary across all active workflows
function getActiveSummary() {
  if (activeWorkflows.length === 0) return null;
  const merged = {
    totalOperations: 0,
    successCount: 0,
    errorCount: 0,
    successRate: 0,
    establishments: 0,
    profiles: 0,
    students: 0,
    enrollments: 0,
    classes: 0,
    endpointRanking: [],
    anomalies: []
  };
  activeWorkflows.forEach((w) => {
    if (!w) return;
    const s = w.getSummary();
    if (!s) return;
    merged.totalOperations += s.totalOperations || 0;
    merged.successCount += s.successCount || 0;
    merged.errorCount += s.errorCount || 0;
    merged.establishments += s.establishments || 0;
    merged.profiles += s.profiles || 0;
    merged.students += s.students || 0;
    merged.enrollments += s.enrollments || 0;
    merged.classes += s.classes || 0;
    if (Array.isArray(s.endpointRanking)) merged.endpointRanking = merged.endpointRanking.concat(s.endpointRanking);
    if (Array.isArray(s.anomalies)) merged.anomalies = merged.anomalies.concat(s.anomalies);
  });
  const ops = merged.totalOperations || 1;
  merged.successRate = Number(((merged.successCount / ops) * 100).toFixed(2));
  merged.healthStatus = merged.successRate >= 95 ? 'excellent' : merged.successRate >= 85 ? 'good' : merged.successRate >= 70 ? 'warning' : 'critical';
  if (activeWorkflows.length === 1) {
    const single = activeWorkflows[0].getSummary();
    if (single) {
      merged.endpointRanking = single.endpointRanking || [];
      merged.anomalies = single.anomalies || [];
      merged.evaluationsHeld = single.evaluationsHeld || 0;
      merged.attendanceCount = single.attendanceCount || 0;
      merged.classCount = single.classCount || 0;
      merged.paymentCount = single.paymentCount || 0;
    }
  }
  return merged;
}

function clearActiveWorkflows() {
  activeWorkflows = [];
  currentWorkflow = null;
  progressBuffer = [];
}

const snapshotManager = sb ? new SnapshotManager(sb) : null;
const cleanupEngine = sb ? new CleanupEngine(sb, snapshotManager) : null;
const auditEngine = sb ? new AuditEngine(sb) : null;
const roleAuditEngine = sb ? new RoleAuditEngine(sb) : null;
let lastRoleAuditResult = null;

// ─── Health ───
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'MartialSystem Simulator', port: PORT, supabaseConnected: !!sb, ts: new Date().toISOString() });
});

// ══════════════════════════════════════════════════════════════
// MODO SIMULACIÓN
// ══════════════════════════════════════════════════════════════

// SSE endpoint for real-time progress
app.get('/api/simulation/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);

  const send = (payload) => {
    try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch (_) {}
  };

  const interval = setInterval(() => {
    if (activeWorkflows.length > 0) {
      const status = getActiveStatus();
      const summary = getActiveSummary();
      send({ status, summary });
    }
    // Flush buffered progress events
    if (progressBuffer.length > 0) {
      const events = progressBuffer.splice(0, progressBuffer.length);
      send({ events });
    }
  }, 500);

  req.on('close', () => {
    clearInterval(interval);
    sseClients = sseClients.filter(c => c !== res);
  });
});

// Start simulation
app.post('/api/simulation/start', async (req, res) => {
  if (activeWorkflows.some(w => w && w.getStatus().running)) {
    return res.status(409).json({ ok: false, error: 'Simulation already running' });
  }

  const params = req.body || {};
  const concurrency = Math.max(1, Math.min(parseInt(params.concurrency) || 1, 10));

  // Clear any stale state
  clearActiveWorkflows();

  const makeWorkflow = (speed) => new WorkflowEngine(sb, {
    chaosRate: params.chaosRate || 0,
    speed: speed || params.speed || 'normal',
    onProgress: (event) => {
      // Buffer events for SSE delivery
      progressBuffer.push({ ...event, ts: new Date().toISOString() });
      // Keep buffer bounded
      if (progressBuffer.length > 10000) progressBuffer = progressBuffer.slice(-10000);
    }
  });

  // Create all workflows (1 or N for concurrency)
  const workflows = [];
  for (let i = 0; i < concurrency; i++) {
    // For concurrency > 1, use fast speed to avoid overwhelming; keep first at requested speed
    const wf = makeWorkflow(i === 0 ? params.speed : 'fast');
    workflows.push(wf);
    activeWorkflows.push(wf);
  }
  currentWorkflow = workflows[0];

  // Run all workflows in parallel (awaited so the request returns when done)
  const runAll = async () => {
    try {
      const results = await Promise.all(workflows.map(w => w.runSimulation(params)));

      // Build a detailed combined summary including ALL operations + errors
      let combined = null;
      if (concurrency === 1) {
        combined = results[0];
      } else {
        combined = {
          totalOperations: results.reduce((a, r) => a + (r.totalOperations || 0), 0),
          successCount: results.reduce((a, r) => a + (r.successCount || 0), 0),
          errorCount: results.reduce((a, r) => a + (r.errorCount || 0), 0),
          successRate: 0,
          elapsedFormatted: results[0]?.elapsedFormatted || '--',
          establishments: results.reduce((a, r) => a + (r.establishments || 0), 0),
          profiles: results.reduce((a, r) => a + (r.profiles || 0), 0),
          students: results.reduce((a, r) => a + (r.students || 0), 0),
          enrollments: results.reduce((a, r) => a + (r.enrollments || 0), 0),
          classes: results.reduce((a, r) => a + (r.classes || 0), 0),
          endpointRanking: [],
          anomalies: [],
          operations: [],
          errors: []
        };
        const ops = combined.totalOperations || 1;
        combined.successRate = Number(((combined.successCount / ops) * 100).toFixed(2));
        combined.healthStatus = combined.successRate >= 95 ? 'excellent' : combined.successRate >= 85 ? 'good' : combined.successRate >= 70 ? 'warning' : 'critical';
        // Merge operations and errors from all concurrent runs
        results.forEach(r => {
          if (Array.isArray(r.operations)) combined.operations = combined.operations.concat(r.operations);
          if (Array.isArray(r.errors)) combined.errors = combined.errors.concat(r.errors);
          if (Array.isArray(r.endpointRanking)) combined.endpointRanking = combined.endpointRanking.concat(r.endpointRanking);
          if (Array.isArray(r.anomalies)) combined.anomalies = combined.anomalies.concat(r.anomalies);
        });
      }

      const historyEntry = {
        id: simulationHistory.length + 1,
        timestamp: new Date().toISOString(),
        params,
        concurrency,
        summary: combined
      };
      simulationHistory.push(historyEntry);
      // Keep last 20
      if (simulationHistory.length > 20) simulationHistory = simulationHistory.slice(-20);

      return historyEntry;
    } catch (err) {
      console.error('[SIM] Error:', err.message);
      return null;
    } finally {
      // Remove finished workflows from active list
      activeWorkflows = activeWorkflows.filter(w => w && w.getStatus().running);
      if (activeWorkflows.length === 0) currentWorkflow = null;
    }
  };

  // Await completion so it's NOT in background — frontend gets full result when done
  const historyEntry = await runAll();

  // ─── Generar reporte PDF con usuarios/contraseñas y todas las acciones ───
  let pdfPath = null;
  try {
    // Recolectar perfiles y establecimientos de todos los workflows
    const allProfiles = [];
    const allEstablishments = [];
    workflows.forEach((wf) => {
      if (!wf) return;
      const reportData = wf.getReportData();
      if (reportData) {
        if (Array.isArray(reportData.profiles)) allProfiles.push(...reportData.profiles);
        if (Array.isArray(reportData.establishments)) allEstablishments.push(...reportData.establishments);
      }
    });

    pdfPath = generateSimulationPdf({
      summary: historyEntry?.summary || {},
      profiles: allProfiles,
      establishments: allEstablishments,
      params,
      concurrency
    });
    console.log('[SIM] 📄 Reporte PDF generado:', pdfPath);
  } catch (pdfErr) {
    console.error('[SIM] Error generando PDF:', pdfErr.message);
  }

  return res.json({
    ok: true,
    message: 'Simulation completed',
    params,
    concurrency,
    data: historyEntry,
    pdf: pdfPath ? { path: pdfPath, filename: path.basename(pdfPath) } : null
  });
});

// Descargar el último reporte PDF generado
app.get('/api/simulation/last-report', (_req, res) => {
  if (!fs.existsSync(REPORTS_DIR)) return res.status(404).json({ ok: false, error: 'No reports directory' });
  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.pdf')).sort();
  if (files.length === 0) return res.status(404).json({ ok: false, error: 'No PDF reports generated yet' });
  const latest = path.join(REPORTS_DIR, files[files.length - 1]);
  return res.download(latest);
});

// Listar reportes PDF generados
app.get('/api/simulation/reports', (_req, res) => {
  if (!fs.existsSync(REPORTS_DIR)) return res.json({ ok: true, data: [] });
  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.pdf')).sort().reverse();
  return res.json({ ok: true, data: files.map(f => ({ filename: f, path: path.join(REPORTS_DIR, f) })) });
});

// Pause simulation
app.post('/api/simulation/pause', (_req, res) => {
  activeWorkflows.forEach(w => { if (w) w.pause(); });
  return res.json({ ok: true, message: 'Simulation paused' });
});

// Resume simulation
app.post('/api/simulation/resume', (_req, res) => {
  activeWorkflows.forEach(w => { if (w) w.resume(); });
  return res.json({ ok: true, message: 'Simulation resumed' });
});

// Stop simulation
app.post('/api/simulation/stop', (_req, res) => {
  activeWorkflows.forEach(w => { if (w) w.stop(); });
  return res.json({ ok: true, message: 'Simulation stopped' });
});

// Get current status
app.get('/api/simulation/status', (_req, res) => {
  if (activeWorkflows.length === 0) return res.json({ ok: true, data: { running: false, idle: true } });
  return res.json({ ok: true, data: { ...getActiveStatus(), summary: getActiveSummary() } });
});

// Get simulation history
app.get('/api/simulation/history', (_req, res) => {
  return res.json({ ok: true, data: simulationHistory });
});

// ══════════════════════════════════════════════════════════════
// MODO MANTENIMIENTO / AUDITORÍA
// ══════════════════════════════════════════════════════════════

// Build timeline
app.post('/api/maintenance/timeline', async (req, res) => {
  if (!sb) return res.status(503).json({ ok: false, error: 'Supabase not connected' });
  try {
    const { dateFrom, dateTo, stepDays } = req.body || {};
    const from = dateFrom || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const to = dateTo || new Date().toISOString().slice(0, 10);
    const step = stepDays || 1;

    const result = await auditEngine.replayTimeline(from, to, step);
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Audit integrity
app.get('/api/maintenance/integrity', async (_req, res) => {
  if (!sb) return res.status(503).json({ ok: false, error: 'Supabase not connected' });
  try {
    const result = await auditEngine.auditIntegrity();
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Get raw timeline (without replay)
app.post('/api/maintenance/raw-timeline', async (req, res) => {
  if (!sb) return res.status(503).json({ ok: false, error: 'Supabase not connected' });
  try {
    const { dateFrom, dateTo } = req.body || {};
    const from = dateFrom || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const to = dateTo || new Date().toISOString().slice(0, 10);
    const result = await auditEngine.buildTimeline(from, to);
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// MODO AUDITORÍA DE ROLES
// ══════════════════════════════════════════════════════════════

// Run full role audit
app.post('/api/audit/roles/run', async (req, res) => {
  if (!sb) return res.status(503).json({ ok: false, error: 'Supabase not connected' });
  try {
    const { establishmentId, includeEndpointTests, includeScopeTests } = req.body || {};
    const options = {
      includeEndpointTests: includeEndpointTests !== false,
      includeScopeTests: includeScopeTests !== false
    };
    lastRoleAuditResult = await roleAuditEngine.runFullAudit(establishmentId || null, options);
    return res.json({ ok: true, data: lastRoleAuditResult });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Get last results
app.get('/api/audit/roles/results', (_req, res) => {
  if (!lastRoleAuditResult) return res.json({ ok: true, data: null });
  return res.json({ ok: true, data: lastRoleAuditResult });
});

// Run only endpoint tests
app.post('/api/audit/roles/endpoints', async (req, res) => {
  if (!sb) return res.status(503).json({ ok: false, error: 'Supabase not connected' });
  try {
    const { establishmentId } = req.body || {};
    const result = await roleAuditEngine.auditEndpointAccess(establishmentId || null);
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Run only scope tests
app.post('/api/audit/roles/scope', async (req, res) => {
  if (!sb) return res.status(503).json({ ok: false, error: 'Supabase not connected' });
  try {
    const { establishmentId } = req.body || {};
    const result = await roleAuditEngine.auditDataScope(establishmentId || null);
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Run only coverage tests
app.post('/api/audit/roles/coverage', async (_req, res) => {
  if (!sb) return res.status(503).json({ ok: false, error: 'Supabase not connected' });
  try {
    const result = await roleAuditEngine.auditRoleCoverage();
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Auto-repair missing roles (creates sensei/instructor/guardian/student as needed)
app.post('/api/audit/roles/repair', async (req, res) => {
  if (!sb) return res.status(503).json({ ok: false, error: 'Supabase not connected' });
  try {
    const { establishmentId } = req.body || {};
    const result = await roleAuditEngine.repairMissingRoles(establishmentId || null);
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// MODO LIMPIEZA
// ══════════════════════════════════════════════════════════════

// Get row counts
app.get('/api/cleanup/counts', async (_req, res) => {
  if (!sb) return res.status(503).json({ ok: false, error: 'Supabase not connected' });
  try {
    const counts = await cleanupEngine.getRowCounts();
    return res.json({ ok: true, data: counts });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Get available tables
app.get('/api/cleanup/tables', (_req, res) => {
  return res.json({ ok: true, data: CleanupEngine.getAvailableTables() });
});

// Dry run
app.post('/api/cleanup/dry-run', async (req, res) => {
  if (!sb) return res.status(503).json({ ok: false, error: 'Supabase not connected' });
  try {
    const result = await cleanupEngine.dryRun(req.body || {});
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Execute cleanup
app.post('/api/cleanup/execute', async (req, res) => {
  if (!sb) return res.status(503).json({ ok: false, error: 'Supabase not connected' });
  try {
    const log = await cleanupEngine.executeCleanup(req.body || {});
    return res.json({ ok: true, data: log });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// Full cleanup
app.post('/api/cleanup/full', async (_req, res) => {
  if (!sb) return res.status(503).json({ ok: false, error: 'Supabase not connected' });
  try {
    const log = await cleanupEngine.fullCleanup();
    return res.json({ ok: true, data: log });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════
// SNAPSHOTS
// ══════════════════════════════════════════════════════════════

app.get('/api/snapshots', (_req, res) => {
  if (!snapshotManager) return res.status(503).json({ ok: false, error: 'Snapshot manager not available' });
  const list = snapshotManager.listSnapshots();
  return res.json({ ok: true, data: list });
});

app.post('/api/snapshots', async (req, res) => {
  if (!snapshotManager) return res.status(503).json({ ok: false, error: 'Snapshot manager not available' });
  try {
    const { label } = req.body || {};
    const snapshot = await snapshotManager.createSnapshot(label);
    return res.json({ ok: true, data: snapshot });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/snapshots/:name/restore', async (req, res) => {
  if (!snapshotManager) return res.status(503).json({ ok: false, error: 'Snapshot manager not available' });
  try {
    const result = await snapshotManager.restoreSnapshot(req.params.name);
    return res.json({ ok: true, data: result });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.delete('/api/snapshots/:name', (req, res) => {
  if (!snapshotManager) return res.status(503).json({ ok: false, error: 'Snapshot manager not available' });
  const deleted = snapshotManager.deleteSnapshot(req.params.name);
  return res.json({ ok: true, deleted });
});

// ══════════════════════════════════════════════════════════════
// SYSTEM INFO
// ══════════════════════════════════════════════════════════════

app.get('/api/system/info', async (_req, res) => {
  const info = { supabaseConnected: !!sb, simulatorPort: PORT };
  if (sb) {
    try {
      const tables = ['establishments', 'profiles', 'students', 'student_enrollments', 'class_sessions', 'payments', 'student_evaluations'];
      const counts = {};
      for (const t of tables) {
        const { count } = await sb.from(t).select('*', { count: 'exact', head: true });
        counts[t] = count || 0;
      }
      info.tableCounts = counts;
    } catch (_) {}
  }
  return res.json({ ok: true, data: info });
});

// ─── Start server ───
app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   MartialSystem SIMULATOR - Dashboard            ║');
  console.log(`║   http://localhost:${PORT}                        ║`);
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});