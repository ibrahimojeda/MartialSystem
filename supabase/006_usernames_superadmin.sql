-- MartialSystem - Username auth support
-- Run this after 001_schema.sql and 002_rls.sql

alter table profiles
  add column if not exists username text,
  add column if not exists auth_email text;

-- Backfill auth_email from auth.users when possible
update profiles p
set auth_email = u.email
from auth.users u
where p.id = u.id
  and p.auth_email is null;

-- Backfill username when empty
update profiles
set username = lower(regexp_replace(split_part(coalesce(auth_email, 'user_' || substr(id::text, 1, 8)), '@', 1), '[^a-zA-Z0-9_]', '_', 'g'))
where username is null or btrim(username) = '';

-- Ensure uniqueness with id suffix for collisions
with ranked as (
  select id, username,
         row_number() over (partition by username order by created_at asc, id asc) as rn
  from profiles
)
update profiles p
set username = p.username || '_' || substr(p.id::text, 1, 6)
from ranked r
where p.id = r.id
  and r.rn > 1;

create unique index if not exists idx_profiles_username_unique
on profiles (username);
