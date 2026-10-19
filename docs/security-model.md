# Modelo de seguridad — MartialSystem

## 1. Autenticación (authn)

- **Superadmin:** login por `username` + `password` contra `.env`. Token `sa_<48 hex>`, sesión en memoria + `data/superadmin-sessions.json` con hash SHA-256 del token (nunca el token crudo). TTL 12 h.
- **Resto:** login por `username` + `password` contra Supabase Auth (`signInWithPassword`). Token = JWT de acceso Supabase.
- `requireAuth` valida token y adjunta `req.authUser` + `req.isSuperadmin`.

## 2. Autorización (authz) y roles

Jerarquía: `superadmin(5) > owner(4)/sensei(4) > admin(3) > instructor(2) > guardian(1)/student(1)`.

## 3. Tenancy (aislamiento multi-establecimiento)

- La autorización se deriva **en servidor** vía `getMembership(profileId, establishmentId)` sobre `establishment_members`.
- `establishmentId` del cliente **nunca** es la única fuente de autorización.
- `superadmin` = acceso global explícito.
- `owner/admin` = solo establecimientos de sus membresías.
- `sensei/instructor` = solo sus asignaciones (`instructor_disciplines`, `student_enrollments`, links sensei).
- `student/guardian` = solo `profile_id` propio y relaciones autorizadas.

## 4. Dashboard

- `/api/dashboard/stats` = **solo superadmin** (global).
- Roles con dojo usan endpoints scoped (`/api/dashboard/owner`, `/api/dashboard/sensei`, `/api/dashboard/student`).

## 5. Secretos

- `.env` no versionado. Nunca volcar secretos en logs/errores/respuestas.
- `GET /api/ai/config` (solo superadmin) devuelve `hasKey` + `apiKeyHint` (últimos 4), nunca la key completa.

## 6. Riesgos pendientes

- Cifrado en reposo de API keys IA.
- Rotación de credenciales expuestas.
- Rate limiting persistente.
