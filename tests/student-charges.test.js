// tests/student-charges.test.js — Pruebas E2E del módulo de cargos/cuotas por alumno.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

let app, baseUrl, server, supabaseMock;

function iso(daysOffset) {
  const d = new Date(Date.now() + daysOffset * 86400000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

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
  supabaseMock._tables.profiles.push({ id: 'superadmin-1', username: 'sa1', role: 'superadmin', full_name: 'SA', is_active: true, auth_email: 'sa1@users.martialsystem.local' });
  supabaseMock.setToken('tok_superadmin', { id: 'superadmin-1', email: null, role: 'superadmin', user_metadata: {} });
  supabaseMock._tables.profiles.push(
    { id: 'sensei-1', username: 'sensei1', role: 'sensei', full_name: 'Sensei 1', is_active: true, auth_email: 's1@x.invalid' },
    { id: 'student-1', username: 'stu1', role: 'student', full_name: 'Estudiante 1', is_active: true, auth_email: 'st1@x.invalid' },
    { id: 'guardian-1', username: 'guard1', role: 'guardian', full_name: 'Tutor 1', is_active: true, auth_email: 'g1@x.invalid' }
  );
  supabaseMock._tables.establishment_members.push(
    { id: 'm-sensei', establishment_id: 'est-1', profile_id: 'sensei-1', role: 'sensei', created_at: '2026-01-01' },
    { id: 'm-student', establishment_id: 'est-1', profile_id: 'student-1', role: 'student', created_at: '2026-01-01' },
    { id: 'm-guardian', establishment_id: 'est-1', profile_id: 'guardian-1', role: 'guardian', created_at: '2026-01-01' }
  );
  supabaseMock.setToken('tok_sensei_1', { id: 'sensei-1', email: null, role: 'sensei', user_metadata: {} });
  supabaseMock.setToken('tok_student_1', { id: 'student-1', email: null, role: 'student', user_metadata: {} });
  supabaseMock.setToken('tok_guardian_1', { id: 'guardian-1', email: null, role: 'guardian', user_metadata: {} });

  supabaseMock._tables.students.push({ id: 'stu-3', establishment_id: 'est-1', full_name: 'Alumno Estudiante', email: 's3@x.invalid', phone: '333', profile_id: 'student-1', birth_date: null, created_at: '2026-01-01', discipline_code: null });
  supabaseMock._tables.student_enrollments.push(
    { id: 'e-i1', student_id: 'stu-1', discipline_id: 'disc-karate', current_rank: 'Blanco', status: 'active', instructor_profile_id: 'instructor-1' },
    { id: 'e-s1', student_id: 'stu-1', discipline_id: 'disc-karate', current_rank: 'Blanco', status: 'active', instructor_profile_id: 'sensei-1' }
  );
  supabaseMock._tables.guardian_students.push({ id: 'gs-1', establishment_id: 'est-1', guardian_profile_id: 'guardian-1', student_id: 'stu-1' });
  supabaseMock._tables.payments.push({ id: 'pay-1', establishment_id: 'est-1', student_id: 'stu-1', discipline_id: 'disc-karate', amount: 100, currency: 'USD', method: 'cash', concept: 'Mensualidad', paid_at: '2026-10-01', created_by: 'owner-1' });

  globalThis.__TEST_SUPABASE_ADMIN__ = supabaseMock;
  globalThis.__TEST_SUPABASE_PUBLIC__ = supabaseMock;
  ({ app } = require('../server/index.js'));
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = 'http://localhost:' + server.address().port; resolve(); }); });
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

beforeEach(() => {
  supabaseMock.writes.length = 0;
  supabaseMock.clearErrors();
  require('../server/index.js').__resetRateLimit();
});

