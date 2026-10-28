// server/student-receivables.js
// Servicios canónicos de cuentas por cobrar de alumnos (Fase A).
// Obligaciones: student_charges (fuente canónica de deuda).
// Pagos: payments (fuente canónica de pagos realizados).
// No suma monedas distintas. No cambia estados (el vencimiento es POST /mark-overdue).
// Recibe el cliente Supabase como parámetro (db) para ser testeable sin red.

function computeBalance(amount, paidAmount) {
  return Math.max(0, Number(amount || 0) - Number(paidAmount || 0));
}

function round2(n) { return Math.round(Number(n || 0) * 100) / 100; }

function todayISO() { return new Date().toISOString().slice(0, 10); }

// Estado derivado por alumno a partir de los ESTADOS reales de sus cargos.
// No deriva 'overdue' de la fecha: el vencimiento es una transición explícita.
function studentStatusFromCharges(charges) {
  if (!charges || !charges.length) return null;
  const has = (s) => charges.some((c) => c.status === s);
  if (has('overdue')) return 'overdue';
  const bal = charges.reduce((s, c) => s + computeBalance(c.amount, c.paid_amount), 0);
  const paid = charges.reduce((s, c) => s + Number(c.paid_amount || 0), 0);
  if (bal === 0) return 'paid';
  if (paid > 0) return 'partial';
  return 'pending';
}

// Agrupa cargos (no cancelados) por alumno y calcula saldos por moneda.
function aggregateStudentBalances(charges) {
  const map = {};
  for (const c of (charges || [])) {
    const sid = c.student_id;
    if (!map[sid]) {
      map[sid] = { student_id: sid, charges: [], curBalance: {}, curPaid: {}, oldest_due_date: null, overdue_count: 0 };
    }
    const b = map[sid];
    const bal = computeBalance(c.amount, c.paid_amount);
    const paid = Number(c.paid_amount || 0);
    const cur = c.currency || 'ARS';
    b.curBalance[cur] = round2((b.curBalance[cur] || 0) + bal);
    b.curPaid[cur] = round2((b.curPaid[cur] || 0) + paid);
    b.charges.push(c);
    if (c.status === 'overdue') b.overdue_count += 1;
    if (c.due_date && bal > 0 && (!b.oldest_due_date || String(c.due_date) < String(b.oldest_due_date))) {
      b.oldest_due_date = c.due_date;
    }
  }
  return Object.values(map).map((b) => {
    const amount_due = round2(b.charges.reduce((s, c) => s + Number(c.amount || 0), 0));
    const paid_amount = round2(b.charges.reduce((s, c) => s + Number(c.paid_amount || 0), 0));
    const balance_due = round2(Object.values(b.curBalance).reduce((s, n) => s + n, 0));
    return {
      student_id: b.student_id,
      student_name: null,
      amount_due,
      paid_amount,
      balance_due,
      status: studentStatusFromCharges(b.charges),
      oldest_due_date: b.oldest_due_date,
      number_of_overdue_charges: b.overdue_count,
      currency_balances: b.curBalance,
      currency_paid: b.curPaid,
      last_payment_date: null,
      last_payment_amount: null
    };
  });
}

// Resumen consolidado: personas (no filas) y montos por moneda.
function buildReceivablesSummary(balances, asOf) {
  const rows = balances || [];
  const out = {
    peopleOwing: 0, peoplePaid: 0, peoplePartial: 0,
    totalOutstanding: 0, totalPaid: 0, currencyBreakdown: [], asOf: asOf || todayISO()
  };
  const cur = {};
  for (const b of rows) {
    if (b.balance_due > 0) out.peopleOwing += 1;
    if (b.balance_due === 0 && b.amount_due > 0) out.peoplePaid += 1;
    if (b.balance_due > 0 && b.paid_amount > 0) out.peoplePartial += 1;
    for (const c of Object.keys(b.currency_balances || {})) {
      if (!cur[c]) cur[c] = { outstanding: 0, paid: 0 };
      cur[c].outstanding = round2(cur[c].outstanding + (b.currency_balances[c] || 0));
    }
    for (const c of Object.keys(b.currency_paid || {})) {
      if (!cur[c]) cur[c] = { outstanding: 0, paid: 0 };
      cur[c].paid = round2(cur[c].paid + (b.currency_paid[c] || 0));
    }
  }
  out.totalOutstanding = round2(rows.reduce((s, b) => s + b.balance_due, 0));
  out.totalPaid = round2(rows.reduce((s, b) => s + b.paid_amount, 0));
  out.currencyBreakdown = Object.keys(cur).sort().map((c) => ({ currency: c, outstanding: cur[c].outstanding, paid: cur[c].paid }));
  return out;
}

