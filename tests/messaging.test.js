// tests/messaging.test.js — Mensajería interna (Fase B): endpoints + tenancy.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const msg = require('../server/messaging');

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

  globalThis.__TEST_SUPABASE_ADMIN__ = supabaseMock;
  globalThis.__TEST_SUPABASE_PUBLIC__ = supabaseMock;
  ({ app } = require('../server/index.js'));
  await new Promise((resolve) => { server = app.listen(0, () => { baseUrl = 'http://localhost:' + server.address().port; resolve(); }); });
});

after(async () => { if (server) await new Promise((r) => server.close(r)); });
beforeEach(() => { supabaseMock.writes.length = 0; supabaseMock.clearErrors(); });

let convId, messageId;

test('canAccessConversation: reglas de rol', async () => {
  const conv = { id: 'c-x', establishment_id: 'est-1' };
  assert.equal(await msg.canAccessConversation(supabaseMock, { profileId: 'owner-1', role: 'owner', isSuperadmin: false, establishmentId: 'est-1' }, conv), true);
  assert.equal(await msg.canAccessConversation(supabaseMock, { profileId: 'owner-1', role: 'owner', isSuperadmin: false, establishmentId: 'est-2' }, conv), false);
  assert.equal(await msg.canAccessConversation(supabaseMock, { profileId: 'superadmin-1', role: 'superadmin', isSuperadmin: true, establishmentId: null }, conv), true);
});

test('owner crea conversación con instructor', async () => {
  const res = await req('POST', '/api/conversations', 'tok_owner_1', { establishmentId: 'est-1', subject: 'Reunión', memberProfileIds: ['instructor-1'] });
  assert.equal(res.status, 200);
  const json = await res.json();
  convId = json.data.id;
  assert.ok(convId);
  const members = supabaseMock._tables.conversation_members.filter((m) => m.conversation_id === convId).map((m) => m.profile_id).sort();
  assert.deepEqual(members, ['instructor-1', 'owner-1']);
});

test('owner lista sus conversaciones', async () => {
  const res = await req('GET', '/api/conversations?establishmentId=est-1', 'tok_owner_1');
  assert.equal(res.status, 200);
  assert.ok((await res.json()).data.some((c) => c.id === convId));
});

test('instructor miembro lista la conversación', async () => {
  const res = await req('GET', '/api/conversations?establishmentId=est-1', 'tok_instructor_1');
  assert.ok((await res.json()).data.some((c) => c.id === convId));
});

test('owner agrega mensaje', async () => {
  const res = await req('POST', `/api/conversations/${convId}/messages?establishmentId=est-1`, 'tok_owner_1', { body: 'Hola instructor' });
  assert.equal(res.status, 200);
  const json = await res.json();
  messageId = json.data.id;
  assert.equal(json.data.body, 'Hola instructor');
});

test('GET detalle devuelve mensajes', async () => {
  const res = await req('GET', `/api/conversations/${convId}?establishmentId=est-1`, 'tok_owner_1');
  const json = await res.json();
  assert.ok(json.data.messages.some((m) => m.id === messageId));
});

test('marcar mensaje leído', async () => {
  const res = await req('PUT', `/api/messages/${messageId}/read?establishmentId=est-1`, 'tok_instructor_1');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('archivar conversación', async () => {
  const res = await req('PUT', `/api/conversations/${convId}/archive?establishmentId=est-1`, 'tok_owner_1');
  assert.equal(res.status, 200);
  assert.ok((await res.json()).data.archived_at);
});

test('instructor de otro establecimiento no accede (cross-tenant)', async () => {
  const res = await req('GET', `/api/conversations/${convId}?establishmentId=est-2`, 'tok_instructor_2');
  assert.equal(res.status, 403);
});

test('student no miembro no accede', async () => {
  const res = await req('GET', `/api/conversations/${convId}?establishmentId=est-1`, 'tok_student_1');
  assert.equal(res.status, 403);
});

test('guardian accede a conversación de su alumno vinculado', async () => {
  const createRes = await req('POST', '/api/conversations', 'tok_owner_1', { establishmentId: 'est-1', subject: 'Aviso', memberProfileIds: ['student-1'] });
  const cid = (await createRes.json()).data.id;
  const res = await req('GET', `/api/conversations/${cid}?establishmentId=est-1`, 'tok_guardian_1');
  assert.equal(res.status, 200);
  const listRes = await req('GET', '/api/conversations?establishmentId=est-1', 'tok_guardian_1');
  assert.ok((await listRes.json()).data.some((c) => c.id === cid));
});

test('lecturas de mensajería no escriben', async () => {
  supabaseMock.writes.length = 0;
  await req('GET', `/api/conversations/${convId}?establishmentId=est-1`, 'tok_owner_1');
  await req('GET', '/api/conversations?establishmentId=est-1', 'tok_owner_1');
  assert.equal(supabaseMock.writes.length, 0);
});

test('miembro de otro establecimiento rechazado (400)', async () => {
  const res = await req('POST', '/api/conversations', 'tok_owner_1', { establishmentId: 'est-1', subject: 'X', memberProfileIds: ['instructor-2'] });
  assert.equal(res.status, 400);
});

test('error al insertar conversación → 500 (nunca 200)', async () => {
  supabaseMock.setError('conversations', 'boom');
  const res = await req('POST', '/api/conversations', 'tok_owner_1', { establishmentId: 'est-1', subject: 'X', memberProfileIds: ['instructor-1'] });
  assert.equal(res.status, 500);
  const json = await res.json();
  assert.equal(json.ok, false);
  assert.ok(json.error);
});

test('error al insertar mensaje → 500', async () => {
  supabaseMock.setError('messages', 'boom');
  const res = await req('POST', `/api/conversations/${convId}/messages?establishmentId=est-1`, 'tok_owner_1', { body: 'x' });
  assert.equal(res.status, 500);
});

test('marcar leído un mensaje inexistente → 404', async () => {
  const res = await req('PUT', '/api/messages/nonexistent/read?establishmentId=est-1', 'tok_owner_1');
  assert.equal(res.status, 404);
});

test('no deja conversación parcial si falla un miembro', async () => {
  supabaseMock.setError('conversation_members', 'boom');
  const res = await req('POST', '/api/conversations', 'tok_owner_1', { establishmentId: 'est-1', subject: 'Parcial', memberProfileIds: ['instructor-1'] });
  assert.equal(res.status, 500);
  assert.ok(!supabaseMock._tables.conversations.some((c) => c.subject === 'Parcial'), 'no debe quedar conversación parcial');
});

test('superadmin crea conversación (administrativa)', async () => {
  const res = await req('POST', '/api/conversations', 'tok_superadmin', { establishmentId: 'est-1', subject: 'SA Admin', memberProfileIds: ['owner-1', 'instructor-1'] });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.data && json.data.id);
  assert.equal(json.data.created_by, null);
});

test('superadmin no puede enviar mensajes (403)', async () => {
  const res = await req('POST', `/api/conversations/${convId}/messages?establishmentId=est-1`, 'tok_superadmin', { body: 'hola' });
  assert.equal(res.status, 403);
});

test('instructor envía mensaje con sender_profile_id válido', async () => {
  const res = await req('POST', `/api/conversations/${convId}/messages?establishmentId=est-1`, 'tok_instructor_1', { body: 'Hola desde instructor' });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.data && json.data.id);
  assert.equal(json.data.sender_profile_id, 'instructor-1');
  assert.ok(json.data.sender_profile_id !== 'superadmin');
});

console.log('Suite messaging: ejecutada con node:test');
