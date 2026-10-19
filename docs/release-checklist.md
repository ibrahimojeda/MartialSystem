# Release Checklist — MartialSystem

## Bloqueantes (no publicar si alguno falla)

- [ ] Sin fuga multi-tenant en dashboard/reportes/IA/pagos/alumnos/notificaciones/torneos/marketplace.
- [ ] Owner solo ve/opera sus establecimientos (membresías).
- [ ] Sensei/instructor solo datos permitidos por rol y asignaciones.
- [ ] Student/guardian solo datos propios y autorizados.
- [ ] Dashboard global reservado a superadmin.
- [ ] `establishmentId` ajeno devuelve 403/404/empty (nunca datos ajenos).
- [ ] Secretos expuestos rotados y sin rastro en historial.
- [ ] `@capacitor/android` ≥8.5.1 y APK reconstruido.
- [ ] `GET /api/ai/config` nunca devuelve claves completas.
- [ ] Pruebas de auth, tenancy, pagos, CRUD e IA verdes en staging.
- [ ] Finanzas con KPIs coherentes (alcance global/local/periodo claros).

## Calidad

- [ ] `npm audit` sin críticos/altos (o con mitigación documentada).
- [ ] Build web y Android reproducibles.
- [ ] Healthcheck + logs + staging separado.
- [ ] No versionar `.env`, APKs, logs ni datos sensibles.

## Veredicto

- GO: 0 P0/P1 abiertos, suite verde, secretos rotados, backups/monitoreo activos.
- GO condicionado: solo P1/P2 con plan acordado.
- NO-GO: cualquier fuga multi-tenant, secreto sin rotar, vuln crítica APK o prueba crítica fallida.
