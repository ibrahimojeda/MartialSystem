// tests/frontend-ai-context.test.js
// Prueba de integración FRONTEND (sin navegador): valida invariantes del fuente real
// Y ejecuta el CÓDIGO REAL (buildAIChatBody + set/clear) para verificar el body real
// de /api/ai/chat. No es un E2E de navegador; ver "limitaciones" en el reporte.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');

function requireIn(needle, label) {
  assert.ok(html.includes(needle), 'Falta en el fuente: ' + (label || needle));
}

function extractBlock(startMarker, endMarker) {
  const re = new RegExp('/\\* ' + startMarker + ' \\*/\\n([\\s\\S]*?)/\\* ' + endMarker + ' \\*/');
  const m = html.match(re);
  assert.ok(m, 'Bloque no encontrado: ' + startMarker);
  return m[1];
}

// ── 1. Invariantes del fuente ─────────────────────────────────────────
test('estado de perfil seleccionado para IA está declarado', () => {
  requireIn('aiSelectedProfile: { profileId: null, profileName: null, profileType: null, establishmentId: null }', 'state.aiSelectedProfile');
});

test('setAISelectedProfile / clearAISelectedProfile / buildAIChatBody existen', () => {
  requireIn('window.setAISelectedProfile =');
  requireIn('window.clearAISelectedProfile =');
  requireIn('window.buildAIChatBody =');
});

test('contexto visible para el usuario', () => {
  requireIn('id="ai-context-line"');
  requireIn("'Contexto actual: '");
  requireIn("'No hay un perfil seleccionado.'");
});

test('instructor, guardian y student fijan el contexto IA con profileId (nunca studentId)', () => {
  requireIn("setAISelectedProfile(profileId, instr.name, 'instructor');");
  requireIn("setAISelectedProfile(profileId, tutor.name, 'guardian');");
  // student: se resuelve students.profile_id → profiles.id, nunca students.id.
  requireIn("setAISelectedProfile(studentProfileId, studentName, 'student', academyId);");
  requireIn("const studentProfileId = st?.profile_id || st?.profileId || selected?.profile_id || selected?.profileId || '';");
  requireIn("setAIContextHint('Este alumno no tiene un perfil de acceso asociado.');");
  const calls = (html.match(/setAISelectedProfile\(/g) || []).length;
  assert.equal(calls, 3, 'instructor, guardian y student deben llamar setAISelectedProfile (encontrados ' + calls + ')');
  // Ninguna llamada usa el studentId crudo (students.id) como targetProfileId.
  assert.ok(!/setAISelectedProfile\(\s*studentId\b/.test(html), 'no debe pasar students.id como profileId');
});

test('se limpia el perfil al cambiar de establecimiento y al cerrar sesión', () => {
  requireIn("ids('tree-establishment')?.addEventListener('change', () => {\n      clearAISelectedProfile();");
  requireIn('syncAdminPanelAccess();\n      clearAISelectedProfile();\n      setAuthenticated(false);');
});

// ── 2. Ejecución del CÓDIGO REAL (body del request) ──────────────────
test('buildAIChatBody (código real) arma el body correcto', () => {
  const block = extractBlock('AI_BODY_BUILDER_START', 'AI_BODY_BUILDER_END');
  const fn = new Function('window', block + '\nreturn window.buildAIChatBody;')({});

  // A. con perfil seleccionado
  assert.deepStrictEqual(
    fn({ profileId: 'profile-A', profileName: 'A' }, 'Muéstrame el resumen de este perfil', 'est-1'),
    { message: 'Muéstrame el resumen de este perfil', establishmentId: 'est-1', targetProfileId: 'profile-A' }
  );

  // B. sin perfil → targetProfileId no debe existir
  assert.deepStrictEqual(fn({ profileId: null }, 'msg', 'est-1'), { message: 'msg', establishmentId: 'est-1' });
  assert.ok(!('targetProfileId' in fn(null, 'msg', 'est-1')));

  // C. perfil A → A; perfil B → B
  assert.equal(fn({ profileId: 'profile-A' }, 'm', 'e').targetProfileId, 'profile-A');
  assert.equal(fn({ profileId: 'profile-B' }, 'm', 'e').targetProfileId, 'profile-B');

  // D. cerrar detalle (sin selección) → no envía A ni B
  assert.ok(!('targetProfileId' in fn({ profileId: null }, 'm', 'e')));
  assert.ok(!('targetProfileId' in fn({}, 'm', 'e')));

  // F. la función solo lee .profileId (nunca studentId/establishmentId)
  assert.ok(block.includes('sel.profileId'), 'debe leer sel.profileId');
  assert.ok(!block.includes('sel.studentId'), 'no debe leer studentId');
  assert.ok(!block.includes('sel.establishmentId'), 'no debe leer establishmentId');
});

// ── 3. Ejecución del CÓDIGO REAL (cambio de perfil / cierre) ─────────
test('setAISelectedProfile / clearAISelectedProfile / setAIContextHint (código real) gestionan el estado', () => {
  const block = extractBlock('AI_PROFILE_SELECT_START', 'AI_PROFILE_SELECT_END');
  const sandbox = {
    state: { aiSelectedProfile: { profileId: null, profileName: null, profileType: null, establishmentId: null }, aiContextHint: null },
    renderAIContext: () => {}
  };
  const win = new Function('window', 'state', 'renderAIContext', block + '\nreturn window;')({}, sandbox.state, sandbox.renderAIContext);

  // perfil A → A
  win.setAISelectedProfile('profile-A', 'A', 'instructor', 'est-1');
  assert.equal(sandbox.state.aiSelectedProfile.profileId, 'profile-A');
  assert.equal(sandbox.state.aiContextHint, null);

  // perfil B → B (cambiar de perfil)
  win.setAISelectedProfile('profile-B', 'B', 'instructor', 'est-1');
  assert.equal(sandbox.state.aiSelectedProfile.profileId, 'profile-B');

  // alumno sin profile_id → hint controlado + sin perfil
  win.clearAISelectedProfile();
  win.setAIContextHint('Este alumno no tiene un perfil de acceso asociado.');
  assert.equal(sandbox.state.aiSelectedProfile.profileId, null);
  assert.equal(sandbox.state.aiContextHint, 'Este alumno no tiene un perfil de acceso asociado.');

  // al seleccionar un perfil válido, se limpia el hint
  win.setAISelectedProfile('profile-C', 'C', 'student', 'est-1');
  assert.equal(sandbox.state.aiContextHint, null);
  assert.equal(sandbox.state.aiSelectedProfile.profileId, 'profile-C');
});

console.log('Suite frontend-ai-context: ejecutada con node:test');
