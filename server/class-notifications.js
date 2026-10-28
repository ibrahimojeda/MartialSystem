// server/class-notifications.js
// Notificaciones de clases (Fase C, incremento 2).
// Resuelve destinatarios y genera notificaciones IDEMPOTENTES usando la tabla
// class_notification_events (dedup por clase + evento + destinatario + versión).
// Recibe el cliente Supabase como parámetro (db) para ser testeable sin red.

const crypto = require('crypto');

function httpError(status, message, code) { const e = new Error(message); e.status = status; if (code) e.code = code; return e; }

// Destinatarios reales de una clase (solo profiles con profile_id no nulo).
async function resolveClassRecipients(db, { disciplineId, instructorProfileId }) {
  let studentProfileIds = [];
  let guardianProfileIds = [];
  if (disciplineId) {
    const { data: enrolls } = await db.from('student_enrollments').select('student_id').eq('discipline_id', disciplineId).eq('status', 'active').limit(5000);
    const studentIds = [...new Set((enrolls || []).map((e) => e.student_id).filter(Boolean))];
    if (studentIds.length) {
      const { data: students } = await db.from('students').select('id, profile_id').in('id', studentIds).limit(5000);
      studentProfileIds = [...new Set((students || []).map((s) => s.profile_id).filter(Boolean))];
      const { data: links } = await db.from('guardian_students').select('guardian_profile_id').in('student_id', studentIds).limit(5000);
      guardianProfileIds = [...new Set((links || []).map((l) => l.guardian_profile_id).filter(Boolean))];
    }
  }
  return { students: studentProfileIds, guardians: guardianProfileIds, instructor: instructorProfileId || null };
}

// Genera notificaciones idempotentes para UN evento de clase.
// Devuelve { notified, recipients } (notified = avisos nuevos creados).
async function notifyClassEvent(db, { classId, establishmentId, eventType, title, body, version, recipients }) {
  const targets = [...new Set([
    ...(recipients.students || []),
    ...(recipients.guardians || []),
    ...(recipients.instructor ? [recipients.instructor] : [])
  ].filter(Boolean))];

  let notified = 0;
  for (const pid of targets) {
    const { data: existing } = await db.from('class_notification_events')
      .select('id').eq('class_id', classId).eq('event_type', eventType).eq('recipient_profile_id', pid).eq('version', version).maybeSingle();
    if (existing) continue;

    const { error: nErr } = await db.from('notifications').insert({
      id: crypto.randomUUID(), establishment_id: establishmentId,
      recipient_profile_id: pid, title, body, is_read: false
    });
    if (nErr) throw httpError(500, 'No se pudo crear notificación: ' + nErr.message);

    const { error: dErr } = await db.from('class_notification_events').insert({
      id: crypto.randomUUID(), class_id: classId, event_type: eventType, recipient_profile_id: pid, version
    });
    if (dErr) throw httpError(500, 'No se pudo registrar dedup: ' + dErr.message);
    notified += 1;
  }
  return { notified, recipients: targets.length };
}

// Devuelve los tipos de evento que cambió un PATCH (para notificar).
function detectClassEventTypes(oldClass, patch) {
  const events = [];
  if (patch.status === 'cancelled' && oldClass.status !== 'cancelled') events.push('class_cancelled');
  if ((patch.scheduledDate !== undefined && patch.scheduledDate !== oldClass.scheduled_date) ||
      (patch.startTime !== undefined && patch.startTime !== oldClass.start_time) ||
      (patch.endTime !== undefined && String(patch.endTime) !== String(oldClass.end_time))) events.push('class_rescheduled');
  if (patch.instructorProfileId !== undefined && patch.instructorProfileId !== oldClass.instructor_profile_id) events.push('instructor_assigned');
  if (patch.location !== undefined && patch.location !== oldClass.location) events.push('class_location_changed');
  return events;
}

// Construye el objeto de update solo con campos que realmente cambian.
function buildClassUpdate(cls, patch) {
  const map = { title: 'title', scheduledDate: 'scheduled_date', startTime: 'start_time', endTime: 'end_time', location: 'location', notes: 'notes', instructorProfileId: 'instructor_profile_id', status: 'status' };
  const upd = {};
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] === undefined) continue;
    const v = (col === 'end_time' || col === 'location' || col === 'notes') ? (patch[k] || null) : patch[k];
    if (String(v) !== String(cls[col] == null ? null : cls[col])) upd[col] = v;
  }
  return upd;
}

function classEventBody(eventType, cls) {
  const t = cls.title || 'Clase';
  const d = cls.scheduled_date || '';
  const h = cls.start_time ? String(cls.start_time).slice(0, 5) : '';
  if (eventType === 'class_cancelled') return 'La clase "' + t + '" fue cancelada.';
  if (eventType === 'class_rescheduled') return 'La clase "' + t + '" fue reprogramada para el ' + d + ' a las ' + h + '.';
  if (eventType === 'instructor_assigned') return 'Se asignó un instructor a la clase "' + t + '".';
  if (eventType === 'class_location_changed') return 'La clase "' + t + '" cambió de ubicación.';
  return 'La clase "' + t + '" fue actualizada.';
}

module.exports = { httpError, resolveClassRecipients, notifyClassEvent, detectClassEventTypes, buildClassUpdate, classEventBody };
