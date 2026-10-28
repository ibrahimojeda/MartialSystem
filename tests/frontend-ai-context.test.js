// tests/frontend-ai-context.test.js
// Prueba de integración FRONTEND (a nivel de código fuente, sin navegador).
// Verifica que /api/ai/chat reciba targetProfileId desde el perfil seleccionado,
// que el contexto sea visible para el usuario, y que se limpie al cambiar de
// establecimiento o cerrar sesión. No es un E2E: valida invariantes del fuente real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');

function requireIn(needle, label) {
  assert.ok(html.includes(needle), 'Falta en el fuente: ' + (label || needle));
}

test('estado de perfil seleccionado para IA está declarado', () => {
  requireIn('aiSelectedProfile: { profileId: null, profileName: null, profileType: null, establishmentId: null }', 'state.aiSelectedProfile');
});

test('aiSendPrompt incluye targetProfileId solo si hay perfil seleccionado', () => {
  requireIn('const sel = state.aiSelectedProfile || {};');
  requireIn('if (sel.profileId) body.targetProfileId = sel.profileId;');
  // Nunca se envía student.id ni establishment.id como targetProfileId.
  assert.ok(!/targetProfileId\s*=\s*(student|establishment)/.test(html), 'no debe enviar student.id ni establishment.id como targetProfileId');
});

test('setAISelectedProfile / clearAISelectedProfile existen', () => {
  requireIn('window.setAISelectedProfile =');
  requireIn('window.clearAISelectedProfile =');
});

test('contexto visible para el usuario', () => {
  requireIn('id="ai-context-line"');
  requireIn("'Contexto actual: '");
  requireIn("'No hay un perfil seleccionado.'");
});

test('seleccionar instructor fija el perfil para IA (profileId real, no studentId)', () => {
  requireIn("setAISelectedProfile(profileId, instr.name, 'instructor');");
});

test('se limpia el perfil al cambiar de establecimiento y al cerrar sesión', () => {
  requireIn("ids('tree-establishment')?.addEventListener('change', () => {\n      clearAISelectedProfile();");
  requireIn('syncAdminPanelAccess();\n      clearAISelectedProfile();\n      setAuthenticated(false);');
});

console.log('Suite frontend-ai-context: ejecutada con node:test');
