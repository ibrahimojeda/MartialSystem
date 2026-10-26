-- ══════════════════════════════════════════════════════════════
-- 019_student_charges.sql — Cuotas/Cargos por alumno (cuentas por cobrar)
-- Representa OBLIGACIONES de pago de alumnos (mensualidades, exámenes,
-- ascensos, otros). La tabla payments sigue siendo el historial de
-- pagos realizados; NO se modifica ni se reemplaza.
-- ══════════════════════════════════════════════════════════════

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

-- Aplicación de pagos a cargos (un pago puede cubrir uno o varios cargos).
create table if not exists student_charge_payments (
  id uuid primary key default gen_random_uuid(),
  charge_id uuid not null references student_charges(id) on delete cascade,
  payment_id uuid not null references payments(id) on delete cascade,
  amount_applied numeric(12,2) not null check (amount_applied > 0),
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  unique(charge_id, payment_id)
);

-- Índices de consulta por tenancy/estado/vencimiento/periodo.
create index if not exists idx_student_charges_est_due on student_charges(establishment_id, due_date);
create index if not exists idx_student_charges_est_status on student_charges(establishment_id, status);
create index if not exists idx_student_charges_student_due on student_charges(student_id, due_date);
create index if not exists idx_student_charges_student_status on student_charges(student_id, status);
create index if not exists idx_student_charges_est_period on student_charges(establishment_id, period_key);
create index if not exists idx_student_charge_payments_charge on student_charge_payments(charge_id);
create index if not exists idx_student_charge_payments_payment on student_charge_payments(payment_id);

-- Unicidad parcial: una sola mensualidad por (academia, alumno, periodo).
-- No aplica a exam/promotion/other (pueden repetirse legítimamente).
create unique index if not exists uq_student_charges_membership_period
  on student_charges(establishment_id, student_id, period_key)
  where charge_type = 'membership' and status <> 'cancelled';

drop trigger if exists trg_student_charges_updated_at on student_charges;
create trigger trg_student_charges_updated_at
  before update on student_charges
  for each row execute procedure set_updated_at();

alter table student_charges enable row level security;
alter table student_charge_payments enable row level security;
