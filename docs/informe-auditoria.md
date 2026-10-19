# Informe de Auditoría — MartialSystem (pre-lanzamiento)

> **Fecha:** 2026-10-19 · **Versión auditada:** v2.11.3 (build 27) · **Rama:** `master`
> **Estado:** diagnóstico estático + plan ejecutable. No se modificó código durante la revisión.
> **Checklist operativa:** ver `docs/auditoria.md`.

---

## 1. Resumen ejecutivo

MartialSystem es una plataforma multi-disciplina de gestión para academias de artes marciales, con backend Node/Express monolítico (~8.820 líneas en `server/index.js`), Supabase/PostgreSQL (18 migraciones), frontend web estático (PWA) y app Android (Capacitor 8). Integra pagos (Stripe, PagueloFacil, PayPal), mensajería (Twilio WhatsApp, Resend) y un **Asistente IA multi-proveedor con herramientas y memoria**.

**Veredicto preliminar:** el sistema **no está listo para lanzarse con confianza** por 4 factores verificables: (1) trabajo sin commitear en backend/frontend, (2) datos sensibles versionados y contraseña por defecto documentada, (3) ausencia de suite de pruebas y linting, (4) evidencia de inestabilidad operativa (`EADDRINUSE`, OOM de la JVM en builds).

---

## 2. Alcance

1. Seguridad y manejo de secretos.
2. Integridad y autorización de datos (RLS, roles, tenancy).
3. Correctitud funcional del backend (~100 endpoints).
4. Integraciones de pago.
5. Estabilidad, rendimiento y despliegue.
6. Web + APK Android.
7. **Asistente IA: alcances y limitaciones** (sección 6).
8. Cumplimiento legal básico.

**Fuera de alcance:** reescritura de arquitectura, rediseño de UI.

---

## 3. Hallazgos preliminares (severidad)

### 🔴 P0 — Bloqueantes
| ID | Hallazgo | Evidencia |
|---|---|---|
| AUDIT-001 | `data/trial-users.json` **versionado en Git** | `git ls-files` lo lista |
| AUDIT-002 | **Cambios sin commitear**: `server/index.js` +703 líneas, `web/index.html` +262 | `git diff --stat` |
| AUDIT-003 | `EADDRINUSE :::8010` (instancia duplicada) | `server_error.log` |

### 🟠 P1 — Altos
| ID | Hallazgo |
|---|---|
| AUDIT-004 | Contraseña superadmin por defecto en `README.md` y `.env.example` |
| AUDIT-005 | `.gitignore` con líneas basura `console.log(` y `m[1]))]` |
| AUDIT-006 | Sin suite de pruebas formal ni linting |
| AUDIT-007 | Rate limiting en memoria (se resetea al reiniciar) |

### 🟡 P2 — Medios
| ID | Hallazgo |
|---|---|
| AUDIT-008 | `hs_err_pid*.log` = OOM de la JVM en builds Android |
| AUDIT-009 | `/api/upload/public` sin autenticación |
| AUDIT-010 | Doble rama `main`/`master` + APKs trackeados |

---

## 4. Estado de las fases (snapshot)

| Fase | Estado | Notas |
|---|---|---|
| 0 Preparación | ⏳ pendiente | requiere commit + rama de auditoría |
| 1 Inventario | ✅ parcial | endpoints/tablas/secretos mapeados |
| 2 Seguridad | ⚠️ parcial | hallazgos AUDIT-001..010 detectados; falta runtime |
| 3 Datos/RLS | ⏳ pendiente | requiere acceso a Supabase |
| 4 Backend | ⏳ pendiente | requiere suite por endpoint |
| 5 Frontend | ⏳ pendiente | web vs APK por verificar |
| 6 Pagos | ⏳ pendiente | sandbox obligatorio |
| 7 Ops | ⚠️ parcial | EADDRINUSE y OOM detectados |
| 8 Cumplimiento | ⏳ pendiente | datos de menores, PCI, términos |
| 9 Dictamen | ⏳ pendiente | se emitirá al cerrar fases |

---

## 5. Arquitectura detectada

- **Backend:** Express monolítico, ~100 rutas, middleware `requireAuth`, rate-limit in-memory, CORS restringido, static `web/` + `/uploads`.
- **Datos:** `supabaseAdmin` (service_role, bypasea RLS) y `supabasePublic`. RLS en migraciones `002` y `017`.
- **Frontend:** HTML/JS/CSS estáticos, PWA (`sw.js`), biometría nativa, `mobile-connector.js` para modo APK.
- **Móvil:** Capacitor 8; `web/` duplicado en `android/app/src/main/assets/public/` (riesgo de divergencia).
- **Integraciones:** Stripe, PagueloFacil, PayPal, Twilio WhatsApp, Resend, IA (failover multi-proveedor).
- **Simulador/auditoría:** `simulator/` con `role-audit-engine.js`, `error-tracker.js`, `workflow-engine.js`, `snapshot-manager.js`, `pdf-report.js`.

