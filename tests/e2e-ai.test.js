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

  // Sensei (con alumno autorizado) e instructor sin alumnos, para tests de aislamiento de conteos de pagos.
  supabaseMock._tables.profiles.push(
    { id: 'sensei-1', username: 'sensei1', role: 'sensei', full_name: 'Sensei 1', is_active: true, auth_email: 'sensei1@users.martialsystem.local' },
    { id: 'instructor-3', username: 'inst3', role: 'instructor', full_name: 'Instructor 3', is_active: true, auth_email: 'inst3@users.martialsystem.local' }
  );
  supabaseMock._tables.establishment_members.push(
    { id: 'm4', establishment_id: 'est-1', profile_id: 'sensei-1', role: 'sensei', created_at: '2026-01-01' },
    { id: 'm5', establishment_id: 'est-1', profile_id: 'instructor-3', role: 'instructor', created_at: '2026-01-01' }
  );
  supabaseMock._tables.student_enrollments.push(
    { id: 'e-sensei', student_id: 'stu-1', discipline_id: 'disc-karate', current_rank: 'Blanco', status: 'active', instructor_profile_id: 'sensei-1' }
  );
  supabaseMock.setToken('tok_sensei_1', { id: 'sensei-1', email: null, role: 'sensei', user_metadata: {} });
  supabaseMock.setToken('tok_instructor_3', { id: 'instructor-3', email: null, role: 'instructor', user_metadata: {} });

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
  require('../server/index.js').__resetDetailedListState();
  require('../server/index.js').__resetRateLimit();
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

test('Z. Instructor solo cuenta pagos de sus alumnos autorizados', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;
  // alumno no autorizado de est-1 + su pago (no debe contarse ni exponerse)
  supabaseMock._tables.students.push({ id: 'stu-3', establishment_id: 'est-1', full_name: 'Alumno No Autorizado', email: 's3@ex.invalid', phone: '333', profile_id: null, birth_date: null, created_at: '2026-01-01', discipline_code: null });
  supabaseMock._tables.payments.push({ id: 'pay-5', establishment_id: 'est-1', student_id: 'stu-3', discipline_id: 'disc-karate', amount: 100, currency: 'USD', method: 'cash', concept: 'Cuota ajena', paid_at: '2026-10-24', created_by: 'owner-1' });

  const res = await aiChat('tok_instructor_1', '¿Cuántos alumnos pagaron más de 0?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.count.count, 1, 'solo stu-1 (autorizado); excluye stu-3 y est-2');
  assert.equal(json.data.count.uniqueBy, 'student_id');
  assert.equal(json.data.count.tool, 'payments');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
  const raw = JSON.stringify(json);
  assert.ok(!raw.includes('stu-3'), 'no expone stu-3');
  assert.ok(!raw.includes('stu-2'), 'no expone stu-2');
  assert.ok(!raw.includes('pay-5'), 'no expone pay-5');
  assert.ok(!raw.includes('pay-4'), 'no expone pay-4');
});

test('AA. Sensei solo cuenta pagos de sus alumnos autorizados', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;

  const res = await aiChat('tok_sensei_1', '¿Cuántos alumnos pagaron más de 0?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.count.count, 1, 'solo stu-1 (autorizado para sensei-1)');
  assert.equal(json.data.count.uniqueBy, 'student_id');
  assert.equal(json.data.count.tool, 'payments');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
  const raw = JSON.stringify(json);
  assert.ok(!raw.includes('stu-3'), 'no expone stu-3');
  assert.ok(!raw.includes('stu-2'), 'no expone stu-2');
  assert.ok(!raw.includes('pay-4'), 'no expone pay-4');
});

