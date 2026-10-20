// tests/e2e-ai.test.js — Pruebas E2E locales del módulo IA (Supabase mock + proveedor IA mock).
// Sin red externa, sin Supabase real, sin proveedores IA reales, sin datos reales.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

let app, baseUrl, server, supabaseMock, providerA, providerB, superadminToken;

function setConfig(providers) {
  supabaseMock._tables.app_settings[0].settings_value = {
    enabled: true,
    updatedAt: new Date().toISOString(),
    providers: providers.map((p, i) => ({
      id: p.id || ('p' + (i + 1)),
      provider: 'custom',
      apiKey: 'test-key-' + i,
      model: 'm' + i,
      baseUrl: p.baseUrl,
      enabled: true
    }))
  };
}

function aiChat(token, message, establishmentId) {
  return fetch(baseUrl + '/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ message, establishmentId })
  });
}

function aiDraft(token, body) {
  return fetch(baseUrl + '/api/ai/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(body)
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
  providerB = await createMockAIProvider();

  supabaseMock = createSupabaseMock();
  supabaseMock.setToken('tok_owner_1', { id: 'owner-1', email: null, role: 'owner', user_metadata: {} });
  supabaseMock.setToken('tok_instructor_1', { id: 'instructor-1', email: null, role: 'instructor', user_metadata: {} });
  supabaseMock._tables.profiles.push({ id: 'superadmin-1', username: 'sa1', role: 'superadmin', full_name: 'Superadmin Perfil', is_active: true, auth_email: 'sa1@users.martialsystem.local' });
  supabaseMock.setToken('tok_superadmin_profile', { id: 'superadmin-1', email: null, role: 'superadmin', user_metadata: {} });
  supabaseMock._tables.payments.push(
    { id: 'pay-2', establishment_id: 'est-1', student_id: 'stu-1', discipline_id: 'disc-karate', amount: 50, currency: 'USD', method: 'cash', concept: 'Cuota', paid_at: '2026-09-15', created_by: 'owner-1' },
    { id: 'pay-3', establishment_id: 'est-1', student_id: 'stu-1', discipline_id: 'disc-karate', amount: 0, currency: 'USD', method: 'cash', concept: 'Ajuste', paid_at: '2026-10-25', created_by: 'owner-1' },
    { id: 'pay-4', establishment_id: 'est-2', student_id: 'stu-2', discipline_id: 'disc-bjj', amount: 200, currency: 'USD', method: 'cash', concept: 'Ajeno', paid_at: '2026-10-21', created_by: 'owner-2' }
  );

  setConfig([{ id: 'p1', baseUrl: providerA.url }]);

  globalThis.__TEST_SUPABASE_ADMIN__ = supabaseMock;
  globalThis.__TEST_SUPABASE_PUBLIC__ = supabaseMock;

  ({ app } = require('../server/index.js'));

  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = 'http://localhost:' + server.address().port; resolve(); }); });

  // Token superadmin vía login real
  const login = await fetch(baseUrl + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'venta', password: 'test-superadmin-password' })
  });
  superadminToken = (await login.json()).data.access_token;
});

after(async () => {
  await providerA.close();
  await providerB.close();
  if (server) await new Promise((r) => server.close(r));
});

beforeEach(() => {
  providerA.reset();
  providerB.reset();
  require('../server/index.js').__resetAICooldown();
});

test('A. /api/health responde 200', async () => {
  const res = await fetch(baseUrl + '/api/health');
  assert.equal(res.status, 200);
});

test('B. /api/ai/chat sin token -> 401', async () => {
  const res = await fetch(baseUrl + '/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'hola' })
  });
  assert.equal(res.status, 401);
});

