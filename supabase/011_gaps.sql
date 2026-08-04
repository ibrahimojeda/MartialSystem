-- ══════════════════════════════════════════════════════════════
-- Fase 0: Brechas competitivas - prospects, waivers, QR, plans
-- ══════════════════════════════════════════════════════════════

-- ===== Prospects (Lead Funnel) =====
create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  source text default 'direct', -- 'website', 'referral', 'landing', 'social_media', 'walk_in', 'direct'
  status text not null default 'new' check (status in ('new','contacted','visited','trial','converted','lost')),
  discipline_interest text[], -- Array de discipline codes
  notes text,
  converted_to_student_id uuid references students(id) on delete set null,
  converted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_prospects_establishment on prospects(establishment_id);
create index if not exists idx_prospects_status on prospects(status);
create index if not exists idx_prospects_created on prospects(created_at);

-- ===== Plans (Tiers de precios del PDF) =====
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  name text not null, -- 'Starter', 'Professional', 'Elite'
  code text not null, -- 'starter', 'professional', 'elite'
  price_usd numeric(10,2) not null,
  price_panama numeric(10,2) not null,
  max_students int,
  max_dojos int default 1,
  features jsonb not null default '[]'::jsonb, -- Lista de features habilitadas
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique(establishment_id, code)
);

-- ===== Subscriptions (plan activo de un establecimiento) =====
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  plan_id uuid not null references plans(id) on delete restrict,
  status text not null default 'trial' check (status in ('trial','active','past_due','canceled','expired')),
  trial_ends_at timestamptz,
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  stripe_subscription_id text,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(establishment_id)
);

-- ===== Waivers / Contratos Digitales =====
create table if not exists waiver_templates (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  discipline_id uuid references disciplines(id) on delete set null,
  title text not null,
  content text not null, -- HTML o texto del waiver
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists waivers (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  waiver_template_id uuid references waiver_templates(id) on delete restrict,
  student_id uuid not null references students(id) on delete cascade,
  guardian_profile_id uuid references profiles(id) on delete set null,
  signed_at timestamptz not null default now(),
  expires_at timestamptz,
  ip_address text,
  user_agent text,
  signature_storage_path text, -- Ruta en Storage de la imagen de firma
  pdf_storage_path text, -- Ruta del PDF generado
  status text not null default 'signed' check (status in ('signed','expired','revoked')),
  created_at timestamptz not null default now()
);

create index if not exists idx_waivers_student on waivers(student_id);
create index if not exists idx_waivers_establishment on waivers(establishment_id);

-- ===== Student QR Tokens =====
create table if not exists student_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  token text not null unique,
  qr_image_url text, -- URL de la imagen QR generada
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(student_id)
);

create index if not exists idx_qr_tokens_token on student_qr_tokens(token);
create index if not exists idx_qr_tokens_student on student_qr_tokens(student_id);

-- ===== Payment Status View (mora del alumno) =====
create or replace view student_payment_status as
select
  s.id as student_id,
  s.full_name,
  s.establishment_id,
  e.discipline_id,
  coalesce(p.last_payment_date, '1970-01-01'::timestamptz) as last_payment_date,
  coalesce(p.last_amount, 0) as last_amount,
  coalesce(p.total_paid, 0) as total_paid,
  case
    when p.last_payment_date is null then 'never_paid'
    when p.last_payment_date < (now() - interval '30 days') then 'overdue'
    when p.last_payment_date < (now() - interval '25 days') then 'due_soon'
    else 'current'
  end as payment_status,
  case
    when p.last_payment_date is null then coalesce(fee.expected_fee, 50)
    when p.last_payment_date < (now() - interval '30 days') then coalesce(fee.expected_fee, 50)
    else 0
  end as amount_due
from students s
left join student_enrollments e on e.student_id = s.id and e.status = 'active'
left join lateral (
  select
    max(paid_at) as last_payment_date,
    (select amount from payments p2 where p2.student_id = s.id order by p2.paid_at desc limit 1) as last_amount,
    sum(amount) as total_paid
  from payments
  where student_id = s.id
) p on true
left join lateral (
  select get_expected_fee(e.discipline_id, s.establishment_id) as expected_fee
) fee on true
where s.id is not null;

-- Función auxiliar para fee esperado (usada por la view)
create or replace function get_expected_fee(discipline_id uuid, establishment_id uuid)
returns numeric as $$
declare
  fee numeric;
begin
  -- Intenta obtener de la config de finanzas
  select value::numeric into fee
  from (
    select config->'expected_fee' as value
    from discipline_configs
    where discipline_id = $1 and establishment_id = $2
  ) sub
  where value is not null;
  
  return coalesce(fee, 50.00);
end;
$$ language plpgsql immutable;

-- Triggers de updated_at
drop trigger if exists trg_prospects_updated_at on prospects;
create trigger trg_prospects_updated_at
before update on prospects
for each row execute procedure set_updated_at();

drop trigger if exists trg_subscriptions_updated_at on subscriptions;
create trigger trg_subscriptions_updated_at
before update on subscriptions
for each row execute procedure set_updated_at();

drop trigger if exists trg_waiver_templates_updated_at on waiver_templates;
create trigger trg_waiver_templates_updated_at
before update on waiver_templates
for each row execute procedure set_updated_at();

drop trigger if exists trg_student_qr_tokens_updated_at on student_qr_tokens;
create trigger trg_student_qr_tokens_updated_at
before update on student_qr_tokens
for each row execute procedure set_updated_at();

-- Seed default plans
insert into plans (establishment_id, name, code, price_usd, price_panama, max_students, max_dojos, features, sort_order)
select
  e.id, 'Starter', 'starter', 49.00, 29.00, 50, 1,
  '["student_portal", "attendance", "rank_tracking", "email_support"]'::jsonb,
  1
from establishments e
on conflict (establishment_id, code) do nothing;

insert into plans (establishment_id, name, code, price_usd, price_panama, max_students, max_dojos, features, sort_order)
select
  e.id, 'Professional', 'professional', 99.00, 59.00, 250, 3,
  '["student_portal", "attendance", "rank_tracking", "marketing_automation", "digital_waivers", "tournaments", "priority_support", "api_access"]'::jsonb,
  2
from establishments e
on conflict (establishment_id, code) do nothing;

insert into plans (establishment_id, name, code, price_usd, price_panama, max_students, max_dojos, features, sort_order)
select
  e.id, 'Elite', 'elite', 199.00, 99.00, 999999, 999,
  '["student_portal", "attendance", "rank_tracking", "marketing_automation", "digital_waivers", "tournaments", "ai_features", "multi_dojo", "dedicated_support", "api_access", "white_label"]'::jsonb,
  3
from establishments e
on conflict (establishment_id, code) do nothing;