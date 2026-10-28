# Cierre de Fase B — Mensajería interna

> Fecha: 2026-10-28. Estado: **Fase B aprobada técnicamente**.

## Evidencias
- Código desplegado: `6d65f04` (verificado en Render).
- Suite `tests/messaging.test.js`: **21 PASS / 0 FAIL / 0 SKIP** (suite total 242).
- Producción verificada: owner crea/envía, instructor consulta/marca leído/responde, archivado (`409 CONVERSATION_ARCHIVED`), no-miembro del mismo dojo (`403`), cross-tenant (`403`), superadmin admin-only (`403` controlado).
- Lecturas sin escrituras: garantizado por construcción (GET no ejecuta `insert/update/delete`) y cubierto por la suite local.

## Guardian — follow-up de datos (no bloqueante de código)
La lógica está implementada y probada localmente (`guardian accede a conversación de su alumno vinculado → 200`). En producción **no es ejecutable** porque no existe un vínculo `guardian_students.student_id → students.profile_id` válido (el único vínculo tiene `students.profile_id = NULL`).

Requisitos para la futura prueba real:
1. perfil guardian real (UUID en `profiles`);
2. perfil UUID del alumno;
3. `students.profile_id` no nulo;
4. fila `guardian_students` válida y con `establishment_id` coincidente;
5. credenciales autorizadas del guardian;
6. plan de limpieza/conservación aprobado.

**No** asignar UUID arbitrario ni crear cuentas solo para cerrar el checklist. **No** modificar producción sin backup y aprobación explícita.

## Invariantes de seguridad (mensajería)
- Nunca insertar `"superadmin"` en columnas UUID (`created_by`, `sender_profile_id`, `message_recipients.profile_id`).
- Nunca convertir `sender_profile_id` a `text`; nunca eliminar la FK a `profiles`.
- Conversación archivada no acepta mensajes (`409 CONVERSATION_ARCHIVED`).
- Superadmin administra (crea/consulta/archiva) pero no envía mensajes (`403`).