test('C. /api/ai/status owner est-1 -> 200 allowed=true', async () => {
  const res = await fetch(baseUrl + '/api/ai/status?establishmentId=est-1', {
    headers: { Authorization: 'Bearer tok_owner_1' }
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.allowed, true);
});

test('D. Consulta de estudiantes devuelve solo est-1 con discipline_name', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  providerA.push('<<<TOOL>>>{"tool":"students","params":{"limit":3}}');
  providerA.push('Aquí están los estudiantes encontrados.');

  const res = await aiChat('tok_owner_1', 'Busca los estudiantes de mi dojo', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  const search = (json.data.tools || []).find(t => t.action === 'search');
  assert.ok(search, 'debe haber una búsqueda de students');
  const rows = search.rows || [];
  assert.ok(rows.some(r => r.id === 'stu-1'), 'incluye stu-1');
  assert.ok(!rows.some(r => r.id === 'stu-2'), 'no expone stu-2 de est-2');
  assert.equal(rows.find(r => r.id === 'stu-1').discipline_code, 'karate');
  assert.equal(rows.find(r => r.id === 'stu-1').discipline_name, 'Karate');
});

test('E. Aislamiento: owner-1 con est-2 -> 403', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  providerA.push('respuesta');

  const res = await aiChat('tok_owner_1', '¿Qué alumnos hay?', 'est-2');
  assert.ok(res.status === 403 || res.status === 404 || res.status === 401, 'estado esperado, obtenido ' + res.status);
  assert.notEqual(res.status, 200, 'nunca 200 con datos de est-2');
});

test('F. Consulta de pagos via router devuelve solo est-1', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  providerA.push('Aquí tienes'); // texto plano, sin herramienta → router

  const res = await aiChat('tok_owner_1', '¿Qué pagos tiene mi dojo?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  const search = (json.data.tools || []).find(t => t.action === 'search');
  assert.ok(search, 'debe haber búsqueda de payments');
  assert.ok((search.rows || []).some(r => r.id === 'pay-1'), 'incluye pago de est-1');
  assert.ok(String(json.data.content).length > 0, 'respuesta legible');
  assert.ok(!/^[\s{}[\],:."']*$/.test(String(json.data.content)), 'no basura');
});

test('G. Consulta de clases usa class_sessions', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  providerA.push('<<<TOOL>>>{"tool":"classes","params":{"limit":3}}');
  providerA.push('Aquí están las clases.');

  const res = await aiChat('tok_owner_1', '¿Qué clases hay?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  const search = (json.data.tools || []).find(t => t.action === 'search');
  assert.ok(search, 'debe haber búsqueda de classes');
  assert.ok((search.rows || []).some(r => r.id === 'cls-1'), 'clase de est-1 encontrada');
});

test('H. Router determinístico: alumnos sin herramienta', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  providerA.push('No tengo datos en memoria'); // sin <<<TOOL>>>

  const res = await aiChat('tok_owner_1', '¿Qué alumnos hay en mi dojo?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  const search = (json.data.tools || []).find(t => t.action === 'search');
  assert.ok(search, 'el router forzó la búsqueda students');
  assert.ok(String(json.data.content).includes('Alumno Uno'), 'respuesta determinística con dato real');
});

test('I. Failover por 429 usa provider-2', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }, { id: 'p2', baseUrl: providerB.url }]);
  providerA.push429();
  providerB.push('Hola, soy la IA disponible.');

  const res = await aiChat('tok_owner_1', 'hola', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.providerId, 'p2');
  assert.ok(String(json.data.content).includes('Hola'));
});

test('J. Failover por respuesta vacía usa provider-2', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }, { id: 'p2', baseUrl: providerB.url }]);
  providerA.push('   '); // content vacío
  providerB.push('Respuesta del proveedor B.');

  const res = await aiChat('tok_owner_1', 'hola', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.providerId, 'p2');
});

test('K. Todos los proveedores fallan -> error breve (nunca 200)', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }, { id: 'p2', baseUrl: providerB.url }]);
  providerA.push429();
  providerB.push429();

  const res = await aiChat('tok_owner_1', 'hola', 'est-1');
  assert.notEqual(res.status, 200);
  const json = await res.json();
  assert.ok(String(json.error).includes('no está disponible temporalmente'), 'mensaje accionable');
});

test('L. Respuesta basura -> 502 AI_INVALID_RESPONSE', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  providerA.push('}\n}');

  const res = await aiChat('tok_owner_1', 'hola', 'est-1');
  assert.equal(res.status, 502);
  const json = await res.json();
  assert.equal(json.code, 'AI_INVALID_RESPONSE');
});

