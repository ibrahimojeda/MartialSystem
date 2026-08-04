// ══════════════════════════════════════════════════════════════
// audit-engine.js — Motor de auditoría y línea de tiempo (Modo Mantenimiento)
// ══════════════════════════════════════════════════════════════

class AuditEngine {
  constructor(supabaseAdmin) {
    this.sb = supabaseAdmin;
  }

  // ─── Escanear datos existentes y construir línea de tiempo ───
  async buildTimeline(dateFrom, dateTo) {
    const timeline = [];
    const stats = {
      establishments: 0, profiles: 0, students: 0, instructors: 0,
      senseis: 0, guardians: 0, classes: 0, attendanceRecords: 0,
      evaluations: 0, payments: 0, notifications: 0, tournaments: 0,
      marketplace: 0
    };

    // Load all data
    const [
      establishments, members, students, enrollments,
      classSessions, attendance, evaluations, payments,
      notifications, tournaments, tournamentResults
    ] = await Promise.all([
      this._safeQuery('establishments', 'id, name, city, country, is_active, created_at'),
      this._safeQuery('establishment_members', 'id, establishment_id, profile_id, role, created_at'),
      this._safeQuery('students', 'id, establishment_id, full_name, email, birth_date, created_at'),
      this._safeQuery('student_enrollments', 'id, student_id, discipline_id, current_rank, status, joined_at'),
      this._safeQuery('class_sessions', 'id, establishment_id, discipline_id, title, scheduled_date, start_time, status, created_at'),
      this._safeQuery('class_attendance_records', 'id, class_session_id, student_id, status, marked_at'),
      this._safeQuery('student_evaluations', 'id, establishment_id, student_id, discipline_id, score, passed, evaluated_at'),
      this._safeQuery('payments', 'id, establishment_id, student_id, amount, currency, paid_at'),
      this._safeQuery('notifications', 'id, establishment_id, title, audience_role, created_at'),
      this._safeQuery('tournament_registrations', 'id, establishment_id, tournament_name, created_at'),
      this._safeQuery('tournament_results', 'id, establishment_id, tournament_name, medal, created_at'),
      this._safeQuery('marketplace_items', 'id, establishment_id, title, price, is_active, created_at')
    ]);

    stats.establishments = establishments.length;
    stats.students = students.length;
    stats.instructors = members.filter(m => m.role === 'instructor').length;
    stats.senseis = members.filter(m => m.role === 'sensei').length;
    stats.guardians = members.filter(m => m.role === 'guardian').length;
    stats.classes = classSessions.length;
    stats.attendanceRecords = attendance.length;
    stats.evaluations = evaluations.length;
    stats.payments = payments.length;
    stats.notifications = notifications.length;
    stats.tournaments = tournaments.length + tournamentResults.length;
    stats.marketplace = 0; // loaded separately if needed

    stats.profiles = members.length;

    // Build timeline events
    for (const e of establishments) {
      timeline.push({ date: this._toDate(e.created_at), type: 'establishment', icon: '🏢', label: `Nuevo establecimiento: ${e.name}`, data: e });
    }
    for (const m of members) {
      timeline.push({ date: this._toDate(m.created_at), type: 'member', icon: m.role === 'instructor' ? '👨‍🏫' : m.role === 'sensei' ? '🥋' : m.role === 'guardian' ? '👨‍👧' : '👤', label: `Nuevo ${m.role} registrado`, data: m });
    }
    for (const s of students) {
      timeline.push({ date: this._toDate(s.created_at), type: 'student', icon: '🧑‍🎓', label: `Nuevo alumno: ${s.full_name}`, data: s });
    }
    for (const c of classSessions) {
      timeline.push({ date: c.scheduled_date || this._toDate(c.created_at), type: 'class', icon: '📚', label: `Clase: ${c.title}`, data: c });
    }
    for (const a of attendance) {
      timeline.push({ date: this._toDate(a.marked_at), type: 'attendance', icon: a.status === 'present' ? '✅' : a.status === 'late' ? '🟡' : '❌', label: `Asistencia: ${a.status}`, data: a });
    }
    for (const e of evaluations) {
      timeline.push({ date: this._toDate(e.evaluated_at), type: 'evaluation', icon: e.passed ? '🟢' : '🔴', label: `Evaluación: ${e.passed ? 'Aprobado' : 'Reprobado'} (score: ${e.score || '-'})`, data: e });
    }
    for (const p of payments) {
      timeline.push({ date: this._toDate(p.paid_at), type: 'payment', icon: '💰', label: `Pago: $${p.amount} ${p.currency || 'USD'}`, data: p });
    }
    for (const n of notifications) {
      timeline.push({ date: this._toDate(n.created_at), type: 'notification', icon: '📢', label: `Notificación: ${n.title}`, data: n });
    }
    for (const t of tournaments) {
      timeline.push({ date: this._toDate(t.created_at), type: 'tournament', icon: '🏆', label: `Torneo: ${t.tournament_name}`, data: t });
    }

    // Sort timeline by date
    timeline.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    // Filter by date range
    const filtered = timeline.filter(e => {
      if (dateFrom && e.date < dateFrom) return false;
      if (dateTo && e.date > dateTo) return false;
      return true;
    });

    return { timeline: filtered, stats, totalEvents: filtered.length };
  }

