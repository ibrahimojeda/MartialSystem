// tests/class-notifications.test.js — Fase C incremento 2: PATCH de clases + notificaciones idempotentes.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

let app, baseUrl, server, supabaseMock;

function req(method, path, token, body) {
  return fetch(baseUrl + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
}

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.SUPERADMIN_USERNAME = 'venta';
  process.env.SUPERADMIN_PASSWORD = 'test-superadmin-password';
  process.env.SUPABASE_URL = 'https://mock.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'mock-anon';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service';

  const { createSupabaseMock } = require('./helpers/supabase-mock');
  supabaseMock = createSupabaseMock();
  supabaseMock.setToken('tok_owner_1', { id: 'owner-1', email: null, role: 'owner', user_metadata: {} });
  supabaseMock.setToken('tok_instructor_1', { id: 'instructor-1', email: null, role: 'instructor', user_metadata: {} });
  supabaseMock.setToken('tok_instructor_2', { id: 'instructor-2', email: null, role: 'instructor', user_metadata: {} });
  supabaseMock._tables.profiles.push(
    { id: 'superadmin-1', username: 'sa1', role: 'superadmin', full_name: 'SA', is_active: true, auth_email: 'sa1@users.martialsystem.local' },
    { id: 'student-1', username: 'stu1', role: 'student', full_name: 'Estudiante 1', is_active: true, auth_email: 'st1@x.invalid' },
    { id: 'guardian-1', username: 'guard1', role: 'guardian', full_name: 'Tutor 1', is_active: true, auth_email: 'g1@x.invalid' }
  );
  supabaseMock.setToken('tok_superadmin', { id: 'superadmin-1', email: null, role: 'superadmin', user_metadata: {} });
  supabaseMock._tables.establishment_members.push(
    { id: 'm-student', establishment_id: 'est-1', profile_id: 'student-1', role: 'student', created_at: '2026-01-01' },
    { id: 'm-guardian', establishment_id: 'est-1', profile_id: 'guardian-1', role: 'guardian', created_at: '2026-01-01' }
  );
  supabaseMock.setToken('tok_student_1', { id: 'student-1', email: null, role: 'student', user_metadata: {} });
  supabaseMock.setToken('tok_guardian_1', { id: 'guardian-1', email: null, role: 'guardian', user_metadata: {} });

  const stu = supabaseMock._tables.students.find((s) => s.id === 'stu-1');
  if (stu) stu.profile_id = 'student-1';
  supabaseMock._tables.guardian_students.push({ id: 'gs-1', establishment_id: 'est-1', guardian_profile_id: 'guardian-1', student_id: 'stu-1', relationship: 'tutor' });
  supabaseMock._tables.student_enrollments.push({ id: 'e-karate', student_id: 'stu-1', discipline_id: 'disc-karate', current_rank: 'Blanco', status: 'active', instructor_profile_id: 'instructor-1' });

  supabaseMock._tables.class_sessions = [
    { id: 'cls-1', establishment_id: 'est-1', discipline_id: 'disc-karate', instructor_profile_id: 'instructor-1', title: 'Karate', scheduled_date: '2026-10-20', start_time: '10:00', end_time: '11:00', location: 'Sala 1', notes: null, status: 'scheduled', created_at: '2026-01-01', updated_at: '2026-01-01' }
  ];

  globalThis.__TEST_SUPABASE_ADMIN__ = supabaseMock;
  globalThis.__TEST_SUPABASE_PUBLIC__ = supabaseMock;
  ({ app } = require('../server/index.js'));
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = 'http://localhost:' + server.address().port; resolve(); }); });
});

after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(() => { supabaseMock.writes.length = 0; supabaseMock.clearErrors(); });

test('owner reprograma clase y encola notificaciones en la outbox', async () => {
  const res = await req('PATCH', '/api/classes/cls-1', 'tok_owner_1', { scheduledDate: '2026-10-25' });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.scheduled_date, '2026-10-25');
  assert.equal(json.data.notification_status, 'queued');
  assert.ok(json.data.notifications_queued >= 3);
  // Aún no se crearon notificaciones (el worker no corrió).
  assert.equal(supabaseMock._tables.notifications.length, 0);
  const recip = supabaseMock._tables.class_notification_outbox.map((n) => n.recipient_profile_id).sort();
  assert.ok(recip.includes('student-1'));
  assert.ok(recip.includes('guardian-1'));
  assert.ok(recip.includes('instructor-1'));
});

