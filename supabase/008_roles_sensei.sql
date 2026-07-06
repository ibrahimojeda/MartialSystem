-- MartialSystem - Enable sensei role in role checks
-- Run this in Supabase SQL Editor after 006_usernames_superadmin.sql

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles
  add constraint profiles_role_check
  check (role in ('owner','sensei','admin','instructor','student','guardian','superadmin'));

alter table establishment_members drop constraint if exists establishment_members_role_check;
alter table establishment_members
  add constraint establishment_members_role_check
  check (role in ('owner','sensei','admin','instructor','student','guardian','superadmin'));