  // ─── Reproducir la línea de tiempo día a día ───
  async replayTimeline(dateFrom, dateTo, stepDays = 1) {
    const { timeline, stats } = await this.buildTimeline(dateFrom, dateTo);

    // Group events by date
    const byDate = {};
    for (const event of timeline) {
      const d = event.date;
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(event);
    }

    // Generate day-by-day snapshots
    const days = [];
    const current = new Date(dateFrom);
    const end = new Date(dateTo);

    let runningStats = {
      studentsActive: 0, classesHeld: 0, attendanceRate: 0,
      totalIncome: 0, evaluationsHeld: 0, errorsFound: 0,
      newStudents: 0, newPayments: 0, newClasses: 0
    };

    // Pre-calculate enrollment data
    const enrollments = await this._safeQuery('student_enrollments', 'student_id, status, joined_at');
    const payments = await this._safeQuery('payments', 'amount, paid_at');

    while (current <= end) {
      const dateStr = current.toISOString().slice(0, 10);
      const dayEvents = byDate[dateStr] || [];

      // Update running stats
      const dayStudents = dayEvents.filter(e => e.type === 'student').length;
      const dayClasses = dayEvents.filter(e => e.type === 'class').length;
      const dayPayments = dayEvents.filter(e => e.type === 'payment');
      const dayAttendance = dayEvents.filter(e => e.type === 'attendance');
      const dayEvaluations = dayEvents.filter(e => e.type === 'evaluation').length;

      runningStats.newStudents = dayStudents;
      runningStats.newClasses = dayClasses;
      runningStats.newPayments = dayPayments.length;

      // Count active students up to this date
      runningStats.studentsActive = enrollments.filter(e =>
        e.status === 'active' && e.joined_at <= dateStr
      ).length;

      // Count classes up to this date
      runningStats.classesHeld += dayClasses;

      // Attendance rate for this day
      const present = dayAttendance.filter(e => e.data?.status === 'present' || e.data?.status === 'late').length;
      runningStats.attendanceRate = dayAttendance.length > 0
        ? Math.round((present / dayAttendance.length) * 100)
        : runningStats.attendanceRate;

      // Income for this day
      const dayIncome = dayPayments.reduce((sum, e) => sum + Number(e.data?.amount || 0), 0);
      runningStats.totalIncome += dayIncome;

      // Evaluations
      runningStats.evaluationsHeld += dayEvaluations;

      // Anomalies for this day
      const anomalies = this._detectDayAnomalies(dateStr, dayEvents, runningStats);

      days.push({
        date: dateStr,
        events: dayEvents,
        eventCount: dayEvents.length,
        metrics: { ...runningStats },
        anomalies,
        dayIncome
      });

      current.setDate(current.getDate() + stepDays);
    }

    return { days, stats, totalDays: days.length };
  }

