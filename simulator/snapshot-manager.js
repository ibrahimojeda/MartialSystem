// ══════════════════════════════════════════════════════════════
// snapshot-manager.js — Guarda y restaura snapshots del sistema
// ══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const SNAPSHOTS_DIR = path.join(__dirname, 'snapshots');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

class SnapshotManager {
  constructor(supabaseAdmin) {
    this.sb = supabaseAdmin;
    ensureDir(SNAPSHOTS_DIR);
  }

  async createSnapshot(label = null) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const name = label ? `${ts}_${label.replace(/[^a-zA-Z0-9_-]/g, '_')}` : ts;
    const snapshotPath = path.join(SNAPSHOTS_DIR, `${name}.json`);

    const tables = [
      'establishments', 'profiles', 'establishment_members', 'students',
      'student_enrollments', 'instructor_disciplines', 'class_sessions',
      'class_attendance_records', 'student_evaluations', 'payments',
      'notifications', 'marketplace_items', 'guardian_students',
      'tournament_registrations', 'tournament_results', 'inventory_items',
      'exam_grade_requests', 'exam_grade_results', 'system_commissions',
      'prospects', 'subscriptions'
    ];

    const snapshot = { timestamp: new Date().toISOString(), label, tables: {} };
    let totalRows = 0;

    for (const table of tables) {
      try {
        const { data, error } = await this.sb.from(table).select('*').limit(50000);
        if (error) {
          snapshot.tables[table] = { error: error.message, rows: 0 };
        } else {
          snapshot.tables[table] = { data: data || [], rows: (data || []).length };
          totalRows += (data || []).length;
        }
      } catch (err) {
        snapshot.tables[table] = { error: err.message, rows: 0 };
      }
    }

    snapshot.totalRows = totalRows;
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf-8');

    return {
      name,
      path: snapshotPath,
      timestamp: snapshot.timestamp,
      label,
      totalRows,
      tables: Object.entries(snapshot.tables).map(([t, v]) => ({
        table: t,
        rows: v.rows,
        hasError: !!v.error
      }))
    };
  }

  async restoreSnapshot(snapshotName) {
    const snapshotPath = path.join(SNAPSHOTS_DIR, `${snapshotName}.json`);
    if (!fs.existsSync(snapshotPath)) throw new Error(`Snapshot '${snapshotName}' not found`);

    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    const results = {};

    // Delete order (reverse dependency)
    const deleteOrder = [
      'system_commissions', 'exam_grade_results', 'exam_grade_requests',
      'tournament_results', 'tournament_registrations',
      'marketplace_items', 'notifications', 'guardian_students',
      'class_attendance_records', 'student_evaluations', 'payments',
      'student_enrollments', 'instructor_disciplines', 'class_sessions',
      'subscriptions', 'prospects', 'inventory_items',
      'students', 'establishment_members', 'profiles', 'establishments'
    ];

    // Clear existing data
    for (const table of deleteOrder) {
      try {
        const { error } = await this.sb.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (error) results[table] = { clearError: error.message };
      } catch (_) {}
    }

    // Restore data (in dependency order)
    const restoreOrder = [
      'establishments', 'profiles', 'establishment_members',
      'students', 'student_enrollments', 'instructor_disciplines',
      'class_sessions', 'class_attendance_records', 'student_evaluations',
      'payments', 'notifications', 'marketplace_items', 'guardian_students',
      'tournament_registrations', 'tournament_results', 'inventory_items',
      'exam_grade_requests', 'exam_grade_results', 'system_commissions',
      'prospects', 'subscriptions'
    ];

    for (const table of restoreOrder) {
      const tableData = snapshot.tables[table];
      if (!tableData || !tableData.data || tableData.data.length === 0) continue;

      try {
        const batchSize = 500;
        let restored = 0;
        for (let i = 0; i < tableData.data.length; i += batchSize) {
          const batch = tableData.data.slice(i, i + batchSize);
          const { error } = await this.sb.from(table).insert(batch);
          if (error) {
            results[table] = { restoreError: error.message, restoredSoFar: restored };
            break;
          }
          restored += batch.length;
        }
        if (!results[table]?.restoreError) {
          results[table] = { restored };
        }
      } catch (err) {
        results[table] = { restoreError: err.message };
      }
    }

    return { snapshot: snapshotName, results };
  }

  listSnapshots() {
    ensureDir(SNAPSHOTS_DIR);
    const files = fs.readdirSync(SNAPSHOTS_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SNAPSHOTS_DIR, f), 'utf-8'));
        return {
          name: f.replace('.json', ''),
          timestamp: data.timestamp,
          label: data.label,
          totalRows: data.totalRows,
          tableCount: Object.keys(data.tables || {}).length
        };
      } catch (_) {
        return { name: f.replace('.json', ''), error: 'Could not parse snapshot' };
      }
    }).sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  }

  deleteSnapshot(snapshotName) {
    const filePath = path.join(SNAPSHOTS_DIR, `${snapshotName}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }
}

module.exports = { SnapshotManager };