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

## 2. Base de datos (producción) — orden exacto

> **No ejecutar `019` y `020` seguidas a ciegas.** Primero diagnosticar, luego aplicar solo lo necesario.

**2.1 Backup**
- [ ] Snapshot / backup de Supabase **antes** de tocar nada.

**2.2 Confirmar proyecto**
```sql
select current_database() as database_name, current_schema() as schema_name, current_user as db_user;
```
- [ ] Debe ser el proyecto de **PRODUCCIÓN** (no staging).

**2.3 Revisar si existen las tablas**
```sql
select
  to_regclass('public.student_charges') as student_charges,
  to_regclass('public.student_charge_payments') as student_charge_payments;
```
- [ ] `NULL / NULL` → no existen → aplicar `019`.
- [ ] números (ambas) → existen → verificar estructura; si falta algo → aplicar `020`.
- [ ] estructura completa → no aplicar ninguna migración.

**2.4 Aplicar solo lo necesario**
- [ ] `supabase/019_student_charges.sql` (solo si las tablas NO existen).
- [ ] `supabase/020_student_charges_atomic.sql` (solo si falta algún objeto; idempotente y atómica).
- [ ] **NO rollback. NO DROP.**

**2.5 Schema-check** → ejecutar `tests/student-charges-schema-check.sql`
- [ ] tablas: **2**; columnas **18 + 6**; RLS **true / true**; FKs **4 + 3**; índices completos; trigger presente; índice único parcial presente.

**2.6 payments históricos**
- [ ] Recuento/snapshot antes y después → **sin cambios**.

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
