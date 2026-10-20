# Auditoría de MartialSystem — Guía operativa y checklist

> **Objetivo:** emitir un dictamen de *apto / no apto para lanzamiento* con evidencia verificable.
> **Regla de oro:** congelar el código (snapshot), auditar sobre esa versión, y toda corrección entra por control de cambios.
> **Última actualización:** 2026-10-19 · Rama objetivo `master` · Versión auditada v2.11.3 (build 27).

---

## 0. Cómo usar esta guía

1. Ejecuta las fases en orden. Cada ítem es un checkbox.
2. Registra **todo** hallazgo con ID único (`AUDIT-###`), severidad (P0–P3), evidencia y responsable.
3. No mezcles "arreglar" con "auditar": primero documenta, luego corrige en una rama aparte.
4. Al final, contrasta contra la sección **Go/No-go** de `informe-auditoria.md`.

**Severidades:** P0 = bloqueante · P1 = alto · P2 = medio · P3 = bajo.

---

## Fase 0 — Preparación y línea base

- [ ] Commitear cambios pendientes (`server/index.js`, `web/index.html`, `web/sw.js`, `web/mobile-styles.css`, `supabase/018_*.sql`) en rama `release/audit-vX`.
- [ ] Elegir **una sola rama** (`master` o `main`) y cerrar la otra.
- [ ] Corregir `.gitignore` (borrar líneas basura `console.log(`, `m[1]))]`).
- [ ] Backup: clon del repo + export/dump de Supabase.
- [ ] Snapshot de entorno: versión Node, Supabase, APK, y nombres de variables `.env` (sin volcar secretos).
- [ ] Crear registro de hallazgos.

---

## Fase 1 — Inventario y mapeo

- [ ] Listar los ~100 endpoints con método, auth y validación.
- [ ] Listar tablas de las 18 migraciones (`001` → `018`).
- [ ] Inventariar secretos: dónde vive cada credencial.
- [ ] Matriz de dependencias externas (Stripe, Twilio, Resend, PagueloFacil, PayPal, IA).
- [ ] Detectar duplicados: `web/index.html` vs `android/app/src/main/assets/public/index.html`.
- [ ] Clasificar scripts sueltos de la raíz.

---

## Fase 2 — Seguridad

### 2.1 Secretos y repositorio
- [ ] Buscar secretos en el historial Git (`gitleaks` / `trufflehog`).
- [ ] Auditar `data/trial-users.json` (trackeado): ¿contraseñas/hashes? → purgar y rotar si es real.
- [ ] Rotar todo lo expuesto (superadmin, `SUPABASE_SERVICE_ROLE_KEY`, Stripe, IA, Twilio, Resend).
- [ ] Eliminar contraseña por defecto hardcodeada en `README.md` y `.env.example`.

### 2.2 Autenticación y sesiones
- [ ] Login `/api/login`: hashing fuerte, normalización, sin fugas de existencia de usuario.
- [ ] Sesiones: expiración, revocación, persistencia segura de `data/superadmin-sessions.json`.
- [ ] `requireAuth` presente en **todos** los endpoints sensibles.

### 2.3 Autorización y tenancy
- [ ] Probar aislamiento: un owner **no** debe acceder a otro `establishmentId`.
- [ ] Verificar checks de rol en cada endpoint de escritura.
- [ ] Reutilizar `simulator/role-audit-engine.js`.

### 2.4 Superficie web
- [ ] CORS con orígenes maliciosos.
- [ ] SQL injection, XSS, inyección en QR/PDF.
- [ ] Uploads: MIME, tamaño, path traversal; revisar `/api/upload/public`.
- [ ] Rate limiting (in-memory) y cobertura.
- [ ] Headers de seguridad (CSP, X-Frame-Options, HSTS).

### 2.5 Secretos en runtime
- [ ] `service_role_key` nunca se envía al cliente.
- [ ] API keys de IA: verificar cifrado en reposo (ver sección IA).

## Fase 3 — Datos, schema y RLS

- [ ] Aplicar las 18 migraciones en orden sobre base limpia (sin errores).
- [ ] RLS activa en tablas multitenant (`establishment_id`).
- [ ] Listar rutas que usan `supabaseAdmin` (service_role) y confirmar autorización en app.
- [ ] Integridad referencial (FK, `on delete`), índices en columnas de filtro.
- [ ] Ejecutar `_scan_report.js` y convertir hallazgos de consistencia en `AUDIT-###`.
- [ ] Backups/restore de Supabase verificados.

---

## Fase 4 — Backend / API funcional

