-- ══════════════════════════════════════════════════════════════
-- 024_class_notification_atomicity.sql — Hardening transaccional de la outbox.
-- Fase C, incremento 4.
--
--   A) update_class_and_enqueue_notifications   (actualización atómica clase + outbox)
--   B) create_class_and_enqueue_notifications   (creación atómica clase + outbox)
--   C) claim_class_notification_outbox          (claim atómico multi-worker)
--   D) mark_class_notification_sent / _failed   (finalización segura con lease)
--
-- La autorización y el tenancy se validan SIEMPRE en Node.js. Estas RPCs solo
-- persisten y no envían notificaciones (solo encolan en la outbox).
-- ══════════════════════════════════════════════════════════════

-- ── A) Actualización atómica de clase + encolado ──────────────────────────
-- p_updates: jsonb con columnas de class_sessions YA validadas por Node.
-- p_jobs:    jsonb [{event_type, recipient_profile_id, title, body}].
-- Bloquea la clase (FOR UPDATE), actualiza solo lo enviado, encola con
-- ON CONFLICT DO NOTHING y devuelve la clase + notifications_queued.
create or replace function update_class_and_enqueue_notifications(
  p_class_id uuid,
  p_updates jsonb,
  p_version text,
  p_jobs jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class class_sessions%rowtype;
  v_queued integer := 0;
  v_job jsonb;
  v_result jsonb;
begin
  select * into v_class from class_sessions where id = p_class_id for update;
  if not found then
    raise exception 'CLASS_NOT_FOUND';
  end if;

  update class_sessions
    set title                 = case when p_updates ? 'title' then (p_updates->>'title') else title end,
        scheduled_date        = case when p_updates ? 'scheduled_date' then (p_updates->>'scheduled_date')::date else scheduled_date end,
        start_time            = case when p_updates ? 'start_time' then (p_updates->>'start_time')::time else start_time end,
        end_time              = case when p_updates ? 'end_time' then (p_updates->>'end_time')::time else end_time end,
        location              = case when p_updates ? 'location' then (p_updates->>'location') else location end,
        notes                 = case when p_updates ? 'notes' then (p_updates->>'notes') else notes end,
        instructor_profile_id = case when p_updates ? 'instructor_profile_id' then (p_updates->>'instructor_profile_id')::uuid else instructor_profile_id end,
        status                = case when p_updates ? 'status' then (p_updates->>'status') else status end,
        updated_at            = now()
    where id = p_class_id;

  for v_job in select value from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) as t(value)
  loop
    insert into class_notification_outbox
      (class_id, establishment_id, event_type, recipient_profile_id, version, title, body)
    values
      (p_class_id, v_class.establishment_id, v_job->>'event_type',
       (v_job->>'recipient_profile_id')::uuid, p_version, v_job->>'title', v_job->>'body')
    on conflict (class_id, event_type, recipient_profile_id, version) do nothing;
    if found then
      v_queued := v_queued + 1;
    end if;
  end loop;

  select to_jsonb(c) || jsonb_build_object('notifications_queued', v_queued)
    into v_result
    from class_sessions c where c.id = p_class_id;

  return v_result;
end;
$$;

-- ── B) Creación atómica de clase + encolado ────────────────────────────────
create or replace function create_class_and_enqueue_notifications(
  p_establishment_id uuid,
  p_discipline_id uuid,
  p_instructor_profile_id uuid,
  p_title text,
  p_scheduled_date date,
  p_start_time time,
  p_end_time time,
  p_location text,
  p_notes text,
  p_version text,
  p_jobs jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_queued integer := 0;
  v_job jsonb;
  v_result jsonb;
begin
  insert into class_sessions
    (establishment_id, discipline_id, instructor_profile_id, title,
     scheduled_date, start_time, end_time, location, notes, status)
  values
    (p_establishment_id, p_discipline_id, p_instructor_profile_id, p_title,
     p_scheduled_date, p_start_time, p_end_time, p_location, p_notes, 'scheduled')
  returning id into v_id;

  for v_job in select value from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) as t(value)
  loop
    insert into class_notification_outbox
      (class_id, establishment_id, event_type, recipient_profile_id, version, title, body)
    values
      (v_id, p_establishment_id, v_job->>'event_type',
       (v_job->>'recipient_profile_id')::uuid, p_version, v_job->>'title', v_job->>'body')
    on conflict (class_id, event_type, recipient_profile_id, version) do nothing;
    if found then
      v_queued := v_queued + 1;
    end if;
  end loop;

  select to_jsonb(c) || jsonb_build_object('notifications_queued', v_queued)
    into v_result
    from class_sessions c where c.id = v_id;

  return v_result;
