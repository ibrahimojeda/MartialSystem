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
  providerA.clear();
  providerB.clear();
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

  const res = await aiChat('tok_owner_1', '¿Cuántos alumnos tiene mi dojo?', 'est-1');
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

