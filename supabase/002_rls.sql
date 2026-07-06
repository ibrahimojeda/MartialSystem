-- MartialSystem - RLS baseline
-- Run after 001_schema.sql

-- Enable RLS
alter table disciplines enable row level security;
alter table establishments enable row level security;
alter table establishment_disciplines enable row level security;
alter table profiles enable row level security;
alter table establishment_members enable row level security;
alter table instructor_disciplines enable row level security;
alter table students enable row level security;
alter table student_enrollments enable row level security;
alter table discipline_configs enable row level security;
alter table ranks enable row level security;
alter table theory_topics enable row level security;
alter table exam_templates enable row level security;
alter table payments enable row level security;

-- Helper function: does current auth.user belong to establishment?
create or replace function is_member_of_establishment(est_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from establishment_members em
    where em.establishment_id = est_id
      and em.profile_id = auth.uid()
  );
$$;

-- Public read for active disciplines
create policy disciplines_read_active
on disciplines for select
using (is_active = true);

-- Establishment-scoped policies
create policy establishments_member_read
on establishments for select
using (is_member_of_establishment(id));

create policy establishment_disciplines_member_read
on establishment_disciplines for select
using (is_member_of_establishment(establishment_id));

create policy students_member_read
on students for select
using (is_member_of_establishment(establishment_id));

create policy enrollments_member_read
on student_enrollments for select
using (
  exists (
    select 1
    from students s
    where s.id = student_enrollments.student_id
      and is_member_of_establishment(s.establishment_id)
  )
);

create policy payments_member_read
on payments for select
using (is_member_of_establishment(establishment_id));

-- Profile read own
create policy profiles_read_own
on profiles for select
using (id = auth.uid());

-- NOTE:
-- Service Role key bypasses RLS. Backend API should use service role for admin actions.
-- Add stricter insert/update/delete policies once your role matrix is finalized.