test('AB. Instructor sin alumnos autorizados cuenta 0 sin consultar pagos globales', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;

  const res = await aiChat('tok_instructor_3', '¿Cuántos alumnos pagaron más de 0?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.count.count, 0, 'sin alumnos autorizados → 0');
  assert.equal(json.data.count.tool, 'payments');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

// ─── Consultas detalladas genéricas (paginadas, determinísticas) ───

test('AC. Conteo de instructores (detailed=false)', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;

  const res = await aiChat('tok_owner_1', '¿Cuántos instructores hay?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.count.tool, 'users');
  assert.equal(json.data.count.count, 2, 'instructor-1 e instructor-3 en est-1');
  assert.ok(String(json.data.content).includes('2 instructores'));
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('AD. Lista detallada de instructores (academia y disciplinas)', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;

  const res = await aiChat('tok_owner_1', 'Me gustaría la lista detallada de cada instructor por favor', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.list.meta.domain, 'users');
  assert.equal(json.data.list.meta.page, 1);
  assert.equal(json.data.list.meta.pageSize, 25);
  assert.equal(json.data.list.meta.total, 2);
  const row = json.data.list.rows.find(r => r.full_name === 'Instructor 1');
  assert.ok(row, 'instructor-1 presente');
  assert.equal(row.establishment_name, 'Dojo Bushido');
  assert.ok(row.disciplines.includes('Karate'), 'disciplina Karate presente');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
  const raw = JSON.stringify(json);
  assert.ok(!raw.includes('instructor-1'), 'no expone IDs internos');
  assert.ok(!raw.includes('profile_id'), 'no expone profile_id');
});

test('AE. Filtro por disciplina (instructores de Karate)', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;

  const res = await aiChat('tok_owner_1', 'Muéstrame los instructores de Karate', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.list.meta.total, 1, 'solo instructor-1 tiene Karate');
  assert.ok(json.data.list.rows.some(r => r.full_name === 'Instructor 1'));
  assert.ok(!json.data.list.rows.some(r => r.full_name === 'Instructor 3'));
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('AF. Filtro por academia (instructores del Dojo Bushido)', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;

  const res = await aiChat('tok_owner_1', 'Muéstrame los instructores del Dojo Bushido', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.list.meta.total, 2);
  assert.ok(json.data.list.rows.every(r => r.establishment_name === 'Dojo Bushido'));
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('AG. Tenancy: owner est-1 no ve est-2; superadmin global; student sin listado', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;

  const owner = await aiChat('tok_owner_1', 'Quiero la lista detallada de cada instructor', 'est-1');
  assert.equal(owner.status, 200);
  const ownerJson = await owner.json();
  assert.equal(ownerJson.data.list.meta.total, 2);
  assert.ok(!ownerJson.data.list.rows.some(r => r.full_name === 'Instructor 2'), 'no expone instructor de est-2');

  const sa = await aiChat('tok_superadmin_profile', 'Quiero la lista detallada de cada instructor', null);
  assert.equal(sa.status, 200);
  const saJson = await sa.json();
  assert.equal(saJson.data.list.meta.total, 3, 'superadmin ve los 3 instructores globales');
  assert.ok(saJson.data.list.rows.some(r => r.full_name === 'Instructor 2'), 'superadmin incluye est-2');

  supabaseMock._tables.profiles.push({ id: 'student-1', username: 'stu1', role: 'student', full_name: 'Estudiante 1', is_active: true, auth_email: 'stu1@x.invalid' });
  supabaseMock._tables.establishment_members.push({ id: 'm6', establishment_id: 'est-1', profile_id: 'student-1', role: 'student', created_at: '2026-01-01' });
  supabaseMock.setToken('tok_student_1', { id: 'student-1', email: null, role: 'student', user_metadata: {} });
  const stu = await aiChat('tok_student_1', 'Quiero la lista detallada de cada instructor', 'est-1');
  assert.equal(stu.status, 200);
  const stuJson = await stu.json();
  assert.equal(stuJson.data.list, undefined, 'student no obtiene listado de usuarios');
});

test('AH. Paginación: siguiente página', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;
  for (let i = 0; i < 26; i++) {
    const pid = 'inst-bulk-' + i;
    supabaseMock._tables.profiles.push({ id: pid, username: 'bulk' + i, role: 'instructor', full_name: 'Instructor Bulk ' + i, is_active: true, auth_email: 'bulk' + i + '@x.invalid' });
    supabaseMock._tables.establishment_members.push({ id: 'mb' + i, establishment_id: 'est-1', profile_id: pid, role: 'instructor', created_at: '2026-01-01' });
  }

  const res1 = await aiChat('tok_owner_1', 'Me gustaría la lista detallada de cada instructor por favor', 'est-1');
  assert.equal(res1.status, 200);
  const json1 = await res1.json();
  assert.equal(json1.data.list.meta.page, 1);
  assert.equal(json1.data.list.meta.pageSize, 25);
  assert.equal(json1.data.list.meta.total, 28, 'instructor-1 + instructor-3 + 26 bulk');
  assert.equal(json1.data.list.rows.length, 25);
  assert.equal(json1.data.list.meta.hasNextPage, true);

  const res2 = await aiChat('tok_owner_1', 'siguiente página', 'est-1');
  assert.equal(res2.status, 200);
  const json2 = await res2.json();
  assert.equal(json2.data.list.meta.page, 2);
  assert.equal(json2.data.list.rows.length, 3);
  assert.equal(json2.data.list.meta.hasNextPage, false);
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('AI. Error de Supabase en listado → error controlado', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;
  supabaseMock.setError('establishment_members', 'mock query error');

  const res = await aiChat('tok_owner_1', 'Quiero la lista detallada de cada instructor', 'est-1');
  supabaseMock.clearErrors();
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.ok(String(json.error).includes('No pude consultar el detalle'), 'error controlado, sin stack');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('AJ. IA consulta cargos vencidos sin llamar al modelo', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;
  supabaseMock._tables.student_charges.push(
    { id: 'ch-ia1', establishment_id: 'est-1', student_id: 'stu-1', charge_type: 'membership', period_key: '2026-09', description: 'Mensualidad atrasada', amount: 50, currency: 'ARS', due_date: '2020-01-01', status: 'overdue', paid_amount: 0 }
  );

  const c = await aiChat('tok_owner_1', '¿Cuántos cargos están vencidos?', 'est-1');
  assert.equal(c.status, 200);
  const cj = await c.json();
  assert.equal(cj.data.count.tool, 'charges');
  assert.equal(cj.data.count.count, 1);
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');

  const l = await aiChat('tok_owner_1', '¿Quiénes tienen mensualidad vencida?', 'est-1');
  assert.equal(l.status, 200);
  const lj = await l.json();
  assert.equal(lj.data.list.meta.domain, 'charges');
  assert.ok(lj.data.list.rows.some(r => r.status === 'overdue'), 'lista de vencidos');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('AK. "¿Qué usuario soy?" responde con la identidad de la sesión (superadmin)', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;

  const res = await aiChat(superadminToken, '¿Qué usuario soy?');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.model, 'deterministic');
  assert.ok(String(json.data.content).includes('con rol Superadmin'));
  assert.ok(!String(json.data.content).includes('Owner 1'), 'no devuelve lista global');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(providerA.metrics.chatCalls, 0, 'cero llamadas al modelo');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('AL. "¿Quién soy?" responde solo la identidad del owner', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;

  const res = await aiChat('tok_owner_1', '¿Quién soy?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.model, 'deterministic');
  assert.ok(String(json.data.content).includes('Owner 1'));
  assert.ok(String(json.data.content).includes('con rol owner'));
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('AM. "¿Cuál es mi rol?" responde solo la identidad del instructor', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;

  const res = await aiChat('tok_instructor_1', '¿Cuál es mi rol?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.model, 'deterministic');
  assert.ok(String(json.data.content).includes('Instructor 1'));
  assert.ok(String(json.data.content).includes('con rol instructor'));
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('AN. "¿Cuántos dojos deben el sistema?" consulta system_usage_bills (superadmin)', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;
  supabaseMock._tables.system_usage_bills.push(
    { id: 'bill-ov1', establishment_id: 'est-1', billing_month: '2026-08', amount: 49, status: 'overdue', due_date: '2026-08-05' },
    { id: 'bill-ov2', establishment_id: 'est-2', billing_month: '2026-08', amount: 99, status: 'overdue', due_date: '2026-08-05' },
    { id: 'bill-pd1', establishment_id: 'est-2', billing_month: '2026-09', amount: 99, status: 'pending', due_date: '2026-09-05' }
  );

  const res = await aiChat(superadminToken, '¿Cuántos dojos deben el sistema?');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.model, 'deterministic');
  assert.equal(json.data.count.tool, 'billing');
  assert.equal(json.data.count.overdueCount, 2);
  assert.equal(json.data.count.pendingCount, 1);
  assert.ok(String(json.data.content).includes('con facturas vencidas'));
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('AO. Owner solo ve facturas de su propio dojo (system_usage_bills)', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;
  supabaseMock._tables.system_usage_bills.push(
    { id: 'bill-ov3', establishment_id: 'est-1', billing_month: '2026-07', amount: 49, status: 'overdue', due_date: '2026-07-05' },
    { id: 'bill-ov4', establishment_id: 'est-2', billing_month: '2026-07', amount: 99, status: 'overdue', due_date: '2026-07-05' }
  );

  const res = await aiChat('tok_owner_1', '¿Cuántos dojos deben el sistema?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.count.tool, 'billing');
  assert.equal(json.data.count.overdueCount, 1, 'solo est-1');
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

test('AP. Instructor no puede consultar facturación de dojos', async () => {
  setConfig([{ id: 'p1', baseUrl: providerA.url }]);
  supabaseMock.writes.length = 0;

  const res = await aiChat('tok_instructor_1', '¿Cuánto debe mi dojo al sistema?', 'est-1');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.model, 'deterministic');
  assert.ok(String(json.data.content).includes('No tienes permisos para consultar la facturación de la plataforma.'));
  assert.equal(providerA.metrics.interpretationCalls, 0, 'cero interpretaciones');
  assert.equal(supabaseMock.writes.length, 0, 'sin escrituras');
});

