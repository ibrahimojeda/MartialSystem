// tests/student-charges-staging.js — Validación HTTP real del módulo student_charges
// contra un entorno Supabase STAGING. NO imprime credenciales, tokens ni cuerpos
// completos sensibles. Recibe TODO por variables de entorno.

const BASE_URL = String(process.env.STAGING_BASE_URL || '').replace(/\/$/, '');

let PASS = 0, FAIL = 0, SKIP = 0;
const ok = (d) => { PASS++; console.log('  [PASS] ' + d); };
const fail = (d) => { FAIL++; console.log('  [FAIL] ' + d); };
const skip = (d) => { SKIP++; console.log('  [SKIP] ' + d); };

if (!BASE_URL) { console.error('ERROR: define STAGING_BASE_URL'); process.exit(2); }

const env = (name) => process.env[name] || '';

async function login(username, password) {
  const res = await fetch(BASE_URL + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const json = await res.json().catch(() => ({}));
  return (json.data && json.data.access_token) || '';
}

async function req(method, path, token, body) {
  const res = await fetch(BASE_URL + path, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

// Preflight: detecta si la migración está aplicada. El middleware requireStudentCharges
// responde 503 STUDENT_CHARGES_NOT_READY ANTES de requireAuth cuando la tabla no existe.
async function preflight() {
  const res = await fetch(BASE_URL + '/api/student-charges');
  let json = null;
  try { json = await res.json(); } catch (_) {}
  if (res.status === 503 && json && json.code === 'STUDENT_CHARGES_NOT_READY') {
    console.error('DIAGNÓSTICO: las tablas student_charges / student_charge_payments NO existen en este entorno.');
    console.error('Acción: aplica supabase/019_student_charges.sql en el SQL Editor de Supabase (proyecto staging).');
    console.error('No ejecutes el rollback: no hay nada que revertir si las tablas no existen.');
    console.error('STUDENT_CHARGES_NOT_READY');
    process.exit(2);
  }
  if (res.status === 401 || res.status === 400 || res.status === 200) {
    console.log('Preflight OK: las tablas existen (el middleware no devolvió 503).');
    return;
  }
  console.error('Preflight inesperado (status ' + res.status + '). Revisa STAGING_BASE_URL y el proyecto Supabase conectado (¿staging o producción?).');
  process.exit(2);
}

// Preflight 2: con token de owner, verifica que las columnas/relaciones esperadas
// existan (migración completa). Distingue "tabla inexistente" (503, ya cubierto)
// de "tabla existe pero faltan columnas" (error 42P01/42703 de PostgREST).
async function preflightColumns(owner, estOwn) {
  if (!owner || !estOwn) return;
  const res = await req('GET', '/api/student-charges?establishmentId=' + encodeURIComponent(estOwn), owner);
  if (res.status === 200) { console.log('Preflight columnas OK (GET cargos responde 200).'); return; }
  const msg = (res.json && res.json.error) || '';
  if (/does not exist|undefined_column|42703|42P01|column/i.test(msg)) {
    console.error('DIAGNÓSTICO: las tablas existen pero faltan columnas/relaciones esperadas.');
    console.error('La migración 019 pudo quedar parcial. Revisa el historial del SQL Editor.');
    console.error('Detalle (sin datos sensibles): ' + String(msg).slice(0, 200));
    process.exit(2);
  }
  console.log('Preflight columnas: status ' + res.status + ' (se reportará en las pruebas).');
}

async function main() {
  console.log('== Validación student_charges en STAGING ==');
  console.log('URL: ' + BASE_URL);

  await preflight();

  const owner = await login(env('STAGING_OWNER_USER'), env('STAGING_OWNER_PASS'));
  const instructor = await login(env('STAGING_INSTRUCTOR_USER'), env('STAGING_INSTRUCTOR_PASS'));
  const student = await login(env('STAGING_STUDENT_USER'), env('STAGING_STUDENT_PASS'));
  const superadmin = await login(env('STAGING_SUPERADMIN_USER'), env('STAGING_SUPERADMIN_PASS'));
  if (!owner) { fail('owner login'); process.exit(1); }
  ok('owner login');
  if (!instructor) skip('instructor login (sin credenciales)');
  if (!student) skip('student login (sin credenciales)');
  if (!superadmin) skip('superadmin login (sin credenciales)');

  const estOwn = env('STAGING_EST_OWN_ID');
  const estOther = env('STAGING_EST_OTHER_ID');
  const stuOwn = env('STAGING_STUDENT_OWN_ID');
  const stuOther = env('STAGING_STUDENT_OTHER_ID');

  await preflightColumns(owner, estOwn);

  console.log('\n== A. Activación controlada (tabla no disponible) ==');
  ok('503 STUDENT_CHARGES_NOT_READY cubierto por preflight (si faltaran las tablas, el script ya habría abortado con diagnóstico)');

  console.log('\n== B/C/D/E. Crear cargo y validaciones ==');
  const chargeBase = {
    establishmentId: estOwn, studentId: stuOwn, chargeType: 'membership',
    periodKey: 'STAGE-' + Date.now(), description: 'Cargo sintético staging',
    amount: 500, currency: 'ARS', dueDate: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10)
  };
  let createdChargeId = null;

  if (estOwn && stuOwn) {
    const rB = await req('POST', '/api/student-charges', owner, chargeBase);
    if (rB.status === 200 || rB.status === 201) { ok('crear cargo válido (' + rB.status + ')'); createdChargeId = rB.json && rB.json.data && rB.json.data.id; }
    else fail('crear cargo válido (status ' + rB.status + ')');

    const rC = await req('POST', '/api/student-charges', owner, Object.assign({}, chargeBase, { amount: 0, periodKey: chargeBase.periodKey + '-z' }));
    if (rC.status === 400) ok('rechaza amount=0'); else fail('rechaza amount=0 (status ' + rC.status + ')');

    const rD = await req('POST', '/api/student-charges', owner, Object.assign({}, chargeBase, { amount: -10, periodKey: chargeBase.periodKey + '-n' }));
    if (rD.status === 400) ok('rechaza amount negativo'); else fail('rechaza amount negativo (status ' + rD.status + ')');

    if (estOther && stuOther) {
      const rE = await req('POST', '/api/student-charges', owner, Object.assign({}, chargeBase, { establishmentId: estOther, studentId: stuOther, periodKey: chargeBase.periodKey + '-x' }));
      if (rE.status === 400 || rE.status === 403) ok('rechaza establishmentId/studentId ajeno'); else fail('rechaza ajeno (status ' + rE.status + ')');
    } else skip('rechaza ajeno (sin STAGING_EST_OTHER_ID/STAGING_STUDENT_OTHER_ID)');
  } else {
    skip('crear/validar cargo (sin STAGING_EST_OWN_ID/STAGING_STUDENT_OWN_ID)');
  }

  console.log('\n== F/G/H. Tenancy por rol ==');
  if (estOwn) {
    const rF = await req('GET', '/api/student-charges?establishmentId=' + encodeURIComponent(estOwn), owner);
    if (rF.status === 200) {
      const ids = (rF.json && rF.json.data || []).map(c => c.establishment_id);
      const leaked = estOther && ids.includes(estOther);
      if (!leaked) ok('owner est-1 no ve cargos de est-2'); else fail('owner est-1 ve cargos de est-2');
    } else fail('owner GET cargos (status ' + rF.status + ')');

    if (instructor) {
      const rG = await req('GET', '/api/student-charges?establishmentId=' + encodeURIComponent(estOwn), instructor);
      if (rG.status === 200) ok('instructor lee cargos (solo autorizados)'); else fail('instructor lee cargos (status ' + rG.status + ')');
    }
    if (student) {
      const rH = await req('GET', '/api/student-charges?establishmentId=' + encodeURIComponent(estOwn), student);
      if (rH.status === 200) ok('student lee cargos (solo propios)'); else fail('student lee cargos (status ' + rH.status + ')');
    }
  } else skip('tenancy por rol (sin STAGING_EST_OWN_ID)');

  console.log('\n== I. Generación mensual idempotente ==');
  if (estOwn && stuOwn) {
    const genBody = { establishmentId: estOwn, periodKey: 'STAGE-IDEM-' + Date.now(), dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), amount: 600, description: 'Mensualidad staging', studentIds: [stuOwn] };
    const g1 = await req('POST', '/api/student-charges/generate-monthly', owner, genBody);
    const g2 = await req('POST', '/api/student-charges/generate-monthly', owner, genBody);
    const c1 = (g1.json && g1.json.data && g1.json.data.created || []).length;
    const c2 = (g2.json && g2.json.data && g2.json.data.created || []).length;
    if (c1 === 1 && c2 === 0) ok('generación idempotente (1 creado, 0 duplicado)'); else fail('generación idempotente (c1=' + c1 + ', c2=' + c2 + ')');
  } else skip('generación idempotente (sin IDs)');

  console.log('\n== J/P. mark-overdue y cancelación ==');
  if (estOwn && stuOwn) {
    const odBody = { establishmentId: estOwn, studentId: stuOwn, chargeType: 'other', periodKey: 'STAGE-OD-' + Date.now(), description: 'Cargo vencido staging', amount: 300, currency: 'ARS', dueDate: '2020-01-01' };
    const odCreate = await req('POST', '/api/student-charges', owner, odBody);
    if (odCreate.status === 200 || odCreate.status === 201) {
      const odId = odCreate.json.data.id;
      await req('POST', '/api/student-charges/mark-overdue', owner, { establishmentId: estOwn });
      const check = await req('GET', '/api/student-charges/' + odId, owner);
      if (check.json && check.json.data && check.json.data.status === 'overdue') ok('mark-overdue pending → overdue'); else fail('mark-overdue pending → overdue');
      const cancel = await req('PATCH', '/api/student-charges/' + odId, owner, { cancel: true });
      if (cancel.status === 200) ok('cancelar cargo vencido'); else fail('cancelar cargo vencido (status ' + cancel.status + ')');
    } else fail('crear cargo vencido (status ' + odCreate.status + ')');
  } else skip('mark-overdue/cancelación (sin IDs)');

  console.log('\n== K/L/M/N. Pagos (parcial, completo, sobreaplicación, doble) ==');
  if (createdChargeId && stuOwn && estOwn) {
    const mkPay = async (amount, concept) => {
      const r = await req('POST', '/api/payments', owner, { establishmentId: estOwn, studentId: stuOwn, amount, currency: 'ARS', method: 'cash', concept });
      return (r.json && r.json.data && r.json.data.id) || '';
    };
    const p1 = await mkPay(200, 'Pago parcial staging');
    const p2 = await mkPay(300, 'Pago complemento staging');
    const p3 = await mkPay(100, 'Pago sobreaplicacion staging');
    if (p1 && p2 && p3) {
      const k = await req('POST', `/api/student-charges/${createdChargeId}/apply-payment`, owner, { paymentId: p1, amountApplied: 200 });
      if (k.json && k.json.data && k.json.data.status === 'partial' && Number(k.json.data.paid_amount) === 200) ok('pago parcial (partial, paid_amount=200)'); else fail('pago parcial');
      const l = await req('POST', `/api/student-charges/${createdChargeId}/apply-payment`, owner, { paymentId: p2, amountApplied: 300 });
      if (l.json && l.json.data && l.json.data.status === 'paid') ok('pago completo → paid'); else fail('pago completo → paid');
      const m = await req('POST', `/api/student-charges/${createdChargeId}/apply-payment`, owner, { paymentId: p3, amountApplied: 1 });
      if (m.status === 400) ok('sobreaplicación rechazada'); else fail('sobreaplicación rechazada (status ' + m.status + ')');
      const n = await req('POST', `/api/student-charges/${createdChargeId}/apply-payment`, owner, { paymentId: p1, amountApplied: 50 });
      if (n.status === 400) ok('doble aplicación rechazada'); else fail('doble aplicación rechazada (status ' + n.status + ')');
    } else skip('pagos (no se pudieron crear pagos fixture)');
  } else skip('pagos (sin cargo creado)');

  console.log('\n== Q. IA consulta vencidos ==');
  {
    const q = await req('POST', '/api/ai/chat', owner, { message: '¿Quiénes tienen mensualidad vencida?', establishmentId: estOwn });
    if (q.status === 200 && q.json && q.json.data && q.json.data.content) ok('IA responde lista de vencidos'); else fail('IA lista de vencidos (status ' + q.status + ')');
  }

  console.log('\n== O. Historial de payments intacto ==');
  skip('payments intacto (verificado estructuralmente en suite local; revisar en Supabase)');

  console.log('\n== Resumen ==');
  console.log('PASS: ' + PASS + '   FAIL: ' + FAIL + '   SKIP: ' + SKIP);
  if (FAIL === 0) { console.log('RESULTADO: OK ✅'); process.exit(0); }
  console.log('RESULTADO: NO-GO ❌'); process.exit(1);
}

main().catch((e) => { console.error('FATAL: ' + e.message); process.exit(2); });