// ── Acceso a datos (db = cliente Supabase) ─────────────────────────────
async function fetchStudentNames(db, studentIds) {
  if (!studentIds.length) return {};
  const { data } = await db.from('students').select('id, full_name').in('id', studentIds).limit(5000);
  const map = {};
  (data || []).forEach((s) => { map[s.id] = s.full_name; });
  return map;
}

async function fetchLastPayments(db, establishmentId, studentIds) {
  if (!studentIds.length) return {};
  let q = db.from('payments').select('student_id, amount, paid_at').gt('amount', 0)
    .in('student_id', studentIds).order('paid_at', { ascending: false }).limit(10000);
  if (establishmentId) q = q.eq('establishment_id', establishmentId);
  const { data } = await q;
  const map = {};
  (data || []).forEach((p) => {
    if (!map[p.student_id] || String(p.paid_at) > String(map[p.student_id].paid_at)) map[p.student_id] = p;
  });
  return map;
}

// Devuelve el saldo consolidado por alumno. establishmentId null = global (solo superadmin).
async function getStudentBalances(db, { establishmentId, scope, status, studentId }) {
  let q = db.from('student_charges')
    .select('id, student_id, amount, paid_amount, currency, status, due_date, charge_type, period_key')
    .neq('status', 'cancelled')
    .limit(10000);
  if (establishmentId) q = q.eq('establishment_id', establishmentId);
  if (scope !== null && scope !== undefined) q = q.in('student_id', scope.length ? scope : ['__none__']);
  if (status) q = q.eq('status', status);
  if (studentId) q = q.eq('student_id', studentId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const balances = aggregateStudentBalances(data || []);
  const ids = balances.map((b) => b.student_id);
  const nameMap = await fetchStudentNames(db, ids);
  const lastPay = await fetchLastPayments(db, establishmentId, ids);
  balances.forEach((b) => {
    b.student_name = nameMap[b.student_id] || null;
    const lp = lastPay[b.student_id];
    b.last_payment_date = lp ? String(lp.paid_at || '').slice(0, 10) : null;
    b.last_payment_amount = lp ? Number(lp.amount || 0) : null;
  });
  return balances;
}

async function getStudentReceivablesSummary(db, { establishmentId, scope }) {
  const balances = await getStudentBalances(db, { establishmentId, scope });
  return buildReceivablesSummary(balances);
}

async function getOverdueStudentCharges(db, opts) {
  return (await getStudentBalances(db, opts)).filter((b) => b.status === 'overdue');
}

async function getPaidStudents(db, opts) {
  return (await getStudentBalances(db, opts)).filter((b) => b.status === 'paid');
}

async function getPartiallyPaidStudents(db, opts) {
  return (await getStudentBalances(db, opts)).filter((b) => b.status === 'partial');
}

async function getStudentsWithoutPayments(db, { establishmentId, scope }) {
  let sq = db.from('students').select('id, full_name').limit(10000);
  if (establishmentId) sq = sq.eq('establishment_id', establishmentId);
  if (scope !== null && scope !== undefined) sq = sq.in('id', scope.length ? scope : ['__none__']);
  const { data: students, error } = await sq;
  if (error) throw new Error(error.message);
  if (!students || !students.length) return [];
  const ids = students.map((s) => s.id);
  let pq = db.from('payments').select('student_id').gt('amount', 0).in('student_id', ids).limit(10000);
  if (establishmentId) pq = pq.eq('establishment_id', establishmentId);
  const { data: pays } = await pq;
  const paidIds = new Set((pays || []).map((p) => p.student_id));
  return students.filter((s) => !paidIds.has(s.id)).map((s) => ({ student_id: s.id, student_name: s.full_name || null, has_payments: false }));
}

module.exports = {
  computeBalance, round2, todayISO, studentStatusFromCharges,
  aggregateStudentBalances, buildReceivablesSummary,
  getStudentBalances, getStudentReceivablesSummary,
  getOverdueStudentCharges, getPaidStudents, getPartiallyPaidStudents, getStudentsWithoutPayments
};