---

## 6. Asistente IA — alcances y limitaciones

### 6.1 Arquitectura
- **Proveedores** (`AI_PROVIDERS`): OpenAI (`gpt-4o-mini`), DeepSeek (`deepseek-chat`), Google Gemini (`gemini-3.6-flash`), y `custom` (compatible OpenAI, baseUrl propio).
- **Configuración:** fuente de verdad en Supabase `app_settings` (key `__ai__`); `data/ai-config.json` como caché offline; reconciliación por `updatedAt`.
- **Consumo:** `data/ai-usage.json` + espejo best-effort en `app_settings` (key `__ai__usage__`): calls, tokens, costo estimado, por día y proveedor.
- **Failover:** `aiCallWithFailover` prueba el proveedor activo y, ante error (key inválida, cuota, red), pasa al siguiente activo.
- **Memoria:** tabla `ai_memory` (migración `017`) con RLS `profile_id = auth.uid()::text`; historial por usuario + establecimiento; se reinyecta en el chat (últimos 6 mensajes).
- **Rate limit:** `/api/ai/chat` y `/api/ai/welcome` a 30 req/min (in-memory).

### 6.2 Endpoints
`/api/ai/config` (GET/PUT, superadmin) · `/api/ai/usage` (GET/DELETE, superadmin) · `/api/ai/status` (todos) · `/api/ai/chat` (autenticado) · `/api/ai/welcome` (autenticado) · `/api/ai/draft` (autenticado) · `/api/ai/explain` (autenticado) · `/api/ai/mapping` (autenticado) · `/api/ai/memory` (GET/DELETE, autenticado).

### 6.3 Herramientas y permisos por rol
- `students`: read amplio (incluye student/guardian), write hasta instructor, delete solo admin+.
- `classes`: read/write staff, delete admin+.
- `payments`: read amplio, write/delete solo admin.
- `notifications`: read/write staff, sin delete.
- `billing`: read solo admin+.
- `users`: read/write superadmin/owner/sensei.
- El modelo **nunca guarda directamente**: CREAR/EDITAR genera prefill validado; BORRAR siempre pide confirmación.

### 6.4 Alcances (lo que SÍ hace)
1. **Buscador conversacional con datos reales** acotados por rol/establecimiento (≤80 filas, campos mínimos).
2. **Multi-herramienta / agentic**: emite varias búsquedas `<<<TOOL>>>` en un mismo mensaje (máx. 4 pasos) y combina resultados sin inventar (regla inyectada en el prompt).
3. **Resumen por rol** en login (`/api/ai/welcome`), con fallback "servidor" gratis si no hay IA.
4. **Borradores de formularios** (`/api/ai/draft`): marketplace, notificaciones, waivers (JSON validado).
5. **Explicaciones** (`/api/ai/explain`) y **mapeo de columnas CSV** (`/api/ai/mapping`) con `confidence`.
6. **Memoria** por usuario/establecimiento con borrado por privacidad.
7. **Gating por plan** (`ia_features`, en TODOS los planes) y **bloqueo por factura vencida ≥15 días** (`423 BILLING_BLOCKED`).

### 6.5 Limitaciones y riesgos (hallazgos IA)
| ID | Limitación / riesgo | Severidad |
|---|---|---|
| AI-01 | **API keys en texto plano** en `app_settings` (JSONB) y `data/ai-config.json`. Verificar cifrado en reposo. | 🟠 P1 |
| AI-02 | `hasAIFeature()` **permisivo ante error/sin plan** (devuelve `true`). Gating "fail-open". | 🟡 P2 |
| AI-03 | Rate limit in-memory y sin tope de presupuesto global de gasto IA. | 🟡 P2 |
| AI-04 | `getAIContextRole()` devuelve `user` sin membresía (sin datos, pero no se distingue explícitamente). | 🟢 P3 |
| AI-05 | Memoria guarda `user_message`/`ai_response` en **texto plano**; falta retención/expiración. | 🟡 P2 |
| AI-06 | Parseo `<<<TOOL>>>` por regex: verificar robustez ante salida maliciosa (injection). | 🟡 P2 |
| AI-07 | `custom` provider con `baseUrl` arbitrario: verificar sanitización anti-SSRF. | 🟡 P2 |
| AI-08 | Costo estimado: `custom`/modelos desconocidos → `0` (sin estimación). | 🟢 P3 |
| AI-09 | Consumo en Supabase **best-effort** (catch silencioso) → posible pérdida de métricas. | 🟢 P3 |

