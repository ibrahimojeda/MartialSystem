/**
 * MartialDataSync - Direct Supabase Data Synchronization Engine
 * Proporciona todas las operaciones de datos vÃ­a Supabase Direct.
 * Reemplaza el servidor Express en modo APK.
 * Hace polling cada 5 minutos y emite eventos para actualizar la UI.
 */
(function () {
  'use strict';

  class MartialDataSync {
    constructor(supabaseClient) {
      this.supabase = supabaseClient || window.MartialSupabase;
      this.profileId = null;
      this.accessToken = null;
      this.isApkMode = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
      this.pollInterval = 5 * 60 * 1000; // 5 minutos
      this.pollTimer = null;
      this.listeners = {};
      this.cache = {};
      this._lastSyncTimestamps = {};
      this._syncInProgress = false;
    }

    on(event, callback) {
      if (!this.listeners[event]) this.listeners[event] = [];
      this.listeners[event].push(callback);
      return () => {
        this.listeners[event] = (this.listeners[event] || []).filter(cb => cb !== callback);
      };
    }

    emit(event, data) {
      (this.listeners[event] || []).forEach(cb => {
        try { cb(data); } catch (e) { console.warn('[DataSync] listener error:', e); }
      });
    }

    async start(profileId, accessToken) {
      if (!this.supabase) throw new Error('Supabase client not available');
      this.profileId = profileId;
      this.accessToken = accessToken;
      console.log('[DataSync] Iniciando sincronizacion de datos...');
      try { await this.fullSync(); } catch (e) { console.warn('[DataSync] sync inicial parcial:', e.message); }
      this.startPolling();
      this.emit('ready', { profileId, timestamp: new Date().toISOString() });
      return true;
    }

    stop() {
      if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
      console.log('[DataSync] Sincronizacion detenida');
    }

    startPolling() {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = setInterval(() => this.poll(), this.pollInterval);
      console.log('[DataSync] Polling cada 5 minutos iniciado');
    }

    async poll() {
      if (this._syncInProgress) return;
      this._syncInProgress = true;
      try {
        const changed = await this.detectChanges();
        if (changed) {
          console.log('[DataSync] Cambios detectados, sincronizando...');
          await this.fullSync();
          this.emit('dataChange', { timestamp: new Date().toISOString() });
        }
      } catch (e) { /* silent */ }
      finally { this._syncInProgress = false; }
    }

    async detectChanges() {
      const tables = ['disciplines', 'establishments', 'establishment_members', 'profiles', 'students', 'classes', 'payments', 'evaluations', 'notifications'];
      let changed = false;
      for (const table of tables) {
        try {
          const { data } = await this.supabase.from(table)
            .select('updated_at', { count: 'exact', head: true })
            .order('updated_at', { ascending: false }).limit(1);
          const latest = data?.[0]?.updated_at || null;
          if (latest && latest !== this._lastSyncTimestamps[table]) {
            this._lastSyncTimestamps[table] = latest;
            changed = true;
          }
        } catch (_) { /* skip */ }
      }
      return changed;
    }

    async fullSync() {
      await Promise.allSettled([this.syncDisciplines(), this.syncProfile(), this.syncMemberships()]);
    }

    async syncDisciplines() {
      const { data, error } = await this.supabase.from('disciplines').select('id, code, name').order('name');
      if (!error && data) { this.cache.disciplines = data; this.emit('disciplines', data); }
      return this.cache.disciplines || [];
    }

    async syncProfile() {
      if (!this.profileId) return null;
      const { data, error } = await this.supabase.from('profiles').select('*').eq('id', this.profileId).single();
      if (!error && data) { this.cache.profile = data; this.emit('profile', data); }
      return this.cache.profile || null;
    }

    async syncMemberships() {
      if (!this.profileId) return [];
      const { data, error } = await this.supabase
        .from('establishment_members')
        .select('*, establishment:establishments(*)')
        .eq('profile_id', this.profileId);
      if (!error && data) { this.cache.memberships = data; this.emit('memberships', data); }
      return this.cache.memberships || [];
    }

    // â”€â”€â”€ DASHBOARD STUDENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async loadDashboardStudent(establishmentId, profileId) {
      const r = { enrollments: [], upcomingClasses: [], attendance: null, lastEvaluation: null, payments: [], notifications: [], nextRank: null };
      if (!establishmentId || !profileId) return r;
      try {
        const { data: stu } = await this.supabase
          .from('students').select('*, discipline:disciplines(*)')
          .eq('establishment_id', establishmentId).eq('profile_id', profileId);
        if (stu) r.enrollments = stu;
        const today = new Date().toISOString().slice(0, 10);
        const { data: cls } = await this.supabase.from('classes').select('*').eq('establishment_id', establishmentId).gte('scheduled_date', today).order('scheduled_date', { ascending: true }).limit(5);
        if (cls) r.upcomingClasses = cls;
        const sids = (stu || []).map(s => s.id);
        if (sids.length) {
          const { data: att } = await this.supabase.from('attendance').select('*').in('student_id', sids);
          if (att && att.length) { const p = att.filter(a => a.status === 'present' || a.status === 'late').length; r.attendance = { rate: Math.round((p / att.length) * 100), present: p, total: att.length }; }
          const { data: ev } = await this.supabase.from('evaluations').select('*, discipline:disciplines(name)').in('student_id', sids).order('evaluated_at', { ascending: false }).limit(1);
          if (ev && ev.length) { r.lastEvaluation = { score: ev[0].score, passed: ev[0].passed, discipline_name: ev[0].discipline?.name || '', evaluated_at: ev[0].evaluated_at }; }
          const { data: pay } = await this.supabase.from('payments').select('*').in('student_id', sids).order('paid_at', { ascending: false }).limit(5);
          if (pay) r.payments = pay;
        }
        const { data: notif } = await this.supabase.from('notifications').select('*').eq('establishment_id', establishmentId).or('recipient_profile_id.eq.' + profileId + ',audience_role.eq.student').order('created_at', { ascending: false }).limit(3);
        if (notif) r.notifications = notif;
      } catch (e) { console.warn('[DataSync] loadDashboardStudent:', e.message); }
      return r;
// â”€â”€â”€ DASHBOARD SENSEI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async loadDashboardSensei(establishmentId, profileId) {
      const r = { disciplines: [], totalStudents: 0, studentsPerDiscipline: {}, todayAttendance: null, todayClasses: [], pendingEvaluations: 0, notifications: [] };
      if (!establishmentId || !profileId) return r;
      try {
        const { data: disc } = await this.supabase.from('instructor_disciplines').select('*, discipline:disciplines(name)').eq('instructor_profile_id', profileId);
        if (disc) r.disciplines = disc.map(d => ({ name: d.discipline?.name || d.discipline_code, code: d.discipline_code }));
        const { data: stu } = await this.supabase.from('students').select('id, discipline_code, full_name').eq('establishment_id', establishmentId).overlaps('instructor_profile_ids', [profileId]);
        if (stu) { r.totalStudents = stu.length; const pd = {}; stu.forEach(s => { pd[s.discipline_code] = (pd[s.discipline_code] || 0) + 1; }); r.studentsPerDiscipline = pd; }
        const today = new Date().toISOString().slice(0, 10);
        const { data: cls } = await this.supabase.from('classes').select('*, discipline:disciplines(name)').eq('establishment_id', establishmentId).eq('scheduled_date', today).eq('instructor_profile_id', profileId).order('start_time');
        if (cls) r.todayClasses = cls;
        if (cls && cls.length) {
          const { data: att } = await this.supabase.from('attendance').select('*').in('class_id', cls.map(c => c.id));
          if (att) { const p = att.filter(a => a.status === 'present' || a.status === 'late').length; r.todayAttendance = { rate: att.length ? Math.round((p / att.length) * 100) : 0, present: p, total: att.length }; }
        }
      } catch (e) { console.warn('[DataSync] loadDashboardSensei:', e.message); }
      return r;
    }

    // â”€â”€â”€ DASHBOARD OWNER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async loadDashboardOwner(establishmentId) {
      const r = { totalStudents: 0, studentsPerDiscipline: {}, todayClasses: [], attendanceStats: {}, totalReceived: 0 };
      if (!establishmentId) return r;
      try {
        const { count: sc } = await this.supabase.from('students').select('*', { count: 'exact', head: true }).eq('establishment_id', establishmentId);
        r.totalStudents = sc || 0;
        const { data: stu } = await this.supabase.from('students').select('discipline_code').eq('establishment_id', establishmentId);
        if (stu) { const pd = {}; stu.forEach(s => { pd[s.discipline_code] = (pd[s.discipline_code] || 0) + 1; }); r.studentsPerDiscipline = pd; }
        const today = new Date().toISOString().slice(0, 10);
        const { data: cls } = await this.supabase.from('classes').select('*, discipline:disciplines(name)').eq('establishment_id', establishmentId).eq('scheduled_date', today).order('start_time');
        if (cls) r.todayClasses = cls;
        const ms = new Date(); ms.setDate(1); ms.setHours(0,0,0,0);
        const { data: pay } = await this.supabase.from('payments').select('amount').eq('establishment_id', establishmentId).gte('paid_at', ms.toISOString());
        if (pay) r.totalReceived = pay.reduce((s, p) => s + Number(p.amount || 0), 0);
        const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data: att } = await this.supabase.from('attendance').select('status').eq('establishment_id', establishmentId).gte('created_at', d30);
        if (att && att.length) { const p = att.filter(a => a.status === 'present' || a.status === 'late').length; r.attendanceStats = { rate: Math.round((p / att.length) * 100), present: p, total: att.length }; }
      } catch (e) { console.warn('[DataSync] loadDashboardOwner:', e.message); }
      return r;
    }

    // â”€â”€â”€ DASHBOARD SUPERADMIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async loadDashboardSuperadmin() {
      const r = { establishments: { total: 0, active: 0, inactive: 0 }, users: { total: 0, byRole: {} }, students: { total: 0 }, disciplines: { total: 0 }, payments: { hasData: false, ingresosSemana: 0 }, newThisWeek: 0 };
      try {
        const { data: ests } = await this.supabase.from('establishments').select('is_active');
        if (ests) { r.establishments.total = ests.length; r.establishments.active = ests.filter(e => e.is_active !== false).length; r.establishments.inactive = ests.filter(e => e.is_active === false).length; }
        const { data: mems } = await this.supabase.from('establishment_members').select('role');
        if (mems) { const br = {}; mems.forEach(m => { br[m.role] = (br[m.role] || 0) + 1; }); r.users.byRole = br; r.users.total = mems.length; }
        const { count: stuC } = await this.supabase.from('students').select('*', { count: 'exact', head: true });
        r.students.total = stuC || 0;
        const { count: discC } = await this.supabase.from('disciplines').select('*', { count: 'exact', head: true });
        r.disciplines.total = discC || 0;
        const wa = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { count: newC } = await this.supabase.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', wa);
        r.newThisWeek = newC || 0;
        const { data: wp } = await this.supabase.from('payments').select('amount').gte('paid_at', wa);
        if (wp && wp.length) { r.payments.hasData = true; r.payments.ingresosSemana = wp.reduce((s, p) => s + Number(p.amount || 0), 0); }
      } catch (e) { console.warn('[DataSync] loadDashboardSuperadmin:', e.message); }
      return r;
    }

    // ─── CRUD: Students ─────────────────────────────────────
    async createStudent(data) {
      if (!data.establishmentId || !data.disciplineCode || !data.fullName) throw new Error('establishmentId, disciplineCode y fullName son requeridos');
      const { data: profile, error: profErr } = await this.supabase.from('profiles').insert({ full_name: data.fullName, email: data.email, role: 'student' }).select().single();
      if (profErr) throw new Error(profErr.message);
      const { error: membErr } = await this.supabase.from('establishment_members').insert({ establishment_id: data.establishmentId, profile_id: profile.id, role: 'student' });
      if (membErr) throw new Error(membErr.message);
      const { data: student, error: stuErr } = await this.supabase.from('students').insert({ establishment_id: data.establishmentId, discipline_code: data.disciplineCode, profile_id: profile.id, full_name: data.fullName, email: data.email, phone: data.phone, birth_date: data.birthDate || null, current_rank: data.currentRank || null, instructor_profile_ids: data.instructorProfileIds || [], photo_url: data.photoUrl || null }).select().single();
      if (stuErr) throw new Error(stuErr.message);
      return { student, profile };
    }

    async getStudents(establishmentId, disciplineCode) {
      let q = this.supabase.from('students').select('*, profile:profiles!inner(*)').eq('establishment_id', establishmentId);
      if (disciplineCode) q = q.eq('discipline_code', disciplineCode);
      const { data, error } = await q.order('full_name');
      if (error) throw new Error(error.message);
      return data || [];
    }

    // ─── CRUD: Classes ──────────────────────────────────────
    async createClass(data) {
      const { data: result, error } = await this.supabase.from('classes').insert({ establishment_id: data.establishmentId, discipline_code: data.disciplineCode, title: data.title, scheduled_date: data.scheduledDate, start_time: data.startTime, end_time: data.endTime || null, location: data.location || null, notes: data.notes || null, instructor_profile_id: data.instructorProfileId || null }).select().single();
      if (error) throw new Error(error.message);
      return result;
    }

    async getClasses(establishmentId, disciplineCode, date) {
      let q = this.supabase.from('classes').select('*, discipline:disciplines(name)').eq('establishment_id', establishmentId);
      if (disciplineCode) q = q.eq('discipline_code', disciplineCode);
      if (date) q = q.eq('scheduled_date', date);
      const { data, error } = await q.order('scheduled_date', { ascending: true });
      if (error) throw new Error(error.message);
      return data || [];
    }

    // ─── CRUD: Payments ─────────────────────────────────────
    async createPayment(data) {
      const { data: result, error } = await this.supabase.from('payments').insert({ establishment_id: data.establishmentId, discipline_code: data.disciplineCode || null, student_id: data.studentId, amount: data.amount, currency: data.currency || 'USD', method: data.method || 'cash', concept: data.concept || '', paid_at: data.paidAt || new Date().toISOString() }).select().single();
      if (error) throw new Error(error.message);
      return result;
    }

    async getPayments(establishmentId, disciplineCode, studentId) {
      let q = this.supabase.from('payments').select('*').eq('establishment_id', establishmentId);
      if (disciplineCode) q = q.eq('discipline_code', disciplineCode);
      if (studentId) q = q.eq('student_id', studentId);
      const { data, error } = await q.order('paid_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    }

    // ─── CRUD: Notifications ────────────────────────────────
    async createNotification(data) {
      const { data: result, error } = await this.supabase.from('notifications').insert({ establishment_id: data.establishmentId, discipline_code: data.disciplineCode || null, recipient_profile_id: data.recipientProfileId || null, audience_role: data.audienceRole || 'all', title: data.title, body: data.body }).select().single();
      if (error) throw new Error(error.message);
      return result;
    }

    async getNotifications(establishmentId, disciplineCode) {
      let q = this.supabase.from('notifications').select('*').eq('establishment_id', establishmentId);
      if (disciplineCode) q = q.eq('discipline_code', disciplineCode);
      const { data, error } = await q.order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data || [];
    }

    // ─── CRUD: Instructors ──────────────────────────────────
    async createInstructor(data) {
      const { data: profile, error: profErr } = await this.supabase.from('profiles').insert({ full_name: data.fullName, username: data.username, role: 'instructor' }).select().single();
      if (profErr) throw new Error(profErr.message);
      const { error: membErr } = await this.supabase.from('establishment_members').insert({ establishment_id: data.establishmentId, profile_id: profile.id, role: 'instructor' });
      if (membErr) throw new Error(membErr.message);
      if (data.disciplineCodes && data.disciplineCodes.length) {
        const { error: discErr } = await this.supabase.from('instructor_disciplines').insert(data.disciplineCodes.map(code => ({ instructor_profile_id: profile.id, discipline_code: code, establishment_id: data.establishmentId })));
        if (discErr) throw new Error(discErr.message);
      }
      return { profile };
    }

    async getInstructors(establishmentId) {
      const { data, error } = await this.supabase.from('establishment_members').select('*, profile:profiles(*)').eq('establishment_id', establishmentId).eq('role', 'instructor');
      if (error) throw new Error(error.message);
      return (data || []).map(m => ({ profileId: m.profile_id, name: m.profile?.full_name || '', username: m.profile?.username || '', email: m.profile?.email || '', role: m.role, status: m.is_active !== false ? 'Activo' : 'Inactivo' }));
    }

    // ─── Helpers ─────────────────────────────────────────────
    formatResult(data) { return { ok: true, data }; }
    formatError(message) { return { ok: false, error: message }; }
  }

  // ─── Exponer globalmente ────────────────────────────────────────
  window.MartialDataSync = MartialDataSync;
  window.createDataSync = function(supabase) {
    const instance = new MartialDataSync(supabase);
    window._dataSync = instance;
    return instance;
  };
})();
