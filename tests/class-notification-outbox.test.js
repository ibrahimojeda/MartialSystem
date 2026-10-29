// tests/class-notification-outbox.test.js — Contrato de las RPCs de outbox (Fase C, incremento 4).
// Unit tests con el mock: atomicidad del update+enqueue (rollback), claim, lease,
// finalización segura, idempotencia por unique violation y tenancy.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { createSupabaseMock } = require('./helpers/supabase-mock');
const worker = require('../server/class-notification-worker');

let mock;

beforeEach(() => {
  mock = createSupabaseMock();
});

function seedOutboxRow(overrides = {}) {
  const row = Object.assign({
    id: 'ob-1', class_id: 'cls-1', establishment_id: 'est-1', event_type: 'class_rescheduled',
    recipient_profile_id: 'student-1', version: 'v1', title: 'T', body: 'B',
    status: 'pending', attempts: 0, available_at: '2020-01-01T00:00:00.000Z',
    created_at: '2020-01-01T00:00:00.000Z'
  }, overrides);
  mock._tables.class_notification_outbox.push(row);
  return row;
}

test('update RPC actualiza la clase y encola en la outbox (E.1)', async () => {
  const { data, error } = await mock.rpc('update_class_and_enqueue_notifications', {
    p_class_id: 'cls-1', p_updates: { location: 'Sala 2' }, p_version: 'v1',
    p_jobs: [{ event_type: 'class_location_changed', recipient_profile_id: 'student-1', title: 'T', body: 'B' }]
  });
  assert.equal(error, null);
  assert.equal(data.location, 'Sala 2');
  assert.equal(data.notifications_queued, 1);
  assert.equal(mock._tables.class_sessions.find((c) => c.id === 'cls-1').location, 'Sala 2');
  assert.equal(mock._tables.class_notification_outbox.length, 1);
  assert.equal(mock._tables.class_notification_outbox[0].establishment_id, 'est-1');
});

test('update RPC hace rollback si falla el insert de outbox (E.2/E.3)', async () => {
  const cls = mock._tables.class_sessions.find((c) => c.id === 'cls-1');
  const before = { ...cls };
  mock.setError('class_notification_outbox', 'boom');
  const { data, error } = await mock.rpc('update_class_and_enqueue_notifications', {
    p_class_id: 'cls-1', p_updates: { location: 'Sala 9' }, p_version: 'v1',
    p_jobs: [{ event_type: 'class_location_changed', recipient_profile_id: 'student-1', title: 'T', body: 'B' }]
  });
  assert.ok(error);
  assert.equal(data, null);
  assert.equal(cls.location, before.location, 'la clase no debe quedar modificada');
  assert.equal(mock._tables.class_notification_outbox.length, 0);
});

test('RPC devuelve error y no data para clase inexistente (E.15)', async () => {
  const { data, error } = await mock.rpc('update_class_and_enqueue_notifications', {
    p_class_id: 'no-existe', p_updates: { location: 'X' }, p_version: 'v1', p_jobs: []
  });
  assert.ok(error);
  assert.equal(data, null);
});

test('tenancy no se amplía por payload (E.14)', async () => {
  mock._tables.class_sessions.push({
    id: 'cls-est2', establishment_id: 'est-2', discipline_id: 'disc-bjj', instructor_profile_id: 'instructor-2',
    title: 'BJJ', scheduled_date: '2026-10-21', start_time: '10:00', end_time: null, location: null,
    notes: null, status: 'scheduled', created_at: '2026-01-01', updated_at: '2026-01-01'
  });
  const { data } = await mock.rpc('update_class_and_enqueue_notifications', {
    p_class_id: 'cls-est2', p_updates: { location: 'X', establishment_id: 'est-1' }, p_version: 'v1',
    p_jobs: [{ event_type: 'class_location_changed', recipient_profile_id: 'student-1', title: 'T', body: 'B' }]
  });
  assert.equal(data.establishment_id, 'est-2', 'usa el establishment_id de la clase, no el del payload');
  const out = mock._tables.class_notification_outbox.find((o) => o.class_id === 'cls-est2');
  assert.ok(out);
  assert.equal(out.establishment_id, 'est-2');
});

test('claim no entrega el mismo job a dos workers (E.4)', async () => {
  seedOutboxRow();
  const a = await mock.rpc('claim_class_notification_outbox', { p_worker_id: 'w1', p_limit: 10, p_lease_seconds: 60 });
  assert.equal(a.data.length, 1);
  const b = await mock.rpc('claim_class_notification_outbox', { p_worker_id: 'w2', p_limit: 10, p_lease_seconds: 60 });
  assert.equal(b.data.length, 0, 'el segundo worker no recibe el job ya reclamado');
});

