-- ══════════════════════════════════════════════════════════════
-- 025_ai_status_rpc.sql — Estado público de la IA para la APK.
-- Expone SOLO { enabled, hasKey } de la config de IA (app_settings.__ai__)
-- SIN exponer API keys, para que la APK (Supabase directo, rol anon) lea
-- el flag que el superadmin configuró en la web.
-- La fuente de verdad sigue siendo app_settings (key '__ai__').
-- ══════════════════════════════════════════════════════════════

create or replace function get_ai_enabled_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb;
  v_enabled boolean := true;
  v_has_key boolean := false;
  v_prov jsonb;
begin
  select settings_value into v_cfg
  from app_settings
  where establishment_id is null and settings_key = '__ai__'
  order by updated_at desc
  limit 1;

  if v_cfg is not null and jsonb_typeof(v_cfg) = 'object' then
    v_enabled := coalesce((v_cfg->>'enabled')::boolean, true);

    if v_cfg->'providers' is not null and jsonb_typeof(v_cfg->'providers') = 'array' then
      for v_prov in select value from jsonb_array_elements(v_cfg->'providers') as t(value)
      loop
        if coalesce((v_prov->>'enabled')::boolean, true)
           and coalesce(v_prov->>'apiKey', '') <> '' then
          v_has_key := true;
        end if;
      end loop;
    elsif coalesce(v_cfg->>'apiKey', '') <> '' then
      v_has_key := true; -- formato legacy (apiKey único)
    end if;
  else
    v_enabled := false;
  end if;

  return jsonb_build_object('enabled', v_enabled, 'hasKey', v_has_key);
end;
$$;

revoke all on function get_ai_enabled_status() from public;
grant execute on function get_ai_enabled_status() to anon, authenticated;
