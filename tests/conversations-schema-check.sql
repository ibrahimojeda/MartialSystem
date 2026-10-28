-- ══════════════════════════════════════════════════════════════
-- conversations-schema-check.sql — Verificación (solo lectura) de la
-- migración 021 (mensajería interna). NO modifica nada.
--
-- Uso: ejecutar en el SQL Editor del proyecto Supabase conectado a Render
--       (preferiblemente tras un backup, o en staging primero).
-- ══════════════════════════════════════════════════════════════

-- 0) Contexto (para saber en qué base estás)
select current_database() as database_name, current_schema() as schema_name, current_user as db_user;

-- 1) ¿Existen las 4 tablas? (NULL = no existe; nombre = existe)
select
  to_regclass('public.conversations') as conversations,
  to_regclass('public.conversation_members') as conversation_members,
  to_regclass('public.messages') as messages,
  to_regclass('public.message_recipients') as message_recipients;

-- 2) Conteo de columnas por tabla.
--    Esperado: conversations=6, conversation_members=5, messages=7, message_recipients=4.
select table_name, count(*) as total_columns
from information_schema.columns
where table_schema = 'public'
  and table_name in ('conversations','conversation_members','messages','message_recipients')
group by table_name
order by table_name;

-- 3) Columnas detalladas.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('conversations','conversation_members','messages','message_recipients')
order by table_name, ordinal_position;

-- 4) Constraints (PRIMARY KEY / FOREIGN KEY / UNIQUE).
select tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name
  and kcu.table_schema = tc.table_schema
  and kcu.table_name = tc.table_name
where tc.table_schema = 'public'
  and tc.table_name in ('conversations','conversation_members','messages','message_recipients')
order by tc.table_name, tc.constraint_type, tc.constraint_name;

-- 5) Índices (debe incluir idx_conversations_est, idx_conversation_members_*,
--    idx_messages_*, idx_message_recipients_profile).
select tablename, indexname
from pg_indexes
where schemaname = 'public'
  and tablename in ('conversations','conversation_members','messages','message_recipients')
order by tablename, indexname;

-- 6) Foreign keys concretas (debe referenciar establishments/profiles/messages).
select conrelid::regclass as tabla, conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where contype = 'f'
  and conrelid in (
    to_regclass('public.conversations'),
    to_regclass('public.conversation_members'),
    to_regclass('public.messages'),
    to_regclass('public.message_recipients')
  )
order by conrelid::regclass::text, conname;

-- 7) RLS habilitado (debe devolver 4 filas con relrowsecurity = true).
select c.relname as tabla, c.relrowsecurity as rls_habilitado
from pg_class c
where c.oid in (
  to_regclass('public.conversations'),
  to_regclass('public.conversation_members'),
  to_regclass('public.messages'),
  to_regclass('public.message_recipients')
)
order by c.relname;

-- 8) Policies RLS existentes (se espera 0 filas: el backend usa service_role).
select schemaname, tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('conversations','conversation_members','messages','message_recipients')
order by tablename, policyname;
