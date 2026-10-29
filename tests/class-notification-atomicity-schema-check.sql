-- class-notification-atomicity-schema-check.sql — Verificación (solo lectura) de 024.
-- Ejecutar en el SQL Editor de Supabase tras aplicar 024_class_notification_atomicity.sql.

-- 1) Las 5 RPCs existen en public (esperado: 5 filas).
select r.routine_name, r.data_type as return_type
from information_schema.routines r
where r.routine_schema = 'public'
  and r.routine_name in (
    'update_class_and_enqueue_notifications',
    'create_class_and_enqueue_notifications',
    'claim_class_notification_outbox',
    'mark_class_notification_sent',
    'mark_class_notification_failed'
  )
order by r.routine_name;

-- 2) SECURITY DEFINER en las 5 (esperado: prosecdef = true en las 5).
select p.proname, p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'update_class_and_enqueue_notifications',
    'create_class_and_enqueue_notifications',
    'claim_class_notification_outbox',
    'mark_class_notification_sent',
    'mark_class_notification_failed'
  )
order by p.proname;

-- 3) Claim usa FOR UPDATE SKIP LOCKED (esperado: has_skip_locked = true).
select p.proname,
       p.prosrc ilike '%for update skip locked%' as has_skip_locked
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'claim_class_notification_outbox';

-- 4) search_path fijado a public (esperado: una fila por función con proconfig = {public}).
select p.proname, p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'update_class_and_enqueue_notifications',
    'create_class_and_enqueue_notifications',
    'claim_class_notification_outbox',
    'mark_class_notification_sent',
    'mark_class_notification_failed'
  )
order by p.proname;

-- 5) Grants EXECUTE: NO debe aparecer PUBLIC (esperado: solo service_role / postgres).
select r.routine_name, g.grantee
from information_schema.role_routine_grants g
join information_schema.routines r
  on r.specific_name = g.specific_name
 and r.routine_schema = 'public'
where r.routine_schema = 'public'
  and r.routine_name in (
    'update_class_and_enqueue_notifications',
    'create_class_and_enqueue_notifications',
    'claim_class_notification_outbox',
    'mark_class_notification_sent',
    'mark_class_notification_failed'
  )
  and g.privilege_type = 'EXECUTE'
order by r.routine_name, g.grantee;

-- 6) Outbox de 023 sigue presente con su unique de dedup (esperado: outbox != null).
select
  to_regclass('public.class_notification_outbox') as outbox_table,
  (select count(*) from pg_indexes
   where schemaname = 'public' and tablename = 'class_notification_outbox'
     and indexdef like '%unique%') as outbox_unique_indexes;
