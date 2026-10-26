// tests/verify-render-deploy.js — Verificación post-deploy de Render.
// Confirma que /api/health devuelve la versión correcta y que el commit
// desplegado es 0670c82 o un descendiente (contiene el fix .update().eq()).
// NO aplica SQL, NO hace rollback. Solo lectura.
//
// Uso:
//   node tests/verify-render-deploy.js
//   RENDER_BASE_URL=https://otra-url node tests/verify-render-deploy.js

const { execFileSync } = require('child_process');

const BASE = String(process.env.RENDER_BASE_URL || 'https://martialsystem.onrender.com').replace(/\/+$/, '');
const FIX_COMMIT = '0670c82';
const EXPECT_VERSION = '2.11.3';

let PASS = 0, FAIL = 0;
const ok = (m) => { PASS++; console.log('  [PASS] ' + m); };
const fail = (m) => { FAIL++; console.log('  [FAIL] ' + m); };

// ¿Es `ancestor` un ancestro de `commit` en el repo local?
function isAncestor(ancestor, commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', ancestor, commit], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

(async () => {
  console.log('== Verificación post-deploy Render ==');
  console.log('URL: ' + BASE + '/api/health');

  let res;
  try {
    res = await fetch(BASE + '/api/health');
  } catch (e) {
    console.error('ERROR al consultar /api/health: ' + e.message);
    console.log('RESULTADO: NO-GO ❌ (no se pudo consultar el healthcheck)');
    process.exit(2);
  }

  // 1) HTTP 200
  if (res.status === 200) ok('HTTP 200'); else fail('HTTP ' + res.status + ' (esperado 200)');

  let json = null;
  try { json = await res.json(); } catch (_) { json = null; }
  if (!json) {
    console.error('NO-GO: /api/health no devolvió JSON válido.');
    process.exit(1);
  }

  // 2) ok=true
  if (json.ok === true) ok('ok=true'); else fail('ok=' + JSON.stringify(json.ok) + ' (esperado true)');

  // 3) version
  if (json.version === EXPECT_VERSION) ok('version=' + EXPECT_VERSION); else fail('version=' + json.version + ' (esperado ' + EXPECT_VERSION + ')');

  // 4) branch
  if (json.branch === 'master') ok('branch=master'); else fail('branch=' + json.branch + ' (esperado master)');

  // 5) commit desplegado presente y con formato válido
  const commit = String(json.commit || '');
  if (/^[0-9a-f]{7,40}$/i.test(commit)) ok('commit desplegado: ' + commit);
  else fail('commit ausente o con formato inválido: "' + commit + '"');

  // 6) ¿contiene el fix? (debe ser descendiente de 0670c82)
  if (commit && isAncestor(FIX_COMMIT, commit)) {
    ok('commit es descendiente de ' + FIX_COMMIT + ' (contiene el fix .update().eq())');
  } else {
    fail('commit ' + commit + ' NO es descendiente de ' + FIX_COMMIT + ' (NO contiene el fix)');
  }

  console.log('');
  console.log('PASS: ' + PASS + '   FAIL: ' + FAIL);
  if (FAIL === 0) {
    console.log('RESULTADO: GO ✅ (Render ejecuta el fix ' + FIX_COMMIT + ')');
    process.exit(0);
  }
  console.log('RESULTADO: NO-GO ❌ (Render NO ejecuta el fix todavía; desplegar 0670c82 o un descendiente)');
  process.exit(1);
})();
