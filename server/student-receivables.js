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

// Resuelve un rango de fechas a partir de `period` (o from/to explícito).
// Devuelve { from, to } en formato YYYY-MM-DD (null si no aplica).
function resolveDateRange({ from, to, period } = {}) {
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (period === 'this_month') {
    return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
  }
  if (period === 'last_month') {
    return { from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth(), 0)) };
  }
  if (period === 'this_week') {
    const day = now.getDay(); const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now); monday.setDate(now.getDate() - diff); monday.setHours(0, 0, 0, 0);
    return { from: iso(monday), to: iso(now) };
  }
  if (period === 'last_30_days') {
    const f = new Date(now); f.setDate(now.getDate() - 30); f.setHours(0, 0, 0, 0);
    return { from: iso(f), to: iso(now) };
  }
  if (from || to) return { from: from || null, to: to || null };
  return { from: null, to: null };
}

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

// Resumen consolidado. Métricas separadas por fuente:
// - peopleWithOutstandingBalance/PaidCharges/PartialCharges/OverdueCharges → student_charges (hoy).
// - peopleWhoMadePayments/totalCollected → payments (en el período).
function buildReceivablesSummary(balances, paymentMetrics, range) {
  const rows = balances || [];
  const pm = paymentMetrics || {};
  const r = range || {};
  const out = {
    asOf: todayISO(),
    from: r.from || null,
    to: r.to || null,
    period: r.period || null,
    peopleWithOutstandingBalance: 0,
    peopleWithPaidCharges: 0,
    peopleWithPartialCharges: 0,
    peopleWithOverdueCharges: 0,
    peopleWhoMadePayments: Number(pm.peopleWhoMadePayments) || 0,
    totalOutstanding: 0,
    totalCollected: Number(pm.totalCollected) || 0,
    currencyBreakdown: []
  };
  const cur = {};
  for (const b of rows) {
    if (b.balance_due > 0) out.peopleWithOutstandingBalance += 1;
    if (b.balance_due === 0 && b.amount_due > 0) out.peopleWithPaidCharges += 1;
    if (b.balance_due > 0 && b.paid_amount > 0) out.peopleWithPartialCharges += 1;
    if (b.status === 'overdue' || b.number_of_overdue_charges > 0) out.peopleWithOverdueCharges += 1;
    for (const c of Object.keys(b.currency_balances || {})) {
      if (!cur[c]) cur[c] = { outstanding: 0, paid: 0, collected: 0 };
      cur[c].outstanding = round2(cur[c].outstanding + (b.currency_balances[c] || 0));
    }
    for (const c of Object.keys(b.currency_paid || {})) {
      if (!cur[c]) cur[c] = { outstanding: 0, paid: 0, collected: 0 };
      cur[c].paid = round2(cur[c].paid + (b.currency_paid[c] || 0));
    }
  }
  for (const c of Object.keys(pm.collectedByCurrency || {})) {
    if (!cur[c]) cur[c] = { outstanding: 0, paid: 0, collected: 0 };
    cur[c].collected = round2(pm.collectedByCurrency[c]);
  }
  out.totalOutstanding = round2(rows.reduce((s, b) => s + b.balance_due, 0));
  out.currencyBreakdown = Object.keys(cur).sort().map((c) => ({ currency: c, outstanding: cur[c].outstanding, paid: cur[c].paid, collected: cur[c].collected }));
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
async function getStudentBalances(db, { establishmentId, scope, status, studentId, from, to }) {
  let q = db.from('student_charges')
    .select('id, student_id, amount, paid_amount, currency, status, due_date, charge_type, period_key')
    .neq('status', 'cancelled')
    .limit(10000);
  if (establishmentId) q = q.eq('establishment_id', establishmentId);
  if (scope !== null && scope !== undefined) q = q.in('student_id', scope.length ? scope : ['__none__']);
  if (status) q = q.eq('status', status);
  if (studentId) q = q.eq('student_id', studentId);
  if (from) q = q.gte('due_date', from);
  if (to) q = q.lte('due_date', to);
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

async function getPaymentMetrics(db, { establishmentId, scope, from, to }) {
  let q = db.from('payments').select('student_id, amount, currency, paid_at').gt('amount', 0).limit(10000);
  if (establishmentId) q = q.eq('establishment_id', establishmentId);
  if (scope !== null && scope !== undefined) q = q.in('student_id', scope.length ? scope : ['__none__']);
  if (from) q = q.gte('paid_at', from);
  if (to) q = q.lte('paid_at', to);
  const { data } = await q;
  const rows = data || [];
  const unique = new Set(rows.map((r) => r.student_id));
  const collectedByCurrency = {};
  let totalCollected = 0;
  rows.forEach((r) => {
    const amt = Number(r.amount || 0);
    totalCollected += amt;
    const c = r.currency || 'ARS';
    collectedByCurrency[c] = round2((collectedByCurrency[c] || 0) + amt);
  });
  return { peopleWhoMadePayments: unique.size, totalCollected: round2(totalCollected), collectedByCurrency };
}

async function getStudentReceivablesSummary(db, { establishmentId, scope, from, to, period }) {
  const range = resolveDateRange({ from, to, period });
  const balances = await getStudentBalances(db, { establishmentId, scope, from: range.from, to: range.to });
  const pm = await getPaymentMetrics(db, { establishmentId, scope, from: range.from, to: range.to });
  return buildReceivablesSummary(balances, pm, { from: range.from, to: range.to, period: period || null });
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
  computeBalance, round2, todayISO, resolveDateRange, studentStatusFromCharges,
  aggregateStudentBalances, buildReceivablesSummary,
  getStudentBalances, getStudentReceivablesSummary, getPaymentMetrics,
  getOverdueStudentCharges, getPaidStudents, getPartiallyPaidStudents, getStudentsWithoutPayments
};