test('owner cancela clase (status cancelled)', async () => {
  const res = await req('PATCH', '/api/classes/cls-1', 'tok_owner_1', { status: 'cancelled' });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.status, 'cancelled');
});

test('instructor modifica su propia clase', async () => {
  const res = await req('PATCH', '/api/classes/cls-1', 'tok_instructor_1', { location: 'Sala 2' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.location, 'Sala 2');
});

test('instructor no modifica clase ajena (403)', async () => {
  supabaseMock._tables.class_sessions.push({ id: 'cls-otra', establishment_id: 'est-1', discipline_id: 'disc-karate', instructor_profile_id: 'instructor-2', title: 'Otra', scheduled_date: '2026-10-21', start_time: '10:00', end_time: null, location: null, notes: null, status: 'scheduled', created_at: '2026-01-01', updated_at: '2026-01-01' });
  const res = await req('PATCH', '/api/classes/cls-otra', 'tok_instructor_1', { location: 'X' });
  assert.equal(res.status, 403);
});

test('student/guardian no pueden PATCH (403)', async () => {
  assert.equal((await req('PATCH', '/api/classes/cls-1', 'tok_student_1', { location: 'X' })).status, 403);
  assert.equal((await req('PATCH', '/api/classes/cls-1', 'tok_guardian_1', { location: 'X' })).status, 403);
});

test('instructor de otro establecimiento rechazado (403)', async () => {
  supabaseMock._tables.class_sessions.push({ id: 'cls-est2', establishment_id: 'est-2', discipline_id: 'disc-bjj', instructor_profile_id: 'instructor-2', title: 'BJJ', scheduled_date: '2026-10-21', start_time: '10:00', end_time: null, location: null, notes: null, status: 'scheduled', created_at: '2026-01-01', updated_at: '2026-01-01' });
  const res = await req('PATCH', '/api/classes/cls-est2', 'tok_instructor_1', { location: 'X' });
  assert.equal(res.status, 403);
});

test('instructor no pertenece al establecimiento (400)', async () => {
  const res = await req('PATCH', '/api/classes/cls-1', 'tok_owner_1', { instructorProfileId: 'instructor-2' });
  assert.equal(res.status, 400);
});

test('fecha inválida (400)', async () => {
  const res = await req('PATCH', '/api/classes/cls-1', 'tok_owner_1', { scheduledDate: 'no-es-fecha' });
  assert.equal(res.status, 400);
});

test('PATCH de clase inexistente devuelve 404 (no 200 + data=null)', async () => {
  const res = await req('PATCH', '/api/classes/no-existe', 'tok_owner_1', { location: 'X' });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).ok, false);
});

test('repetir el mismo PATCH no duplica trabajos en outbox', async () => {
  await req('PATCH', '/api/classes/cls-1', 'tok_owner_1', { scheduledDate: '2026-10-26' });
  const before = supabaseMock._tables.class_notification_outbox.length;
  const res2 = await req('PATCH', '/api/classes/cls-1', 'tok_owner_1', { scheduledDate: '2026-10-26' });
  const json2 = await res2.json();
  assert.equal(json2.data.changed, false);
  assert.equal(json2.data.notifications_queued, 0);
  assert.equal(supabaseMock._tables.class_notification_outbox.length, before);
});

test('error al encolar en la outbox devuelve 500', async () => {
  supabaseMock.setError('class_notification_outbox', 'boom');
  const res = await req('PATCH', '/api/classes/cls-1', 'tok_owner_1', { location: 'Sala 3' });
  assert.equal(res.status, 500);
  assert.equal((await res.json()).ok, false);
});

test('lecturas del calendario no escriben (sigue solo lectura)', async () => {
  supabaseMock.writes.length = 0;
  await req('GET', '/api/calendar/events?establishmentId=est-1', 'tok_owner_1');
  assert.equal(supabaseMock.writes.length, 0);
});

