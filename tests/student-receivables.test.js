// tests/student-receivables.test.js
// Cuentas por cobrar consolidadas (Fase A): servicios + endpoints + tenancy.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const sr = require('../server/student-receivables');

let app, baseUrl, server, supabaseMock;

function req(method, path, token) {
  return fetch(baseUrl + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {})
  });
}

// ── Unit (helpers puros) ──────────────────────────────────────────────
test('computeBalance: balance = max(0, amount - paid)', () => {
  assert.equal(sr.computeBalance(100, 30), 70);
  assert.equal(sr.computeBalance(100, 100), 0);
  assert.equal(sr.computeBalance(100, 150), 0);
  assert.equal(sr.computeBalance(100, undefined), 100);
});

test('studentStatusFromCharges: pending/partial/paid/overdue', () => {
  const c = (status, amount, paid) => ({ status, amount, paid_amount: paid });
  assert.equal(sr.studentStatusFromCharges([c('pending', 100, 0)]), 'pending');
  assert.equal(sr.studentStatusFromCharges([c('partial', 100, 30)]), 'partial');
  assert.equal(sr.studentStatusFromCharges([c('paid', 100, 100)]), 'paid');
  assert.equal(sr.studentStatusFromCharges([c('overdue', 100, 0)]), 'overdue');
  assert.equal(sr.studentStatusFromCharges([]), null);
});

test('aggregateStudentBalances: agrupa por alumno y separa monedas', () => {
  const rows = sr.aggregateStudentBalances([
    { student_id: 's1', amount: 100, paid_amount: 0, currency: 'ARS', status: 'overdue', due_date: '2026-09-01' },
    { student_id: 's2', amount: 60, paid_amount: 20, currency: 'ARS', status: 'partial', due_date: '2026-10-01' },
    { student_id: 's2', amount: 40, paid_amount: 40, currency: 'USD', status: 'paid', due_date: '2026-10-01' }
  ]);
  assert.equal(rows.length, 2);
  const s2 = rows.find((r) => r.student_id === 's2');
  assert.equal(s2.balance_due, 40); // ARS pendiente (USD pagado)
  assert.equal(s2.paid_amount, 60);
  assert.deepEqual(s2.currency_balances, { ARS: 40, USD: 0 });
  assert.equal(s2.status, 'partial');
  assert.equal(s2.number_of_overdue_charges, 0);
});

test('buildReceivablesSummary: cuenta personas únicas y no mezcla monedas', () => {
  const balances = [
    { student_id: 's1', amount_due: 100, paid_amount: 0, balance_due: 100, status: 'overdue', currency_balances: { ARS: 100 }, currency_paid: {} },
    { student_id: 's2', amount_due: 60, paid_amount: 20, balance_due: 40, status: 'partial', currency_balances: { ARS: 40 }, currency_paid: { ARS: 20 } },
    { student_id: 's3', amount_due: 40, paid_amount: 40, balance_due: 0, status: 'paid', currency_balances: { USD: 0 }, currency_paid: { USD: 40 } }
  ];
  const s = sr.buildReceivablesSummary(balances, '2026-10-28');
  assert.equal(s.peopleOwing, 2);
  assert.equal(s.peoplePaid, 1);
  assert.equal(s.peoplePartial, 1);
  assert.equal(s.totalOutstanding, 140);
  assert.equal(s.totalPaid, 60);
  assert.deepEqual(s.currencyBreakdown, [
    { currency: 'ARS', outstanding: 140, paid: 20 },
    { currency: 'USD', outstanding: 0, paid: 40 }
  ]);
  assert.equal(s.asOf, '2026-10-28');
});

// ── HTTP (servicios + endpoints + tenancy) ────────────────────────────
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
  supabaseMock._tables.profiles.push({ id: 'superadmin-1', username: 'sa1', role: 'superadmin', full_name: 'SA', is_active: true, auth_email: 'sa1@users.martialsystem.local' });
  supabaseMock.setToken('tok_superadmin', { id: 'superadmin-1', email: null, role: 'superadmin', user_metadata: {} });
  supabaseMock._tables.profiles.push({ id: 'student-1', username: 'stu1', role: 'student', full_name: 'Estudiante 1', is_active: true, auth_email: 'st1@x.invalid' });
  supabaseMock._tables.establishment_members.push({ id: 'm-student', establishment_id: 'est-1', profile_id: 'student-1', role: 'student', created_at: '2026-01-01' });
  supabaseMock.setToken('tok_student_1', { id: 'student-1', email: null, role: 'student', user_metadata: {} });

  supabaseMock._tables.students.push(
    { id: 'stu-3', establishment_id: 'est-1', full_name: 'Alumno Pagado', email: 's3@x.invalid', phone: '333', profile_id: 'student-1', birth_date: null, created_at: '2026-01-01', discipline_code: null },
    { id: 'stu-4', establishment_id: 'est-1', full_name: 'Alumno Parcial', email: 's4@x.invalid', phone: '444', profile_id: null, birth_date: null, created_at: '2026-01-01', discipline_code: null },
    { id: 'stu-5', establishment_id: 'est-1', full_name: 'Alumno Sin Cargo', email: 's5@x.invalid', phone: '555', profile_id: null, birth_date: null, created_at: '2026-01-01', discipline_code: null }
  );
  supabaseMock._tables.student_charges = [
    { id: 'c1', establishment_id: 'est-1', student_id: 'stu-1', charge_type: 'membership', period_key: '2026-09', description: 'Mensualidad', amount: 100, currency: 'ARS', due_date: '2026-09-01', status: 'overdue', paid_amount: 0 },
    { id: 'c2', establishment_id: 'est-1', student_id: 'stu-3', charge_type: 'membership', period_key: '2026-10', description: 'Mensualidad', amount: 40, currency: 'USD', due_date: '2026-10-01', status: 'paid', paid_amount: 40 },
    { id: 'c3', establishment_id: 'est-1', student_id: 'stu-4', charge_type: 'membership', period_key: '2026-10', description: 'Mensualidad', amount: 60, currency: 'ARS', due_date: '2026-10-01', status: 'partial', paid_amount: 20 },
    { id: 'c4', establishment_id: 'est-2', student_id: 'stu-2', charge_type: 'membership', period_key: '2026-10', description: 'Mensualidad', amount: 90, currency: 'ARS', due_date: '2026-10-01', status: 'pending', paid_amount: 0 }
  ];
  supabaseMock._tables.payments = [
    { id: 'pay-3', establishment_id: 'est-1', student_id: 'stu-3', discipline_id: 'disc-karate', amount: 40, currency: 'USD', method: 'cash', concept: 'Mensualidad', paid_at: '2026-10-01', created_by: 'owner-1' },
    { id: 'pay-4', establishment_id: 'est-1', student_id: 'stu-4', discipline_id: 'disc-karate', amount: 20, currency: 'ARS', method: 'cash', concept: 'Mensualidad', paid_at: '2026-10-02', created_by: 'owner-1' }
  ];

  globalThis.__TEST_SUPABASE_ADMIN__ = supabaseMock;
  globalThis.__TEST_SUPABASE_PUBLIC__ = supabaseMock;
  ({ app } = require('../server/index.js'));
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = 'http://localhost:' + server.address().port; resolve(); }); });
});

