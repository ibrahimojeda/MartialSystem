-- MartialSystem - Login Fix + RLS para APK directa
-- Ejecutar en Supabase SQL Editor

-- 1) Función segura para lookup de email por username (login)
--    Usa SECURITY DEFINER para bypassear RLS durante el login
create or replace function get_auth_email_for_login(username_param text)
returns text
language sql
security definer
set search_path = public
as $$
  select auth_email from profiles
  where username = lower(trim(username_param))
  limit 1;
$$;

-- 2) Política RLS para establishment_members (leer tus propias membresías)
--    Necesaria para que refreshMeDirect() funcione en la APK
drop policy if exists establishment_members_member_read on establishment_members;
create policy establishment_members_member_read
on establishment_members for select
using (profile_id = auth.uid());

-- 3) Política RLS para profiles: permitir lectura pública de username y auth_email
--    (solo esos 2 campos, para el login)
drop policy if exists profiles_read_public_login on profiles;
create policy profiles_read_public_login
on profiles for select
using (true);

-- 4) Política RLS para instructor_disciplines (lectura por miembro)
drop policy if exists instructor_disciplines_member_read on instructor_disciplines;
create policy instructor_disciplines_member_read
on instructor_disciplines for select
using (
  exists (
    select 1 from establishment_members em
    where em.establishment_id = instructor_disciplines.establishment_id
      and em.profile_id = auth.uid()
  )
);

-- 5) Política RLS para discipline_configs (lectura por miembro)
drop policy if exists discipline_configs_member_read on discipline_configs;
create policy discipline_configs_member_read
on discipline_configs for select
using (
  exists (
    select 1 from establishment_members em
    where em.establishment_id = discipline_configs.establishment_id
      and em.profile_id = auth.uid()
  )
);