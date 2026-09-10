-- MartialSystem - Fase 1: Memoria del Asistente IA
-- Ejecutar en Supabase SQL Editor.
-- Guarda el historial de conversaciones por usuario + establecimiento
-- para que la IA recuerde lo que cada quien pregunta.

create table if not exists ai_memory (
  id uuid primary key default gen_random_uuid(),
  profile_id text not null,               -- 'superadmin' o el uuid del perfil
  establishment_id uuid references establishments(id) on delete cascade,
  role text not null default 'user',      -- rol con el que se consultó
  user_message text not null,
  ai_response text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_memory_profile on ai_memory(profile_id, created_at desc);
create index if not exists idx_ai_memory_est on ai_memory(establishment_id, created_at desc);

-- RLS: la memoria es por usuario; el service_role tiene acceso total.
alter table ai_memory enable row level security;

drop policy if exists "service_role full ai_memory" on ai_memory;
create policy "service_role full ai_memory"
  on ai_memory for all to service_role using (true) with check (true);

-- Los usuarios autenticados solo pueden ver/editar su propia memoria.
drop policy if exists "users read own ai_memory" on ai_memory;
create policy "users read own ai_memory"
  on ai_memory for select to authenticated
  using (profile_id = auth.uid()::text);

drop policy if exists "users insert own ai_memory" on ai_memory;
create policy "users insert own ai_memory"
  on ai_memory for insert to authenticated
  with check (profile_id = auth.uid()::text);

drop policy if exists "users delete own ai_memory" on ai_memory;
create policy "users delete own ai_memory"
  on ai_memory for delete to authenticated
  using (profile_id = auth.uid()::text);