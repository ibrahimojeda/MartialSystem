# Fase C — Incremento 3: Outbox asíncrono de notificaciones de clases

## Objetivo
Desacoplar el `PATCH /api/classes/:id` (y `POST /api/classes`) del envío síncrono de
notificaciones. Antes, el PATCH actualizaba la clase y luego creaba notificaciones
síncronamente, lo que producía timeouts de cliente aunque el cambio ya estuviera persistido.
Ahora el PATCH encola trabajos en una outbox y responde rápido; un worker los procesa.

## Cambios
- `supabase/023_class_notification_outbox.sql` — tabla `class_notification_outbox`
  (estados `pending/processing/sent/failed/dead`, `attempts`, `available_at`, `locked_at`,
  `locked_by`, `sent_at`, `last_error`, FKs, unique dedup, índices, RLS sin policies) +
  columna `notifications.class_notification_outbox_id` con índice UNIQUE parcial.
- `server/class-notification-worker.js` — `processOutboxBatch(db, workerId, batchSize)` y
  `startWorker(db, opts)` (interval + shutdown). Reclama pending/failed, crea la notificación
  vinculada al outbox, marca `sent`; ante error reintenta con backoff y pasa a `dead` tras 5 intentos.
- `server/class-notifications.js` — nueva `enqueueClassNotifications(...)` (idempotente por
  class+event+recipient+version) y `classEventBody(...)`.
- `server/index.js`:
  - `PATCH /api/classes/:id` ahora devuelve `notification_status: "queued"` y
    `notifications_queued: N` en lugar de esperar a `notifyClassEvent`.
  - `POST /api/classes` encola `class_created` en la outbox (sin try/catch best-effort que
    ocultaba errores en la notificación; el enqueue falla explícitamente).
  - `GET /api/notifications` ya no construye `recipient_profile_id.eq.superadmin`: superadmin
    consulta todas las notificaciones del establecimiento (establishmentId explícito obligatorio).
  - Worker arrancado al iniciar el servidor solo en producción (`NODE_ENV !== 'test'`).
- Tests: `tests/class-notifications.test.js` (13 PASS, ahora cubre enqueue + worker + superadmin),
  `tests/class-notification-outbox-schema-check.sql` (solo lectura).

## Resultados
- `node --check` OK en `server/index.js`, `server/calendar.js`, `server/class-notifications.js`,
  `server/class-notification-worker.js`.
- `node --test tests/class-notifications.test.js tests/calendar.test.js tests/messaging.test.js tests/student-receivables.test.js` → 62 PASS / 0 FAIL.
- `node tests/tenancy-audit.js` → aserciones críticas OK.
- `git diff --check` limpio.

## Deuda técnica conocida (no bloqueante para este incremento)
1. **Atomicidad clase+outbox**: el PATCH hace `update class_sessions` y luego `insert outbox`
   como operaciones separadas. Si el insert de outbox falla, la clase ya quedó actualizada y el
   PATCH devuelve 500 (estado parcial). Esto ya ocurría con las notificaciones síncronas; la
   mejora es que ahora la respuesta es inmediata. La solución definitiva es una función RPC
   transaccional `update_class_and_enqueue_notifications(...)` (SECURITY DEFINER) que bloquee la
   clase `FOR UPDATE`, actualice, inserte en outbox con `ON CONFLICT DO NOTHING` y haga rollback
   completo. **No está cableada en Node todavía** (la RPC no es testeable con el mock). Revisar
   columnas reales y seguridad antes de aplicarla.
2. **Claim del worker**: el mock no soporta `FOR UPDATE SKIP LOCKED`, por lo que el claim del
   worker es "select pending/failed + marcar processing" (no atómico entre procesos). En producción
   con un único proceso es suficiente; para múltiples workers se necesita la RPC de claim atómico.
3. **Deduplicación**: la dedup del enqueue se hace con `select` previo (no `ON CONFLICT`). En
   producción el `unique(class_id, event_type, recipient_profile_id, version)` protege ante carreras;
   la RPC transaccional lo garantiza de forma atómica.

## Orden de despliegue (no desplegar backend antes de la migración)
1. Aplicar `supabase/023_class_notification_outbox.sql` en staging y verificar
   `tests/class-notification-outbox-schema-check.sql` (PASS).
2. Smoke reversible del PATCH en staging (verificar `notification_status: queued` y worker `sent`).
3. Aplicar 023 en producción con backup; verificar schema-check.
4. Desplegar backend; verificar `/api/health`.
5. Smoke PATCH reversible en producción y confirmar jobs `sent` (ninguno inesperado en `dead`).