**Fortalezas IA:** failover automático, respeto de permisos por rol, datos reales acotados, sin escritura directa (prefill + confirmación), máscara de key (`apiKeyHint` = últimos 4), sanitización de modelo/baseUrl, límite de pasos y longitud de mensaje.

---

## 7. Criterios de Go / No-go

**NO LANZAR** si existe al menos uno de: secreto expuesto sin rotar · fuga multi-tenant · cobro duplicado/no registrado · endpoint de escritura sin authz · RLS desactivada · crash en flujo crítico · instancia duplicada en producción.

**LANZAR condicionado** si: solo P1/P2 con plan de remediación acordado · suite mínima (login, tenancy, pagos, CRUD, IA) verde en staging · secretos rotados · contraseña por defecto eliminada.

**Lanzamiento pleno** si: 0 P0, 0 P1 abiertos · P2 con fecha · suite verde · backups y monitoreo activos.

---

## 8. Plan de remediación priorizado

| Prioridad | Acción | Corrige |
|---|---|---|
| 1 | Commitear trabajo pendiente en rama de auditoría | AUDIT-002 |
| 2 | Purgar `data/trial-users.json` del historial y rotar credenciales | AUDIT-001 |
| 3 | Resolver `EADDRINUSE` (gestión de procesos) | AUDIT-003 |
| 4 | Rotar superadmin password y quitar de docs | AUDIT-004 |
| 5 | Cifrar/aislar API keys IA + revisar gating `hasAIFeature` | AI-01, AI-02 |
| 6 | Montar suite de regresión + CI | AUDIT-006 |
| 7 | Limpiar `.gitignore` y ramas/artefactos | AUDIT-005, AUDIT-010 |
| 8 | Estabilizar build Android (memoria Gradle) | AUDIT-008 |

---

## 9. Próximos pasos recomendados

1. Ejecutar **Fase 0** (congelar) y **Fase 2** (seguridad) primero — condicionan todo lo demás.
2. Verificar runtime de Supabase (RLS, datos, consistencia) con `_scan_report.js`.
3. Probar el aislamiento multi-tenant con `simulator/role-audit-engine.js`.
4. Validar pagos en sandbox end-to-end.
5. Emitir dictamen final al cerrar fases (ver `docs/auditoria.md`).

---

## 10. Resultados de la ejecución (confirmados 2026-10-19)

Se ejecutó auditoría estática (solo lectura). Confirmaciones que **refinan** el diagnóstico preliminar:

### 🔴 Confirmado — P0
| ID | Resultado | Evidencia |
|---|---|---|
| AUDIT-011 | **Superadmin usa la contraseña por defecto `Venta@Dojo2026!`** en `.env` (credencial adivinable, documentada en README y en el historial de Git) | `.env` `SUPERADMIN_PASSWORD` = valor por defecto |
| AUDIT-012 | **Vulnerabilidad crítica en `@capacitor/android` (<8.5.1)**: carga de contenido remoto en el origen de la app vía proxy HTTP interno (afecta al APK) | `npm audit` GHSA-rvm3-566m-v7fv |

### 🟠 Confirmado — P1
| ID | Resultado |
|---|---|
| AI-01 | API key de IA (Gemini, 53 chars) en **texto plano** en `data/ai-config.json` (y en `app_settings`) |
| AUDIT-013 | `handlebars` crítico (injection) + `xmldom`/`brace-expansion` altos (dependencias transitivas de build) |
| AUDIT-014 | Contraseña por defecto presente en el **historial de Git** (commits `96fdc7a`, `65e94ab`) |

### 🟡 Confirmado — P2
| ID | Resultado |
|---|---|
| AUDIT-001 (revisado) | `data/trial-users.json` trackeado: **solo PII** (username/fullName), **sin contraseñas** |
| AUDIT-015 | PII local en `data/` (student-photos, student-instructors, sensei-instructors, whatsapp-config, 84 sesiones en `superadmin-sessions.json`) — no versionado, pero sin cifrado en reposo |
| AUDIT-016 | `body-parser` moderate (DoS por límite inválido) — servidor |

### ✅ Descartado / positivo
- Sin secretos Stripe/live en el árbol de trabajo (solo placeholders en `.env.example`).
- `console.log` mínimo (2 en `server/index.js`).
- `superadmin-sessions.json` y `data/` (excepto `trial-users.json`) **no** versionados.

### Acciones inmediatas
1. Cambiar `SUPERADMIN_PASSWORD` (y rotar todo lo demás: IA, Supabase, Stripe).
2. `npm audit fix` y priorizar `@capacitor/android` → 8.5.1 (reconstruir APK).
3. Purgar `data/trial-users.json` del historial y rotar la key de IA.
4. Cifrar API keys de IA en reposo (Supabase `app_settings` y `data/ai-config.json`).

