# Seguridad del Asistente IA — MartialSystem

## 1. Contexto y aislamiento

- `getAIContextRole(req, establishmentId)` → rol real en el establecimiento activo; sin membresía = `user` (sin acceso a datos).
- `buildAIContext` inyecta SOLO datos que el rol puede ver.
- `aiSearchTool` limita por `establishmentId` y rol (≤80 filas, campos mínimos).
- **Regla:** `establishmentId` vacío **no** debe significar "todos" para no-superadmin (fail-closed).

## 2. Gating y costo

- `hasAIFeature()` ahora es **fail-closed**: sin plan / error → `false`.
- Superadmin siempre autorizado.
- Bloqueo por factura vencida ≥15 días → `423 BILLING_BLOCKED`.
- Pendiente: presupuesto global, límites por usuario/proveedor/día, rate limit persistente.

## 3. Herramientas (`AI_TOOLS`)

- read/write/delete por rol. La IA **nunca** ejecuta crear/editar/borrar: genera prefill validado + confirmación.
- Pendiente: parser `<<<TOOL>>>` estricto con esquema JSON y rechazo de payloads inválidos.

## 4. Proveedores y secretos

- `custom.baseUrl` debe restringirse a `https` y bloquear loopback/privadas/metadata (SSRF).
- API keys: solo `hasKey` + `apiKeyHint` (últimos 4) al cliente; nunca la key completa.
- Pendiente: cifrado en reposo.

## 5. Memoria (`ai_memory`)

- RLS `profile_id = auth.uid()::text` (solo propia memoria).
- Pendiente: retención/expiración y cifrado/minimización de contenido.
