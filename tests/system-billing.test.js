// tests/system-billing.test.js — Suite dedicada de facturación de plataforma (system_usage_bills).
// Sin Supabase real ni proveedores IA reales. Usa Supabase mock + proveedor IA mock.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

let app, baseUrl, server, supabaseMock, providerA, superadminToken;

function setConfig() {
  supabaseMock._tables.app_settings[0].settings_value = {
    enabled: true,
    updatedAt: new Date().toISOString(),
    providers: [{ id: 'p1', provider: 'custom', apiKey: 'test-key', model: 'm1', baseUrl: providerA.url, enabled: true }]
  };
}

function aiChat(token, message, establishmentId) {
  return fetch(baseUrl + '/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ message, establishmentId })
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
  const { createMockAIProvider } = require('./helpers/mock-ai-provider');
  providerA = await createMockAIProvider();
  supabaseMock = createSupabaseMock();

  supabaseMock.setToken('tok_owner_1', { id: 'owner-1', email: null, role: 'owner', user_metadata: {} });
  supabaseMock.setToken('tok_instructor_1', { id: 'instructor-1', email: null, role: 'instructor', user_metadata: {} });
  supabaseMock._tables.profiles.push(
    { id: 'sensei-1', username: 'sensei1', role: 'sensei', full_name: 'Sensei 1', is_active: true, auth_email: 'sensei1@users.martialsystem.local' },
    { id: 'student-1', username: 'stu1', role: 'student', full_name: 'Student 1', is_active: true, auth_email: 'stu1@users.martialsystem.local' },
    { id: 'guardian-1', username: 'guard1', role: 'guardian', full_name: 'Guardian 1', is_active: true, auth_email: 'guard1@users.martialsystem.local' }
  );
  supabaseMock.setToken('tok_sensei_1', { id: 'sensei-1', email: null, role: 'sensei', user_metadata: {} });
  supabaseMock.setToken('tok_student_1', { id: 'student-1', email: null, role: 'student', user_metadata: {} });
  supabaseMock.setToken('tok_guardian_1', { id: 'guardian-1', email: null, role: 'guardian', user_metadata: {} });

  // Facturas del sistema: est-1 (propia) y est-2 (ajena).
  supabaseMock._tables.system_usage_bills = [
    { id: 'bill-1', establishment_id: 'est-1', billing_month: '2026-10', amount: 29, currency: 'USD', status: 'confirmed', due_date: '2026-10-05' },
    { id: 'bill-2', establishment_id: 'est-1', billing_month: '2026-08', amount: 49, currency: 'USD', status: 'overdue', due_date: '2026-08-05', paid_at: '2026-08-10', payment_reference: 'REF-2' },
    { id: 'bill-3', establishment_id: 'est-1', billing_month: '2026-09', amount: 49, currency: 'USD', status: 'pending', due_date: '2026-09-05' },
    { id: 'bill-4', establishment_id: 'est-2', billing_month: '2026-08', amount: 99, currency: 'USD', status: 'overdue', due_date: '2026-08-05' },
    { id: 'bill-5', establishment_id: 'est-2', billing_month: '2026-09', amount: 99, currency: 'ARS', status: 'pending', due_date: '2026-09-05' },
    { id: 'bill-6', establishment_id: 'est-2', billing_month: '2026-07', amount: 99, currency: 'USD', status: 'waived', due_date: '2026-07-05' },
    { id: 'bill-7', establishment_id: 'est-1', billing_month: '2026-06', amount: 49, currency: 'USD', status: 'paid', due_date: '2026-06-05', paid_at: '2026-06-10', payment_reference: 'REF-7' }
  ];

  setConfig();
  globalThis.__TEST_SUPABASE_ADMIN__ = supabaseMock;
  globalThis.__TEST_SUPABASE_PUBLIC__ = supabaseMock;
  ({ app } = require('../server/index.js'));
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = 'http://localhost:' + server.address().port; resolve(); }); });

  const login = await fetch(baseUrl + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'venta', password: 'test-superadmin-password' })
  });
  superadminToken = (await login.json()).data.access_token;
});