- [ ] Por cada endpoint: éxito, error de validación, no autorizado, no autenticado.
- [ ] Detectar `res.status(500).json({ error: err.message })` que filtra mensajes internos.
- [ ] Concurrencia en pagos, asistencia, inventario, brackets.
- [ ] Idempotencia en cobros/creación.
- [ ] Validar `establishmentId` (autorización real, no solo presencia).

---

## Fase 5 — Frontend web y móvil

- [ ] Sincronización `web/` vs `android/.../public/`.
- [ ] Flujo de sesión APK: Supabase Direct → Express → fallback.
- [ ] Biometría (`biometric-auth.js`) en dispositivo real.
- [ ] PWA/SW (`sw.js`): no servir versiones viejas.
- [ ] Prueba en dispositivo Android real + emulador.

---

## Fase 6 — Pagos e integraciones

- [ ] Stripe: webhook firmado, idempotencia, reintentos.
- [ ] PagueloFacil/PayPal: sandbox vs live, verificación de firma.
- [ ] Facturación electrónica (`010_*`): secuencias, impuestos.
- [ ] Suscripciones (`012_*`, `015_*`): prorrateo, cancelación.
- [ ] E2E sandbox de un cobro completo.
- [ ] Doble cobro no duplica.
- [ ] Logs de auditoría de pagos.

---

## Fase 7 — Rendimiento, estabilidad, Ops

- [ ] Resolver `EADDRINUSE :::8010` y definir arranque limpio.
- [ ] Memoria Gradle (OOM `hs_err_pid*`): `-Xmx` o build en CI.
- [ ] Prueba de carga (`k6`/`autocannon`) sobre login, tree, pagos, chat IA.
- [ ] `EXPLAIN`/índices en consultas lentas.
- [ ] Logs centralizados y rotados.
- [ ] Monitoreo + healthcheck (`/api/health`) + alertas.
- [ ] Entorno staging separado.

---

## Fase 8 — Cumplimiento

- [ ] Protección de datos de menores → consentimiento, retención, borrado.
- [ ] Términos/privacidad actualizados.
- [ ] PCI/3DS: tarjetas **nunca** tocan tu servidor.
- [ ] `npm audit` + licencias.
- [ ] Quitar contraseña en claro del `README.md`.

---

## Fase 9 — Consolidación y dictamen

- [ ] Matriz única de hallazgos (ID, severidad, impacto, evidencia, responsable, estado).
- [ ] Priorización P0→P3 y plan de remediación con fechas.
- [ ] Dictamen go/no-go (contrastar con `informe-auditoria.md`).

---

# 🧠 Auditoría específica del Asistente IA

## Inventario de componentes IA

| Componente | Ubicación | Detalle |
|---|---|---|
| Proveedores | `server/index.js` `AI_PROVIDERS` | OpenAI (`gpt-4o-mini`), DeepSeek (`deepseek-chat`), Google Gemini (`gemini-3.6-flash`), Custom (OpenAI-compatible) |
| Config (fuente de verdad) | Supabase `app_settings` key `__ai__` | `enabled`, `providers[]`, `apiKey`, `model`, `baseUrl`, `updatedAt` |
| Cache local | `data/ai-config.json` | Respaldo offline; reconciliación por `updatedAt` |
| Consumo | `data/ai-usage.json` + espejo `__ai__usage__` | calls, tokens, costo estimado, por día |
| Memoria | tabla `ai_memory` (migración `017`) | historial por usuario + establecimiento; RLS `profile_id = auth.uid()` |
| Gating por plan | `hasAIFeature()` | feature `ia_features` (en TODOS los planes por `016`) |
| Rate limit | `/api/ai/chat` y `/api/ai/welcome` 30/min | in-memory |

## Endpoints IA y permisos

| Endpoint | Método | Permiso |
|---|---|---|
| `/api/ai/config` | GET/PUT | **solo superadmin** |
| `/api/ai/usage` | GET/DELETE | **solo superadmin** |
| `/api/ai/status` | GET | todos los roles |
| `/api/ai/chat` | POST | autenticado (gating por plan + billing) |
| `/api/ai/welcome` | POST | autenticado |
| `/api/ai/draft` | POST | autenticado (gating por plan) |
| `/api/ai/explain` | POST | autenticado |
| `/api/ai/mapping` | POST | autenticado |
| `/api/ai/memory` | GET/DELETE | autenticado (solo propia memoria) |

## Herramientas IA y matriz de permisos

| Herramienta | read | write (prefill) | delete (confirmación) |
|---|---|---|---|
| `students` | superadmin, owner, admin, sensei, instructor, student, guardian | superadmin, owner, admin, sensei, instructor | superadmin, owner, admin |
| `classes` | superadmin, owner, admin, sensei, instructor | superadmin, owner, admin, sensei, instructor | superadmin, owner, admin, sensei |
| `payments` | superadmin, owner, admin, sensei, instructor, student, guardian | superadmin, owner, admin | superadmin, owner, admin |
| `notifications` | superadmin, owner, admin, sensei, instructor | superadmin, owner, admin, sensei, instructor | — |
| `billing` | superadmin, owner, admin | — | — |
| `users` | superadmin, owner, sensei | superadmin, owner, sensei | — |

