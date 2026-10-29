// tests/class-notification-outbox-integration.test.js
// Integración REAL contra PostgreSQL/Supabase (staging) para probar la concurrencia
// de claim (FOR UPDATE SKIP LOCKED) y el lease de finalización.
//
// NO se ejecuta en la suite normal. Requiere:
//   RUN_INTEGRATION=1
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (o tests/.staging.env)
//   migración 024_class_notification_atomicity.sql aplicada
//
// Crea una clase temporal + jobs de outbox y los limpia al terminar.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadEnvFile(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnvFile(path.join(__dirname, '.staging.env'));

const RUN = process.env.RUN_INTEGRATION === '1';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (RUN && url && key) {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const marker = 'it-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex');
  let classId = null;

  before(async () => {
    // Fixture mínimo reutilizando entidades existentes de staging.
    const { data: est } = await sb.from('establishments').select('id').limit(1).maybeSingle();
    const { data: disc } = await sb.from('disciplines').select('id').limit(1).maybeSingle();
    const { data: prof } = await sb.from('profiles').select('id').limit(1).maybeSingle();
    assert.ok(est, 'staging debe tener al menos un establecimiento');
    assert.ok(disc, 'staging debe tener al menos una disciplina');
    assert.ok(prof, 'staging debe tener al menos un perfil');

    const { data: created, error } = await sb.from('class_sessions').insert({
      establishment_id: est.id,
      discipline_id: disc.id,
      instructor_profile_id: prof.id,
      title: marker,
      scheduled_date: new Date().toISOString().slice(0, 10),
      start_time: '10:00',
      status: 'scheduled'
    }).select('id').single();
    if (error) throw new Error('no se pudo crear clase temporal: ' + error.message);
    classId = created.id;
  });

  after(async () => {
    if (!classId) return;
    await sb.from('class_notification_outbox').delete().eq('class_id', classId);
    await sb.from('class_sessions').delete().eq('id', classId);
  });

  test('claim concurrente no devuelve el mismo job (FOR UPDATE SKIP LOCKED)', async () => {
    const { data: cls } = await sb.from('class_sessions').select('establishment_id').eq('id', classId).single();
    const { data: prof } = await sb.from('profiles').select('id').limit(1).maybeSingle();
    const jobs = Array.from({ length: 40 }, () => ({
      class_id: classId,
      establishment_id: cls.establishment_id,
      event_type: 'class_rescheduled',
      recipient_profile_id: prof.id,
      version: marker,
      title: 'T', body: 'B'
    }));
    const { error: insErr } = await sb.from('class_notification_outbox').insert(jobs);
    if (insErr) throw new Error('no se pudo insertar jobs: ' + insErr.message);

    const [a, b] = await Promise.all([
      sb.rpc('claim_class_notification_outbox', { p_worker_id: 'w-a', p_limit: 20, p_lease_seconds: 60 }),
      sb.rpc('claim_class_notification_outbox', { p_worker_id: 'w-b', p_limit: 20, p_lease_seconds: 60 })
    ]);
    assert.equal(a.error, null);
    assert.equal(b.error, null);
    const ids = [...(a.data || []), ...(b.data || [])].map((r) => r.id);
    assert.equal(ids.length, 40, 'entre ambos reclaman las 40 filas');
    assert.equal(new Set(ids).size, 40, 'ningún job fue reclamado por dos workers a la vez');
  });

  test('mark sent respeta el lease (solo el worker dueño)', async () => {
    const { data: claimed, error } = await sb.rpc('claim_class_notification_outbox', { p_worker_id: 'w-owner', p_limit: 1, p_lease_seconds: 60 });
    assert.equal(error, null);
    assert.ok(claimed && claimed.length >= 1);
    const jobId = claimed[0].id;

    const wrong = await sb.rpc('mark_class_notification_sent', { p_id: jobId, p_worker_id: 'w-other' });
    assert.equal(wrong.error, null);
    assert.equal(wrong.data, false, 'un worker ajeno no puede marcar sent');

    const right = await sb.rpc('mark_class_notification_sent', { p_id: jobId, p_worker_id: 'w-owner' });
    assert.equal(right.error, null);
    assert.equal(right.data, true, 'el worker dueño sí puede marcar sent');
  });

  console.log('Suite class-notification-outbox-integration: ejecutada contra staging');
} else {
  console.log('SKIP class-notification-outbox-integration: RUN_INTEGRATION!=1 o faltan credenciales');
}
