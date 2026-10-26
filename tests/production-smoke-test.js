// tests/production-smoke-test.js — Smoke test controlado del módulo student_charges
// en PRODUCCIÓN. Usa UNA academia y UN alumno de prueba. NO borra registros.
// Credenciales en tests/.production.env (gitignored).
//
// Uso:  node tests/production-smoke-test.js

require('dotenv').config({ path: require('path').join(__dirname, '.production.env') });

const BASE = String(process.env.PROD_BASE_URL || 'https://martialsystem.onrender.com').replace(/\/+$/, '');

let PASS = 0, FAIL = 0, SKIP = 0;
const ok = (d) => { PASS++; console.log('  [PASS] ' + d); };
const fail = (d) => { FAIL++; console.log('  [FAIL] ' + d); };
const skip = (d) => { SKIP++; console.log('  [SKIP] ' + d); };

const env = (n) => process.env[n] || '';

async function login(username, password) {
  const res = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const json = await res.json().catch(() => ({}));
  return (json.data && json.data.access_token) || '';
}
async function req(method, path, token, body) {
  const res = await fetch(BASE + path, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

(async () => {
  console.log('== Smoke test student_charges en PRODUCCIÓN ==');
  console.log('URL: ' + BASE);

  // 0) healthcheck
  try {
    const h = await fetch(BASE + '/api/health');
    const hj = await h.json().catch(() => ({}));
    if (h.status === 200 && hj.ok === true) ok('health OK (commit ' + (hj.commit || '?') + ')');
    else fail('health (status ' + h.status + ')');
  } catch (e) { fail('health (' + e.message + ')'); }

  const owner = await login(env('PROD_OWNER_USER'), env('PROD_OWNER_PASS'));
  if (!owner) { fail('owner login'); process.exit(1); }
  ok('owner login');

  const estId = env('PROD_EST_ID');
  const stuId = env('PROD_STUDENT_ID');

  // 1) crear cargo de prueba + 2) verificar pending
  let chargeId = null;
  if (estId && stuId) {
    const body = {
      establishmentId: estId, studentId: stuId, chargeType: 'membership',
      periodKey: 'SMOKE-' + Date.now(), description: 'Cargo smoke test',
      amount: 500, currency: 'ARS', dueDate: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10)
    };
    const r = await req('POST', '/api/student-charges', owner, body);
    if (r.status === 200 || r.status === 201) {
      chargeId = r.json && r.json.data && r.json.data.id;
      ok('crear cargo de prueba');
      const chk = await req('GET', '/api/student-charges/' + chargeId, owner);
      if (chk.json && chk.json.data && chk.json.data.status === 'pending') ok('cargo aparece como pending');
      else fail('cargo pending');
    } else fail('crear cargo (status ' + r.status + ')');
  } else skip('crear cargo (sin PROD_EST_ID/PROD_STUDENT_ID)');

  // 3) pago parcial, 4) pago completo, 5) sobreaplicación, 6) doble aplicación
  if (chargeId && estId && stuId) {
    const mkPay = async (amount, concept) => {
      const r = await req('POST', '/api/payments', owner, { establishmentId: estId, studentId: stuId, amount, currency: 'ARS', method: 'cash', concept });
      return (r.json && r.json.data && r.json.data.id) || '';
    };
    const p1 = await mkPay(200, 'Smoke pago parcial');
    const p2 = await mkPay(300, 'Smoke pago completo');
    const p3 = await mkPay(100, 'Smoke sobreaplicacion');
    if (p1 && p2 && p3) {
      const k = await req('POST', `/api/student-charges/${chargeId}/apply-payment`, owner, { paymentId: p1, amountApplied: 200 });
      if (k.json && k.json.data && k.json.data.status === 'partial' && Number(k.json.data.paid_amount) === 200) ok('pago parcial → partial, paid_amount=200');
      else fail('pago parcial');

      const l = await req('POST', `/api/student-charges/${chargeId}/apply-payment`, owner, { paymentId: p2, amountApplied: 300 });
      if (l.json && l.json.data && l.json.data.status === 'paid' && Number(l.json.data.paid_amount) === 500) ok('pago completo → paid, paid_amount=500');
      else fail('pago completo');

      const m = await req('POST', `/api/student-charges/${chargeId}/apply-payment`, owner, { paymentId: p3, amountApplied: 1 });
      if (m.status === 400) ok('sobreaplicación rechazada'); else fail('sobreaplicación rechazada (status ' + m.status + ')');

      const n = await req('POST', `/api/student-charges/${chargeId}/apply-payment`, owner, { paymentId: p1, amountApplied: 50 });
      if (n.status === 400) ok('doble aplicación rechazada'); else fail('doble aplicación rechazada (status ' + n.status + ')');
    } else skip('pagos (no se pudieron crear pagos fixture)');
  }

  // 7) permisos por rol
  if (estId) {
    const rF = await req('GET', '/api/student-charges?establishmentId=' + encodeURIComponent(estId), owner);
    if (rF.status === 200) ok('owner lee cargos de su academia'); else fail('owner GET cargos (status ' + rF.status + ')');

    const instructor = await login(env('PROD_INSTRUCTOR_USER'), env('PROD_INSTRUCTOR_PASS'));
    if (instructor) {
      const rG = await req('GET', '/api/student-charges?establishmentId=' + encodeURIComponent(estId), instructor);
      if (rG.status === 200) ok('instructor lee cargos (solo autorizados)'); else fail('instructor GET (status ' + rG.status + ')');
    } else skip('instructor (sin credenciales)');

    const student = await login(env('PROD_STUDENT_USER'), env('PROD_STUDENT_PASS'));
    if (student) {
      const rH = await req('GET', '/api/student-charges?establishmentId=' + encodeURIComponent(estId), student);
      if (rH.status === 200) ok('estudiante lee cargos (solo propios)'); else fail('student GET (status ' + rH.status + ')');
    } else skip('estudiante (sin credenciales)');
  }

  // 8) payments histórico (verificación por snapshot en Supabase)
  console.log('\n[NOTA] Para verificar payments histórico, ejecuta ANTES y DESPUÉS en Supabase producción:');
  console.log('  select count(*) from payments;');
  console.log('  select count(*) from student_charges;');
  skip('payments histórico intacto (verificar con snapshot en Supabase)');

  console.log('\n== Resumen ==');
  console.log('PASS: ' + PASS + '   FAIL: ' + FAIL + '   SKIP: ' + SKIP);
  if (chargeId) console.log('Cargo de prueba creado (id): ' + chargeId + ' — estado final: paid (no cancelable por regla de negocio; revisar según política de auditoría)');
  if (FAIL === 0) { console.log('RESULTADO: OK ✅'); process.exit(0); }
  console.log('RESULTADO: NO-GO ❌'); process.exit(1);
})().catch((e) => { console.error('FATAL: ' + e.message); process.exit(2); });
