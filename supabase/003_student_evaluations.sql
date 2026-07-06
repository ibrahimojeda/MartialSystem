-- MartialSystem - Student evaluations module
-- Run this after 001_schema.sql and 002_rls.sql

create table if not exists student_evaluations (
  id uuid primary key default gen_random_uuid(),
  establishment_id uuid not null references establishments(id) on delete cascade,
  discipline_id uuid not null references disciplines(id) on delete restrict,
  student_id uuid not null references students(id) on delete cascade,
  template_id uuid references exam_templates(id) on delete set null,
  evaluator_profile_id uuid not null references profiles(id) on delete set null,
  score numeric(5,2),
  passed boolean not null default false,
  notes text,
  next_rank text,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_student_eval_establishment on student_evaluations(establishment_id);
create index if not exists idx_student_eval_student on student_evaluations(student_id);
create index if not exists idx_student_eval_discipline on student_evaluations(discipline_id);
create index if not exists idx_student_eval_evaluator on student_evaluations(evaluator_profile_id);

alter table student_evaluations enable row level security;

create policy student_evaluations_member_read
on student_evaluations for select
using (is_member_of_establishment(establishment_id));

create policy student_evaluations_member_insert
on student_evaluations for insert
with check (is_member_of_establishment(establishment_id));
