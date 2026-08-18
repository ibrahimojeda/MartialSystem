-- ══════════════════════════════════════════════════════════════
-- Fase 2: Migración de stores JSON a tablas Supabase
-- Crea tablas para los datos que actualmente viven en archivos JSON
-- ══════════════════════════════════════════════════════════════

-- ===== Module Permissions (module-permissions.json) =====
create table if not exists module_permissions (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  role text not null,
  modules jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(establishment_id, role)
);

-- ===== Sensei-Instructors (sensei-instructors.json) =====
create table if not exists sensei_instructors (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  instructor_profile_id uuid not null references profiles(id) on delete cascade,
  sensei_profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(establishment_id, instructor_profile_id)
);

-- ===== Student-Instructors (student-instructors.json) =====
create table if not exists student_instructors (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  instructor_profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(establishment_id, student_id, instructor_profile_id)
);

-- ===== Student Photos (student-photos.json) =====
create table if not exists student_photos (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  photo_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(establishment_id, student_id)
);

-- ===== Finance Targets (finance-targets.json) =====
create table if not exists finance_targets (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  discipline_code text not null,
  expected_fee numeric(10,2) not null default 50.00,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(establishment_id, discipline_code)
);

-- ===== Absences (absences.json) =====
create table if not exists absences (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  absence_date date not null,
  reason text,
  document_url text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ===== App Settings (app-settings.json) =====
create table if not exists app_settings (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid references establishments(id) on delete cascade,
  settings_key text not null, -- 'beltColors', 'monthlyFees', '__system__', etc
  settings_value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(establishment_id, settings_key)
);

-- ===== WhatsApp Configs (whatsapp-config.json) =====
create table if not exists whatsapp_configs (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null unique references establishments(id) on delete cascade,
  enabled boolean not null default false,
  phone_number text,
  message_template text default 'Hola {{name}}, te recordamos que tienes clase de {{discipline}} el {{date}} a las {{time}}.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== Trial Users (trial-users.json) =====
create table if not exists trial_users (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  establishment_id uuid references establishments(id) on delete cascade,
  username text,
  full_name text,
  created_at timestamptz not null default now(),
  unlimited boolean not null default false,
  unique(profile_id)
);

-- ===== Marketplace Images (marketplace-images.json) =====
create table if not exists marketplace_images (
  id uuid primary key default gen_random_uuid(),
  marketplace_item_id uuid not null references marketplace_items(id) on delete cascade,
  image_url text not null,
  created_at timestamptz not null default now(),
  unique(marketplace_item_id)
);

-- ===== Triggers updated_at =====
drop trigger if exists trg_module_permissions_updated_at on module_permissions;
create trigger trg_module_permissions_updated_at before update on module_permissions
  for each row execute procedure set_updated_at();

drop trigger if exists trg_student_photos_updated_at on student_photos;
create trigger trg_student_photos_updated_at before update on student_photos
  for each row execute procedure set_updated_at();

drop trigger if exists trg_finance_targets_updated_at on finance_targets;
create trigger trg_finance_targets_updated_at before update on finance_targets
  for each row execute procedure set_updated_at();

drop trigger if exists trg_app_settings_updated_at on app_settings;
create trigger trg_app_settings_updated_at before update on app_settings
  for each row execute procedure set_updated_at();

drop trigger if exists trg_whatsapp_configs_updated_at on whatsapp_configs;
create trigger trg_whatsapp_configs_updated_at before update on whatsapp_configs
  for each row execute procedure set_updated_at();

-- ===== RLS Policies (service_role access) =====
alter table module_permissions enable row level security;
alter table sensei_instructors enable row level security;
alter table student_instructors enable row level security;
alter table student_photos enable row level security;
alter table finance_targets enable row level security;
alter table absences enable row level security;
alter table app_settings enable row level security;
alter table whatsapp_configs enable row level security;
alter table trial_users enable row level security;
alter table marketplace_images enable row level security;

drop policy if exists "service_role full module_permissions" on module_permissions;
create policy "service_role full module_permissions" on module_permissions for all to service_role using (true) with check (true);
drop policy if exists "service_role full sensei_instructors" on sensei_instructors;
create policy "service_role full sensei_instructors" on sensei_instructors for all to service_role using (true) with check (true);
drop policy if exists "service_role full student_instructors" on student_instructors;
create policy "service_role full student_instructors" on student_instructors for all to service_role using (true) with check (true);
drop policy if exists "service_role full student_photos" on student_photos;
create policy "service_role full student_photos" on student_photos for all to service_role using (true) with check (true);
drop policy if exists "service_role full finance_targets" on finance_targets;
create policy "service_role full finance_targets" on finance_targets for all to service_role using (true) with check (true);
drop policy if exists "service_role full absences" on absences;
create policy "service_role full absences" on absences for all to service_role using (true) with check (true);
drop policy if exists "service_role full app_settings" on app_settings;
create policy "service_role full app_settings" on app_settings for all to service_role using (true) with check (true);
drop policy if exists "service_role full whatsapp_configs" on whatsapp_configs;
create policy "service_role full whatsapp_configs" on whatsapp_configs for all to service_role using (true) with check (true);
drop policy if exists "service_role full trial_users" on trial_users;
create policy "service_role full trial_users" on trial_users for all to service_role using (true) with check (true);
drop policy if exists "service_role full marketplace_images" on marketplace_images;
create policy "service_role full marketplace_images" on marketplace_images for all to service_role using (true) with check (true);
