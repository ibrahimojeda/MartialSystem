-- MartialSystem - Fase 0: Habilitar IA en todas las modalidades de pago
-- Ejecutar en Supabase SQL Editor.
-- Habilita 'ia_features' en TODOS los planes (desde Bushido hasta Elite).
-- El script es defensivo: solo toca las tablas que existan
-- (system_plans = esquema unificado actual; plans = tabla legacy opcional).

-- ============================================================
-- 1) system_plans (planes globales del esquema unificado)
--    Solo se ejecuta si la tabla existe.
-- ============================================================
do $$
begin
  if to_regclass('public.system_plans') is not null then
    update system_plans
    set features = coalesce(features, '[]'::jsonb) || '["ia_features"]'::jsonb
    where not (coalesce(features, '[]'::jsonb) ? 'ia_features');
  end if;
end $$;

-- ============================================================
-- 2) plans (tabla legacy por establecimiento, opcional)
--    Solo se ejecuta si la tabla existe.
-- ============================================================
do $$
begin
  if to_regclass('public.plans') is not null then
    update plans
    set features = coalesce(features, '[]'::jsonb) || '["ia_features"]'::jsonb
    where not (coalesce(features, '[]'::jsonb) ? 'ia_features');
  end if;
end $$;

-- ============================================================
-- 3) Upsert de todos los planes con ia_features desde Bushido
--    hasta Elite (solo en system_plans).
-- ============================================================
insert into system_plans (code, name, price_usd, max_dojos, max_students, features, sort_order)
values
  ('bushido', 'Bushido', 29.00, 1, 20, '["gestion_alumnos","asistencia","rangos","portal_alumno","ia_features"]'::jsonb, 0),
  ('starter', 'Starter', 49.00, 1, 50, '["gestion_alumnos","asistencia","rangos","portal_alumno","ia_features"]'::jsonb, 1),
  ('professional', 'Professional', 99.00, 3, 250, '["gestion_alumnos","asistencia","rangos","portal_alumno","torneos","marketplace","waivers","reportes_avanzados","ia_features"]'::jsonb, 2),
  ('elite', 'Elite', 199.00, 999, 999999, '["gestion_alumnos","asistencia","rangos","portal_alumno","torneos","marketplace","waivers","reportes_avanzados","multi_dojo","ia_features","soporte_dedicado","api_access","white_label"]'::jsonb, 3)
on conflict (code) do update
  set features = excluded.features,
      name = excluded.name,
      sort_order = excluded.sort_order;

-- ============================================================
-- 4) Ajuste defensivo: si un establecimiento ya tiene un plan
--    en 'plans' con features, garantizar ia_features también ahí.
--    (Ya cubierto en el punto 2; se deja este extra solo si existe.)
-- ============================================================
do $$
begin
  if to_regclass('public.plans') is not null then
    update plans
    set features = coalesce(features, '[]'::jsonb) || '["ia_features"]'::jsonb
    where not (coalesce(features, '[]'::jsonb) ? 'ia_features');
  end if;
end $$;