test('claim recupera lease expirado (E.5)', async () => {
  seedOutboxRow({ status: 'processing', locked_by: 'w1', locked_at: '2020-01-01T00:00:00.000Z' });
  const b = await mock.rpc('claim_class_notification_outbox', { p_worker_id: 'w2', p_limit: 10, p_lease_seconds: 60 });
  assert.equal(b.data.length, 1);
  assert.equal(b.data[0].locked_by, 'w2');
});

test('claim no reclama failed con available_at futuro', async () => {
  seedOutboxRow({ status: 'failed', available_at: '2099-01-01T00:00:00.000Z' });
  const r = await mock.rpc('claim_class_notification_outbox', { p_worker_id: 'w1', p_limit: 10, p_lease_seconds: 60 });
  assert.equal(r.data.length, 0);
});

test('worker sin lease no puede marcar sent (E.6)', async () => {
  seedOutboxRow({ status: 'processing', locked_by: 'w1', locked_at: '2020-01-01T00:00:00.000Z' });
  await mock.rpc('claim_class_notification_outbox', { p_worker_id: 'w2', p_limit: 10, p_lease_seconds: 60 });
  const sentByW1 = await mock.rpc('mark_class_notification_sent', { p_id: 'ob-1', p_worker_id: 'w1' });
  assert.equal(sentByW1.data, false, 'w1 perdió el lease y no puede marcar sent');
});

test('worker dueño puede marcar sent (E.7)', async () => {
  seedOutboxRow();
  await mock.rpc('claim_class_notification_outbox', { p_worker_id: 'w1', p_limit: 10, p_lease_seconds: 60 });
  const r = await mock.rpc('mark_class_notification_sent', { p_id: 'ob-1', p_worker_id: 'w1' });
  assert.equal(r.data, true);
  assert.equal(mock._tables.class_notification_outbox[0].status, 'sent');
  assert.equal(mock._tables.class_notification_outbox[0].locked_by, null);
});

test('mark_failed conserva attempts y libera locks (E.8)', async () => {
  seedOutboxRow({ status: 'processing', locked_by: 'w1', locked_at: '2020-01-02T00:00:00.000Z', attempts: 1 });
  const r = await mock.rpc('mark_class_notification_failed', {
    p_id: 'ob-1', p_worker_id: 'w1', p_error: 'x', p_next_available_at: '2099-01-01T00:00:00.000Z'
  });
  assert.equal(r.data, 'failed');
  const job = mock._tables.class_notification_outbox[0];
  assert.equal(job.attempts, 2);
  assert.equal(job.locked_by, null);
  assert.equal(job.locked_at, null);
  assert.equal(job.available_at, '2099-01-01T00:00:00.000Z');
  assert.equal(job.last_error, 'x');
});

test('mark_failed pasa a dead tras max_attempts (E.9)', async () => {
  seedOutboxRow({ status: 'processing', locked_by: 'w1', locked_at: '2020-01-02T00:00:00.000Z', attempts: 4 });
  const r = await mock.rpc('mark_class_notification_failed', {
    p_id: 'ob-1', p_worker_id: 'w1', p_error: 'x', p_next_available_at: '2099-01-01T00:00:00.000Z'
  });
  assert.equal(r.data, 'dead');
  const job = mock._tables.class_notification_outbox[0];
  assert.equal(job.status, 'dead');
  assert.equal(job.attempts, 5);
  assert.equal(job.locked_by, null);
});

test('worker trata unique violation de notification como éxito idempotente (E.10)', async () => {
  seedOutboxRow();
  mock._tables.notifications.push({
    id: 'n-existing', establishment_id: 'est-1', recipient_profile_id: 'student-1',
    title: 'T', body: 'B', is_read: false, class_notification_outbox_id: 'ob-1'
  });
  const r = await worker.processOutboxBatch(mock, 'w1', 10, 60);
  assert.equal(r.sent, 1);
  assert.equal(r.failed, 0);
  assert.equal(mock._tables.class_notification_outbox[0].status, 'sent');
  assert.equal(mock._tables.notifications.length, 1, 'no se duplica la notificación');
});

test('worker reclamado por RPC cuenta sent/failed/dead correctamente', async () => {
  seedOutboxRow({ id: 'ob-ok' });
  seedOutboxRow({ id: 'ob-bad', recipient_profile_id: 'guardian-1' });
  mock.setError('notifications', 'boom');
  const r = await worker.processOutboxBatch(mock, 'w1', 10, 60);
  assert.equal(r.sent, 0);
  assert.equal(r.failed, 2);
  assert.equal(r.dead, 0);
  assert.equal(r.processed, 2);
});

