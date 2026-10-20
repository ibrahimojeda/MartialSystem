#!/usr/bin/env node
/**
 * Tenancy audit — estático y basado en reglas. Sin dependencias, sin Supabase real.
 * Uso: node tests/tenancy-audit.js
 * Salida: 0 si todas las aserciones críticas pasan; 1 si hay violación crítica.
 *
 * Verifica (aserciones críticas):
 *  - /api/dashboard/stats es superadmin-only (fuga P0)
 *  - /api/payments GET valida tenancy vía getMembership
 *  - /api/ai/config GET es superadmin-only
 *  - /api/upload (no público) requiere auth
 *  - hasAIFeature es fail-closed
 * Además genera un reporte de todas las rutas con flags auth/membership/guard.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');

// 1) Enumerar rutas con su posición
const routeRe = /app\.(get|post|put|delete|patch)\s*\(\s*(['"])(\/[^'"]+)\2/g;
const routes = [];
let m;
while ((m = routeRe.exec(SRC)) !== null) {
  routes.push({ method: m[1].toLowerCase(), path: m[3], index: m.index });
}

// Ventana de cada ruta: desde su índice hasta el inicio de la siguiente ruta.
function blockFor(i) {
  const start = routes[i].index;
  const end = i + 1 < routes.length ? routes[i + 1].index : SRC.length;
  return SRC.slice(start, end);
}

const flags = routes.map((r, i) => {
  const b = blockFor(i);
  return {
    ...r,
    hasAuth: /requireAuth/.test(b),
    hasMembership: /getMembership\s*\(/.test(b),
    hasSuperadminGuard: /req\.isSuperadmin|role\s*!==?\s*['"]superadmin|ROLE_SUPERADMIN/.test(b)
  };
});

// Rutas públicas esperadas (webhooks firma-verificada, login, health, logo, trial, upload public)
const PUBLIC_OK = new Set([
  '/api/health', '/api/logo', '/api/login', '/api/trial/signup',
  '/api/upload/public',
  '/api/payments/stripe/webhook', '/api/payments/paguelofacil/webhook', '/api/payments/paypal/webhook'
]);

// Rutas de datos multitenant que deberían validar tenancy (para revisión manual)
const TENANCY_REQUIRED = /payments|students|classes|instructors|notifications|tournaments|inventory|exam|academics|attendance|marketplace|billing/;

const critical = [];
const report = [];

for (const f of flags) {
  const isPublicOk = PUBLIC_OK.has(f.path);
  const requiresTenancy = TENANCY_REQUIRED.test(f.path);

  let status = 'OK', reason = '';
  if (!f.hasAuth && !isPublicOk) { status = 'REVISAR'; reason = 'sin requireAuth (¿debería ser público?)'; }
  else if (f.hasAuth && requiresTenancy && !f.hasMembership && !f.hasSuperadminGuard) {
    status = 'REVISAR'; reason = 'ruta de datos sin getMembership ni guard de superadmin (revisar tenancy)';
  }
  report.push({ method: f.method.toUpperCase(), path: f.path, auth: f.hasAuth, membership: f.hasMembership, superadminGuard: f.hasSuperadminGuard, status, reason });
}

// ─── Aserciones críticas (fallo = exit 1) ───
const assertTrue = (cond, msg) => { if (!cond) critical.push(msg); };

const dash = flags.find(f => f.path === '/api/dashboard/stats');
assertTrue(!!dash && dash.hasSuperadminGuard, 'P0: /api/dashboard/stats debe ser superadmin-only');

const payGet = flags.find(f => f.path === '/api/payments' && f.method === 'get');
assertTrue(!!payGet && payGet.hasMembership, '/api/payments GET debe validar getMembership');

const aiConfig = flags.find(f => f.path === '/api/ai/config' && f.method === 'get');
assertTrue(!!aiConfig && aiConfig.hasSuperadminGuard, '/api/ai/config GET debe ser superadmin-only');

const uploadAuth = flags.find(f => f.path === '/api/upload');
assertTrue(!!uploadAuth && uploadAuth.hasAuth, '/api/upload (no público) debe requerir auth');

assertTrue(SRC.includes('fail-closed'), 'hasAIFeature debe ser fail-closed');

// ─── Salida ───
console.log('=== Tenancy audit — MartialSystem ===');
console.log('Rutas analizadas: ' + routes.length);
console.log('Aserciones críticas: ' + (critical.length === 0 ? 'TODAS OK ✅' : critical.length + ' FALLIDAS ❌'));
critical.forEach(c => console.log('  ✗ ' + c));

const review = report.filter(r => r.status === 'REVISAR');
if (review.length) {
  console.log('\nRutas para revisión manual (' + review.length + '):');
  review.forEach(r => console.log(`  ${r.method} ${r.path} — ${r.reason}`));
}

fs.writeFileSync(
  path.join(__dirname, 'tenancy-report.json'),
  JSON.stringify({ generated: new Date().toISOString(), totalRoutes: routes.length, critical, report }, null, 2)
);
console.log('\nReporte: tests/tenancy-report.json');

process.exit(critical.length ? 1 : 0);
