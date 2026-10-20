# Runbook — Rotación de secretos

> No imprimir valores. Rotar fuera del repositorio. Invalidar sesiones tras rotar.

## 1. Superadmin

1. Definir nueva contraseña fuerte y única.
2. Actualizar `SUPERADMIN_PASSWORD` en `.env` (no versionado).
3. Reiniciar el proceso del servidor (invalida sesiones en memoria).
4. Borrar `data/superadmin-sessions.json` para invalidar sesiones guardadas.

## 2. Supabase

1. Rotar `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_ANON_KEY` en el panel.
2. Actualizar `.env`.

## 3. IA (OpenAI/DeepSeek/Gemini/Custom)

1. Revocar la key comprometida en el panel del proveedor.
2. Generar nueva key.
3. Guardarla vía Configuración → IA (o gestor de secretos), no en `data/ai-config.json` en claro.
4. Borrar `data/ai-config.json` local o reemplazar con valores vacíos.

## 4. Stripe / PagueloFacil / PayPal / Twilio / Resend

1. Rotar claves secretas en cada panel.
2. Actualizar `.env` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, etc.).
3. Revalidar webhooks en sandbox antes de producción.

## 5. Verificación

- [ ] `git grep` no encuentra secretos en árbol ni historial (tras `git filter-repo`).
- [ ] `GET /api/ai/config` devuelve solo `hasKey`/`apiKeyHint`.
- [ ] Login con credenciales viejas falla.
- [ ] Sesiones previas invalidadas.

## 6. Revisión de acceso

Revisar logs de acceso desde la fecha de exposición (Supabase Auth, logs del servidor, proveedores IA) para detectar uso indebido.

---

## 7. Procedimiento detallado por proveedor (paso a paso)

> **Regla:** no escribas nunca un valor real en terminal, logs, issues ni commits. Usa un gestor de secretos local (p.ej. `1Password`) y copia/pega directo al panel.

### 7.1 SUPERADMIN_PASSWORD
1. Generar una contraseña fuerte y única (>= 16 chars, símbolos).
2. Local: editar `.env` → `SUPERADMIN_PASSWORD=<NUEVO>`.
3. Render: Settings → Environment Variables → actualizar `SUPERADMIN_PASSWORD`.
4. **Invalidar sesiones:** borrar `data/superadmin-sessions.json` y reiniciar el proceso (las sesiones en memoria se pierden al reiniciar).
5. Verificar: login con la contraseña vieja debe fallar (401); con la nueva debe funcionar.

### 7.2 Supabase (Service Role Key + Anon Key)
1. Supabase Dashboard → Project Settings → API Keys → **Revoke** y regenerar `service_role` y `anon`.
2. Actualizar `.env` (`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`) y Render.
3. **Invalidar sesiones:** Supabase Auth → revoke sesiones activas si aplica.
4. Reiniciar el servidor y verificar `/api/health` y `/api/login`.

### 7.3 API keys de IA (OpenAI / DeepSeek / Gemini / Custom)
1. En cada proveedor: revocar la key comprometida y generar una nueva.
2. Guardar la nueva vía **Configuración → IA** (superadmin) **o** en el gestor de secretos — **no** en `data/ai-config.json` en claro.
3. Borrar o vaciar `data/ai-config.json` local.
4. Verificar en Configuración → IA que `GET /api/ai/config` devuelve solo `hasKey` + `apiKeyHint` (últimos 4).

### 7.4 Stripe
1. Stripe Dashboard → Developers → API keys → revocar `sk_live_*` y `whsec_*`.
2. Actualizar `.env` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) y Render.
3. Actualizar el endpoint del webhook con el nuevo `whsec_`.
4. Probar un pago en modo test antes de producción.

### 7.5 PayPal
1. PayPal Developer → Apps → rotar `client secret` (el `client id` suele fijarse).
2. Actualizar `.env` (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MODE`) y Render.
3. Probar create/capture en sandbox.

### 7.6 PagueloFacil
1. Panel PagueloFacil → rotar `api key` y `secret`.
2. Actualizar `.env` (`PAGUELOFACIL_API_KEY`, `PAGUELOFACIL_SECRET`, `PAGUELOFACIL_MODE`) y Render.
3. Verificar webhook/creación de link en sandbox.

### 7.7 Twilio (WhatsApp)
1. Twilio Console → revocar/regenerar `Auth Token` (el `Account SID` no cambia).
2. Actualizar `.env` (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`) y Render.
3. **No** enviar WhatsApp real durante la prueba.

### 7.8 Resend
1. Resend Dashboard → API Keys → revocar y generar nueva.
2. Actualizar `.env` (`RESEND_API_KEY`) y Render.
3. **No** enviar correos reales durante la prueba.

---

## 8. Actualización en Render

1. Render Dashboard → tu servicio → **Settings → Environment Variables**.
2. Añadir/actualizar cada variable rotada (nunca valores en logs).
3. **Deploy** (o espera el auto-deploy si está configurado).
4. Confirmar que el nuevo build arranca sin errores (ver logs de Render).

## 9. Verificación post-rotación

```bash
# Healthcheck (debe devolver ok + version/build/commit)
curl -s https://<TU_DOMINIO>/api/health

# Login (reemplaza <usuario> y <contraseña>; no los imprimas en logs)
curl -s -X POST https://<TU_DOMINIO>/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"<USUARIO>","password":"<CONTRASEÑA>"}'
```

- [ ] `/api/health` devuelve `ok:true` con `version`, `build`, `commit` esperados.
- [ ] Login con credenciales **nuevas** → 200 y `access_token`.
- [ ] Login con credenciales **viejas** → 401.
- [ ] `GET /api/ai/config` (superadmin) devuelve solo `hasKey`/`apiKeyHint`.
- [ ] Stripe/PayPal/PagueloFacil funcionan en sandbox.

