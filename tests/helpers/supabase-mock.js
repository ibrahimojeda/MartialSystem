// tests/helpers/supabase-mock.js
// Mock chainable de Supabase para pruebas E2E locales (sin red, sin datos reales).
// Registra escrituras en mock.writes (cada insert/update/delete).

function createSupabaseMock(seed = {}) {
  const mock = { writes: [], tokenMap: {}, _errors: {} };
  const tables = Object.assign({}, defaultSeed(), seed);

  function makeQuery(table, rows) {
    const state = { filters: [], limit: null, count: null, head: false, range: null };
    const q = {};
    const filtered = () => {
      let out = rows.slice();
      for (const f of state.filters) {
        if (f.type === 'eq') out = out.filter(r => r[f.col] === f.val);
        else if (f.type === 'neq') out = out.filter(r => r[f.col] !== f.val);
        else if (f.type === 'is') out = out.filter(r => r[f.col] == null);
        else if (f.type === 'ilike') out = out.filter(r => String(r[f.col] || '').toLowerCase().includes(String(f.val).toLowerCase().replace(/%/g, '')));
        else if (f.type === 'in') out = out.filter(r => (f.val || []).includes(r[f.col]));
        else if (f.type === 'gte') out = out.filter(r => r[f.col] >= f.val);
        else if (f.type === 'lte') out = out.filter(r => r[f.col] <= f.val);
        else if (f.type === 'gt') out = out.filter(r => r[f.col] > f.val);
        else if (f.type === 'lt') out = out.filter(r => r[f.col] < f.val);
      }
      if (state.limit != null) out = out.slice(0, state.limit);
      if (state.range) out = out.slice(state.range[0], state.range[1] + 1);
      return out;
    };
    q.select = (cols, opts) => {
      if (opts && opts.count) state.count = opts.count;
      if (opts && opts.head) state.head = opts.head;
      return q;
    };
    q.eq = (col, val) => { state.filters.push({ type: 'eq', col, val }); return q; };
    q.neq = (col, val) => { state.filters.push({ type: 'neq', col, val }); return q; };
    q.is = (col, val) => { state.filters.push({ type: 'is', col, val }); return q; };
    q.ilike = (col, val) => { state.filters.push({ type: 'ilike', col, val }); return q; };
    q.in = (col, val) => { state.filters.push({ type: 'in', col, val }); return q; };
    q.gte = (col, val) => { state.filters.push({ type: 'gte', col, val }); return q; };
    q.lte = (col, val) => { state.filters.push({ type: 'lte', col, val }); return q; };
    q.gt = (col, val) => { state.filters.push({ type: 'gt', col, val }); return q; };
    q.lt = (col, val) => { state.filters.push({ type: 'lt', col, val }); return q; };
    q.order = () => q;
    q.limit = (n) => { state.limit = n; return q; };
    q.range = (from, to) => { state.range = [from, to]; return q; };
    q.single = () => { const r = filtered(); return Promise.resolve(r.length ? { data: r[0], error: null } : { data: null, error: { message: 'not found' } }); };
    q.maybeSingle = () => { const r = filtered(); return Promise.resolve({ data: r.length ? r[0] : null, error: null }); };
    q.then = (resolve, reject) => {
      if (mock._errors[table]) return Promise.resolve({ data: null, error: { message: mock._errors[table] } }).then(resolve, reject);
      const r = filtered();
      const result = { data: state.head ? [] : r, error: null };
      if (state.count === 'exact') result.count = r.length;
      return Promise.resolve(result).then(resolve, reject);
    };
    q.insert = (payload) => {
      const recs = Array.isArray(payload) ? payload : [payload];
      if (mock._errors[table]) {
        const err = { message: mock._errors[table] };
        return { select: () => ({ single: () => Promise.resolve({ data: null, error: err }) }), then: (r) => Promise.resolve({ data: null, error: err }).then(r) };
      }
      recs.forEach(p => { mock.writes.push({ table, operation: 'insert', payload: p }); rows.push(p); });
      return { select: () => ({ single: () => Promise.resolve({ data: recs[0], error: null }) }), then: (r) => Promise.resolve({ data: recs, error: null }).then(r) };
    };
    q.update = (payload) => {
      const errResp = () => (mock._errors[table] ? { data: null, error: { message: mock._errors[table] } } : null);
      const upd = {
        eq: (col, val) => { state.filters.push({ type: 'eq', col, val }); return upd; },
        select: () => upd,
        single: () => {
          const e = errResp(); if (e) return Promise.resolve(e);
          const targets = filtered();
          targets.forEach(r => Object.assign(r, payload));
          mock.writes.push({ table, operation: 'update', payload });
          return Promise.resolve(targets.length ? { data: targets[0], error: null } : { data: null, error: { message: 'not found' } });
        },
        then: (resolve, reject) => {
          const e = errResp(); if (e) return Promise.resolve(e).then(resolve, reject);
          const targets = filtered();
          targets.forEach(r => Object.assign(r, payload));
          mock.writes.push({ table, operation: 'update', payload });
          return Promise.resolve({ data: targets, error: null }).then(resolve, reject);
        }
      };
      return upd;
    };
    q.delete = () => {
      const del = {
        eq: (col, val) => { state.filters.push({ type: 'eq', col, val }); return del; },
        in: (col, val) => { state.filters.push({ type: 'in', col, val }); return del; },
        then: (resolve, reject) => {
          if (mock._errors[table]) return Promise.resolve({ data: null, error: { message: mock._errors[table] } }).then(resolve, reject);
          const targets = filtered();
          for (const t of targets) { const idx = rows.indexOf(t); if (idx >= 0) rows.splice(idx, 1); }
          mock.writes.push({ table, operation: 'delete', payload: { count: targets.length } });
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
      };
      return del;
    };
    return q;
  }

  return {
    from: (t) => makeQuery(t, tables[t] || []),
    auth: {
      getUser: (token) => {
        const u = mock.tokenMap[token];
        return u ? Promise.resolve({ data: { user: u }, error: null }) : Promise.resolve({ data: null, error: { message: 'invalid token' } });
      },
      signInWithPassword: () => Promise.resolve({ data: { session: null }, error: { message: 'mock: not implemented' } })
    },
    storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    rpc: () => Promise.resolve({ data: null, error: null }),
    writes: mock.writes,
    setToken: (token, user) => { mock.tokenMap[token] = user; },
    setError: (table, message) => { mock._errors[table] = message; },
    clearErrors: () => { mock._errors = {}; },
    _tables: tables
  };
}

function defaultSeed() {
  return {
    profiles: [
      { id: 'owner-1', username: 'owner1', role: 'owner', full_name: 'Owner 1', is_active: true, auth_email: 'owner1@users.martialsystem.local' },
      { id: 'instructor-1', username: 'inst1', role: 'instructor', full_name: 'Instructor 1', is_active: true, auth_email: 'inst1@users.martialsystem.local' },
      { id: 'instructor-2', username: 'inst2', role: 'instructor', full_name: 'Instructor 2', is_active: true, auth_email: 'inst2@users.martialsystem.local' }
    ],
    establishments: [
      { id: 'est-1', name: 'Dojo Bushido', city: 'C1', country: 'PA', is_active: true, created_at: '2026-01-01' },
      { id: 'est-2', name: 'Academia Ajena', city: 'C2', country: 'PA', is_active: true, created_at: '2026-01-01' }
    ],
    establishment_members: [
      { id: 'm1', establishment_id: 'est-1', profile_id: 'owner-1', role: 'owner', created_at: '2026-01-01' },
      { id: 'm2', establishment_id: 'est-1', profile_id: 'instructor-1', role: 'instructor', created_at: '2026-01-01' },
      { id: 'm3', establishment_id: 'est-2', profile_id: 'instructor-2', role: 'instructor', created_at: '2026-01-01' }
    ],
    students: [
      { id: 'stu-1', establishment_id: 'est-1', full_name: 'Alumno Uno', email: 's1@ex.invalid', phone: '111', profile_id: null, birth_date: null, created_at: '2026-01-01', discipline_code: null },
      { id: 'stu-2', establishment_id: 'est-2', full_name: 'Alumno Ajeno', email: 's2@ex.invalid', phone: '222', profile_id: null, birth_date: null, created_at: '2026-01-01', discipline_code: null }
    ],
    student_enrollments: [
      { id: 'e1', student_id: 'stu-1', discipline_id: 'disc-karate', current_rank: 'Blanco', status: 'active', instructor_profile_id: 'instructor-1' }
    ],
    disciplines: [
      { id: 'disc-karate', code: 'karate', name: 'Karate', is_active: true },
      { id: 'disc-bjj', code: 'bjj', name: 'BJJ', is_active: true }
    ],
    payments: [
      { id: 'pay-1', establishment_id: 'est-1', student_id: 'stu-1', discipline_id: 'disc-karate', amount: 100, currency: 'USD', method: 'cash', concept: 'Mensualidad', paid_at: '2026-10-01', created_by: 'owner-1' }
    ],
    class_sessions: [
      { id: 'cls-1', establishment_id: 'est-1', discipline_id: 'disc-karate', instructor_profile_id: 'instructor-1', title: 'Karate', scheduled_date: '2026-10-20', start_time: '10:00', end_time: '11:00', location: 'Sala 1', notes: null, status: 'scheduled', created_at: '2026-01-01', updated_at: '2026-01-01' }
    ],
    class_attendance_records: [],
    ai_memory: [],
    system_usage_bills: [
      { id: 'bill-1', establishment_id: 'est-1', billing_month: '2026-10', amount: 29, status: 'confirmed', due_date: '2026-10-05' }
    ],
    establishment_plans: [{ id: 'ep-1', establishment_id: 'est-1', plan_code: 'bushido' }],
    system_plans: [{ id: 'sp-1', code: 'bushido', name: 'Bushido', features: ['gestion_alumnos', 'ia_features'] }],
    instructor_disciplines: [{ id: 'id-1', establishment_id: 'est-1', instructor_profile_id: 'instructor-1', discipline_id: 'disc-karate' }],
    establishment_disciplines: [{ id: 'ed-1', establishment_id: 'est-1', discipline_id: 'disc-karate', is_active: true }],
    app_settings: [{ id: 'as-1', establishment_id: null, settings_key: '__ai__', settings_value: null, updated_at: null }],
    notifications: [],
    class_notification_events: [],
    class_notification_outbox: [],
    guardian_students: [],
    student_charges: [],
    student_charge_payments: [],
    conversations: [],
    conversation_members: [],
    messages: [],
    message_recipients: []
  };
}

module.exports = { createSupabaseMock };
