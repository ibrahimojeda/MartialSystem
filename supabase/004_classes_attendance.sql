-- MartialSystem - Classes and attendance module
-- Run this after 001_schema.sql and 002_rls.sql

create table if not exists class_sessions (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  discipline_id uuid not null references disciplines(id) on delete restrict,
  instructor_profile_id uuid references profiles(id) on delete set null,
  title text not null,
  scheduled_date date not null,
  start_time time not null,
  end_time time,
  location text,
  notes text,
  status text not null default 'scheduled' check (status in ('scheduled','completed','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists class_attendance_records (
  id uuid primary key default gen_random_uuid(),
  class_session_id uuid not null references class_sessions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  status text not null default 'present' check (status in ('present','absent','late','excused')),
  notes text,
  marked_by uuid references profiles(id) on delete set null,
  marked_at timestamptz not null default now(),
  unique(class_session_id, student_id)
);

create index if not exists idx_class_sessions_establishment on class_sessions(establishment_id);
create index if not exists idx_class_sessions_discipline on class_sessions(discipline_id);
create index if not exists idx_class_sessions_date on class_sessions(scheduled_date);
create index if not exists idx_attendance_class on class_attendance_records(class_session_id);
create index if not exists idx_attendance_student on class_attendance_records(student_id);

alter table class_sessions enable row level security;
alter table class_attendance_records enable row level security;

create policy class_sessions_member_read
on class_sessions for select
using (is_member_of_establishment(establishment_id));

create policy class_sessions_member_insert
on class_sessions for insert
with check (is_member_of_establishment(establishment_id));

create policy class_sessions_member_update
on class_sessions for update
using (is_member_of_establishment(establishment_id));

create policy class_attendance_member_read
on class_attendance_records for select
using (
  exists (
    select 1
    from class_sessions cs
    where cs.id = class_attendance_records.class_session_id
      and is_member_of_establishment(cs.establishment_id)
  )
);

create policy class_attendance_member_upsert
on class_attendance_records for insert
with check (
  exists (
    select 1
    from class_sessions cs
    where cs.id = class_attendance_records.class_session_id
      and is_member_of_establishment(cs.establishment_id)
  )
);

create policy class_attendance_member_update
on class_attendance_records for update
using (
  exists (
    select 1
    from class_sessions cs
    where cs.id = class_attendance_records.class_session_id
      and is_member_of_establishment(cs.establishment_id)
  )
);
