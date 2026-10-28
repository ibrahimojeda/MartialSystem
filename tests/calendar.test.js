// tests/calendar.test.js — Calendario por rol (Fase C, solo lectura).
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

let app, baseUrl, server, supabaseMock;

function req(path, token) {
  return fetch(baseUrl + path, { method: 'GET', headers: token ? { Authorization: 'Bearer ' + token } : {} });
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

  supabaseMock._tables.class_sessions = [
    { id: 'cls-1', establishment_id: 'est-1', discipline_id: 'disc-karate', instructor_profile_id: 'instructor-1', title: 'Karate A', scheduled_date: '2026-10-20', start_time: '10:00', end_time: '11:00', location: 'Sala 1', notes: null, status: 'scheduled', created_at: '2026-01-01' },
    { id: 'cls-2', establishment_id: 'est-1', discipline_id: 'disc-karate', instructor_profile_id: 'instructor-1', title: 'Karate B', scheduled_date: '2026-10-21', start_time: '10:00', end_time: '11:00', location: 'Sala 1', notes: null, status: 'cancelled', created_at: '2026-01-01' },
    { id: 'cls-3', establishment_id: 'est-2', discipline_id: 'disc-bjj', instructor_profile_id: 'instructor-2', title: 'BJJ A', scheduled_date: '2026-10-20', start_time: '10:00', end_time: '11:00', location: 'Sala 2', notes: null, status: 'scheduled', created_at: '2026-01-01' },
    { id: 'cls-4', establishment_id: 'est-1', discipline_id: 'disc-bjj', instructor_profile_id: 'instructor-1', title: 'BJJ B', scheduled_date: '2026-10-22', start_time: '10:00', end_time: '11:00', location: 'Sala 1', notes: null, status: 'scheduled', created_at: '2026-01-01' }
  ];

  globalThis.__TEST_SUPABASE_ADMIN__ = supabaseMock;
  globalThis.__TEST_SUPABASE_PUBLIC__ = supabaseMock;
  ({ app } = require('../server/index.js'));
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = 'http://localhost:' + server.address().port; resolve(); }); });
});

after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(() => { supabaseMock.writes.length = 0; supabaseMock.clearErrors(); });

function ids(res) { return (res.data && res.data.events || []).map((e) => e.id).sort(); }

test('superadmin global ve todas las clases de todos los dojos', async () => {
  const res = await req('/api/calendar/events', 'tok_superadmin');
  assert.deepEqual(ids(await res.json()), ['cls-1', 'cls-2', 'cls-3', 'cls-4']);
});

test('superadmin filtra por establecimiento', async () => {
  const res = await req('/api/calendar/events?establishmentId=est-1', 'tok_superadmin');
  assert.deepEqual(ids(await res.json()), ['cls-1', 'cls-2', 'cls-4']);
});

test('owner solo ve su establecimiento', async () => {
  const res = await req('/api/calendar/events?establishmentId=est-1', 'tok_owner_1');
  assert.deepEqual(ids(await res.json()), ['cls-1', 'cls-2', 'cls-4']);
});

test('instructor ve solo sus clases asignadas', async () => {
  const res = await req('/api/calendar/events?establishmentId=est-1', 'tok_instructor_1');
  assert.deepEqual(ids(await res.json()), ['cls-1', 'cls-2', 'cls-4']);
});

test('instructor de otro dojo ve solo sus clases', async () => {
  const res = await req('/api/calendar/events?establishmentId=est-2', 'tok_instructor_2');
  assert.deepEqual(ids(await res.json()), ['cls-3']);
});

test('student ve solo las disciplinas de sus inscripciones activas', async () => {
  const res = await req('/api/calendar/events?establishmentId=est-1', 'tok_student_1');
  assert.deepEqual(ids(await res.json()), ['cls-1', 'cls-2']);
});

test('guardian ve las disciplinas de su alumno vinculado', async () => {
  const res = await req('/api/calendar/events?establishmentId=est-1', 'tok_guardian_1');
  assert.deepEqual(ids(await res.json()), ['cls-1', 'cls-2']);
});

test('filtro por estado', async () => {
  const res = await req('/api/calendar/events?establishmentId=est-1&status=cancelled', 'tok_owner_1');
  assert.deepEqual(ids(await res.json()), ['cls-2']);
});

test('filtro por rango de fechas', async () => {
  const res = await req('/api/calendar/events?establishmentId=est-1&from=2026-10-21&to=2026-10-22', 'tok_owner_1');
  assert.deepEqual(ids(await res.json()), ['cls-2', 'cls-4']);
});

test('lecturas del calendario no escriben', async () => {
  supabaseMock.writes.length = 0;
  await req('/api/calendar/events?establishmentId=est-1', 'tok_owner_1');
  await req('/api/calendar/events', 'tok_superadmin');
  assert.equal(supabaseMock.writes.length, 0);
});

console.log('Suite calendar: ejecutada con node:test');
