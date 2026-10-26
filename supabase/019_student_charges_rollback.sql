-- ══════════════════════════════════════════════════════════════
-- 019_student_charges_rollback.sql — Rollback EXPLÍCITO y MANUAL.
-- NO ejecutar de forma automática ni desde CI. Requiere aprobación
-- manual y backup previo.
--
-- Precondiciones (verificar ANTES de ejecutar):
--   1. Ninguna tabla externa tiene foreign key hacia student_charges
--      ni student_charge_payments (solo se crearon en 019).
--   2. No hay datos que deban conservarse en esas tablas.
--   3. Ningún cliente está usando el módulo de cargos.
--   4. Se realizó backup/snapshot de la base.
--
-- Las tablas `payments` y el resto del esquema NO se ven afectados.
-- ══════════════════════════════════════════════════════════════

begin;

drop table if exists student_charge_payments;
drop table if exists student_charges;

commit;
