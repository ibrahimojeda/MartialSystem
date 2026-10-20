#!/usr/bin/env bash
# =============================================================================
# post-deploy-verify.sh — Verificación post-deploy de tenancy del dashboard
# Confirma que Render ejecuta el fix P0: /api/dashboard/stats es SOLO superadmin.
#
# - NO imprime contraseñas, tokens ni cuerpos de respuestas sensibles.
# - Los tokens se conservan ÚNICAMENTE en memoria (variables del proceso).
# - Credenciales por variables de entorno o por stdin interactivo (sin eco).
#
# Uso:
#   BASE_URL="https://<dominio>" \
#   OWNER_USER="u" OWNER_PASS="p" \
#   SENSEI_USER="u" SENSEI_PASS="p" \
#   INSTRUCTOR_USER="u" INSTRUCTOR_PASS="p" \
#   SUPERADMIN_USER="u" SUPERADMIN_PASS="p" \
#   [EST_OWN_ID="uuid-propio"] [EST_OTHER_ID="uuid-ajeno"] \
#   bash tests/post-deploy-verify.sh
# =============================================================================
set -uo pipefail

BASE_URL="${BASE_URL%/}"
EXPECTED_VERSION="2.11.3"
EXPECTED_BUILD="27"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-7e5fe65}"
EXPECTED_BRANCH="master"

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  [PASS] %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  [FAIL] %s\n' "$1"; }

# ---- lectura segura de credenciales (env o stdin, sin eco) ----
read_secret() {
  local name="$1" prompt="$2" v
  v="$(printenv "$name" 2>/dev/null || true)"
  if [ -n "$v" ]; then printf '%s' "$v"; return; fi
  if [ -t 0 ]; then
    printf '%s: ' "$prompt" >&2
    IFS= read -r -s v || true
    printf '\n' >&2
  else
    IFS= read -r v || true
  fi
  printf '%s' "$v"
}

# ---- HTTP helpers ----
http_status() { # method path [token] -> solo código de estado
  local method="$1" path="$2" token="${3:-}"
  if [ -n "$token" ]; then
    curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE_URL$path" -H "Authorization: Bearer $token"
  else
    curl -s -o /dev/null -w '%{http_code}' -X "$method" "$BASE_URL$path"
  fi
}

login_token() { # user pass -> token por stdout (capturar en variable, NO imprimir)
  local user="$1" pass="$2"
  curl -s -X POST "$BASE_URL/api/login" -H 'Content-Type: application/json' \
    -d "{\"username\":\"$user\",\"password\":\"$pass\"}" \
    | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
}

assert_status() { # desc method path expected [token]
  local desc="$1" method="$2" path="$3" expected="$4" token="${5:-}"
  local code
  code="$(http_status "$method" "$path" "$token")"
  if [ "$code" = "$expected" ]; then ok "$desc ($code)"; else fail "$desc (esperado $expected, obtenido $code)"; fi
}

[ -z "$BASE_URL" ] && { echo "ERROR: define BASE_URL"; exit 2; }
echo "== Verificación post-deploy =="
echo "URL: $BASE_URL"

echo ""
echo "== 1) /api/health =="
HEALTH_RAW="$(curl -s -w '\n%{http_code}' "$BASE_URL/api/health")"
H_CODE="$(printf '%s' "$HEALTH_RAW" | tail -n1)"
H="$(printf '%s' "$HEALTH_RAW" | sed '$d')"
if [ "$H_CODE" = "200" ]; then ok "health HTTP 200"; else fail "health HTTP 200 (obtenido $H_CODE)"; fi
if [ -n "$H" ]; then
  printf '%s' "$H" | grep -Fq "\"version\":\"$EXPECTED_VERSION\"" && ok "version $EXPECTED_VERSION" || fail "version (esperada $EXPECTED_VERSION)"
  printf '%s' "$H" | grep -Fq "\"build\":\"$EXPECTED_BUILD\""     && ok "build $EXPECTED_BUILD"       || fail "build (esperado $EXPECTED_BUILD)"
  printf '%s' "$H" | grep -Fq "\"commit\":\"$EXPECTED_COMMIT"      && ok "commit $EXPECTED_COMMIT (prefijo)" || fail "commit (esperado prefijo $EXPECTED_COMMIT)"
  printf '%s' "$H" | grep -Fq "\"branch\":\"$EXPECTED_BRANCH\""   && ok "branch $EXPECTED_BRANCH"     || fail "branch (esperada $EXPECTED_BRANCH)"
else
  fail "health no respondió"
fi

echo ""
echo "== 2) Sin token -> 401 =="
assert_status "sin token /api/dashboard/stats" GET "/api/dashboard/stats" 401

