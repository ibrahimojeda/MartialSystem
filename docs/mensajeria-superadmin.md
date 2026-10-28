# Mensajería interna — Decisión de identidad del superadmin

> Fecha: 2026-10-28. Estado: **Opción 1 activa** (superadmin administra, no envía mensajes).

## Decisión actual (Opción 1)
- superadmin **puede crear** conversaciones administrativas.
- superadmin **puede consultar** (listar/detalle) cualquier conversación.
- superadmin **puede archivar** conversaciones.
- superadmin **NO puede enviar mensajes**: `POST /api/conversations/:id/messages` responde **403** controlado:
  > "El superadmin no puede enviar mensajes: no tiene un perfil de usuario asociado."
- superadmin **no trackea lectura**: `markMessageRead` devuelve `{ ok: true }` sin insertar en `message_recipients`.

## Invariantes de seguridad (no cambiar)
- Nunca insertar `"superadmin"` en columnas UUID (`created_by`, `sender_profile_id`, `message_recipients.profile_id`).
- Nunca convertir `sender_profile_id` a `text`.
- Nunca eliminar la FK `messages.sender_profile_id → profiles(id)`.

## Frontend
- Hoy **no existe UI de mensajería** (el módulo es backend-only: `server/messaging.js` + endpoints).
- Cuando se construya la UI: **no** mostrar al superadmin un formulario de envío habilitado. Si se muestra, indicar:
  > "El superadmin puede administrar conversaciones, pero no enviar mensajes."
- El `403` del backend sigue siendo la protección real aunque el frontend oculte el control.

## Backlog — identidad de mensajería del superadmin (Opción 2)
Si en el futuro se requiere que el superadmin envíe mensajes:
1. crear o asignar un `profile` UUID válido en `profiles`;
2. definir si será perfil de sistema o perfil administrativo real;
3. asegurar que exista en `profiles` (para satisfacer las FK);
4. revisar `created_by`, `sender_profile_id` y `message_recipients`;
5. definir auditoría;
6. crear una migración reversible;
7. actualizar la matriz de permisos;
8. probar cross-tenant;
9. desplegar por separado.

**No implementar este backlog ahora.**
