# Checklist independiente de cierre operativo — MartialSystem

Versión objetivo: v2.11.4 / build 28
Commit objetivo: 30dbd4c
Regla: no compartir credenciales, tokens, service-role keys, keystores ni datos personales en la evidencia.

## A. Identidad del release

- [ ] `/api/health` responde `ok: true`.
- [ ] `version`, `build`, `commit` y `branch` coinciden con el release aprobado.
- [ ] `git diff --check` limpio.
- [ ] No hay `.env`, APKs, logs, backups o secretos en Git.
- [ ] `npm audit --omit=dev` sin vulnerabilidades bloqueantes.

## B. Supabase y backup

- [ ] El ref del host del SQL Editor coincide con el ref de `SUPABASE_URL` en Render.
- [ ] Backup/export realizado antes de cualquier smoke con escritura.
- [ ] Registrar fecha/hora del backup y nombre/ref del proyecto.
- [ ] No pegar keys ni dumps en tickets o chats.

## C. Esquema y RPC

- [ ] Migraciones 021–025 aplicadas.
- [ ] Schema-check de conversaciones aprobado.
- [ ] Schema-check de outbox aprobado.
- [ ] RPC 025 devuelve solo `enabled` y `hasKey`.
- [ ] `class_notification_outbox`: `sent=62`, `dead=0`, `stuck_processing=0`.

## D. Smoke HTTP con cuenta autorizada

Ejecutar el script con variables de entorno, nunca editando el archivo para insertar passwords.

```bash
chmod +x smoke-release-authorized.sh
BASE_URL=https://martialsystem.onrender.com \
SMOKE_USERNAME='usuario-autorizado' \
SMOKE_PASSWORD='password-por-entorno' \
AI_QUERY='¿Qué usuario soy?' \
EXPECTED_USERNAME='username-esperado' \
EXPECTED_ROLE='rol-esperado' \
./smoke-release-authorized.sh
```

- [ ] Login HTTP 200.
- [ ] Healthcheck correcto.
- [ ] IA responde en español y no está vacía.
- [ ] IA identifica correctamente usuario/rol cuando corresponde.
- [ ] Owner no puede consultar otro establecimiento.
- [ ] Sensei/instructor ve solo su alcance.
- [ ] Superadmin consulta globalmente, sin filtrar secretos.
- [ ] Deuda de alumnos (`student_charges`) separada de facturación de dojos (`system_usage_bills`).
- [ ] Supabase Directo sin servidor muestra “Requiere servidor”; nunca `planOk:true` fabricado.

## E. Smoke con mutación reversible

Solo después de backup y con `RUN_MUTATIONS=1` explícito:

- [ ] Registrar estado original de la clase.
- [ ] PATCH únicamente `location` a un valor temporal.
- [ ] Confirmar HTTP 200 y `notification_status=queued`.
- [ ] Repetir el PATCH idéntico.
- [ ] Confirmar `changed=false` y ausencia de duplicados.
- [ ] Confirmar que el worker drena el job a `sent`.
- [ ] Restaurar exactamente el valor original.
- [ ] Verificar que no quedó ningún job `dead` o `processing` atascado.

## F. Mensajería

- [ ] Same-tenant autorizado puede leer la conversación.
- [ ] Usuario cross-tenant recibe 403.
- [ ] Usuario no miembro recibe 403.
- [ ] Conversación archivada rechaza nuevos mensajes con 409.
- [ ] GET de conversación/listado no genera escrituras.
- [ ] No quedan conversaciones temporales de smoke sin revisar.

## G. APK Release

- [ ] Keystore fuera de Git.
- [ ] `keystore.properties` fuera de Git o variables seguras de CI.
- [ ] `npx cap sync android` correcto.
- [ ] `assembleRelease` correcto.
- [ ] `bundleRelease` correcto.
- [ ] APK firmado, no debug.
- [ ] SHA-256 registrado sin secretos.
- [ ] Prueba en dispositivo físico completada.
- [ ] Login, refresh, logout y expiración de sesión.
- [ ] Supabase Direct / fallback Express.
- [ ] IA en español.
- [ ] Calendario y notificaciones.
- [ ] Mensajería.
- [ ] Pagos y permisos.
- [ ] PWA/cache actualizado.
- [ ] Biometría, si está habilitada.
- [ ] Rotación de pantalla/responsive.
- [ ] Sin service-role key en APK.

## H. Validación visual

Capturar desktop y móvil y comparar contra las nueve referencias:

- [ ] Branding y login.
- [ ] Dashboard.
- [ ] Cinturones.
- [ ] Asistencia.
- [ ] Marketplace.
- [ ] Finanzas/pagos.
- [ ] Multidisciplina.
- [ ] Torneos.
- [ ] CTA Android.
- [ ] Contraste, tipografía, tarjetas y responsive.
- [ ] IA contextual visible sin romper la lógica existente.

## I. Criterio de decisión

**CLIENT GO** — Solo si A–H están aprobados y no existe ningún hallazgo P0/P1 abierto.

**CLIENT NO-GO** — Mantener NO-GO si falta cualquiera de estos puntos:

- proyecto Supabase no confirmado;
- backup no evidenciado;
- APK no firmado o no probado físicamente;
- validación visual incompleta;
- fuga de tenancy, secreto expuesto o outbox con `dead > 0`.

## Estado conocido al 2026-11-18

- Backend y esquema: aprobado para piloto.
- Dueños probados: 5/5.
- Senseis probados: 4/5; `ryu_kawakami` existe y está activo, pero la autenticación devolvió 401.
- IA de identidad: corregida en código (antes reportaba "rol user" sin `establishmentId`; ahora usa `profiles.role`). PASS pendiente de re-smoke.
- IA de consulta compuesta: seguridad PASS; UX pendiente post-GO.
- Dictamen: **CLIENT NO-GO público / PILOTO CONTROLADO permitido**.