-- ══════════════════════════════════════════════════════════════
-- 020_student_charges_atomic.sql — Versión ATOMICA e idempotente de 019.
-- Pensada para futuras instalaciones y para completar una aplicación parcial.
-- - NO ejecuta DROP TABLE ni altera payments.
-- - Todo-o-nada (BEGIN/COMMIT): si una sentencia falla, se revierte.
-- - Re-ejecutable: usa CREATE TABLE/INDEX IF NOT EXISTS y DROP TRIGGER IF EXISTS.
-- ══════════════════════════════════════════════════════════════

begin;

create table if not exists student_charges (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  discipline_id uuid references disciplines(id) on delete set null,
  charge_type text not null default 'membership'
    check (charge_type in ('membership','exam','promotion','other')),
  period_key text,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'ARS' check (length(currency) > 0),
  due_date date not null,
  status text not null default 'pending'
    check (status in ('pending','partial','paid','overdue','cancelled')),
  paid_amount numeric(12,2) not null default 0 check (paid_amount >= 0),
  paid_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint student_charges_paid_amount_le_amount check (paid_amount <= amount)
);

create table if not exists student_charge_payments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references student_charges(id) on delete cascade,
  payment_id uuid not null references payments(id) on delete cascade,
  amount_applied numeric(12,2) not null check (amount_applied > 0),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  unique(charge_id, payment_id)
);

create index if not exists idx_student_charges_est_due on student_charges(establishment_id, due_date);
create index if not exists idx_student_charges_est_status on student_charges(establishment_id, status);
create index if not exists idx_student_charges_student_due on student_charges(student_id, due_date);
create index if not exists idx_student_charges_student_status on student_charges(student_id, status);
create index if not exists idx_student_charges_est_period on student_charges(establishment_id, period_key);
create index if not exists idx_student_charge_payments_charge on student_charge_payments(charge_id);
create index if not exists idx_student_charge_payments_payment on student_charge_payments(payment_id);

create unique index if not exists uq_student_charges_membership_period
  on student_charges(establishment_id, student_id, period_key)
  where charge_type = 'membership' and status <> 'cancelled';

drop trigger if exists trg_student_charges_updated_at on student_charges;
create trigger trg_student_charges_updated_at
  before update on student_charges
  for each row execute procedure set_updated_at();

alter table student_charges enable row level security;
alter table student_charge_payments enable row level security;

commit;

-- ── Diagnóstico de estructura (solo informa, no modifica) ──
do $$
declare
  c int;
  t int;
  rls bool;
begin
  select count(*) into c from information_schema.columns
   where table_schema = 'public' and table_name = 'student_charges';
  if c = 0 then
    raise notice 'DIAGNOSTICO: student_charges no tiene columnas visibles (tabla inexistente o schema incorrecto).';
  elsif c < 18 then
    raise notice 'DIAGNOSTICO: ESTRUCTURA PARCIAL en student_charges (tiene % columnas, se esperan 18). Faltan columnas.', c;
  else
    raise notice 'DIAGNOSTICO: student_charges tiene % columnas (OK).', c;
  end if;

  select count(*) into c from information_schema.columns
   where table_schema = 'public' and table_name = 'student_charge_payments';
  if c = 0 then
    raise notice 'DIAGNOSTICO: student_charge_payments no tiene columnas visibles (tabla inexistente o schema incorrecto).';
  elsif c < 6 then
    raise notice 'DIAGNOSTICO: ESTRUCTURA PARCIAL en student_charge_payments (tiene % columnas, se esperan 6).', c;
  else
    raise notice 'DIAGNOSTICO: student_charge_payments tiene % columnas (OK).', c;
  end if;

  select count(*) into t from pg_trigger
   where tgname = 'trg_student_charges_updated_at' and not tgisinternal;
  if t = 0 then
    raise notice 'DIAGNOSTICO: falta el trigger trg_student_charges_updated_at.';
  else
    raise notice 'DIAGNOSTICO: trigger trg_student_charges_updated_at (OK).';
  end if;

  select relrowsecurity into rls from pg_class
   where oid = to_regclass('public.student_charges');
  if rls is distinct from true then
    raise notice 'DIAGNOSTICO: RLS NO habilitado en student_charges.';
  else
    raise notice 'DIAGNOSTICO: RLS student_charges habilitado (OK).';
  end if;
end $$;

-- ══════════════════════════════════════════════════════════════
-- REPARACIÓN MANUAL de una estructura parcial (NO destructiva).
-- Solo si el diagnóstico anterior indica que faltan columnas/índices/trigger.
-- Ejecuta ÚNICAMENTE las sentencias que correspondan a lo que falta:
--
-- 1) Falta una columna:
--    alter table student_charges add column if not exists paid_amount numeric(12,2) not null default 0;
--
-- 2) Falta el trigger:
--    drop trigger if exists trg_student_charges_updated_at on student_charges;
--    create trigger trg_student_charges_updated_at before update on student_charges
--      for each row execute procedure set_updated_at();
--
-- 3) Falta RLS:
--    alter table student_charges enable row level security;
--    alter table student_charge_payments enable row level security;
--
-- 4) Falta la unicidad parcial de membership:
--    create unique index if not exists uq_student_charges_membership_period
--      on student_charges(establishment_id, student_id, period_key)
--      where charge_type = 'membership' and status <> 'cancelled';
-- ══════════════════════════════════════════════════════════════

