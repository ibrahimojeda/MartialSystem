# Plan de Remediación — MartialSystem v2.11.3

> **Rama:** `fix/audit-remediation-v2.11.3` · **Hash base:** `a59c231674751b4670cf7fa45363dbc5b1054d0e` (guardado en `_baseline.txt`) · **Fecha:** 2026-10-19

## 1. Estado general

| Fase | Estado |
|---|---|
| 0 Línea base | ✅ rama + hash guardado |
| 1 Contención de secretos | 🟡 parcial (docs corregidos; rotación pendiente en proveedores) |
| 2 Tenancy / dashboard P0 | ✅ dashboard global = superadmin only |
| 3 IA | 🟡 parcial (fail-closed aplicado; límites/cifrado pendientes) |
| 4 Login / frontend | ✅ transición al panel corregida |
| 5 Finanzas | ⏳ pendiente (requiere datos de staging) |
| 6 Uploads / API | ⏳ pendiente |
| 7 Dependencias / Android / Ops | ⏳ pendiente (actualización de Capacitor) |
| 8 Pruebas | ⏳ pendiente |
| 9 CI / docs | 🟡 parcial (este doc + docs de seguridad) |

## 2. Cambios aplicados en esta sesión

| ID | Corrección | Archivo | Verificación |
|---|---|---|---|
| P0-1 | `/api/dashboard/stats` devuelve 403 a cualquier rol no-superadmin | `server/index.js` | `node --check` OK |
| IA-2 | `hasAIFeature()` fail-closed (false ante error/sin plan) | `server/index.js` | `node --check` OK |
| LOG-1 | Transición al panel: `setAuthenticated(true)` antes de `refreshMe()`; carga de datos aislada en try/catch | `web/index.html` | revisión |
| SEC-1 | Contraseña por defecto eliminada de `README.md` | `README.md` | grep = 0 coincidencias |
| SEC-2 | Contraseña por defecto reemplazada por placeholder en `.env.example` | `.env.example` | grep = 0 coincidencias |

## 3. Matriz de hallazgos

| ID | Severidad | Causa | Impacto | Archivo/ruta | Corrección | Prueba | Estado |
|---|---|---|---|---|---|---|---|
| AUDIT-011 | P0 | Contraseña superadmin por defecto en `.env` | Acceso global adivinable | `.env` | Rotar (manual) | login con credencial vieja falla | ⏳ rotación pendiente |
| AUDIT-012 | P0 | `@capacitor/android` <8.5.1 crítico | RCE/content remoto en APK | `package.json` | actualizar + rebuild | `npm audit` limpio | ⏳ pendiente |
| P0-1 | P0 | dashboard global sin chequeo de rol | Fuga multi-tenant | `server/index.js` | 403 no-superadmin | owner/sensei → 403 | ✅ aplicado |
| AI-01 | P1 | API key IA en texto plano | Fuga si BD se filtra | `data/ai-config.json`, `app_settings` | cifrado/gestor secretos + rotar | key no legible en reposo | ⏳ pendiente |
| AI-02 | P2 | `hasAIFeature` fail-open | IA accesible sin plan | `server/index.js` | fail-closed | plan sin IA → 403 | ✅ aplicado |
| AUDIT-014 | P1 | Contraseña por defecto en historial Git | Fuga permanente | historial | `git filter-repo` + rotar | grep historial limpio | ⏳ pendiente |
| LOG-1 | P2 | `setAuthenticated` tras `refreshMe` | Formulario no se ocultaba | `web/index.html` | mover transición antes | login E2E oculta form | ✅ aplicado |
| AUDIT-009 | P2 | `/api/upload/public` sin auth/validación de contenido | abuso de subida | `server/index.js` | auth + sniffing MIME | subida no-imagen rechazada | ⏳ pendiente |
| AUDIT-007 | P2 | rate limiting en memoria | se resetea | `server/index.js` | store persistente | límite sobrevive restart | ⏳ pendiente |
| AUDIT-016 | P2 | `body-parser` moderate | DoS | `package.json` | actualizar | `npm audit` | ⏳ pendiente |

## 4. Acciones manuales / externas (no ejecutadas por requerir proveedores)

1. Rotar `SUPERADMIN_PASSWORD` en `.env` (no versionado) y toda credencial expuesta (Supabase, Stripe, IA, Twilio, Resend).
2. `npm audit fix` + subir `@capacitor/android` ≥8.5.1 y reconstruir el APK.
3. Purgar `data/trial-users.json` y la contraseña por defecto del historial con `git filter-repo`.
4. Cifrar API keys IA en reposo (gestor de secretos o cifrado con clave maestra fuera de la BD).
5. Ejecutar suite de tenancy (ver `docs/tenancy-matrix.md`).

## 5. Criterio de cierre

No se marca GO/GO-condicionado mientras exista: fuga multi-tenant, secreto sin rotar, vulnerabilidad crítica del APK, o prueba crítica fallida.

## 6. Dictamen actual (2026-10-19)

**NO-GO** — pendientes críticos: rotación de secretos (superadmin, Supabase, IA, Stripe), actualización de `@capacitor/android` ≥8.5.1 + rebuild del APK, purga del historial Git y cifrado de API keys IA en reposo. La fuga multi-tenant del dashboard (P0) ya está cerrada.
