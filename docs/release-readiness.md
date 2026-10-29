# Release Readiness — MartialSystem (piloto comercial controlado)

Fecha de elaboración: 2026-10-29
Commit de referencia: `8f2db8fae4a35bf29f297ecba3d5238a4bdbf401`
Estado: **congelado para piloto** (sin funciones nuevas; solo fixes de producción).

---

## 1. Commit y deploy

- `origin/master` = `8f2db8f` (`test(classes): smoke reversible de notificaciones de clases (Fase C)`).
- `GET https://martialsystem.onrender.com/api/health` (verificado):
  - `ok: true`
  - `version: 2.11.3`, `build: 27`
  - `commit: 8f2db8fae4a35bf29f297ecba3d5238a4bdbf401`
  - `branch: master`
- **Render ejecuta exactamente el HEAD local.** ✅

## 2. Migraciones aplicadas

| Migración | Descripción | Estado |
|---|---|---|
| `023_class_notification_outbox.sql` | tabla outbox + `notifications.class_notification_outbox_id` + unique parcial | aplicada (reportada) |
| `024_class_notification_atomicity.sql` | 5 RPCs (update/create + enqueue, claim, mark sent/failed) | aplicada (reportada) |

- Schema-check combinado (`tests/class-notification-migrations-check.sql`): **14/14 PASS**.
- ⏳ Pendiente confirmar que el SQL Editor consulta **la misma base que usa Render** (ver §7).

## 3. Verificación funcional (smoke producción)

- `PATCH /api/classes/:id` (cambio reversible de `location`):
  - 1ª operación → `200`, `notification_status: queued`, `notifications_queued: 31`.
  - PATCH idéntico → `200`, `changed: false`, `notifications_queued: 0` (idempotente, sin duplicar outbox).
  - Restauración → `200`, `queued` (31), lectura final correcta.
- `GET /api/notifications?establishmentId=...` (superadmin) → `200` (sin error de UUID `"superadmin"`).
- Worker arranca en producción (`NODE_ENV !== 'test'`).

## 4. Tests

- Verificación independiente sobre `8f2db8f`: **182 PASS / 0 FAIL / 0 SKIP** (IA/seguridad, calendario, PATCH clases, outbox, worker, reintentos, leases, sent/failed/dead, mensajería, tenancy).
- `node tests/tenancy-audit.js` → aserciones críticas OK.
- Suite completa local durante el desarrollo: 283 PASS / 0 FAIL.

## 5. Limitaciones conocidas (aceptadas para piloto)

1. **Evidencia de outbox sin cerrar**: el conteo `sent`/`dead` en `class_notification_outbox` aún no está confirmado en la base correcta (la consulta con filtro de 30 min devolvió 0 filas; posible proyecto/ventana incorrectos). No es un defecto de código: el endpoint demostró que insertó los jobs.
2. **Integración de concurrencia no ejecutada** (`tests/class-notification-outbox-integration.test.js`): requiere `RUN_INTEGRATION=1` + `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` directos; no disponible en este entorno. El claim `FOR UPDATE SKIP LOCKED` está implementado y validado por contrato (mock), pendiente de prueba real.
3. **Worker single-process por instancia de Render**: el claim atómico ya permite múltiples workers, pero hoy corre uno solo. No escalar horizontalmente sin revisar el lease (60s) y el log.
4. **Jobs `dead` requieren revisión manual**: el worker reintenta hasta 5 intentos y pasa a `dead`; no hay auto-recuperación de `dead` (decisión de diseño).
5. **Código legacy no usado**: `notifyClassEvent` y `enqueueClassNotifications` (incrementos 2/3) quedan sin uso; la RPC es la única vía de encolado para PATCH/POST.

## 6. Archivos pendientes de decisión (fuera del alcance de release)

`git status` muestra cambios no relacionados con este release. Decidir **commitear intencionalmente o eliminar**:

- `web/mobile-styles.css` (modificado, +29)
- `web/sw.js` (modificado)
- `fix_ds.ps1` (untracked, helper de un solo uso — candidato a eliminar)
- `supabase/018_tournament_brackets.sql` (untracked, migración de torneos **sin aplicar ni commitear**; NO pertenece a este release)

