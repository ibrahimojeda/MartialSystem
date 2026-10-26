# Despliegue controlado — Módulo `student_charges`

> Estado: **Staging APROBADO** (17 PASS / 0 FAIL / 1 SKIP estructural).
> Commit funcional final: `0670c82` (fix `.update().eq()`).
> Render actual: `8ce3c20` (el fix **NO** está desplegado todavía).
> **No declarar "listo para clientes" hasta completar este checklist.**

---

## 1. Pre-despliegue (código)

- [ ] `git ls-remote origin refs/heads/master` → debe ser `0670c82`.
- [ ] `git merge-base --is-ancestor 742a35d 0670c82` → exit 0 (ya confirmado).
- [ ] Desplegar `0670c82` en Render (no cambies frontend ni agregues funciones).
- [ ] `curl -sS https://martialsystem.onrender.com/api/health` → `commit` debe ser `0670c82` (o un HEAD que lo contenga).

## 2. Base de datos (producción)

- [ ] Confirmar que se está en el proyecto Supabase de **PRODUCCIÓN** (`select current_database(), current_schema();`).
- [ ] **Backup / snapshot** de Supabase antes de migrar.
- [ ] Aplicar `supabase/019_student_charges.sql` (si las tablas no existen).
- [ ] Aplicar `supabase/020_student_charges_atomic.sql` (solo si falta algún objeto; es idempotente y atómica).
- [ ] **NO ejecutar rollback. NO ejecutar `DROP`** ni comandos destructivos.
- [ ] Ejecutar `tests/student-charges-schema-check.sql` y confirmar:
  - tablas: `student_charges` + `student_charge_payments`
  - columnas: **18 + 6**
  - constraints CHECK + FKs (**4 + 3**)
  - índices (incluido `uq_student_charges_membership_period`)
  - RLS **true / true**
  - trigger `trg_student_charges_updated_at`
- [ ] Verificar que **payments históricos no cambiaron** (recuento/snapshot antes y después).

## 3. Smoke test (producción, controlado)

- [ ] Crear **UN** cargo de prueba en un establecimiento controlado.
- [ ] Leer el cargo.
- [ ] Pago parcial → `partial`.
- [ ] Pago completo → `paid`.
- [ ] Estado actualizado (`mark-overdue` / `cancel`).
- [ ] Owner **no** ve otro establecimiento.
- [ ] Instructor solo ve alumnos autorizados.
- [ ] `payments` históricos sin cambios.
- [ ] Cancelar/eliminar el cargo de prueba (según política de auditoría). **No borrar cargos reales.**

## 4. Rollback (documentado)

- Si falla la **migración**: restaurar el snapshot de Supabase.
- Si falla el **código**: redeploy del commit anterior (`8ce3c20`) en Render.
- El módulo debe permanecer protegido hasta confirmar la migración: los endpoints deben devolver
  `HTTP 503` con `{ "ok": false, "code": "STUDENT_CHARGES_NOT_READY" }` y **sin stack trace**.

## 5. Criterio GO / NO-GO

**GO solo si:**
- healthcheck devuelve `0670c82`;
- migración aplicada y schema-check completo;
- smoke test PASS;
- `payments` sin cambios;
- sin errores 5xx ni stack trace.

**NO-GO si:**
- Render sigue en `8ce3c20`;
- migración no confirmada;
- cualquier fallo en el smoke test.

---

## Seguridad (obligatorio)

- Rotar contraseñas expuestas en el chat: `juan_moreno`, `venta` (y demás credenciales de prueba pegadas).
- **No incluir credenciales en informes, commits ni chats.**
- `tests/.staging.env` está **gitignored** (no versionado). Verificado.
