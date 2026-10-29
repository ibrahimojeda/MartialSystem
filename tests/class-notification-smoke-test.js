// tests/class-notification-smoke-test.js
// Smoke controlado del flujo de notificaciones de clases (Fase C: outbox + RPC).
// Reversible: cambia `location` de una clase y la restaura. NO borra registros.
//
// Por defecto usa tests/.production.env (PROD_*). Para staging, exporta SMOKE_*:
//   $env:SMOKE_BASE_URL='...'; $env:SMOKE_OWNER_USER='...'; $env:SMOKE_OWNER_PASS='...'; $env:SMOKE_EST_ID='...'
//   node tests/class-notification-smoke-test.js

const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '.production.env') }); } catch (_) {}

const BASE = String(process.env.SMOKE_BASE_URL || process.env.PROD_BASE_URL || 'https://martialsystem.onrender.com').replace(/\/+$/, '');
const OWNER_USER = process.env.SMOKE_OWNER_USER || process.env.PROD_OWNER_USER || '';
const OWNER_PASS = process.env.SMOKE_OWNER_PASS || process.env.PROD_OWNER_PASS || '';
const EST_ID = process.env.SMOKE_EST_ID || process.env.PROD_EST_ID || '';

let PASS = 0, FAIL = 0, SKIP = 0;
const ok = (m) => { PASS++; console.log('  [PASS] ' + m); };
const fail = (m) => { FAIL++; console.log('  [FAIL] ' + m); };
const skip = (m) => { SKIP++; console.log('  [SKIP] ' + m); };

async function login(u, p) {
  const res = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  const json = await res.json().catch(() => ({}));
  return (json.data && json.data.access_token) || '';
}
async function req(method, p, token, body) {
  const res = await fetch(BASE + p, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

(async () => {
  console.log('== Smoke notificaciones de clases (Fase C) ==');
  console.log('URL: ' + BASE);

  // 0) health (muestra el commit desplegado)
  let commit = '';
  try {
    const h = await fetch(BASE + '/api/health'); const hj = await h.json().catch(() => ({}));
    if (h.status === 200 && hj.ok === true) { commit = String(hj.commit || ''); ok('health OK (commit ' + commit + ')'); }
    else fail('health (status ' + h.status + ')');
  } catch (e) { fail('health (' + e.message + ')'); }

  const token = await login(OWNER_USER, OWNER_PASS);
  if (!token) { fail('owner login'); console.log('\nRESULTADO: NO-GO ❌'); process.exit(1); }
  ok('owner login');

  if (!EST_ID) { skip('sin SMOKE_EST_ID/PROD_EST_ID — no se puede listar clases'); finish(); return; }

  // 1) listar clases
  const classes = await req('GET', '/api/classes?establishmentId=' + encodeURIComponent(EST_ID), token);
  const list = (classes.json && classes.json.data) || [];
  const cls = Array.isArray(list) && list.length ? list[0] : null;
  if (!cls) { skip('sin clases en el establecimiento — no se puede PATCH'); finish(); return; }
  ok('clase encontrada: ' + (cls.title || cls.id) + ' (' + cls.id + ')');

  const origLocation = cls.location || null;
  const marker = 'SMOKE-' + Date.now();

  // 2) PATCH reversible (location) → debe encolar vía RPC y responder rápido
  const t0 = Date.now();
  const r1 = await req('PATCH', '/api/classes/' + cls.id, token, { location: marker });
  const ms = Date.now() - t0;
  const d1 = r1.json && r1.json.data;
  if (r1.status === 200 && d1 && d1.notification_status === 'queued') {
    ok('PATCH location → 200 + notification_status=queued (notifications_queued=' + d1.notifications_queued + ', ' + ms + 'ms)');
  } else {
    fail('PATCH location (status ' + r1.status + ', body ' + JSON.stringify(r1.json) + ')');
  }

  // 3) PATCH idéntico → changed=false (idempotencia, no duplica outbox)
  const r2 = await req('PATCH', '/api/classes/' + cls.id, token, { location: marker });
  const d2 = r2.json && r2.json.data;
  if (r2.status === 200 && d2 && d2.changed === false) ok('PATCH idéntico → changed=false (idempotente)');
  else fail('PATCH idéntico (status ' + r2.status + ')');

  // 4) restaurar location original
  const r3 = await req('PATCH', '/api/classes/' + cls.id, token, { location: origLocation });
  if (r3.status === 200) ok('restaurar location original');
  else fail('restaurar location (status ' + r3.status + ')');

  console.log('\n[NOTA] El worker procesa en background. Para confirmar `sent` sin duplicados, ejecuta la integración\n       (RUN_INTEGRATION=1) o consulta en Supabase:\n         select status, count(*) from class_notification_outbox group by status;');

  finish();
})().catch((e) => { console.error('FATAL: ' + e.message); process.exit(2); });

function finish() {
  console.log('\n== Resumen ==');
  console.log('PASS: ' + PASS + '   FAIL: ' + FAIL + '   SKIP: ' + SKIP);
  if (FAIL === 0) { console.log('RESULTADO: OK ✅'); process.exit(0); }
  console.log('RESULTADO: NO-GO ❌'); process.exit(1);
}
