-- ══════════════════════════════════════════════════════════════
-- Fase 3: Unificación de sistemas de planes
-- Hace de system_plans + establishment_plans el sistema canónico
-- Migra datos desde el sistema legacy (plans + subscriptions del 011)
-- Versión defensiva: verifica existencia de tablas legacy antes de migrar
-- ══════════════════════════════════════════════════════════════

-- ===== 1. Asegurar que system_plans exista y tenga los planes canónicos =====
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

insert into system_plans (code, name, price_usd, max_dojos, max_students, features, sort_order)
values
  ('starter', 'Starter', 49.00, 1, 50, '["gestion_alumnos","asistencia","rangos","portal_alumno"]'::jsonb, 1),
  ('professional', 'Professional', 99.00, 3, 250, '["gestion_alumnos","asistencia","rangos","portal_alumno","torneos","marketplace","waivers","reportes_avanzados"]'::jsonb, 2),
  ('elite', 'Elite', 199.00, 999, 999999, '["gestion_alumnos","asistencia","rangos","portal_alumno","torneos","marketplace","waivers","reportes_avanzados","multi_dojo","ia_features","soporte_dedicado","api_access","white_label"]'::jsonb, 3)
on conflict (code) do update
  set name = excluded.name,
      price_usd = excluded.price_usd,
      max_dojos = excluded.max_dojos,
      max_students = excluded.max_students,
      features = excluded.features,
      sort_order = excluded.sort_order,
      is_active = true;

-- ===== 2. Asegurar establishment_plans exista =====
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

-- Auto-seed: insertar plan starter para cada establecimiento que no tenga plan
insert into establishment_plans (establishment_id, plan_code, max_dojos, max_students, price_usd, owner_billing_day, parent_billing_day)
select id, 'starter', 1, 50, 49.00, 15, 15
from establishments
on conflict (establishment_id) do nothing;

-- ===== 3. Migración defensiva desde sistema legacy =====
-- Solo migra si las tablas legacy (plans + subscriptions) existen.
-- Usa to_regclass para verificar la existencia de las tablas.
do $$
declare
  has_legacy boolean;
begin
  -- Verificar si las tablas legacy existen
  has_legacy := to_regclass('public.subscriptions') is not null
                and to_regclass('public.plans') is not null;

  if has_legacy then
    -- Por cada establecimiento que tenga subscription legacy pero no establishment_plan,
    -- se crea el establishment_plans correspondiente.
    insert into establishment_plans (establishment_id, plan_code, max_dojos, max_students, price_usd, owner_billing_day, parent_billing_day, upgraded_at)
    select
      s.establishment_id,
      p.code as plan_code,
      p.max_dojos,
      p.max_students,
      p.price_usd,
      15 as owner_billing_day,
      15 as parent_billing_day,
      s.current_period_start as upgraded_at
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where s.status in ('trial', 'active')
    on conflict (establishment_id) do nothing;
  end if;
end $$;

-- ===== 4. Vista canónica: estado del plan por establecimiento =====
-- Unifica la información de plan + factura actual en una sola vista.
-- Solo usa tablas canónicas (system_plans + establishment_plans).
create or replace view establishment_plan_status as
select
  e.id as establishment_id,
  e.name as establishment_name,
  ep.plan_code,
  sp.name as plan_name,
  sp.price_usd,
  ep.max_dojos,
  ep.max_students,
  ep.owner_billing_day,
  ep.parent_billing_day,
  ep.upgraded_at,
  -- Coalesce: usar el plan efectivo
  coalesce(ep.plan_code, 'starter') as effective_plan_code,
  coalesce(ep.price_usd, sp.price_usd, 49) as effective_price
from establishments e
left join establishment_plans ep on ep.establishment_id = e.id
left join system_plans sp on sp.code = ep.plan_code;

-- ===== 5. Índices adicionales =====
create index if not exists idx_system_plans_code on system_plans(code);
create index if not exists idx_establishment_plans_code on establishment_plans(plan_code);