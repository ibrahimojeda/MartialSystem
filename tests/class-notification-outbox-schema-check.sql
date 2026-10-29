-- class-notification-outbox-schema-check.sql — Verificación (solo lectura) de 023.
select
  to_regclass('public.class_notification_outbox') as outbox,
  to_regclass('public.notifications') as notifications;

-- Conteo de columnas de la outbox (esperado: 19).
select count(*) as outbox_columns
from information_schema.columns
where table_schema = 'public' and table_name = 'class_notification_outbox';

-- Columna en notifications (debe devolver 1 fila).
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'notifications'
  and column_name = 'class_notification_outbox_id';

-- Unique de dedup (debe devolver 1 fila).
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'class_notification_outbox'
  and indexdef like '%unique%';

-- Unique parcial en notifications.
select indexname from pg_indexes
where schemaname = 'public' and tablename = 'notifications'
  and indexname = 'uq_notifications_class_outbox';

-- RLS habilitado (debe dar true).
select relrowsecurity from pg_class where oid = to_regclass('public.class_notification_outbox');

-- Policies públicas (debe devolver 0 filas).
select tablename, policyname from pg_policies
where schemaname = 'public' and tablename = 'class_notification_outbox';