  // ─── Integridad de datos ───
  async auditIntegrity() {
    const findings = [];

    // 1. Students without enrollment
    const students = await this._safeQuery('students', 'id, full_name, establishment_id, created_at');
    const enrollments = await this._safeQuery('student_enrollments', 'student_id, status');
    const enrolledIds = new Set(enrollments.map(e => e.student_id));
    const unenrolled = students.filter(s => !enrolledIds.has(s.id));
    if (unenrolled.length > 0) {
      findings.push({ severity: 'warning', category: 'Integridad', message: `${unenrolled.length} alumno(s) sin inscripción en ninguna disciplina`, count: unenrolled.length, details: unenrolled.map(s => s.full_name).slice(0, 10) });
    }

    // 2. Enrollments without student
    const studentIds = new Set(students.map(s => s.id));
    const orphanEnrollments = enrollments.filter(e => !studentIds.has(e.student_id));
    if (orphanEnrollments.length > 0) {
      findings.push({ severity: 'critical', category: 'Integridad', message: `${orphanEnrollments.length} inscripción(es) huérfana(s) (sin alumno)`, count: orphanEnrollments.length });
    }

    // 3. Instructors without sensei
    const members = await this._safeQuery('establishment_members', 'profile_id, role, establishment_id');
    const instructors = members.filter(m => m.role === 'instructor');
    findings.push({ severity: 'info', category: 'Staff', message: `${instructors.length} instructor(es) registrado(s)`, count: instructors.length });

    // 4. Classes without attendance records
    const classes = await this._safeQuery('class_sessions', 'id, title, scheduled_date, status');
    const attendance = await this._safeQuery('class_attendance_records', 'class_session_id');
    const classesWithAttendance = new Set(attendance.map(a => a.class_session_id));
    const completedClasses = classes.filter(c => c.status === 'completed' || c.scheduled_date < new Date().toISOString().slice(0, 10));
    const classesNoAttendance = completedClasses.filter(c => !classesWithAttendance.has(c.id));
    if (classesNoAttendance.length > 0) {
      findings.push({ severity: 'warning', category: 'Asistencia', message: `${classesNoAttendance.length} clase(s) completada(s) sin registro de asistencia`, count: classesNoAttendance.length });
    }

    // 5. Students with very low attendance
    const attByStudent = {};
    attendance.forEach(a => {
      if (!attByStudent[a.student_id]) attByStudent[a.student_id] = { total: 0, present: 0 };
      attByStudent[a.student_id].total++;
      if (a.status === 'present' || a.status === 'late') attByStudent[a.student_id].present++;
    });
    const lowAttendance = Object.entries(attByStudent)
      .filter(([, s]) => s.total >= 3 && (s.present / s.total) < 0.5)
      .map(([sid, s]) => ({ studentId: sid, rate: Math.round((s.present / s.total) * 100), total: s.total }));
    if (lowAttendance.length > 0) {
      findings.push({ severity: 'warning', category: 'Asistencia', message: `${lowAttendance.length} alumno(s) con asistencia < 50%`, count: lowAttendance.length, details: lowAttendance.slice(0, 10) });
    }

    // 6. Financial analysis
    const payments = await this._safeQuery('payments', 'amount, paid_at, student_id');
    const totalPayments = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const paidStudentIds = new Set(payments.map(p => p.student_id));
    const unpaidStudents = students.filter(s => enrolledIds.has(s.id) && !paidStudentIds.has(s.id));
    if (unpaidStudents.length > 0) {
      findings.push({ severity: 'warning', category: 'Finanzas', message: `${unpaidStudents.length} alumno(s) activo(s) sin pagos registrados`, count: unpaidStudents.length });
    }
    findings.push({ severity: 'info', category: 'Finanzas', message: `Ingresos totales registrados: $${totalPayments.toFixed(2)} USD`, count: payments.length });

    // 7. Evaluations overdue
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
    const evaluations = await this._safeQuery('student_evaluations', 'student_id, evaluated_at');
    const lastEvalByStudent = {};
    evaluations.forEach(e => {
      if (!lastEvalByStudent[e.student_id] || e.evaluated_at > lastEvalByStudent[e.student_id]) {
        lastEvalByStudent[e.student_id] = e.evaluated_at;
      }
    });
    const needsEval = [...enrolledIds].filter(sid => !lastEvalByStudent[sid] || lastEvalByStudent[sid] < thirtyDaysAgo);
    if (needsEval.length > 0) {
      findings.push({ severity: 'info', category: 'Académico', message: `${needsEval.length} alumno(s) sin evaluación reciente (30+ días)`, count: needsEval.length });
    }

    // 8. System health
    findings.push({ severity: 'info', category: 'Resumen', message: `${stats?.establishments || 0} establecimientos, ${students.length} alumnos, ${members.length} miembros`, count: 0 });

    return { findings, summary: this._buildSummary(findings) };
  }

  _buildSummary(findings) {
    const critical = findings.filter(f => f.severity === 'critical').length;
    const warnings = findings.filter(f => f.severity === 'warning').length;
    const info = findings.filter(f => f.severity === 'info').length;
    return { critical, warnings, info, total: findings.length, healthScore: Math.max(0, 100 - (critical * 20) - (warnings * 5)) };
  }

  _detectDayAnomalies(date, events, stats) {
    const anomalies = [];
    const attendance = events.filter(e => e.type === 'attendance');
    if (attendance.length > 0) {
      const absent = attendance.filter(e => e.data?.status === 'absent').length;
      const rate = absent / attendance.length;
      if (rate > 0.4) {
        anomalies.push({ type: 'high_absence', severity: 'warning', message: `Alta ausencia (${Math.round(rate * 100)}%) el ${date}` });
      }
    }
    const payments = events.filter(e => e.type === 'payment');
    if (payments.length === 0 && events.some(e => e.type === 'class')) {
      // Classes held but no payments - not necessarily anomaly
    }
    const evalFailed = events.filter(e => e.type === 'evaluation' && !e.data?.passed);
    if (evalFailed.length >= 3) {
      anomalies.push({ type: 'eval_failures', severity: 'warning', message: `${evalFailed.length} evaluaciones reprobadas el ${date}` });
    }
    return anomalies;
  }

  // ─── Utility ───
  _toDate(ts) {
    if (!ts) return '1970-01-01';
    return String(ts).slice(0, 10);
  }

  async _safeQuery(table, columns = '*') {
    try {
      const { data, error } = await this.sb.from(table).select(columns).limit(50000);
      if (error) return [];
      return data || [];
    } catch (_) {
      return [];
    }
  }
}

module.exports = { AuditEngine };