test('worker procesa la outbox y crea notificaciones idempotentes', async () => {
  supabaseMock._tables.class_notification_outbox.length = 0;
  supabaseMock._tables.class_notification_outbox.push({ id: 'ob-1', class_id: 'cls-1', establishment_id: 'est-1', event_type: 'class_rescheduled', recipient_profile_id: 'student-1', version: 'v1', title: 'Clase actualizada', body: 'Hola', status: 'pending', attempts: 0, available_at: '2020-01-01T00:00:00.000Z' });
  const classWorker = require('../server/class-notification-worker');
  const r = await classWorker.processOutboxBatch(supabaseMock, 'test-worker', 100);
  assert.ok(r.sent >= 1);
  const notif = supabaseMock._tables.notifications.find((n) => n.class_notification_outbox_id === 'ob-1');
  assert.ok(notif, 'debe crear la notificación vinculada al outbox');
  const job = supabaseMock._tables.class_notification_outbox.find((o) => o.id === 'ob-1');
  assert.equal(job.status, 'sent');
});

test('worker no reintenta trabajos ya enviados (idempotencia real)', async () => {
  supabaseMock._tables.class_notification_outbox.length = 0;
  supabaseMock._tables.notifications.length = 0;
  supabaseMock._tables.class_notification_outbox.push({ id: 'ob-idem', class_id: 'cls-1', establishment_id: 'est-1', event_type: 'class_rescheduled', recipient_profile_id: 'student-1', version: 'v1', title: 'T', body: 'B', status: 'pending', attempts: 0, available_at: '2020-01-01T00:00:00.000Z' });
  const classWorker = require('../server/class-notification-worker');
  const r1 = await classWorker.processOutboxBatch(supabaseMock, 'w', 100);
  assert.equal(r1.sent, 1);
  assert.equal(supabaseMock._tables.notifications.filter((n) => n.class_notification_outbox_id === 'ob-idem').length, 1);
  const r2 = await classWorker.processOutboxBatch(supabaseMock, 'w', 100);
  assert.equal(r2.sent, 0);
  assert.equal(supabaseMock._tables.notifications.filter((n) => n.class_notification_outbox_id === 'ob-idem').length, 1);
});

test('worker reintenta con backoff y marca failed si falla la inserción', async () => {
  supabaseMock._tables.class_notification_outbox.length = 0;
  supabaseMock._tables.class_notification_outbox.push({ id: 'ob-retry', class_id: 'cls-1', establishment_id: 'est-1', event_type: 'class_rescheduled', recipient_profile_id: 'student-1', version: 'v1', title: 'T', body: 'B', status: 'pending', attempts: 0, available_at: '2020-01-01T00:00:00.000Z' });
  supabaseMock.setError('notifications', 'boom');
  const classWorker = require('../server/class-notification-worker');
  const r = await classWorker.processOutboxBatch(supabaseMock, 'w-retry', 100);
  assert.equal(r.failed, 1);
  assert.equal(r.dead, 0);
  const job = supabaseMock._tables.class_notification_outbox.find((o) => o.id === 'ob-retry');
  assert.equal(job.status, 'failed');
  assert.equal(job.attempts, 1);
  assert.equal(job.locked_by, null);
  assert.equal(job.locked_at, null);
  assert.ok(job.available_at > '2020-01-01T00:00:00.000Z');
  assert.ok(job.last_error);
});

test('worker pasa a dead tras agotar reintentos', async () => {
  supabaseMock._tables.class_notification_outbox.length = 0;
  supabaseMock._tables.class_notification_outbox.push({ id: 'ob-dead', class_id: 'cls-1', establishment_id: 'est-1', event_type: 'class_rescheduled', recipient_profile_id: 'student-1', version: 'v1', title: 'T', body: 'B', status: 'pending', attempts: 4, available_at: '2020-01-01T00:00:00.000Z' });
  supabaseMock.setError('notifications', 'boom');
  const classWorker = require('../server/class-notification-worker');
  const r = await classWorker.processOutboxBatch(supabaseMock, 'w', 100);
  assert.equal(r.dead, 1);
  assert.equal(r.failed, 0);
  const job = supabaseMock._tables.class_notification_outbox.find((o) => o.id === 'ob-dead');
  assert.equal(job.status, 'dead');
  assert.equal(job.attempts, 5);
  assert.equal(job.locked_by, null);
  assert.ok(job.last_error);
});

test('GET notifications superadmin no usa UUID lógico (sin error)', async () => {
  supabaseMock._tables.notifications.push({ id: 'n-1', establishment_id: 'est-1', recipient_profile_id: null, audience_role: 'all', title: 'T', body: 'B', is_read: false });
  const res = await req('GET', '/api/notifications?establishmentId=est-1', 'tok_superadmin');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(Array.isArray(json.data));
  assert.ok(json.data.some((n) => n.id === 'n-1'));
});

console.log('Suite class-notifications: ejecutada con node:test');
