-- MartialSystem - Nuevos módulos: torneos, inventario, académico, comisiones, pasarela de pago
-- Ejecutar después de 006_usernames_superadmin.sql

-- ─────────────────────────────────────────
-- TORNEOS
-- ─────────────────────────────────────────
create table if not exists tournament_registrations (
  id              uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  student_id      uuid references students(id) on delete set null,
  tournament_name text not null,
  tournament_date date,
  category        text,
  mode            text check (mode in ('Kata','Kumite','Ambos')),
  cost            numeric(10,2),
  notes           text,
  created_at      timestamptz default now()
);

create table if not exists tournament_results (
  id              uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  student_id      uuid references students(id) on delete set null,
  tournament_name text,
  mode            text,
  round_reached   text,
  medal           text,
  points          text,
  notes           text,
  created_at      timestamptz default now()
);

-- ─────────────────────────────────────────
-- INVENTARIO
-- ─────────────────────────────────────────
create table if not exists inventory_items (
  id              uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  discipline_id   uuid references disciplines(id) on delete set null,
  name            text not null,
  category        text,
  supplier        text,
  size            text,
  cost            numeric(10,2),  -- costo interno / costo de adquisición
  price           numeric(10,2),  -- precio de venta al alumno
  base_stock      integer default 0,
  stock           integer default 0,
  is_active       boolean default true,
  image_url       text,
  created_at      timestamptz default now()
);

create table if not exists inventory_movements (
  id              uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  item_id         uuid not null references inventory_items(id) on delete cascade,
  type            text not null check (type in ('entrada','salida','ajuste')),
  qty             integer not null,
  movement_date   date,
  responsible     text,
  reason          text,
  created_at      timestamptz default now()
);

-- ─────────────────────────────────────────
-- ACADÉMICO (solicitudes y resultados de examen de grado)
-- ─────────────────────────────────────────
create table if not exists exam_grade_requests (
  id              uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  student_id      uuid references students(id) on delete set null,
  current_grade   text,
  target_grade    text,
  exam_date       date,
  exam_fee        numeric(10,2),
  examiner        text,
  status          text default 'pending' check (status in ('pending','approved','rejected')),
  created_at      timestamptz default now()
);

create table if not exists exam_grade_results (
  id              uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  student_id      uuid references students(id) on delete set null,
  request_id      uuid references exam_grade_requests(id) on delete set null,
  result          text check (result in ('Aprobado','Reprobado')),
  score           text,
  areas_evaluated text,
  notes           text,
  created_at      timestamptz default now()
);

-- ─────────────────────────────────────────
-- COMISIONES (facturación del sistema por examen aprobado)
-- ─────────────────────────────────────────
create table if not exists system_commissions (
  id                  uuid primary key default gen_random_uuid(),
  establishment_id    uuid references establishments(id) on delete set null,
  exam_result_id      uuid references exam_grade_results(id) on delete set null,
  student_id          uuid references students(id) on delete set null,
  amount_commission   numeric(10,2) not null,
  plan_type           text,
  status              text default 'pending' check (status in ('pending','paid','waived')),
  created_at          timestamptz default now()
);

-- ─────────────────────────────────────────
-- CONFIGURACIÓN DE PASARELA DE PAGO
-- ─────────────────────────────────────────
create table if not exists payment_gateway_configs (
  id               uuid primary key default gen_random_uuid(),
  establishment_id uuid not null unique references establishments(id) on delete cascade,
  provider         text default 'none',
  is_enabled       boolean default false,
  mode             text default 'link' check (mode in ('link','api')),
  currency         text default 'USD',
  link_template    text,
  success_url      text,
  cancel_url       text,
  api_key_hint     text,  -- solo últimos 4 chars, nunca guardar key completa
  updated_at       timestamptz default now()
);

-- ─────────────────────────────────────────
-- RLS BÁSICO — acceso por membresía al establecimiento
-- ─────────────────────────────────────────
alter table tournament_registrations enable row level security;
alter table tournament_results        enable row level security;
alter table inventory_items           enable row level security;
alter table inventory_movements       enable row level security;
alter table exam_grade_requests       enable row level security;
alter table exam_grade_results        enable row level security;
alter table system_commissions        enable row level security;
alter table payment_gateway_configs   enable row level security;

-- Políticas: service_role siempre puede; usuarios autenticados solo a su establecimiento
-- (el backend usa supabaseAdmin con service_role key, por lo que RLS se bypasea en el server)

create policy "service_role full access tournaments_reg"
  on tournament_registrations for all to service_role using (true) with check (true);

create policy "service_role full access tournaments_res"
  on tournament_results for all to service_role using (true) with check (true);

create policy "service_role full access inventory"
  on inventory_items for all to service_role using (true) with check (true);

create policy "service_role full access inventory_movements"
  on inventory_movements for all to service_role using (true) with check (true);

create policy "service_role full access exam_requests"
  on exam_grade_requests for all to service_role using (true) with check (true);

create policy "service_role full access exam_results"
  on exam_grade_results for all to service_role using (true) with check (true);

create policy "service_role full access commissions"
  on system_commissions for all to service_role using (true) with check (true);

create policy "service_role full access gateway_config"
  on payment_gateway_configs for all to service_role using (true) with check (true);