after(async () => {
  await providerA.close();
  if (server) await new Promise((r) => server.close(r));
});

beforeEach(() => {
  providerA.reset();
  require('../server/index.js').__resetAICooldown();
  require('../server/index.js').__resetDetailedListState();
  require('../server/index.js').__resetRateLimit();
});

test('1. Identidad usa ctx (no busca en users)', async () => {
  setConfig();
  supabaseMock.writes.length = 0;
  const res = await aiChat('tok_owner_1', '¿Qué usuario soy?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.model, 'deterministic');
  assert.ok(String(json.data.content).includes('Owner 1'));
  assert.ok(String(json.data.content).includes('con rol owner'));
  assert.equal(providerA.metrics.interpretationCalls, 0);
  assert.equal(supabaseMock.writes.length, 0);
});

test('2. Superadmin consulta facturación global (system_usage_bills)', async () => {
  setConfig();
  supabaseMock.writes.length = 0;
  const res = await aiChat(superadminToken, '¿Cuántos dojos deben el sistema?');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.count.tool, 'billing');
  assert.equal(json.data.count.overdueCount, 2, 'est-1 y est-2 vencidos');
  assert.equal(json.data.count.pendingCount, 2, 'est-1 y est-2 pendientes');
  assert.equal(providerA.metrics.interpretationCalls, 0);
  assert.equal(supabaseMock.writes.length, 0);
});

test('3. Owner solo ve su propia academia', async () => {
  setConfig();
  supabaseMock.writes.length = 0;
  const res = await aiChat('tok_owner_1', '¿Cuántos dojos deben el sistema?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.count.tool, 'billing');
  assert.equal(json.data.count.overdueCount, 1, 'solo est-1');
  assert.equal(json.data.count.pendingCount, 1, 'solo est-1');
  assert.equal(supabaseMock.writes.length, 0);
});

test('4. Instructor/sensei/student/guardian reciben denegación sin datos', async () => {
  setConfig();
  for (const tok of ['tok_instructor_1', 'tok_sensei_1', 'tok_student_1', 'tok_guardian_1']) {
    const res = await aiChat(tok, '¿Cuánto debe mi dojo al sistema?', 'est-1');
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.data.model, 'deterministic');
    assert.ok(String(json.data.content).includes('No tienes permisos para consultar la facturación de la plataforma.'), 'token ' + tok);
  }
  assert.equal(providerA.metrics.interpretationCalls, 0);
  assert.equal(supabaseMock.writes.length, 0);
});

test('5. Filtro por nombre exacto de academia', async () => {
  setConfig();
  supabaseMock.writes.length = 0;
  const res = await aiChat(superadminToken, '¿Cuánto debe Dojo Bushido?');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.model, 'deterministic');
  assert.equal(json.data.count.establishmentName, 'Dojo Bushido');
  assert.equal(json.data.count.overdueCount, 1);
  assert.equal(json.data.count.pendingCount, 1);
  assert.ok(String(json.data.content).includes('Dojo Bushido'));
  assert.ok(String(json.data.content).includes('USD'));
  assert.equal(providerA.metrics.interpretationCalls, 0);
  assert.equal(supabaseMock.writes.length, 0);
});

