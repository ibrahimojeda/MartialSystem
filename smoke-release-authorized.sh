#!/usr/bin/env bash
set -Eeuo pipefail

# Smoke no destructivo para MartialSystem.
# Requiere: curl, jq
# Nunca pongas credenciales en este archivo. Usa variables de entorno.
#
# Uso mínimo:
#   BASE_URL=https://martialsystem.onrender.com \
#   SMOKE_USERNAME=... SMOKE_PASSWORD=... \
#   ./smoke-release-authorized.sh
#
# Consultas opcionales:
#   AI_QUERY='¿Qué usuario soy?'
#   EXPECTED_ROLE=sensei
#   EXPECTED_USERNAME=bruno_silva_sensei
#   ESTABLISHMENT_ID='uuid-del-establecimiento'  (opcional: si se omite, la
#     identidad se prueba sin alcance contextual)
#
# Mutaciones: desactivadas por defecto.
# Para ejecutar el PATCH reversible de clase se requiere:
#   RUN_MUTATIONS=1 CLASS_ID=... ORIGINAL_LOCATION=...
# La restauración es obligatoria y se intenta aunque falle una aserción.
# Nota: el PATCH deriva el tenancy de la propia clase; NO se envía
# establishmentId en el body (el endpoint rechaza campos no permitidos).

BASE_URL="${BASE_URL:-https://martialsystem.onrender.com}"
SMOKE_USERNAME="${SMOKE_USERNAME:-}"
SMOKE_PASSWORD="${SMOKE_PASSWORD:-}"
AI_QUERY="${AI_QUERY:-¿Qué usuario soy?}"
EXPECTED_ROLE="${EXPECTED_ROLE:-}"
EXPECTED_USERNAME="${EXPECTED_USERNAME:-}"
RUN_MUTATIONS="${RUN_MUTATIONS:-0}"
CLASS_ID="${CLASS_ID:-}"
ORIGINAL_LOCATION="${ORIGINAL_LOCATION:-}"
TEMP_LOCATION="${TEMP_LOCATION:-SMOKE-RELEASE-TEMP-DO-NOT-KEEP}"
ESTABLISHMENT_ID="${ESTABLISHMENT_ID:-}"

fail(){ echo "FAIL: $*" >&2; exit 1; }
pass(){ echo "PASS: $*"; }
need(){ [[ -n "${!1:-}" ]] || fail "Falta variable $1"; }

command -v curl >/dev/null || fail "curl no está instalado"
command -v jq >/dev/null || fail "jq no está instalado"
need SMOKE_USERNAME
need SMOKE_PASSWORD

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
COOKIE="$TMP/cookies.txt"
LOGIN_JSON="$TMP/login.json"

health="$(curl -fsS --max-time 30 "$BASE_URL/api/health")" || fail "healthcheck no respondió"
echo "$health" | jq -e '.ok == true' >/dev/null || fail "healthcheck devolvió ok != true"
pass "healthcheck ok"
echo "$health" | jq '{version,build,commit,branch}'

login_code="$(curl -sS -o "$LOGIN_JSON" -w '%{http_code}' --max-time 30 \
  -c "$COOKIE" -H 'Content-Type: application/json' \
  -X POST "$BASE_URL/api/login" \
  --data "$(jq -cn --arg u "$SMOKE_USERNAME" --arg p "$SMOKE_PASSWORD" '{username:$u,password:$p}')")"
[[ "$login_code" == "200" ]] || { echo "$(jq 'del(.data.access_token,.data.refresh_token,.access_token,.refresh_token)' "$LOGIN_JSON" 2>/dev/null || cat "$LOGIN_JSON")"; fail "login HTTP $login_code"; }
TOKEN="$(jq -r '.data.access_token // .access_token // empty' "$LOGIN_JSON")"
[[ -n "$TOKEN" && "$TOKEN" != "null" ]] || fail "login no devolvió access_token"
pass "login HTTP 200 para $SMOKE_USERNAME"

ME_JSON="$TMP/me.json"
ME_CODE="$(curl -sS -o "$ME_JSON" -w '%{http_code}' --max-time 30 \
  -H "Authorization: Bearer $TOKEN" "$BASE_URL/api/me")"