test('M. Borrador de estudiante no escribe en la base', async () => {
  supabaseMock.writes.length = 0;
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  providerA.push('{"draft":{"st-name":"Alumno Sintético","st-email":"alumno@example.invalid"},"question":null}');

  const res = await aiDraft('tok_owner_1', {
    formType: 'students',
    fields: { 'st-name': 'Alumno Sintético', 'st-email': 'alumno@example.invalid', 'st-rank': 'Blanco', 'st-discipline': 'karate' },
    establishmentId: 'est-1'
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.ok, 'respuesta ok');
  assert.equal(supabaseMock.writes.length, 0, 'ninguna escritura en la base');
});

test('N. Borrador de usuario no crea cuenta', async () => {
  supabaseMock.writes.length = 0;
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  providerA.push('{"draft":{"admin-full-name":"Usuario Sintético","admin-username":"usuario_sintetico"},"question":null}');

  const res = await aiDraft('tok_owner_1', {
    formType: 'users',
    fields: { 'admin-full-name': 'Usuario Sintético', 'admin-username': 'usuario_sintetico', 'admin-role': 'instructor' },
    establishmentId: 'est-1'
  });
  assert.equal(res.status, 200);
  assert.equal(supabaseMock.writes.length, 0, 'ninguna escritura en la base');
});

test('O. Instructor no accede a datos globales de usuarios', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  providerA.push('No tengo permisos para ver usuarios.');

  const res = await aiChat('tok_instructor_1', '¿Qué usuarios y roles hay?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  const search = (json.data.tools || []).find(t => t.action === 'search' && t.tool === 'users');
  assert.ok(!search, 'instructor no debe poder buscar usuarios globales');
});

test('P. Superadmin (perfil) puede ver pagos', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  providerA.push('<<<TOOL>>>{"tool":"payments","params":{"limit":3}}');
  providerA.push('Aquí están los pagos.');

  const res = await aiChat('tok_superadmin_profile', '¿Qué pagos hay?', null);
  assert.equal(res.status, 200);
  const json = await res.json();
  const search = (json.data.tools || []).find(t => t.action === 'search' && t.tool === 'payments');
  assert.ok(search, 'superadmin debe poder buscar pagos');
});

test('Q. Frase reportada → búsqueda de pagos, nunca prefill', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  providerA.push('<<<TOOL>>>{"tool":"payments","params":{"amount":0}}');
  providerA.push('Aquí están los últimos pagos.');

  const res = await aiChat('tok_owner_1', 'revisa todos los alumnos y mira sus ultimas fechas de pago de cualquier monto superior a 0', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  const search = (json.data.tools || []).find(t => t.action === 'search');
  const prefill = (json.data.tools || []).find(t => t.action === 'prefill');
  assert.ok(search, 'debe ser búsqueda');
  assert.ok(!prefill, 'nunca prefill');
  assert.equal(search.tool, 'payments');
  assert.equal(search.rows.length, 1, 'una fila por alumno (latestPerStudent)');
  assert.equal(search.rows[0].student_id, 'stu-1');
  assert.equal(search.rows[0].amount, 100, 'excluye amount=0 y usa el último pago');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'consulta clara: cero interpretaciones');
});

test('D. Ambigua usa exactamente una interpretación', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  providerA.push('{"intent":"clarify","domain":"unknown","operation":"unknown","filters":{},"data":{},"scope":"current_establishment","needs_confirmation":false,"missing":["acción"],"confidence":0.2}');
  providerA.push('¿Qué deseas hacer con Juan?');

  const res = await aiChat('tok_owner_1', 'haz algo con Juan', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(providerA.metrics.interpretationCalls, 1, 'una llamada de interpretación');
  assert.ok(String(json.data.content).includes('¿Qué deseas'), 'pregunta de aclaración');
});

test('G. Lectura con amount no activa prefill', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  providerA.push('<<<TOOL>>>{"tool":"payments","params":{"amount":0}}');
  providerA.push('Aquí están los pagos.');

  const res = await aiChat('tok_owner_1', 'muéstrame los pagos mayores a cero', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  const prefill = (json.data.tools || []).find(t => t.action === 'prefill');
  assert.ok(!prefill, 'nunca prefill');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'sin interpretación');
});

// ─── Conteos determinísticos eficientes (backend, sin IA) ───

