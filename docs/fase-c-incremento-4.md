# Fase C — Incremento 4: Hardening transaccional y multi-worker de la outbox

## Objetivo
Cerrar las dos deudas bloqueantes del incremento 3:
1. Atomicidad clase + outbox (evitar estado parcial si el encolado falla).
2. Claim multi-worker con `FOR UPDATE SKIP LOCKED` y lease seguro.

Sin frontend ni funcionalidades nuevas. Solo backend + SQL + tests.

## Cambios

### A) RPC transaccional (migración `024_class_notification_atomicity.sql`)
- `update_class_and_enqueue_notifications(p_class_id, p_updates jsonb, p_version, p_jobs jsonb)`
  - Bloquea la clase con `FOR UPDATE`, usa el `establishment_id` de `class_sessions`
    (ignora cualquier `establishment_id` del payload → no amplía tenancy).
  - Actualiza solo columnas validadas por Node (whitelist), refresca `updated_at`.
  - Encola jobs en `class_notification_outbox` con `ON CONFLICT DO NOTHING`.
  - Devuelve `to_jsonb(class) || {notifications_queued}`. Rollback completo si falla.
- `create_class_and_enqueue_notifications(...)` — equivalente atómico para `POST /api/classes`.
- `claim_class_notification_outbox(p_worker_id, p_limit, p_lease_seconds)` — reclama
  pending/failed disponibles y processing con lease expirado usando `FOR UPDATE SKIP LOCKED`,
  marca `processing` + `locked_by`/`locked_at` y devuelve solo las filas reclamadas.
- `mark_class_notification_sent(p_id, p_worker_id)` → `boolean` (solo si
  `status='processing' AND locked_by=worker_id`).
- `mark_class_notification_failed(p_id, p_worker_id, p_error, p_next_available_at)` → `text`
  (`'failed'` | `'dead'` | `null`). Incrementa `attempts`, libera locks; `dead` en `attempts>=5`.
- Todas son `SECURITY DEFINER set search_path = public`; `revoke from public` +
  `grant execute to service_role`. **No envían notificaciones** (solo encolan).

### B) Node
- `server/index.js`:
  - `PATCH /api/classes/:id` usa `supabaseAdmin.rpc('update_class_and_enqueue_notifications', …)`.
    La autorización/tenancy/validación siguen en Node antes de llamar la RPC.
    Respuesta: `notification_status: 'queued' | 'none'` + `notifications_queued`.
  - `POST /api/classes` usa `create_class_and_enqueue_notifications` (se elimina el
    `try/catch` best-effort que ocultaba errores de encolado).
- `server/class-notifications.js`: nueva `buildClassNotificationJobs(...)` y cuerpo de
  `class_created`.
- `server/class-notification-worker.js`: reescrito para usar las RPCs
  (`claim_class_notification_outbox` + `mark_*`). Trata `unique violation` de la notificación
  como éxito idempotente y marca `sent`.

### C) Tests
- `tests/class-notification-outbox.test.js` (13 tests, unit/contrato): atomicidad+rollback,
  claim sin solapamiento, recuperación de lease, finalización segura, dead tras max_attempts,
  idempotencia por unique violation, tenancy no ampliada por payload, no 200+data=null.
- `tests/class-notifications.test.js`: +1 (PATCH inexistente → 404).
- `tests/class-notification-outbox-integration.test.js`: integración REAL contra staging
  (concurrencia `FOR UPDATE SKIP LOCKED` + lease). Se auto-skipea sin `RUN_INTEGRATION=1`.

## Validación ejecutada
- `node --check` OK en `index.js`, `class-notifications.js`, `class-notification-worker.js`.
- Suite completa: **283 PASS / 0 FAIL**.
- `node --test tests/class-notifications.test.js tests/class-notification-outbox.test.js tests/calendar.test.js tests/messaging.test.js` → 61 PASS.
- `node tests/tenancy-audit.js` → aserciones críticas OK.
- `git diff --check` limpio.

## Despliegue (orden estricto)
1. Aplicar `023` (si aún no está) y `024` en **staging**; ejecutar schema-check.
2. `RUN_INTEGRATION=1` contra staging para validar la concurrencia real de claim.
3. Smoke PATCH reversible: `queued` → worker `sent`; reintento → sin duplicados; fallo → failed/dead.
4. Aplicar `023` + `024` en **producción** con backup.
5. Desplegar backend; verificar `/api/health`.
6. Smoke reversible en producción; confirmar 0 `dead` inesperados.

## Notas
- `notifyClassEvent` y `enqueueClassNotifications` (incremento 2/3) quedan como código legacy
  no usado; la RPC es ahora la única vía de encolado para PATCH/POST.
- El claim del worker y la finalización son atómicos vía SQL; el mock replica el contrato para
  los tests unitarios, pero la garantía real de `FOR UPDATE SKIP LOCKED` se valida con el test
  de integración.
