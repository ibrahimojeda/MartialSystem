# Verificación operativa — Migración 021 (mensajería interna)

> Estado del código: `952f575` desplegado en Render. **La migración NO se aplica sola**:
> hay que ejecutarla en el SQL Editor del proyecto Supabase conectado a Render.

## 0. Seguridad previa
1. Hacer **backup** de Supabase.
2. Verificar en qué base estás:
```sql
select current_database(), current_schema(), current_user;
```

## 1. Aplicar la migración (idempotente)
Ejecutar el contenido de `supabase/021_conversations.sql`. No destruye nada (usa `if not exists`).

## 2. Schema-check (solo lectura)
Ejecutar `tests/conversations-schema-check.sql` y registrar:

| Verificación | Esperado | Resultado |
|---|---|---|
| `to_regclass` 4 tablas | 4 nombres (no NULL) | ⬜ |
| `conversations` columnas | 6 | ⬜ |
| `conversation_members` columnas | 5 | ⬜ |
| `messages` columnas | 7 | ⬜ |
| `message_recipients` columnas | 4 | ⬜ |
| FKs (establishments/profiles/messages) | presentes | ⬜ |
| Índices `idx_*` | presentes | ⬜ |
| RLS (`relrowsecurity`) | `true` ×4 | ⬜ |
| Policies RLS (`pg_policies`) | 0 filas (esperado) | ⬜ |

> **Nota de conteo:** `message_recipients` tiene **4 columnas** (`id`, `message_id`, `profile_id`, `read_at`),
> no 5. El `unique(message_id, profile_id)` es una *constraint*, no una columna.

## 3. Confirmar arquitectura (ya revisado en código)
- ✅ Los endpoints usan `supabaseAdmin`/service_role: `server/index.js` pasa `supabaseAdmin` a `server/messaging.js` (parámetro `db`).
- ✅ El frontend **no** consulta las tablas directamente: búsqueda de `from('conversations')|from('messages')|...` en `web/` y `android/` → 0 resultados.
- ✅ RLS habilitada **sin policies**: el acceso lo controla `server/messaging.js` (membresía + tenancy). No agregar policies amplias.

## 4. Smoke test HTTP (tras aplicar 021, contra staging o producción controlada)
Con `tests/messaging.test.js` ya cubierto en local (12 PASS). Para validar contra la BD real, ejecutar manualmente:

| # | Acción | Esperado |
|---|---|---|
| 1 | owner crea conversación (owner → instructor) | 200, miembros correctos |
| 2 | owner agrega mensaje | 200 |
| 3 | GET conversación | 200, mensajes |
| 4 | instructor (miembro) marca leído | 200 |
| 5 | owner archiva | 200, `archived_at` |
| 6 | guardian ve conversación de alumno vinculado | 200 |
| 7 | usuario de otro establecimiento | 403 |
| 8 | usuario no miembro | 403 |
| 9 | GET (lecturas) | `writes` = 0 |
| 10 | no se filtran mensajes/nombres de otros establecimientos | verificado |

## 5. Criterio de avance
- La Fase C **solo** comienza cuando 021 esté confirmada en la base conectada al Render que ejecuta `952f575` (o un descendiente).
- No declarar la mensajería "lista para clientes" hasta que las 4 tablas existan y el schema-check pase.
