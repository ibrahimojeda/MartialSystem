-- ══════════════════════════════════════════════════════════════
-- Schema-check de SOLO LECTURA para 025_ai_status_rpc.
-- Ejecutar en el proyecto Supabase que realmente usa Render ANTES de
-- declarar el RPC como "aplicado". No modifica ningún objeto.
-- ══════════════════════════════════════════════════════════════

-- 1. Función existente, retorno jsonb y SECURITY DEFINER
select
  p.proname                                   as funcion,
  pg_get_function_result(p.oid)               as retorno,
  case when p.prosecdef then 'OK' else 'FALTA (NO SECURITY DEFINER)' end as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'get_ai_enabled_status';

-- 2. Permisos: execute solo a anon/authenticated (public revocado)
select grantee, privilege_type
from information_schema.role_routine_grants
where routine_name in ('get_ai_enabled_status', '_ai_safe_bool')
order by routine_name, grantee;

-- 3. El helper de booleanos existente
select
  p.proname                                   as funcion,
  case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end as seguridad
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = '_ai_safe_bool';

-- 4. La respuesta solo devuelve { enabled, hasKey }: inspección del retorno declarado
--    (busca jsonb_build_object con solo esas dos claves)
select
  p.proname,
  p.prosrc like '%jsonb_build_object%oauth%'   as filtro_inseguro_1,
  p.prosrc like '%app_settings%select%'        as lee_app_settings
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'get_ai_enabled_status';

-- 5. app_settings NO debe ser consultable por anon/authenticated (RLS)
select schemaname, tablename, policyname, cmd, roles::text
from pg_policies
where schemaname = 'public' and tablename = 'app_settings'
order by policyname;