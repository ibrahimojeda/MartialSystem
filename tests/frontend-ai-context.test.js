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

test('solo los selectores de instructor y guardian fijan el contexto IA (nunca studentId)', () => {
  requireIn("setAISelectedProfile(profileId, instr.name, 'instructor');");
  requireIn("setAISelectedProfile(profileId, tutor.name, 'guardian');");
  // selectStudentForCurriculum recibe students.id, NO debe alimentar el contexto IA.
  requireIn('window.selectStudentForCurriculum = (studentId) =>', 'selectStudentForCurriculum usa studentId');
  const calls = (html.match(/setAISelectedProfile\(/g) || []).length;
  assert.equal(calls, 2, 'solo instructor y guardian deben llamar setAISelectedProfile (encontrados ' + calls + ')');
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
test('setAISelectedProfile / clearAISelectedProfile (código real) gestionan el estado', () => {
  const block = extractBlock('AI_PROFILE_SELECT_START', 'AI_PROFILE_SELECT_END');
  const sandbox = {
    state: { aiSelectedProfile: { profileId: null, profileName: null, profileType: null, establishmentId: null } },
    renderAIContext: () => {}
  };
  const win = new Function('window', 'state', 'renderAIContext', block + '\nreturn window;')({}, sandbox.state, sandbox.renderAIContext);

  // perfil A → A
  win.setAISelectedProfile('profile-A', 'A', 'instructor', 'est-1');
  assert.equal(sandbox.state.aiSelectedProfile.profileId, 'profile-A');

  // perfil B → B (cambiar de perfil)
  win.setAISelectedProfile('profile-B', 'B', 'instructor', 'est-1');
  assert.equal(sandbox.state.aiSelectedProfile.profileId, 'profile-B');

  // cerrar detalle → sin A ni B
  win.clearAISelectedProfile();
  assert.equal(sandbox.state.aiSelectedProfile.profileId, null);
  assert.equal(sandbox.state.aiSelectedProfile.profileName, null);
});

console.log('Suite frontend-ai-context: ejecutada con node:test');