test('A. Crear cargo válido (owner)', async () => {
  const res = await req('POST', '/api/student-charges', 'tok_owner_1', {
    establishmentId: 'est-1', studentId: 'stu-1', chargeType: 'membership', periodKey: '2026-10',
    description: 'Mensualidad octubre', amount: 50, currency: 'ARS', dueDate: iso(5)
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.data.status, 'pending');
  assert.equal(json.data.amount, 50);
  assert.ok(json.data.id, 'cargo con id');
});

test('B. Rechaza amount <= 0', async () => {
  const res = await req('POST', '/api/student-charges', 'tok_owner_1', {
    establishmentId: 'est-1', studentId: 'stu-1', description: 'X', amount: 0, dueDate: iso(5)
  });
  assert.equal(res.status, 400);
});

test('C. Rechaza alumno de otra academia', async () => {
  const res = await req('POST', '/api/student-charges', 'tok_owner_1', {
    establishmentId: 'est-1', studentId: 'stu-2', description: 'X', amount: 50, dueDate: iso(5)
  });
  assert.equal(res.status, 400, 'student does not belong to establishment');
});

test('D. Instructor no puede crear cargo (403)', async () => {
  const res = await req('POST', '/api/student-charges', 'tok_instructor_1', {
    establishmentId: 'est-1', studentId: 'stu-1', description: 'X', amount: 50, dueDate: iso(5)
  });
  assert.equal(res.status, 403);
});

test('E. owner solo ve cargos de su academia', async () => {
  supabaseMock._tables.student_charges.push(
    { id: 'ch-1', establishment_id: 'est-1', student_id: 'stu-1', charge_type: 'membership', period_key: '2026-10', description: 'Mensualidad', amount: 50, currency: 'ARS', due_date: iso(5), status: 'pending', paid_amount: 0 },
    { id: 'ch-2', establishment_id: 'est-2', student_id: 'stu-2', charge_type: 'membership', period_key: '2026-10', description: 'Ajeno', amount: 80, currency: 'ARS', due_date: iso(5), status: 'pending', paid_amount: 0 }
  );
  const res = await req('GET', '/api/student-charges?establishmentId=est-1', 'tok_owner_1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.data.some(c => c.id === 'ch-1'));
  assert.ok(!json.data.some(c => c.id === 'ch-2'), 'no filtra est-2');
});

test('F. Instructor solo ve cargos de alumnos autorizados', async () => {
  supabaseMock._tables.student_charges.push(
    { id: 'ch-i1', establishment_id: 'est-1', student_id: 'stu-1', charge_type: 'membership', period_key: '2026-10', description: 'M', amount: 50, currency: 'ARS', due_date: iso(5), status: 'pending', paid_amount: 0 },
    { id: 'ch-i2', establishment_id: 'est-1', student_id: 'stu-3', charge_type: 'membership', period_key: '2026-10', description: 'No autorizado', amount: 50, currency: 'ARS', due_date: iso(5), status: 'pending', paid_amount: 0 }
  );
  const res = await req('GET', '/api/student-charges?establishmentId=est-1', 'tok_instructor_1');
  const json = await res.json();
  assert.ok(json.data.some(c => c.id === 'ch-i1'));
  assert.ok(!json.data.some(c => c.id === 'ch-i2'), 'no ve alumno no autorizado');
});

test('G. Student solo ve sus propios cargos', async () => {
  const res = await req('GET', '/api/student-charges?establishmentId=est-1', 'tok_student_1');
  const json = await res.json();
  assert.ok(json.data.every(c => c.student_id === 'stu-3'), 'solo stu-3 (su perfil)');
});

test('H. Generación mensual idempotente', async () => {
  const body = { establishmentId: 'est-1', periodKey: '2026-11', dueDate: iso(30), amount: 60, description: 'Mensualidad noviembre', studentIds: ['stu-1'] };
  const r1 = await req('POST', '/api/student-charges/generate-monthly', 'tok_owner_1', body);
  const j1 = await r1.json();
  assert.equal(j1.data.created.length, 1);
  const r2 = await req('POST', '/api/student-charges/generate-monthly', 'tok_owner_1', body);
  const j2 = await r2.json();
  assert.equal(j2.data.created.length, 0, 'segunda vez no crea');
  assert.equal(j2.data.skipped.length, 1, 'omite el duplicado');
});

test('I. Marcar vencidos', async () => {
  supabaseMock._tables.student_charges.push(
    { id: 'ch-od', establishment_id: 'est-1', student_id: 'stu-1', charge_type: 'membership', period_key: '2026-08', description: 'Atrasada', amount: 50, currency: 'ARS', due_date: iso(-5), status: 'pending', paid_amount: 0 }
  );
  const res = await req('POST', '/api/student-charges/mark-overdue', 'tok_owner_1', { establishmentId: 'est-1' });
  const json = await res.json();
  assert.ok(json.data.marked >= 1);
  const c = supabaseMock._tables.student_charges.find(x => x.id === 'ch-od');
  assert.equal(c.status, 'overdue');
});

test('J. Aplicar pago completo', async () => {
  supabaseMock._tables.student_charges.push(
    { id: 'ch-full', establishment_id: 'est-1', student_id: 'stu-1', charge_type: 'membership', period_key: '2026-10', description: 'Pago', amount: 50, currency: 'ARS', due_date: iso(5), status: 'pending', paid_amount: 0 }
  );
  const res = await req('POST', '/api/student-charges/ch-full/apply-payment', 'tok_owner_1', { paymentId: 'pay-1', amountApplied: 50 });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.status, 'paid');
  assert.equal(json.data.paid_amount, 50);
});

test('K. Aplicar pago parcial', async () => {
  supabaseMock._tables.student_charges.push(
    { id: 'ch-part', establishment_id: 'est-1', student_id: 'stu-1', charge_type: 'membership', period_key: '2026-10', description: 'Parcial', amount: 100, currency: 'ARS', due_date: iso(5), status: 'pending', paid_amount: 0 }
  );
  const res = await req('POST', '/api/student-charges/ch-part/apply-payment', 'tok_owner_1', { paymentId: 'pay-1', amountApplied: 40 });
  const json = await res.json();
  assert.equal(json.data.status, 'partial');
  assert.equal(json.data.paid_amount, 40);
});

test('L. Impide sobreaplicación', async () => {
  supabaseMock._tables.student_charges.push(
    { id: 'ch-over', establishment_id: 'est-1', student_id: 'stu-1', charge_type: 'membership', period_key: '2026-10', description: 'Sobre', amount: 10, currency: 'ARS', due_date: iso(5), status: 'pending', paid_amount: 0 }
  );
  const res = await req('POST', '/api/student-charges/ch-over/apply-payment', 'tok_owner_1', { paymentId: 'pay-1', amountApplied: 20 });
  assert.equal(res.status, 400, 'supera saldo pendiente');
});

test('M. Summary por estado', async () => {
  const res = await req('GET', '/api/student-charges/summary?establishmentId=est-1', 'tok_owner_1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(typeof json.data.counts.pending, 'number');
  assert.equal(typeof json.data.totalPending, 'number');
});

test('N. No cambia pagos históricos', async () => {
  const before = supabaseMock._tables.payments.find(p => p.id === 'pay-1');
  const snapshot = JSON.stringify(before);
  await req('POST', '/api/student-charges', 'tok_owner_1', {
    establishmentId: 'est-1', studentId: 'stu-1', description: 'X', amount: 50, dueDate: iso(5)
  });
  const after = supabaseMock._tables.payments.find(p => p.id === 'pay-1');
  assert.equal(JSON.stringify(after), snapshot, 'payments no se modifica');
});

test('O. Error de Supabase no inventa cargos', async () => {
  supabaseMock.setError('student_charges', 'mock error');
  const res = await req('GET', '/api/student-charges?establishmentId=est-1', 'tok_owner_1');
  supabaseMock.clearErrors();
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(json.ok, false);
});