end;
$$;

-- ── C) Claim atómico del worker ────────────────────────────────────────────
-- Selecciona pending/failed disponibles y processing con lease expirado,
-- bloquea con FOR UPDATE SKIP LOCKED y devuelve solo las filas reclamadas.
create or replace function claim_class_notification_outbox(
  p_worker_id text,
  p_limit integer default 20,
  p_lease_seconds integer default 60
) returns setof class_notification_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row class_notification_outbox%rowtype;
begin
  for v_row in
    select * from class_notification_outbox
    where (status in ('pending', 'failed') and available_at <= now())
       or (status = 'processing' and locked_at < now() - make_interval(secs => p_lease_seconds))
    order by created_at asc
    limit p_limit
    for update skip locked
  loop
    update class_notification_outbox
      set status = 'processing', locked_by = p_worker_id, locked_at = now(), updated_at = now()
      where id = v_row.id;
    v_row.status := 'processing';
    v_row.locked_by := p_worker_id;
    v_row.locked_at := now();
    v_row.updated_at := now();
    return next v_row;
  end loop;
end;
$$;

-- ── D) Finalización segura (solo el worker dueño del lease) ────────────────
create or replace function mark_class_notification_sent(p_id uuid, p_worker_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update class_notification_outbox
    set status = 'sent', sent_at = now(), locked_at = null, locked_by = null,
        last_error = null, updated_at = now()
    where id = p_id and status = 'processing' and locked_by = p_worker_id;
  return found;
end;
$$;

-- Devuelve el estado resultante ('dead' | 'failed') o null si no era dueño.
create or replace function mark_class_notification_failed(
  p_id uuid,
  p_worker_id text,
  p_error text,
  p_next_available_at timestamptz
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  update class_notification_outbox
    set attempts = attempts + 1,
        status = case when attempts + 1 >= 5 then 'dead' else 'failed' end,
        last_error = p_error,
        available_at = case when attempts + 1 >= 5 then available_at else p_next_available_at end,
        locked_at = null, locked_by = null, updated_at = now()
    where id = p_id and status = 'processing' and locked_by = p_worker_id
    returning status into v_status;
  return v_status;
end;
$$;

-- ── Permisos: solo el backend (service_role) puede ejecutar estas RPCs ─────
revoke all on function update_class_and_enqueue_notifications(uuid, jsonb, text, jsonb) from public;
grant execute on function update_class_and_enqueue_notifications(uuid, jsonb, text, jsonb) to service_role;

revoke all on function create_class_and_enqueue_notifications(uuid, uuid, uuid, text, date, time, time, text, text, text, jsonb) from public;
grant execute on function create_class_and_enqueue_notifications(uuid, uuid, uuid, text, date, time, time, text, text, text, jsonb) to service_role;

revoke all on function claim_class_notification_outbox(text, integer, integer) from public;
grant execute on function claim_class_notification_outbox(text, integer, integer) to service_role;

revoke all on function mark_class_notification_sent(uuid, text) from public;
grant execute on function mark_class_notification_sent(uuid, text) to service_role;

revoke all on function mark_class_notification_failed(uuid, text, text, timestamptz) from public;
grant execute on function mark_class_notification_failed(uuid, text, text, timestamptz) to service_role;