if [[ "$ME_CODE" == "200" ]]; then
  jq '{username: .data.profile.username, role: .data.profile.role, full_name: .data.profile.full_name}' "$ME_JSON" 2>/dev/null || cat "$ME_JSON"
  pass "endpoint /api/me HTTP 200"
else
  echo "Aviso: /api/me devolvió HTTP $ME_CODE; se continúa con /api/ai/chat"
fi

AI_JSON="$TMP/ai.json"
# Si ESTABLISHMENT_ID está definido se envía establishmentId en el body;
# si no, se omite: la identidad (¿quién soy?) debe responder el rol canónico
# igualmente, sin depender del alcance contextual.
AI_BODY="$TMP/ai-body.json"
jq -cn --arg q "$AI_QUERY" --arg e "$ESTABLISHMENT_ID" \
  '{message:$q} + (if $e == "" then {} else {establishmentId:$e} end)' > "$AI_BODY"
AI_CODE="$(curl -sS -o "$AI_JSON" -w '%{http_code}' --max-time 90 \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -X POST "$BASE_URL/api/ai/chat" \
  --data-binary @"$AI_BODY")"
[[ "$AI_CODE" == "200" ]] || { echo "$(cat "$AI_JSON")"; fail "IA HTTP $AI_CODE"; }
AI_TEXT="$(jq -r '[.. | strings] | join(" ")' "$AI_JSON" 2>/dev/null)" || true
[[ -n "$AI_TEXT" ]] || fail "IA respondió sin texto"
pass "IA HTTP 200 y respuesta no vacía"
echo "Respuesta IA: $AI_TEXT"

if [[ -n "$EXPECTED_USERNAME" ]]; then
  grep -Fqi "$EXPECTED_USERNAME" <<<"$AI_TEXT" || fail "la respuesta IA no contiene el username esperado"
  pass "IA identifica el username esperado"
fi
if [[ -n "$EXPECTED_ROLE" ]]; then
  grep -Fqi "$EXPECTED_ROLE" <<<"$AI_TEXT" || fail "la respuesta IA no contiene el rol esperado"
  pass "IA identifica el rol esperado"
fi

if [[ "$RUN_MUTATIONS" == "1" ]]; then
  need CLASS_ID
  need ORIGINAL_LOCATION
  PATCH_JSON="$TMP/patch.json"
  restore(){
    curl -sS --max-time 60 -o "$TMP/restore.json" -w '%{http_code}' \
      -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
      -X PATCH "$BASE_URL/api/classes/$CLASS_ID" \
      --data "$(jq -cn --arg l "$ORIGINAL_LOCATION" '{location:$l}')" >/dev/null || true
  }
  trap 'restore; rm -rf "$TMP"' EXIT
  PATCH_CODE="$(curl -sS -o "$PATCH_JSON" -w '%{http_code}' --max-time 60 \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -X PATCH "$BASE_URL/api/classes/$CLASS_ID" \
    --data "$(jq -cn --arg l "$TEMP_LOCATION" '{location:$l}')")"
  [[ "$PATCH_CODE" == "200" ]] || { cat "$PATCH_JSON"; fail "PATCH reversible HTTP $PATCH_CODE"; }
  jq -e '.notification_status == "queued" or .data.notification_status == "queued"' "$PATCH_JSON" >/dev/null || echo "Aviso: no se encontró notification_status=queued en la forma esperada"
  pass "PATCH reversible HTTP 200 (notification_status esperado: queued)"
  SECOND="$(curl -sS --max-time 60 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -X PATCH "$BASE_URL/api/classes/$CLASS_ID" \
    --data "$(jq -cn --arg l "$TEMP_LOCATION" '{location:$l}')")"
  echo "$SECOND" | jq -e '.. | objects | select(has("changed")) | .changed == false' >/dev/null || echo "Aviso: no se encontró changed=false en la respuesta idempotente"
  pass "segundo PATCH ejecutado; restauración programada"
else
  pass "modo solo lectura: no se ejecutaron mutaciones"
fi

echo "SMOKE COMPLETADO"