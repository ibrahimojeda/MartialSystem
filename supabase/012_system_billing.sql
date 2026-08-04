-- ══════════════════════════════════════════════════════════════
-- System Billing: Cobros por uso del sistema a Dueños de Dojo
-- ══════════════════════════════════════════════════════════════

-- ===== Facturas mensuales por uso del sistema =====
create table if not exists system_usage_bills (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  owner_profile_id uuid not null references profiles(id) on delete cascade,
  billing_month text not null, -- 'YYYY-MM'
  plan_code text not null, -- 'starter', 'professional', 'elite'
  amount numeric(10,2) not null check (amount >= 0),
  currency text not null default 'USD',
  status text not null default 'pending' check (status in ('pending','paid','confirmed','overdue','waived')),
  due_date date not null,
  paid_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references profiles(id) on delete set null,
  payment_method text, -- 'bank_transfer', 'cash', 'online', 'other'
  payment_reference text, -- Reference number or proof
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(establishment_id, billing_month)
);

create index if not exists idx_system_bills_establishment on system_usage_bills(establishment_id);
create index if not exists idx_system_bills_owner on system_usage_bills(owner_profile_id);
create index if not exists idx_system_bills_status on system_usage_bills(status);
create index if not exists idx_system_bills_month on system_usage_bills(billing_month);

-- ===== Solicitudes de upgrade de plan =====
create table if not exists plan_upgrade_requests (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  owner_profile_id uuid not null references profiles(id) on delete cascade,
  current_plan_code text not null,
  requested_plan_code text not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_upgrade_requests_establishment on plan_upgrade_requests(establishment_id);
create index if not exists idx_upgrade_requests_status on plan_upgrade_requests(status);

-- ===== Historial de recordatorios =====
create table if not exists system_usage_reminders (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references system_usage_bills(id) on delete cascade,
  establishment_id uuid not null references establishments(id) on delete cascade,
  owner_profile_id uuid not null references profiles(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('5_day_overlay','15_day_overlay','manual','email','parent_payment')),
  sent_at timestamptz not null default now(),
  sent_by uuid references profiles(id) on delete set null
);

create index if not exists idx_reminders_bill on system_usage_reminders(bill_id);
create index if not exists idx_reminders_establishment on system_usage_reminders(establishment_id);

-- Triggers de updated_at
drop trigger if exists trg_system_bills_updated_at on system_usage_bills;
create trigger trg_system_bills_updated_at
before update on system_usage_bills
for each row execute procedure set_updated_at();

drop trigger if exists trg_upgrade_requests_updated_at on plan_upgrade_requests;
create trigger trg_upgrade_requests_updated_at
before update on plan_upgrade_requests
for each row execute procedure set_updated_at();

-- ===== Plan de precios del sistema (tabla global, no por establecimiento) =====
create table if not exists system_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, -- 'starter', 'professional', 'elite'
  name text not null,
  price_usd numeric(10,2) not null,
  max_dojos int not null default 1,
  max_students int not null default 50,
  features jsonb not null default '[]'::jsonb,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Seed system plans
insert into system_plans (code, name, price_usd, max_dojos, max_students, features, sort_order)
values
  ('starter', 'Starter', 49.00, 1, 50, '["gestion_alumnos","asistencia","rangos","portal_alumno"]'::jsonb, 1),
  ('professional', 'Professional', 99.00, 3, 250, '["gestion_alumnos","asistencia","rangos","portal_alumno","torneos","marketplace","waivers","reportes_avanzados"]'::jsonb, 2),
  ('elite', 'Elite', 199.00, 999, 999999, '["gestion_alumnos","asistencia","rangos","portal_alumno","torneos","marketplace","waivers","reportes_avanzados","multi_dojo","ia_features","soporte_dedicado","api_access","white_label"]'::jsonb, 3)
on conflict (code) do nothing;

-- ===== Tabla para trackear planes activos de establecimientos =====
create table if not exists establishment_plans (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null unique references establishments(id) on delete cascade,
  plan_code text not null default 'starter',
  max_dojos int not null default 1,
  max_students int not null default 50,
  price_usd numeric(10,2) not null default 49.00,
  owner_billing_day int not null default 15 check (owner_billing_day in (15, 31)),
  parent_billing_day int not null default 15 check (parent_billing_day in (15, 31)),
  upgraded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_establishment_plans_establishment on establishment_plans(establishment_id);

drop trigger if exists trg_establishment_plans_updated_at on establishment_plans;
create trigger trg_establishment_plans_updated_at
before update on establishment_plans
for each row execute procedure set_updated_at();

-- Add billing_day columns to existing tables (if table already exists)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_name = 'establishment_plans' and column_name = 'owner_billing_day') then
    alter table establishment_plans add column owner_billing_day int not null default 15 check (owner_billing_day in (15, 31));
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'establishment_plans' and column_name = 'parent_billing_day') then
    alter table establishment_plans add column parent_billing_day int not null default 15 check (parent_billing_day in (15, 31));
  end if;
end $$;

-- Auto-seed: insert a starter plan for each existing establishment
insert into establishment_plans (establishment_id, plan_code, max_dojos, max_students, price_usd, owner_billing_day, parent_billing_day)
select id, 'starter', 1, 50, 49.00, 15, 15
from establishments
on conflict (establishment_id) do nothing;