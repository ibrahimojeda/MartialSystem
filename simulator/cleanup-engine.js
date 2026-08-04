// ══════════════════════════════════════════════════════════════
// cleanup-engine.js — Motor de limpieza de datos de Supabase
// ══════════════════════════════════════════════════════════════

class CleanupEngine {
  constructor(supabaseAdmin, snapshotManager) {
    this.sb = supabaseAdmin;
    this.sm = snapshotManager;
  }

  // Dependency order for deletion (children first)
  static DELETE_ORDER = [
    'system_commissions',
    'exam_grade_results',
    'exam_grade_requests',
    'tournament_results',
    'tournament_registrations',
    'marketplace_items',
    'notifications',
    'guardian_students',
    'class_attendance_records',
    'student_evaluations',
    'payments',
    'student_enrollments',
    'instructor_disciplines',
    'class_sessions',
    'subscriptions',
    'prospects',
    'inventory_movements',
    'inventory_items',
    'students',
    'establishment_members',
    'profiles',
    'establishments'
  ];

  // Tables that can be selectively deleted
  static SELECTIVE_TABLES = {
    payments: 'Pagos',
    class_attendance_records: 'Asistencias',
    class_sessions: 'Clases',
    student_evaluations: 'Evaluaciones',
    students: 'Alumnos',
    establishment_members: 'Miembros (staff)',
    guardian_students: 'Vínculos Guardian-Alumno',
    marketplace_items: 'Marketplace',
    notifications: 'Notificaciones',
    tournament_registrations: 'Registros de Torneos',
    tournament_results: 'Resultados de Torneos',
    inventory_items: 'Inventario',
    inventory_movements: 'Movimientos de Inventario',
    exam_grade_requests: 'Solicitudes de Examen',
    exam_grade_results: 'Resultados de Examen',
    system_commissions: 'Comisiones',
    prospects: 'Prospectos',
    subscriptions: 'Subscripciones',
    student_enrollments: 'Inscripciones',
    instructor_disciplines: 'Instructor-Disciplina'
  };

  async getRowCounts() {
    const counts = {};
    const tables = Object.keys(CleanupEngine.SELECTIVE_TABLES);

    for (const table of tables) {
      try {
        const { count, error } = await this.sb
          .from(table)
          .select('*', { count: 'exact', head: true });
        counts[table] = error ? -1 : (count || 0);
      } catch (_) {
        counts[table] = -1;
      }
    }
    return counts;
  }

  async dryRun(options = {}) {
    const { tables, establishmentId, beforeDate } = options;
    const results = {};

    for (const table of (tables || Object.keys(CleanupEngine.SELECTIVE_TABLES))) {
      try {
        let query = this.sb.from(table).select('*', { count: 'exact', head: true });
        if (establishmentId && this._hasColumn(table, 'establishment_id')) {
          query = query.eq('establishment_id', establishmentId);
        }
        if (beforeDate && this._hasDateColumn(table)) {
          query = query.lt(this._getDateColumn(table), beforeDate);
        }
        const { count, error } = await query;
        results[table] = { wouldDelete: count || 0, error: error?.message || null };
      } catch (err) {
        results[table] = { wouldDelete: 0, error: err.message };
      }
    }

    const totalWouldDelete = Object.values(results)
      .reduce((sum, r) => sum + (r.wouldDelete || 0), 0);

    return { results, totalWouldDelete };
  }

  async executeCleanup(options = {}) {
    const { tables, establishmentId, beforeDate, createBackup = true } = options;
    const log = { startedAt: new Date().toISOString(), backup: null, deleted: {}, errors: {} };

    // Create backup before deleting
    if (createBackup) {
      try {
        log.backup = await this.sm.createSnapshot('pre_cleanup');
      } catch (err) {
        log.backupError = err.message;
      }
    }

    // Determine deletion order based on requested tables
    const requestedTables = tables || Object.keys(CleanupEngine.SELECTIVE_TABLES);
    const orderedTables = CleanupEngine.DELETE_ORDER.filter(t => requestedTables.includes(t));

    for (const table of orderedTables) {
      try {
        let query = this.sb.from(table).delete();

        // If we have filters, apply them
        if (establishmentId && this._hasColumn(table, 'establishment_id')) {
          query = query.eq('establishment_id', establishmentId);
        } else if (beforeDate && this._hasDateColumn(table)) {
          query = query.lt(this._getDateColumn(table), beforeDate);
        } else {
          // Delete all — use a column that always matches
          query = query.neq('id', '00000000-0000-0000-0000-000000000000');
        }

        const { data, error, count } = await query;
        if (error) {
          log.errors[table] = error.message;
        } else {
          log.deleted[table] = count || (data ? data.length : 0) || 0;
        }
      } catch (err) {
        log.errors[table] = err.message;
      }
    }

    log.finishedAt = new Date().toISOString();
    const totalDeleted = Object.values(log.deleted).reduce((s, n) => s + n, 0);
    log.totalDeleted = totalDeleted;

    return log;
  }

  async fullCleanup() {
    return this.executeCleanup({
      tables: CleanupEngine.DELETE_ORDER,
      createBackup: true
    });
  }

  _hasColumn(table, col) {
    // Most tables have establishment_id
    const noEstablishment = ['system_commissions'];
    if (col === 'establishment_id') return !noEstablishment.includes(table);
    return true;
  }

  _hasDateColumn(table) {
    return !!this._getDateColumn(table);
  }

  _getDateColumn(table) {
    const dateColumns = {
      payments: 'paid_at',
      class_attendance_records: 'marked_at',
      class_sessions: 'scheduled_date',
      student_evaluations: 'evaluated_at',
      notifications: 'created_at',
      tournament_registrations: 'created_at',
      tournament_results: 'created_at',
      exam_grade_requests: 'created_at',
      exam_grade_results: 'created_at',
      prospects: 'created_at',
      marketplace_items: 'created_at',
      inventory_movements: 'movement_date'
    };
    return dateColumns[table] || 'created_at';
  }

  static getAvailableTables() {
    return Object.entries(CleanupEngine.SELECTIVE_TABLES).map(([id, label]) => ({ id, label }));
  }
}

module.exports = { CleanupEngine };