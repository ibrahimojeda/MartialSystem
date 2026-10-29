// server/class-notification-worker.js
// Worker de la outbox de notificaciones de clases (Fase C, incremento 4).
// Usa RPCs atómicas para reclamar trabajos (FOR UPDATE SKIP LOCKED) y para
// finalizarlos (sent/failed) respetando el lease del worker.
const crypto = require('crypto');

const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [10, 30, 120, 600, 600];

function isUniqueViolation(err) {
  if (!err) return false;
  if (err.code === '23505') return true;
  return /duplicate key|unique constraint|already exists/i.test(String(err.message || ''));
}

async function markSent(db, id, workerId) {
  const { data, error } = await db.rpc('mark_class_notification_sent', { p_id: id, p_worker_id: workerId });
  if (error) return false;
  return data === true;
}

async function markFailed(db, id, workerId, errorMsg, nextAvailableAt) {
  const { data, error } = await db.rpc('mark_class_notification_failed', {
    p_id: id, p_worker_id: workerId, p_error: errorMsg, p_next_available_at: nextAvailableAt
  });
  if (error) return null;
  return data || null;
}

async function processOutboxBatch(db, workerId, batchSize = 20, leaseSeconds = 60) {
  const { data: jobs, error } = await db.rpc('claim_class_notification_outbox', {
    p_worker_id: workerId, p_limit: batchSize, p_lease_seconds: leaseSeconds
  });
  if (error) return { processed: 0, sent: 0, failed: 0, dead: 0, error: error.message };
  const rows = Array.isArray(jobs) ? jobs : [];
  let sent = 0, failed = 0, dead = 0;

  for (const job of rows) {
    try {
      const { error: nErr } = await db.from('notifications').insert({
        id: crypto.randomUUID(),
        establishment_id: job.establishment_id,
        recipient_profile_id: job.recipient_profile_id,
        title: job.title,
        body: job.body,
        is_read: false,
        class_notification_outbox_id: job.id
      });
      if (nErr) {
        if (isUniqueViolation(nErr)) {
          // La notificación ya existe para este job → éxito idempotente.
          if (await markSent(db, job.id, workerId)) sent += 1;
          continue;
        }
        throw new Error(nErr.message);
      }
      if (await markSent(db, job.id, workerId)) sent += 1;
    } catch (e) {
      const msg = String((e && e.message) || '').slice(0, 300);
      const backoffIdx = Math.min(job.attempts || 0, BACKOFF_SECONDS.length - 1);
      const nextAt = new Date(Date.now() + BACKOFF_SECONDS[backoffIdx] * 1000).toISOString();
      const newStatus = await markFailed(db, job.id, workerId, msg, nextAt);
      if (newStatus === 'dead') dead += 1;
      else if (newStatus === 'failed') failed += 1;
      // newStatus null → perdió el lease; otro worker lo posee ahora.
    }
  }
  return { processed: rows.length, sent, failed, dead };
}

function startWorker(db, opts = {}) {
  const workerId = opts.workerId || ('worker_' + crypto.randomBytes(6).toString('hex'));
  const intervalMs = opts.intervalMs || 5000;
  const batchSize = opts.batchSize || 20;
  const leaseSeconds = opts.leaseSeconds || 60;
  let running = false;
  let timer = null;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const r = await processOutboxBatch(db, workerId, batchSize, leaseSeconds);
      if (opts.onResult) opts.onResult(r);
    } catch (_) { /* no romper el loop */ }
    running = false;
  }

  timer = setInterval(tick, intervalMs);
  if (timer && timer.unref) timer.unref();
  return { stop: () => { if (timer) clearInterval(timer); timer = null; }, workerId, tick };
}

module.exports = { processOutboxBatch, startWorker, markSent, markFailed, isUniqueViolation, MAX_ATTEMPTS };