## Checklist de auditoría IA

### Configuración y secretos
- [ ] ¿API keys **cifradas** en `app_settings` y `data/ai-config.json`? (en código se guardan en JSON directo — riesgo si la BD se filtra).
- [ ] `GET /api/ai/config` solo devuelve `apiKeyHint` (últimos 4), nunca la key completa.
- [ ] `custom` provider con `baseUrl` arbitrario: verificar sanitización anti-SSRF (`aiSanitizeBaseUrl`).

### Autorización y aislamiento
- [ ] `aiSearchTool` limita por `establishmentId` y rol (student/guardian solo `profile_id` propio; sensei/instructor solo sus `student_enrollments`).
- [ ] Máximo de filas ≤80 y campos mínimos por rol.
- [ ] `buildAIContext` no inyecta datos de otros dojos/roles.

### Correctitud y límites
- [ ] `MAX_STEPS = 4` no permite bucles infinitos ni costos descontrolados.
- [ ] Mensaje limitado a 2000 caracteres.
- [ ] Parseo de `<<<TOOL>>>` (regex) seguro ante salida maliciosa.
- [ ] Failover probado con proveedor caído → siguiente activo (usar `_failover_test.js`).
- [ ] Billing block: factura vencida ≥15 días → `423 BILLING_BLOCKED`.
- [ ] Gating `hasAIFeature` no "fail-open" (hoy devuelve `true` ante error/sin plan: **permissivo**).

### Memoria y privacidad
- [ ] `ai_memory` guarda `user_message`/`ai_response` (texto plano) — verificar retención y borrado.
- [ ] RLS de `ai_memory` correcta (solo propia memoria).
- [ ] `DELETE /api/ai/memory` borra solo la del usuario autenticado.

### Costos y consumo
- [ ] Estimación de costo (`aiEstimateTokenCost`) correcta por modelo.
- [ ] Consumo persiste entre instancias (espejo Supabase) y no se pierde al reiniciar.
- [ ] Verificar si existe tope de presupuesto global.

### Frontend IA
- [ ] Config, uso, memoria, guardar key, test key, chat y welcome funcionan en web y APK.
- [ ] Mensajes de error claros ("AI no configurada", "plan no incluye IA", "Configurar Servidor" en APK).

---

## Herramientas

| Área | Herramienta |
|---|---|
| Secretos Git | `gitleaks`, `trufflehog`, `git filter-repo` |
| Seguridad web | OWASP ZAP, Burp Suite Community |
| Dependencias | `npm audit`, `npm outdated` |
| Estático | ESLint + `eslint-plugin-security` |
| API | Postman/Bruno + `k6`/`autocannon` |
| E2E | Playwright + dispositivo Android |
| Datos | `_scan_report.js` + consultas SQL |
| Seguimiento | GitHub Issues / CSV numerado |
| CI/CD | GitHub Actions (build Android + tests + deploy staging) |

---

## Gobernanza (mantener el orden)

1. Una rama por defecto protegida (sin commits directos).
2. Flujo: `feature/*` → PR → `develop` → `release/*` → tag `vX.Y.Z`.
3. Congelar durante la auditoría.
4. Entornos separados (`dev`/`staging`/`prod`).
5. Sin artefactos (APK/logs) en el repo; purgar trackeados.
6. Suite de regresión mínima en CI (login, tenancy, pagos sandbox, CRUD, IA).
7. Registro único de hallazgos con trazabilidad (ID → fix → test → re-test).

---

## Comandos de referencia (ya ejecutados en la auditoría estática)

```bash
# Secretos en historial
git log --all --oneline -- .env tok.txt data/ai-config.json data/trial-users.json
git log --oneline -S 'REDACTED' --all

# Secretos en árbol de trabajo (solo nombres de archivo)
git grep -l -I -E "sk_live_|sk_test_|whsec_|SERVICE_ROLE_KEY|-----BEGIN|PRIVATE KEY" -- . ':!node_modules' ':!*.apk'

# Dependencias
npm audit --audit-level=high

# Estructura de archivos locales (sin volcar valores)
node -e "console.log(Object.keys(require('./data/ai-config.json')))"
node -e "console.log(Object.keys(require('./data/trial-users.json')))"
```

> **Resultado conocido:** `npm audit` reporta `@capacitor/android` crítico (<8.5.1), `handlebars` crítico (transitivo) y `body-parser` moderado. Ver sección 10 del informe.