echo ""
echo "== 3) Roles no-superadmin -> 403 =="
for role in OWNER SENSEI INSTRUCTOR; do
  u=""; p=""
  case "$role" in
    OWNER)      u="$(read_secret OWNER_USER 'Owner username')";            p="$(read_secret OWNER_PASS 'Owner password')";;
    SENSEI)     u="$(read_secret SENSEI_USER 'Sensei username')";          p="$(read_secret SENSEI_PASS 'Sensei password')";;
    INSTRUCTOR) u="$(read_secret INSTRUCTOR_USER 'Instructor username')";  p="$(read_secret INSTRUCTOR_PASS 'Instructor password')";;
  esac
  tok="$(login_token "$u" "$p")"
  if [ -z "$tok" ]; then fail "$role login (no se obtuvo token)"; continue; fi
  assert_status "$role /api/dashboard/stats" GET "/api/dashboard/stats" 403 "$tok"
  if [ -n "${EST_OWN_ID:-}" ];   then assert_status "$role stats?establishmentId=propio" GET "/api/dashboard/stats?establishmentId=$EST_OWN_ID" 403 "$tok"; fi
  if [ -n "${EST_OTHER_ID:-}" ]; then assert_status "$role stats?establishmentId=ajeno" GET "/api/dashboard/stats?establishmentId=$EST_OTHER_ID" 403 "$tok"; fi
  unset tok u p
done

echo ""
echo "== 4) Superadmin -> 200 (dashboard global) =="
SA_TOK="$(login_token "$(read_secret SUPERADMIN_USER 'Superadmin username')" "$(read_secret SUPERADMIN_PASS 'Superadmin password')")"
if [ -z "$SA_TOK" ]; then fail "superadmin login (no se obtuvo token)"; else assert_status "superadmin /api/dashboard/stats" GET "/api/dashboard/stats" 200 "$SA_TOK"; fi
unset SA_TOK

echo ""
echo "== 5) IA solo-lectura: conteo determinístico (opcional) =="
# Requiere credenciales OWNER (rol con lectura IA). Si no están, se omite y se documenta.
if [ -n "$(printenv OWNER_USER 2>/dev/null || true)" ] && [ -n "$(printenv OWNER_PASS 2>/dev/null || true)" ]; then
  OWNER_TOK="$(login_token "$OWNER_USER" "$OWNER_PASS")"
else
  OWNER_TOK=""
fi
if [ -z "$OWNER_TOK" ]; then
  echo "  [SKIP] OWNER_USER/OWNER_PASS no configurados; prueba IA omitida (opcional)."
else
  if [ -n "${EST_OWN_ID:-}" ]; then
    AI_BODY="{\"message\":\"¿Cuántos alumnos tiene mi dojo?\",\"establishmentId\":\"${EST_OWN_ID}\"}"
  else
    AI_BODY='{"message":"¿Cuántos alumnos tiene mi dojo?"}'
  fi
  AI_RAW="$(curl -s -w '\n%{http_code}' -X POST "$BASE_URL/api/ai/chat" \
    -H "Authorization: Bearer $OWNER_TOK" -H 'Content-Type: application/json' \
    -d "$AI_BODY")"
  AI_CODE="$(printf '%s' "$AI_RAW" | tail -n1)"
  AI_RESP="$(printf '%s' "$AI_RAW" | sed '$d')"

  if [ "$AI_CODE" = "200" ]; then ok "IA conteo HTTP 200"; else fail "IA conteo HTTP 200 (obtenido $AI_CODE)"; fi
  if [ -n "$AI_RESP" ] && printf '%s' "$AI_RESP" | grep -Fq '"ok":true'; then ok "IA conteo respuesta no vacía"; else fail "IA conteo respuesta no vacía"; fi
  if [ -n "${EST_OTHER_ID:-}" ]; then
    if printf '%s' "$AI_RESP" | grep -Fq "$EST_OTHER_ID"; then fail "IA conteo sin IDs de otro establecimiento"; else ok "IA conteo sin IDs de otro establecimiento"; fi
  else
    echo "  [SKIP] EST_OTHER_ID no configurado; no se verifica aislamiento de IDs."
  fi
  if printf '%s' "$AI_RESP" | grep -Fq '"action":"prefill"'; then fail "IA conteo sin prefill/escritura"; else ok "IA conteo sin prefill/escritura (no crea registros)"; fi
  unset OWNER_TOK AI_BODY AI_RAW AI_CODE AI_RESP
fi

echo ""
echo "== Resumen =="
echo "PASS: $PASS   FAIL: $FAIL"
if [ "$FAIL" -eq 0 ]; then echo "RESULTADO: OK ✅"; exit 0; else echo "RESULTADO: NO-GO ❌"; exit 1; fi