test('6. Academia ajena para owner devuelve mensaje controlado', async () => {
  setConfig();
  supabaseMock.writes.length = 0;
  const res = await aiChat('tok_owner_1', '¿Cuánto debe Academia Ajena?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.model, 'deterministic');
  assert.ok(String(json.data.content).includes('No encontré una academia con ese nombre dentro de tu alcance autorizado.'));
  assert.equal(providerA.metrics.interpretationCalls, 0);
  assert.equal(supabaseMock.writes.length, 0);
});

test('7. Error de Supabase no inventa cero ni cifras', async () => {
  setConfig();
  supabaseMock.writes.length = 0;
  supabaseMock.setError('system_usage_bills', 'mock query error');
  const res = await aiChat(superadminToken, '¿Cuántos dojos deben el sistema?');
  supabaseMock.clearErrors();
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.ok(String(json.error).includes('No pude contar'), 'error controlado, sin stack');
  assert.equal(supabaseMock.writes.length, 0);
});

test('8. Totales separados por moneda (no suma monedas distintas)', async () => {
  setConfig();
  supabaseMock.writes.length = 0;
  const res = await aiChat(superadminToken, '¿Cuántos dojos deben el sistema?');
  assert.equal(res.status, 200);
  const json = await res.json();
  const totals = json.data.count.overdueTotals;
  assert.ok(totals && typeof totals === 'object', 'overdueTotals por moneda');
  assert.ok(!String(json.data.content).includes('$'), 'no usa $ genérico');
  assert.equal(supabaseMock.writes.length, 0);
});

test('9. Confirmar pago es solo superadmin (rol no autorizado → 403)', async () => {
  const res = await fetch(baseUrl + '/api/system-billing/confirm-payment/bill-3', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer tok_owner_1' },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 403, 'owner no puede confirmar');
});

test('10. Confirmar pending → confirmed: permitido', async () => {
  const r = await fetch(baseUrl + '/api/system-billing/confirm-payment/bill-3', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + superadminToken },
    body: JSON.stringify({})
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.status, 'confirmed');
});

test('11. Confirmar overdue → confirmed: permitido si pago válido', async () => {
  const r = await fetch(baseUrl + '/api/system-billing/confirm-payment/bill-2', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + superadminToken },
    body: JSON.stringify({})
  });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.status, 'confirmed');
});

test('12. Reconfirmar confirmed → 409 BILL_ALREADY_CONFIRMED', async () => {
  const r = await fetch(baseUrl + '/api/system-billing/confirm-payment/bill-1', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + superadminToken },
    body: JSON.stringify({})
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'BILL_ALREADY_CONFIRMED');
});

test('13. Confirmar paid → 409 BILL_ALREADY_CONFIRMED', async () => {
  const r = await fetch(baseUrl + '/api/system-billing/confirm-payment/bill-7', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + superadminToken },
    body: JSON.stringify({})
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'BILL_ALREADY_CONFIRMED');
});

test('14. Confirmar waived → 409 BILL_ALREADY_CONFIRMED', async () => {
  const r = await fetch(baseUrl + '/api/system-billing/confirm-payment/bill-6', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + superadminToken },
    body: JSON.stringify({})
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'BILL_ALREADY_CONFIRMED');
});

test('15. Confirmar overdue sin pago → 409 BILL_NO_PAYMENT', async () => {
  const r = await fetch(baseUrl + '/api/system-billing/confirm-payment/bill-4', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + superadminToken },
    body: JSON.stringify({})
  });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'BILL_NO_PAYMENT');
});

test('16. Nombre ambiguo de academia pide aclaración (sin consultar facturas)', async () => {
  setConfig();
  supabaseMock.writes.length = 0;
  supabaseMock._tables.establishments.push({ id: 'est-3', name: 'Dojo Bushido Norte', city: 'C3', country: 'PA', is_active: true, created_at: '2026-01-01' });
  const res = await aiChat(superadminToken, '¿Cuánto debe el dojo Bushido?');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.model, 'deterministic');
  assert.ok(String(json.data.content).includes('varias academias'), 'pide aclaración');
  assert.ok(!String(json.data.content).includes('USD'), 'no muestra importes');
  assert.equal(providerA.metrics.interpretationCalls, 0);
  assert.equal(supabaseMock.writes.length, 0);
});

test('17. Sin escrituras en consultas de solo lectura', async () => {
  setConfig();
  supabaseMock.writes.length = 0;
  await aiChat(superadminToken, '¿Cuántos dojos deben el sistema?');
  await aiChat('tok_owner_1', '¿Cuántos dojos deben el sistema?', 'est-1');
  await aiChat(superadminToken, '¿Cuánto debe Dojo Bushido?');
  assert.equal(supabaseMock.writes.length, 0, 'cero escrituras en consultas');
});
