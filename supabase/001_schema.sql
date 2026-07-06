-- MartialSystem - Initial schema
-- Run this in Supabase SQL Editor

create extension if not exists "pgcrypto";

-- ===== Core catalog =====
create table if not exists disciplines (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists establishments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  country text,
  phone text,
  email text,
  logo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- One establishment can run multiple disciplines
create table if not exists establishment_disciplines (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  discipline_id uuid not null references disciplines(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (establishment_id, discipline_id)
);

-- ===== Profiles & roles =====
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null check (role in ('owner','admin','instructor','student','guardian')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Membership by establishment
create table if not exists establishment_members (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('owner','admin','instructor','student','guardian')),
  created_at timestamptz not null default now(),
  unique(establishment_id, profile_id)
);

-- Instructor assignment to discipline
create table if not exists instructor_disciplines (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  discipline_id uuid not null references disciplines(id) on delete cascade,
  instructor_profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(establishment_id, discipline_id, instructor_profile_id)
);

-- Student enrollment by discipline
create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  full_name text not null,
  birth_date date,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists student_enrollments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  discipline_id uuid not null references disciplines(id) on delete restrict,
  instructor_profile_id uuid references profiles(id) on delete set null,
  current_rank text,
  joined_at date not null default current_date,
  status text not null default 'active' check (status in ('active','paused','withdrawn')),
  unique(student_id, discipline_id)
);

-- ===== Discipline configuration =====
create table if not exists discipline_configs (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  discipline_id uuid not null references disciplines(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(establishment_id, discipline_id)
);

create table if not exists ranks (
  id uuid primary key default gen_random_uuid(),
  discipline_id uuid not null references disciplines(id) on delete cascade,
  sort_order int not null,
  name text not null,
  code text,
  metadata jsonb not null default '{}'::jsonb,
  unique(discipline_id, sort_order)
);

create table if not exists theory_topics (
  id uuid primary key default gen_random_uuid(),
  discipline_id uuid not null references disciplines(id) on delete cascade,
  rank_id uuid references ranks(id) on delete set null,
  title text not null,
  content text,
  created_at timestamptz not null default now()
);

create table if not exists exam_templates (
  id uuid primary key default gen_random_uuid(),
  discipline_id uuid not null references disciplines(id) on delete cascade,
  rank_from_id uuid references ranks(id) on delete set null,
  rank_to_id uuid references ranks(id) on delete set null,
  name text not null,
  criteria jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- ===== Payments (shared core) =====
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  discipline_id uuid references disciplines(id) on delete set null,
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'USD',
  method text,
  concept text,
  paid_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);

-- ===== Indexes =====
create index if not exists idx_est_disc_establishment on establishment_disciplines(establishment_id);
create index if not exists idx_est_members_establishment on establishment_members(establishment_id);
create index if not exists idx_students_establishment on students(establishment_id);
create index if not exists idx_enrollments_student on student_enrollments(student_id);
create index if not exists idx_enrollments_discipline on student_enrollments(discipline_id);
create index if not exists idx_payments_establishment on payments(establishment_id);
create index if not exists idx_payments_student on payments(student_id);

-- ===== Trigger for updated_at =====
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_discipline_configs_updated_at on discipline_configs;
create trigger trg_discipline_configs_updated_at
before update on discipline_configs
for each row execute procedure set_updated_at();

-- ===== Seed disciplines =====
insert into disciplines (code, name)
values
  ('karate', 'Karate'),
  ('judo', 'Judo'),
  ('bjj', 'Brazilian Jiu-Jitsu'),
  ('taekwondo', 'Taekwondo'),
  ('kickboxing', 'Kickboxing'),
  ('muay_thai', 'Muay Thai'),
  ('boxing', 'Boxeo'),
  ('mma', 'MMA'),
  ('aikido', 'Aikido'),
  ('kendo', 'Kendo')
on conflict (code) do nothing;