test('R. Conteo de alumnos respeta el establecimiento', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;
  const res = await aiChat('tok_owner_1', '¿Cuántos alumnos tiene mi dojo?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.count.count, 1, 'solo alumnos de est-1 (stu-2 es de est-2)');
  assert.equal(json.data.count.tool, 'students');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('S. Conteo de pagos mayores a cero', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;
  const res = await aiChat('tok_owner_1', '¿Cuántos pagos mayores a cero hay?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.count.count, 2, 'pay-1 y pay-2 (excluye amount=0 y est-2)');
  assert.equal(json.data.count.tool, 'payments');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('T. Conteo de alumnos únicos con pagos (deduplicación)', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;
  const res = await aiChat('tok_owner_1', '¿Cuántos alumnos pagaron más de 0?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.count.count, 1, 'stu-1 pagó dos veces pero es un único alumno');
  assert.equal(json.data.count.uniqueBy, 'student_id');
  assert.equal(json.data.count.tool, 'payments');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('U. Conteo de clases para mañana', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;
  const tomorrow = new Date(Date.now() + 86400000);
  const iso = tomorrow.getUTCFullYear() + '-' + String(tomorrow.getUTCMonth() + 1).padStart(2, '0') + '-' + String(tomorrow.getUTCDate()).padStart(2, '0');
  supabaseMock._tables.class_sessions.push(
    { id: 'cls-t1', establishment_id: 'est-1', discipline_id: 'disc-karate', instructor_profile_id: 'instructor-1', title: 'Karate Mañana A', scheduled_date: iso, start_time: '10:00', end_time: '11:00', location: 'Sala 1', notes: null, status: 'scheduled', created_at: '2026-01-01' },
    { id: 'cls-t2', establishment_id: 'est-1', discipline_id: 'disc-karate', instructor_profile_id: 'instructor-1', title: 'Karate Mañana B', scheduled_date: iso, start_time: '11:00', end_time: '12:00', location: 'Sala 1', notes: null, status: 'scheduled', created_at: '2026-01-01' },
    { id: 'cls-t3', establishment_id: 'est-2', discipline_id: 'disc-bjj', instructor_profile_id: 'instructor-2', title: 'BJJ Ajeno Mañana', scheduled_date: iso, start_time: '10:00', end_time: '11:00', location: 'Sala 2', notes: null, status: 'scheduled', created_at: '2026-01-01' }
  );

  const res = await aiChat('tok_owner_1', '¿Cuántas clases hay mañana?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.count.count, 2, 'solo clases de est-1 para mañana');
  assert.equal(json.data.count.tool, 'classes');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  const prefill = (json.data.tools || []).find(t => t.action === 'prefill');
  assert.ok(!prefill, 'nunca prefill');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('V. Owner de est-1 no ve conteos de est-2', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;
  const res = await aiChat('tok_owner_1', '¿Cuántos pagos hubo?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.count.count, 3, 'pay-1, pay-2, pay-3 de est-1; excluye pay-4 de est-2');
  assert.equal(json.data.count.tool, 'payments');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('W. Error de Supabase no inventa el número', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;
  supabaseMock.setError('payments', 'mock query error');
  const res = await aiChat('tok_owner_1', '¿Cuántos pagos hubo?', 'est-1');
  supabaseMock.clearErrors();
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.equal(json.data, undefined, 'no devuelve un conteo inventado');
  assert.ok(String(json.error).includes('mock query error'), 'error controlado');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('X. Conteo de pagos excluye negativos y amount=0', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;
  supabaseMock._tables.payments.push(
    { id: 'pay-neg', establishment_id: 'est-1', student_id: 'stu-1', discipline_id: 'disc-karate', amount: -10, currency: 'USD', method: 'cash', concept: 'Reembolso', paid_at: '2026-10-22', created_by: 'owner-1' }
  );

  const res = await aiChat('tok_owner_1', '¿Cuántos pagos mayores a cero hay?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.count.count, 2, 'pay-1 y pay-2; excluye pay-3(0) y pay-neg(-10)');
  assert.equal(json.data.count.tool, 'payments');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('Y. student_id null no cuenta como alumno único', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;
  supabaseMock._tables.payments.push(
    { id: 'pay-null', establishment_id: 'est-1', student_id: null, discipline_id: 'disc-karate', amount: 30, currency: 'USD', method: 'cash', concept: 'Pago sin alumno', paid_at: '2026-10-23', created_by: 'owner-1' }
  );

  const res = await aiChat('tok_owner_1', '¿Cuántos alumnos pagaron más de 0?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.count.count, 1, 'solo stu-1; el pago con student_id null se descarta');
  assert.equal(json.data.count.uniqueBy, 'student_id');
  assert.equal(json.data.count.tool, 'payments');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