after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(() => { supabaseMock.writes.length = 0; supabaseMock.clearErrors(); });

test('GET /api/student-receivables (owner) lista saldos y no escribe', async () => {
  const res = await req('GET', '/api/student-receivables?establishmentId=est-1', 'tok_owner_1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  const ids = json.data.map((r) => r.student_id).sort();
  assert.deepEqual(ids, ['stu-1', 'stu-3', 'stu-4']);
  const stu1 = json.data.find((r) => r.student_id === 'stu-1');
  assert.equal(stu1.balance_due, 100);
  assert.equal(stu1.status, 'overdue');
  assert.equal(supabaseMock.writes.length, 0);
});

test('GET /api/student-receivables/summary calcula personas y monedas', async () => {
  const res = await req('GET', '/api/student-receivables/summary?establishmentId=est-1', 'tok_owner_1');
  assert.equal(res.status, 200);
  const s = (await res.json()).data;
  assert.equal(s.peopleOwing, 2);
  assert.equal(s.peoplePaid, 1);
  assert.equal(s.peoplePartial, 1);
  assert.equal(s.totalOutstanding, 140);
  assert.equal(s.totalPaid, 60);
  assert.deepEqual(s.currencyBreakdown, [
    { currency: 'ARS', outstanding: 140, paid: 20 },
    { currency: 'USD', outstanding: 0, paid: 40 }
  ]);
  assert.equal(supabaseMock.writes.length, 0);
});

test('GET /api/student-receivables/overdue solo vencidos', async () => {
  const res = await req('GET', '/api/student-receivables/overdue?establishmentId=est-1', 'tok_owner_1');
  const json = await res.json();
  assert.deepEqual(json.data.map((r) => r.student_id), ['stu-1']);
  assert.equal(supabaseMock.writes.length, 0);
});

test('GET /api/student-receivables/paid solo pagados', async () => {
  const res = await req('GET', '/api/student-receivables/paid?establishmentId=est-1', 'tok_owner_1');
  const json = await res.json();
  assert.deepEqual(json.data.map((r) => r.student_id), ['stu-3']);
  assert.equal(supabaseMock.writes.length, 0);
});

test('GET /api/student-receivables/:studentId devuelve un alumno', async () => {
  const res = await req('GET', '/api/student-receivables/stu-4?establishmentId=est-1', 'tok_owner_1');
  const json = await res.json();
  assert.equal(json.data.student_id, 'stu-4');
  assert.equal(json.data.status, 'partial');
  assert.equal(json.data.balance_due, 40);
});

test('owner no ve cargos de otro establecimiento', async () => {
  const res = await req('GET', '/api/student-receivables?establishmentId=est-2', 'tok_owner_1');
  assert.equal(res.status, 403);
});

test('superadmin global (sin establishmentId) ve todos los dojos', async () => {
  const res = await req('GET', '/api/student-receivables', 'tok_superadmin');
  const json = await res.json();
  const ids = json.data.map((r) => r.student_id).sort();
  assert.deepEqual(ids, ['stu-1', 'stu-2', 'stu-3', 'stu-4']);
});

test('student solo ve su propio alumno', async () => {
  const res = await req('GET', '/api/student-receivables?establishmentId=est-1', 'tok_student_1');
  const json = await res.json();
  assert.deepEqual(json.data.map((r) => r.student_id), ['stu-3']);
});

test('alumno sin cargo no aparece como deudor', async () => {
  const res = await req('GET', '/api/student-receivables?establishmentId=est-1', 'tok_owner_1');
  const json = await res.json();
  assert.ok(!json.data.some((r) => r.student_id === 'stu-5'));
});

test('error de Supabase no inventa cifras (500)', async () => {
  supabaseMock.setError('student_charges', 'boom');
  const res = await req('GET', '/api/student-receivables/summary?establishmentId=est-1', 'tok_owner_1');
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.ok(json.error);
});

console.log('Suite student-receivables: ejecutada con node:test');
