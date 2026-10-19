# Matriz de tenancy — MartialSystem

Formato: `ruta | método | auth | roles | establishmentId (fuente) | validación tenancy | prueba negativa`

## Endpoints críticos

| Ruta | Método | Auth | Roles | establishmentId | Validación | Prueba negativa |
|---|---|---|---|---|---|---|
| `/api/dashboard/stats` | GET | requireAuth | superadmin | n/a (global) | 403 si no superadmin | owner/sensei/instructor → 403 |
| `/api/dashboard/owner` | GET | requireAuth | owner | membresía | getMembership | local B → 403 |
| `/api/dashboard/sensei` | GET | requireAuth | sensei/instructor | membresía | getMembership + asignaciones | local B → 403 |
| `/api/dashboard/student` | GET | requireAuth | student/guardian | membresía | profile_id propio | local B → 403 |
| `/api/payments` | GET | requireAuth | staff/student/guardian | query + membresía | getMembership + scope por rol | local B → 403 |
| `/api/payments` | POST | requireAuth | owner/admin | body + membresía | getMembership | local B → 403 |
| `/api/students` | GET/POST | requireAuth | staff | query + membresía | getMembership | local B → 403 |
| `/api/classes` | GET/POST | requireAuth | staff | query + membresía | getMembership | local B → 403 |
| `/api/instructors` | GET/POST | requireAuth | owner/sensei/admin | query + membresía | getMembership | local B → 403 |
| `/api/notifications` | GET/POST | requireAuth | staff | query + membresía | getMembership | local B → 403 |
| `/api/tournaments/*` | GET/POST | requireAuth | staff | query/body + membresía | getMembership | local B → 403 |
| `/api/inventory/*` | GET/POST | requireAuth | staff | query + membresía | getMembership | local B → 403 |
| `/api/ai/chat` | POST | requireAuth | autenticado | query + membresía | getAIContextRole + scope | local B → 403/empty |
| `/api/ai/memory` | GET/DELETE | requireAuth | autenticado | profile_id propio | RLS ai_memory | memoria ajena → 403/empty |
| `/api/upload` | POST | requireAuth | autenticado | n/a | auth requerida | sin token → 401 |
| `/api/upload/public` | POST | sin auth | público | n/a | revisar: auth o token único | subida no-imagen → 400 |

## Regla general

El resultado esperado para un usuario del local A consultando el local B es **403** (o 404/respuesta vacía según política), nunca datos del local B.
