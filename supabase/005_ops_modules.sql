-- MartialSystem - Reports/Notifications/Marketplace/Guardian portal support
-- Run this after 001_schema.sql and 002_rls.sql

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  discipline_id uuid references disciplines(id) on delete set null,
  recipient_profile_id uuid references profiles(id) on delete cascade,
  audience_role text not null default 'all' check (audience_role in ('all','owner','admin','instructor','student','guardian')),
  title text not null,
  body text,
  is_read boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists marketplace_items (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  discipline_id uuid references disciplines(id) on delete set null,
  title text not null,
  description text,
  price numeric(12,2) not null check (price >= 0),
  currency text not null default 'USD',
  is_active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists guardian_students (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  guardian_profile_id uuid not null references profiles(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  relationship text,
  created_at timestamptz not null default now(),
  unique(establishment_id, guardian_profile_id, student_id)
);

create index if not exists idx_notifications_establishment on notifications(establishment_id);
create index if not exists idx_notifications_recipient on notifications(recipient_profile_id);
create index if not exists idx_marketplace_establishment on marketplace_items(establishment_id);
create index if not exists idx_guardian_students_guardian on guardian_students(guardian_profile_id);
create index if not exists idx_guardian_students_student on guardian_students(student_id);

alter table notifications enable row level security;
alter table marketplace_items enable row level security;
alter table guardian_students enable row level security;

drop policy if exists notifications_member_read on notifications;
create policy notifications_member_read
on notifications for select
using (is_member_of_establishment(establishment_id));

drop policy if exists notifications_member_insert on notifications;
create policy notifications_member_insert
on notifications for insert
with check (is_member_of_establishment(establishment_id));

drop policy if exists notifications_member_update on notifications;
create policy notifications_member_update
on notifications for update
using (is_member_of_establishment(establishment_id));

drop policy if exists marketplace_member_read on marketplace_items;
create policy marketplace_member_read
on marketplace_items for select
using (is_member_of_establishment(establishment_id));

drop policy if exists marketplace_member_insert on marketplace_items;
create policy marketplace_member_insert
on marketplace_items for insert
with check (is_member_of_establishment(establishment_id));

drop policy if exists marketplace_member_update on marketplace_items;
create policy marketplace_member_update
on marketplace_items for update
using (is_member_of_establishment(establishment_id));

drop policy if exists guardian_students_member_read on guardian_students;
create policy guardian_students_member_read
on guardian_students for select
using (is_member_of_establishment(establishment_id));

drop policy if exists guardian_students_member_insert on guardian_students;
create policy guardian_students_member_insert
on guardian_students for insert
with check (is_member_of_establishment(establishment_id));
