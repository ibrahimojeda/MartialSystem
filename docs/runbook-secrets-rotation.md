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
