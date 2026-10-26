-- ══════════════════════════════════════════════════════════════
-- student-charges-schema-check.sql — Verificación (solo lectura) de la
-- estructura del módulo student_charges. NO modifica nada.
--
-- Uso: ejecutar en el SQL Editor del proyecto Supabase que quieras
--       verificar (debe ser STAGING, no producción).
-- ══════════════════════════════════════════════════════════════

-- 1) ¿Existen las tablas? (NULL = no existe; un número = existe)
select
  to_regclass('public.student_charges') as student_charges,
  to_regclass('public.student_charge_payments') as student_charge_payments;

-- 2) Columnas (debe devolver ~18 en student_charges y ~6 en student_charge_payments)
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('student_charges','student_charge_payments')
order by table_name, ordinal_position;

-- 3) Constraints CHECK y Foreign Keys
select tc.table_name, tc.constraint_name, tc.constraint_type, kcu.column_name
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name
  and kcu.table_schema = tc.table_schema
  and kcu.table_name = tc.table_name
where tc.table_schema = 'public'
  and tc.table_name in ('student_charges','student_charge_payments')
order by tc.table_name, tc.constraint_type, tc.constraint_name;

-- 4) Índices (debe incluir idx_student_charges_* y uq_student_charges_membership_period)
select tablename, indexname
from pg_indexes
where schemaname = 'public'
  and tablename in ('student_charges','student_charge_payments')
order by tablename, indexname;

-- 5) Foreign keys concretas (referencias a establishments/students/disciplines/profiles/payments)
select conrelid::regclass as tabla, conname, pg_get_constraintdef(oid) as definicion
from pg_constraint
where contype = 'f'
  and conrelid in ('public.student_charges'::regclass, 'public.student_charge_payments'::regclass)
order by conrelid::regclass::text, conname;

-- 6) RLS habilitado (debe devolver "enabled")
select c.relname as tabla, c.relrowsecurity as rls_habilitado
from pg_class c
where c.oid in ('public.student_charges'::regclass, 'public.student_charge_payments'::regclass)
order by c.relname;

-- 7) Trigger updated_at (debe devolver una fila)
select tgname, tgrelid::regclass as tabla
from pg_trigger
where tgname = 'trg_student_charges_updated_at' and not tgisinternal;

-- 8) Unicidad parcial de membership (debe devolver una fila)
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'student_charges'
  and indexname = 'uq_student_charges_membership_period';
