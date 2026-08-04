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
let globalTracker = new ErrorTracker();
let simulationHistory = [];

const snapshotManager = sb ? new SnapshotManager(sb) : null;
const cleanupEngine = sb ? new CleanupEngine(sb, snapshotManager) : null;
const auditEngine = sb ? new AuditEngine(sb) : null;

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

  const interval = setInterval(() => {
    if (currentWorkflow) {
      const status = currentWorkflow.getStatus();
      const summary = currentWorkflow.getSummary();
      res.write(`data: ${JSON.stringify({ status, summary })}\n\n`);
    }
  }, 500);

  req.on('close', () => { clearInterval(interval); });
});

// Start simulation
app.post('/api/simulation/start', async (req, res) => {
  if (currentWorkflow && currentWorkflow.getStatus().running) {
    return res.status(409).json({ ok: false, error: 'Simulation already running' });
  }

  const params = req.body || {};
  const concurrency = params.concurrency || 1;

  currentWorkflow = new WorkflowEngine(sb, {
    chaosRate: params.chaosRate || 0,
    speed: params.speed || 'normal',
    onProgress: (event) => {
      // Events are captured via SSE polling
    }
  });

  // Run simulation in background
  const run = async () => {
    try {
      const summary = await currentWorkflow.runSimulation(params);
      simulationHistory.push({
        id: simulationHistory.length + 1,
        timestamp: new Date().toISOString(),
        params,
        summary
      });
      // Keep last 20
      if (simulationHistory.length > 20) simulationHistory = simulationHistory.slice(-20);
    } catch (err) {
      console.error('[SIM] Error:', err.message);
    }
  };

  // If concurrency > 1, run multiple in parallel
  if (concurrency > 1) {
    const promises = [];
    for (let i = 0; i < Math.min(concurrency, 10); i++) {
      const wf = new WorkflowEngine(sb, {
        chaosRate: params.chaosRate || 0,
        speed: 'fast',
        onProgress: () => {}
      });
      promises.push(wf.runSimulation(params));
    }
    Promise.all(promises).then(results => {
      simulationHistory.push({
        id: simulationHistory.length + 1,
        timestamp: new Date().toISOString(),
        params,
        concurrency,
        summary: { concurrentResults: results.map(r => ({ totalOperations: r.totalOperations, errorCount: r.errorCount, successRate: r.successRate })) }
      });
    });
  } else {
    run();
  }

  return res.json({ ok: true, message: 'Simulation started', params });
});

// Pause simulation
app.post('/api/simulation/pause', (_req, res) => {
  if (currentWorkflow) { currentWorkflow.pause(); }
  return res.json({ ok: true, message: 'Simulation paused' });
});

// Resume simulation
app.post('/api/simulation/resume', (_req, res) => {
  if (currentWorkflow) { currentWorkflow.resume(); }
  return res.json({ ok: true, message: 'Simulation resumed' });
});

// Stop simulation
app.post('/api/simulation/stop', (_req, res) => {
  if (currentWorkflow) { currentWorkflow.stop(); }
  return res.json({ ok: true, message: 'Simulation stopped' });
});

// Get current status
app.get('/api/simulation/status', (_req, res) => {
  if (!currentWorkflow) return res.json({ ok: true, data: { running: false, idle: true } });
  return res.json({ ok: true, data: { ...currentWorkflow.getStatus(), summary: currentWorkflow.getSummary() } });
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