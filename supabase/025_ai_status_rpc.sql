-- ══════════════════════════════════════════════════════════════
-- 025_ai_status_rpc.sql — Estado público MÍNIMO de la IA para la APK.
-- Expone SOLO { enabled, hasKey } de la config de IA (app_settings.__ai__).
-- NO expone API keys, tokens, URLs privadas ni el contenido de app_settings.
-- La autorización completa (rol, plan, facturación, cooldown) NUNCA se delega
-- a este RPC: sigue viviendo en el backend Express (/api/ai/status).
-- La APK usa este RPC únicamente como indicador mínimo no sensible.
-- ══════════════════════════════════════════════════════════════

-- Helper de conversión booleana tolerante.
-- Acepta únicamente true/false. Valores ausentes usan `dflt`;
-- valores inválidos ("yes", "invalid", ...) usan `dflt` (seguro) en vez de fallar.
create or replace function _ai_safe_bool(v jsonb, key text, dflt boolean)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  raw text;
begin
  if v is null or jsonb_typeof(v) <> 'object' then
    return coalesce(dflt, false);
  end if;
  raw := lower(nullif(coalesce(v->>key, ''), ''));
  if raw is null then
    return coalesce(dflt, false);
  elsif raw = 'true' then
    return true;
  elsif raw = 'false' then
    return false;
  else
    return coalesce(dflt, false); -- "yes"/"invalid" → default seguro, nunca lanza
  end if;
end;
$$;

revoke all on function _ai_safe_bool(jsonb, text, boolean) from public;

-- ══════════════════════════════════════════════════════════════
create or replace function get_ai_enabled_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cfg jsonb;
  v_enabled boolean := false;
  v_has_key boolean := false;
  v_prov jsonb;
begin
  select settings_value into v_cfg
  from app_settings
  where establishment_id is null and settings_key = '__ai__'
  order by updated_at desc
  limit 1;

  if v_cfg is not null and jsonb_typeof(v_cfg) = 'object' then
    -- enabled ausente se interpreta como true (legacy). Inválido → false (seguro).
    v_enabled := _ai_safe_bool(v_cfg, 'enabled', true);

    if v_cfg->'providers' is not null and jsonb_typeof(v_cfg->'providers') = 'array' then
      for v_prov in select value from jsonb_array_elements(v_cfg->'providers') as t(value)
      loop
        if _ai_safe_bool(v_prov, 'enabled', true)
           and coalesce(nullif(v_prov->>'apiKey', ''), '') <> '' then
          v_has_key := true;
        end if;
      end loop;
    elsif coalesce(nullif(v_cfg->>'apiKey', ''), '') <> '' then
      v_has_key := true; -- formato legacy (apiKey único)
    end if;
  else
    v_enabled := false;
  end if;

  -- Solo { enabled, hasKey }. NUNCA apiKey/tokens/urls/app_settings.
  return jsonb_build_object('enabled', v_enabled, 'hasKey', v_has_key);
end;
$$;

revoke all on function get_ai_enabled_status() from public;
grant execute on function get_ai_enabled_status() to anon, authenticated;
