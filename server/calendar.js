// server/calendar.js
// Calendario canónico de clases por rol (Fase C, solo lectura).
// El backend decide el alcance; nunca se confía solo en el frontend.
// Recibe el cliente Supabase como parámetro (db) para ser testeable sin red.

// Disciplinas de las inscripciones activas de un alumno (por profile_id).
async function getStudentDisciplineIds(db, profileId, establishmentId) {
  const { data: students } = await db.from('students').select('id').eq('establishment_id', establishmentId).eq('profile_id', profileId).limit(100);
  const studentIds = (students || []).map((s) => s.id).filter(Boolean);
  if (!studentIds.length) return [];
  const { data: enrolls } = await db.from('student_enrollments').select('discipline_id').in('student_id', studentIds).eq('status', 'active').limit(1000);
  return [...new Set((enrolls || []).map((e) => e.discipline_id).filter(Boolean))];
}

// Disciplinas de los alumnos vinculados a un guardian.
async function getGuardianDisciplineIds(db, profileId, establishmentId) {
  const { data: links } = await db.from('guardian_students').select('student_id').eq('establishment_id', establishmentId).eq('guardian_profile_id', profileId).limit(5000);
  const studentIds = [...new Set((links || []).map((l) => l.student_id).filter(Boolean))];
  if (!studentIds.length) return [];
  const { data: enrolls } = await db.from('student_enrollments').select('discipline_id').in('student_id', studentIds).eq('status', 'active').limit(1000);
  return [...new Set((enrolls || []).map((e) => e.discipline_id).filter(Boolean))];
}

// Devuelve { events, meta } según el alcance del rol y filtros.
async function getCalendarEvents(db, opts) {
  const { ctx, establishmentId, from, to, disciplineId, instructorProfileId, status } = opts || {};
  const role = String((ctx && ctx.role) || '').toLowerCase();
  const page = Math.max(Number(opts.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(opts.pageSize) || 25, 1), 100);

  let q = db.from('class_sessions').select('id, establishment_id, discipline_id, instructor_profile_id, title, scheduled_date, start_time, end_time, location, notes, status, created_at');

  if (role === 'superadmin') {
    if (establishmentId) q = q.eq('establishment_id', establishmentId);
  } else {
    const estId = (ctx && ctx.establishmentId) || establishmentId;
    if (!estId) return { events: [], meta: { total: 0, page, pageSize } };
    q = q.eq('establishment_id', estId);
  }

  // Alcance por rol (solo lectura, fail-closed).
  if (role === 'instructor' || role === 'sensei') {
    q = q.eq('instructor_profile_id', ctx.profileId);
  } else if (role === 'student') {
    const estId = (ctx && ctx.establishmentId) || establishmentId;
    const discIds = await getStudentDisciplineIds(db, ctx.profileId, estId);
    if (!discIds.length) return { events: [], meta: { total: 0, page, pageSize } };
    q = q.in('discipline_id', discIds);
  } else if (role === 'guardian') {
    const estId = (ctx && ctx.establishmentId) || establishmentId;
    const discIds = await getGuardianDisciplineIds(db, ctx.profileId, estId);
    if (!discIds.length) return { events: [], meta: { total: 0, page, pageSize } };
    q = q.in('discipline_id', discIds);
  }

  if (from) q = q.gte('scheduled_date', from);
  if (to) q = q.lte('scheduled_date', to);
  if (disciplineId) q = q.eq('discipline_id', disciplineId);
  if (instructorProfileId) q = q.eq('instructor_profile_id', instructorProfileId);
  if (status) q = q.eq('status', status);

  q = q.order('scheduled_date', { ascending: true }).order('start_time', { ascending: true }).limit(500);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data || [];
  const total = rows.length;
  const fromIdx = (page - 1) * pageSize;
  const pageRows = rows.slice(fromIdx, fromIdx + pageSize);

  // Nombres de instructor/disciplina/establecimiento (sin IDs internos).
  const instructorIds = [...new Set(pageRows.map((c) => c.instructor_profile_id).filter(Boolean))];
  const disciplineIds = [...new Set(pageRows.map((c) => c.discipline_id).filter(Boolean))];
  const estIds = [...new Set(pageRows.map((c) => c.establishment_id).filter(Boolean))];
  const [instrRes, discRes, estRes] = await Promise.all([
    instructorIds.length ? db.from('profiles').select('id, full_name').in('id', instructorIds) : Promise.resolve({ data: [] }),
    disciplineIds.length ? db.from('disciplines').select('id, code, name').in('id', disciplineIds) : Promise.resolve({ data: [] }),
    estIds.length ? db.from('establishments').select('id, name').in('id', estIds) : Promise.resolve({ data: [] })
  ]);
  const instrMap = new Map((instrRes.data || []).map((i) => [i.id, i]));
  const discMap = new Map((discRes.data || []).map((d) => [d.id, d]));
  const estMap = new Map((estRes.data || []).map((e) => [e.id, e]));

  const events = pageRows.map((c) => ({
    id: c.id,
    establishment_id: c.establishment_id,
    establishment_name: estMap.get(c.establishment_id) ? estMap.get(c.establishment_id).name : null,
    discipline_id: c.discipline_id,
    discipline: discMap.get(c.discipline_id) || null,
    instructor_profile_id: c.instructor_profile_id,
    instructor: instrMap.get(c.instructor_profile_id) || null,
    title: c.title,
    scheduled_date: c.scheduled_date,
    start_time: c.start_time,
    end_time: c.end_time,
    location: c.location,
    status: c.status
  }));

  return { events, meta: { total, page, pageSize } };
}

module.exports = { getCalendarEvents, getStudentDisciplineIds, getGuardianDisciplineIds };
