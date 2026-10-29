// server/class-notification-worker.js
// Worker de la outbox de notificaciones de clases (Fase C, incremento 3).
// Procesa trabajos pendientes/failed, crea notificaciones idempotentes y reintenta.
const crypto = require('crypto');

const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [10, 30, 120, 600, 600];

async function processOutboxBatch(db, workerId, batchSize = 20) {
  const now = new Date().toISOString();
  const { data: jobs, error } = await db.from('class_notification_outbox')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lte('available_at', now)
    .order('created_at', { ascending: true })
    .limit(batchSize);
  if (error) return { processed: 0, sent: 0, failed: 0, dead: 0, error: error.message };
  const rows = jobs || [];
  let sent = 0, failed = 0, dead = 0;

  for (const job of rows) {
    await db.from('class_notification_outbox').update({ status: 'processing', locked_at: now, locked_by: workerId }).eq('id', job.id);
    try {
      const notifId = crypto.randomUUID();
      const { error: nErr } = await db.from('notifications').insert({
        id: notifId, establishment_id: job.establishment_id, recipient_profile_id: job.recipient_profile_id,
        title: job.title, body: job.body, is_read: false, class_notification_outbox_id: job.id
      });
      if (nErr) throw new Error(nErr.message);
      await db.from('class_notification_outbox').update({ status: 'sent', sent_at: now, locked_at: null, locked_by: null }).eq('id', job.id);
      sent += 1;
    } catch (e) {
      const attempts = (job.attempts || 0) + 1;
      const msg = String(e.message || '').slice(0, 300);
      if (attempts >= MAX_ATTEMPTS) {
        await db.from('class_notification_outbox').update({ status: 'dead', attempts, last_error: msg, locked_at: null, locked_by: null }).eq('id', job.id);
        dead += 1;
      } else {
        const backoff = BACKOFF_SECONDS[attempts - 1] || 600;
        const availableAt = new Date(Date.now() + backoff * 1000).toISOString();
        await db.from('class_notification_outbox').update({ status: 'failed', attempts, last_error: msg, available_at: availableAt, locked_at: null, locked_by: null }).eq('id', job.id);
        failed += 1;
      }
    }
  }
  return { processed: rows.length, sent, failed, dead };
}

function startWorker(db, opts = {}) {
  const workerId = opts.workerId || ('worker_' + crypto.randomBytes(6).toString('hex'));
  const intervalMs = opts.intervalMs || 5000;
  const batchSize = opts.batchSize || 20;
  let running = false;
  let timer = null;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const r = await processOutboxBatch(db, workerId, batchSize);
      if (opts.onResult) opts.onResult(r);
    } catch (_) { /* no romper el loop */ }
    running = false;
  }

  timer = setInterval(tick, intervalMs);
  if (timer && timer.unref) timer.unref();
  return { stop: () => { if (timer) clearInterval(timer); timer = null; }, workerId, tick };
}

module.exports = { processOutboxBatch, startWorker, MAX_ATTEMPTS };