⚠️ `018_tournament_brackets.sql` es una migración huérfana (el repo ya llega a `024`). Si se quiere conservar, debe renumerarse y aplicarse explícitamente; si no, eliminarla para no confundir el orden de migraciones.

## 7. Checklist de bloqueo de release

| # | Ítem | Estado |
|---|---|---|
| 1 | Secrets sin rotar (IA, Stripe, Supabase, credenciales de prueba) | ⏳ verificar |
| 2 | Backup de Supabase confirmado | ⏳ verificar |
| 3 | Render apunta al proyecto Supabase correcto | ⏳ verificar (comparar `SUPABASE_URL` de Render con el host del SQL Editor) |
| 4 | `class_notification_outbox` sin `dead` (y `sent` ≈ 62) | ⏳ pendiente de SQL |
| 5 | Healthcheck commit == `8f2db8f` | ✅ |
| 6 | Migraciones 023/024 presentes en la base de Render | ⏳ pendiente de confirmar (misma base) |
| 7 | `git diff --check` limpio | ✅ |
| 8 | Sin secretos/tokens/`.env`/PII en el repo | ⏳ revisar antes de entregar |

## 8. Procedimiento de soporte (piloto)

- **Monitoreo diario del worker** (en el SQL Editor de la base de Render):
  ```sql
  select status, count(*) from public.class_notification_outbox group by status order by status;
  ```
  Esperado: mayoría `sent`, `dead = 0`, sin `pending`/`processing`/`failed` persistentes.
- **Jobs atascados** (lease expirado que no se recupera):
  ```sql
  select count(*) from public.class_notification_outbox
  where status='processing' and locked_at < now() - interval '2 minutes';
  ```
  Esperado `0`. Si `> 0`, revisar log del worker en Render.
- **Si `dead > 0`**: NO borrar filas. Analizar `last_error` y `attempts`; corregir la causa y (si procede) re-encolar manualmente con un nuevo `version`.
- **Registro de errores del worker**: mantener habilitado el logging de Render.

## 9. Procedimiento de rollback

- **Código**: `git revert <commit>` sobre `origin/master` → Render redespliega automáticamente. Commit de referencia del release: `8f2db8f`.
- **Migraciones 023/024**: son aditivas (tabla + funciones). No bloquean el backend anterior (que no las usaba). Para revertir de forma segura:
  ```sql
  drop function if exists update_class_and_enqueue_notifications(uuid,jsonb,text,jsonb) cascade;
  drop function if exists create_class_and_enqueue_notifications(uuid,uuid,uuid,text,date,time,time,text,text,text,jsonb) cascade;
  drop function if exists claim_class_notification_outbox(text,integer,integer) cascade;
  drop function if exists mark_class_notification_sent(uuid,text) cascade;
  drop function if exists mark_class_notification_failed(uuid,text,text,timestamptz) cascade;
  -- y si se quiere revertir 023 por completo:
  -- alter table notifications drop column if exists class_notification_outbox_id;
  -- drop table if exists class_notification_outbox cascade;
  ```
  Solo si el backend también se revierte al flujo anterior.

## 10. Acciones operativas ANTES de cobrar a un cliente

- Rotar la contraseña de `venta` y toda credencial compartida durante pruebas.
- Rotar/eliminar cuentas de prueba usadas en smoke.
- Rotar claves de proveedores de IA si estuvieron expuestas.
- Confirmar que `.env`, `.production.env`, `.staging.env` están fuera de Git (ya están en `.gitignore`).
- Hacer backup de Supabase.
- Confirmar que Render apunta al proyecto Supabase correcto.
- Crear un usuario real por cliente (no reutilizar cuentas de prueba).
- Probar tenancy con el primer cliente antes de incorporar otro.
- Mantener habilitado el logging del worker.

---

**Dictamen**: el desarrollo queda cerrado para un piloto comercial controlado (1–3 dojos). Único cierre pendiente del incremento de notificaciones: confirmar `class_notification_outbox` con `sent ≈ 62` y `dead = 0` en la base correcta.

