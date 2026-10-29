-- class-notification-migrations-check.sql — Resumen PASS/FAIL de 023 + 024.
-- Pégalo completo en el SQL Editor de Supabase. Debe devolver todo PASS.
with checks(check_name, ok) as (
  -- ── 023: outbox ──
  select '023 outbox table exists', to_regclass('public.class_notification_outbox') is not null
  union all
  select '023 notifications.class_notification_outbox_id exists',
    exists (select 1 from information_schema.columns
            where table_schema='public' and table_name='notifications'
              and column_name='class_notification_outbox_id')
  union all
  select '023 outbox unique (dedup) exists',
    exists (select 1 from pg_indexes
            where schemaname='public' and tablename='class_notification_outbox' and indexdef like '%unique%')
  union all
  select '023 notifications unique partial exists',
    exists (select 1 from pg_indexes
            where schemaname='public' and tablename='notifications'
              and indexname='uq_notifications_class_outbox')
  union all
  select '023 outbox RLS enabled',
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.class_notification_outbox')), false)
  -- ── 024: RPCs ──
  union all
  select '024 update_class_and_enqueue_notifications exists',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='update_class_and_enqueue_notifications')
  union all
  select '024 create_class_and_enqueue_notifications exists',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='create_class_and_enqueue_notifications')
  union all
  select '024 claim_class_notification_outbox exists',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='claim_class_notification_outbox')
  union all
  select '024 mark_class_notification_sent exists',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='mark_class_notification_sent')
  union all
  select '024 mark_class_notification_failed exists',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='mark_class_notification_failed')
  union all
  select '024 all 5 SECURITY DEFINER',
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.prosecdef
       and p.proname in ('update_class_and_enqueue_notifications','create_class_and_enqueue_notifications',
                         'claim_class_notification_outbox','mark_class_notification_sent','mark_class_notification_failed')) = 5
  union all
  select '024 claim uses FOR UPDATE SKIP LOCKED',
    exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='claim_class_notification_outbox'
              and p.prosrc ilike '%for update skip locked%')
  union all
  select '024 all 5 search_path=public',
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proconfig @> array['search_path=public']
       and p.proname in ('update_class_and_enqueue_notifications','create_class_and_enqueue_notifications',
                         'claim_class_notification_outbox','mark_class_notification_sent','mark_class_notification_failed')) = 5
  union all
  select '024 no EXECUTE granted to PUBLIC',
    not exists (select 1 from information_schema.role_routine_grants g
                join information_schema.routines r
                  on r.specific_name = g.specific_name and r.routine_schema = 'public'
                where r.routine_schema='public'
                  and r.routine_name in ('update_class_and_enqueue_notifications','create_class_and_enqueue_notifications',
                                         'claim_class_notification_outbox','mark_class_notification_sent','mark_class_notification_failed')
                  and g.grantee='PUBLIC' and g.privilege_type='EXECUTE')
)
select check_name, case when ok then 'PASS' else 'FAIL' end as result
from checks
order by check_name;
