-- MartialSystem - Fase 0: Habilitar IA en todas las modalidades de pago
-- Ejecutar en Supabase SQL Editor.
-- Habilita 'ia_features' en TODOS los planes (system_plans y plans por establecimiento).

-- ===== system_plans (planes globales) =====
do $$
declare
  p record;
  feats jsonb;
begin
  for p in select * from system_plans loop
    feats := coalesce(p.features, '[]'::jsonb);
    if not (feats ? 'ia_features') then
      feats := feats || '["ia_features"]'::jsonb;
      update system_plans set features = feats where id = p.id;
    end if;
  end loop;
end $$;

-- ===== plans (planes por establecimiento) =====
do $$
declare
  p record;
  feats jsonb;
begin
  for p in select * from plans loop
    feats := coalesce(p.features, '[]'::jsonb);
    if not (feats ? 'ia_features') then
      feats := feats || '["ia_features"]'::jsonb;
      update plans set features = feats where id = p.id;
    end if;
  end loop;
end $$;

-- ===== Inserts/upserts para planes nuevos con ia_features en todas las modalidades =====
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

-- ===== Nota: 'plans' por establecimiento puede no existir si el esquema es nuevo =====
-- Solo se actualiza si la tabla 'plans' existe.
do $$
begin
  if to_regclass('public.plans') is not null then
    update plans
    set features = features || '["ia_features"]'::jsonb
    where not (features ? 'ia_features');
  end if;
end $$;