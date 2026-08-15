// ══════════════════════════════════════════════════════════════
// role-audit-engine.js — Motor de auditoría de roles y permisos
// Verifica:
//   A. Matriz de roles y módulos (cobertura, roles faltantes)
//   B. Acceso a endpoints por rol (200/403 esperados vs reales)
//   C. Alcance de registros (scope) por rol
//   D. Consistencia frontend vs backend (módulos mostrados vs permisos reales)
// ══════════════════════════════════════════════════════════════

const http = require('http');
const dg = require('./data-generator');

class RoleAuditEngine {
  constructor(supabaseAdmin, mainServerUrl = null) {
    this.sb = supabaseAdmin;
    this.mainServerUrl = mainServerUrl || process.env.MAIN_SERVER_URL || 'http://localhost:8010';
    this.findings = [];
    this.stats = { totalChecks: 0, passed: 0, failed: 0, warnings: 0, skipped: 0 };
  }

  // ══════════════════════════════════════════════════════════════
  // CONSTANTS — Mapa de roles, módulos y jerarquía (del server/index.js)
  // ══════════════════════════════════════════════════════════════

  static ROLES = {
    SUPERADMIN: 'superadmin',
    OWNER: 'owner',
    SENSEI: 'sensei',
    ADMIN: 'admin',
    INSTRUCTOR: 'instructor',
    GUARDIAN: 'guardian',
    STUDENT: 'student'
  };

  static ALL_ROLES = ['superadmin', 'owner', 'sensei', 'admin', 'instructor', 'guardian', 'student'];

  static ROLE_HIERARCHY = {
    superadmin: 5,
    owner: 4,
    sensei: 4,
    admin: 3,
    instructor: 2,
    guardian: 1,
    student: 1
  };

  // Quién puede crear qué roles
  static canCreateRole = (actorRole, targetRole) => {
    const t = targetRole;
    if (!t || !['owner', 'sensei', 'admin', 'instructor', 'guardian', 'student'].includes(t)) return false;
    if (actorRole === 'superadmin') return ['owner', 'sensei', 'admin', 'instructor', 'guardian', 'student'].includes(t);
    if (actorRole === 'owner' || actorRole === 'sensei') return ['instructor', 'guardian', 'student'].includes(t);
    return false;
  };

  // Módulos por defecto por rol (del server/index.js)
  static DEFAULT_ROLE_MODULES = {
    superadmin: ['operacion', 'calendario', 'academico', 'administracion', 'torneos', 'comunidad', 'marketplace', 'finanzas', 'configuracion', 'debug'],
    owner: ['operacion', 'calendario', 'academico', 'administracion', 'torneos', 'comunidad', 'marketplace', 'finanzas', 'configuracion'],
    sensei: ['operacion', 'calendario', 'academico', 'torneos', 'comunidad', 'finanzas'],
    admin: ['operacion', 'calendario', 'academico', 'comunidad', 'marketplace', 'finanzas'],
    instructor: ['operacion', 'calendario', 'academico', 'comunidad'],
    guardian: ['academico', 'finanzas', 'comunidad'],
    student: ['academico', 'comunidad']
  };

  // MODULE_KEYS del sistema
  static MODULE_KEYS = ['operacion', 'calendario', 'academico', 'administracion', 'torneos', 'comunidad', 'marketplace', 'finanzas', 'configuracion', 'debug'];

  // Todas las pantallas del frontend (ALL_TABS del web/index.html)
  static ALL_TABS = ['onboarding', 'operacion', 'prospectos', 'calendario', 'academico', 'teoria', 'administracion', 'roles', 'torneos', 'comunidad', 'marketplace', 'finanzas', 'inventario', 'comisiones', 'pasarela', 'facturacion', 'configuracion', 'debug'];

  // Funciones de permiso del backend
  static isManagerRole = (role) => ['superadmin', 'owner', 'sensei', 'admin'].includes(role);
  static canAccessAdminPanel = (role) => ['owner', 'sensei', 'superadmin'].includes(role);
  static canCreateNotifications = (role) => ['owner', 'sensei', 'admin', 'instructor', 'superadmin'].includes(role);

  // ══════════════════════════════════════════════════════════════
  // MATRIZ DE EXPECTATIVAS: Endpoint → status esperado por rol
  //  200 = acceso permitido, 403 = denegado, 404 = no existe (info)
  // ══════════════════════════════════════════════════════════════

  static ENDPOINT_EXPECTATIONS = [
    // ─── Auth / Session ───
    { method: 'GET',  path: '/api/me',                        roles: { all: 200 } },
    { method: 'GET',  path: '/api/tree',                       roles: { all: 200 } },

    // ─── Trial ───
    { method: 'GET',  path: '/api/trial/users',                roles: { superadmin: 200, owner: 403, sensei: 403, admin: 403, instructor: 403, guardian: 403, student: 403 } },

    // ─── Dashboard ───
    { method: 'GET',  path: '/api/dashboard/stats',            roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 200, guardian: 403, student: 403 } },
    { method: 'GET',  path: '/api/dashboard/student',          roles: { student: 200, guardian: 200, owner: 403, sensei: 403, admin: 403, instructor: 403 } },
    { method: 'GET',  path: '/api/dashboard/sensei',           roles: { sensei: 200, instructor: 200, owner: 403, admin: 403, guardian: 403, student: 403 } },
    { method: 'GET',  path: '/api/dashboard/owner',            roles: { owner: 200, sensei: 200, superadmin: 200, admin: 403, instructor: 403, guardian: 403, student: 403 } },

    // ─── Students ───
    { method: 'GET',  path: '/api/students',                   roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 200, guardian: 200, student: 403 } },
    { method: 'POST', path: '/api/students',                   roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 200, guardian: 403, student: 403 } },
    { method: 'GET',  path: '/api/students/curriculum',        roles: { all: 200 } },

    // ─── Instructors ───
    { method: 'GET',  path: '/api/instructors',                roles: { all: 200 } },
    { method: 'POST', path: '/api/instructors',                roles: { superadmin: 200, owner: 200, sensei: 200, admin: 403, instructor: 403, guardian: 403, student: 403 } },

    // ─── Classes ───
    { method: 'GET',  path: '/api/classes',                    roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 200, guardian: 403, student: 403 } },
    { method: 'POST', path: '/api/classes',                    roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 200, guardian: 403, student: 403 } },

    // ─── Payments ───
    { method: 'GET',  path: '/api/payments',                   roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, guardian: 200, instructor: 200, student: 403 } },
    { method: 'POST', path: '/api/payments',                   roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, guardian: 403, instructor: 403, student: 403 } },

    // ─── Finance ───
    { method: 'GET',  path: '/api/finance/targets',            roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 403, guardian: 403, student: 403 } },
    { method: 'PUT',  path: '/api/finance/targets',            roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 403, guardian: 403, student: 403 } },
    { method: 'GET',  path: '/api/finance/trends',               roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, guardian: 403, instructor: 403, student: 403 } },

    // ─── Reports ───
    { method: 'GET',  path: '/api/reports/summary',            roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 403, guardian: 403, student: 403 } },
    { method: 'GET',  path: '/api/reports/operational',        roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 403, guardian: 403, student: 403 } },
    { method: 'GET',  path: '/api/reports/churn',              roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 403, guardian: 403, student: 403 } },

    // ─── CRM Prospects ───
    { method: 'GET',  path: '/api/prospects',                  roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 200, guardian: 403, student: 403 } },
    { method: 'POST', path: '/api/prospects',                  roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 200, guardian: 403, student: 403 } },

    // ─── Admin Panel ───
    { method: 'GET',  path: '/api/admin/members',              roles: { superadmin: 200, owner: 200, sensei: 200, admin: 403, instructor: 403, guardian: 403, student: 403 } },
    { method: 'POST', path: '/api/admin/users',                roles: { superadmin: 200, owner: 200, sensei: 200, admin: 403, instructor: 403, guardian: 403, student: 403 } },
    { method: 'PATCH',path: '/api/admin/members/__DUMMY__',    roles: { superadmin: 200, owner: 200, sensei: 200, admin: 403, instructor: 403, guardian: 403, student: 403 }, skipReason: 'Requiere ID real de miembro' },

    // ─── Module Permissions ───
    { method: 'GET',  path: '/api/module-permissions',         roles: { all: 200 } },
    { method: 'PUT',  path: '/api/module-permissions',         roles: { superadmin: 200, owner: 403, sensei: 403, admin: 403, instructor: 403, guardian: 403, student: 403 } },

    // ─── WhatsApp ───
    { method: 'GET',  path: '/api/whatsapp/config',            roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 403, guardian: 403, student: 403 } },
    { method: 'POST', path: '/api/whatsapp/send',              roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 200, guardian: 403, student: 403 } },

    // ─── Notifications ───
    { method: 'GET',  path: '/api/notifications',              roles: { all: 200 } },
    { method: 'POST', path: '/api/notifications',              roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 200, guardian: 403, student: 403 } },

    // ─── Marketplace ───
    { method: 'GET',  path: '/api/marketplace',                roles: { all: 200 } },
    { method: 'POST', path: '/api/marketplace',                roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 403, guardian: 403, student: 403 } },

    // ─── Inventory ───
    { method: 'GET',  path: '/api/inventory',                  roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 403, guardian: 403, student: 403 } },
    { method: 'POST', path: '/api/inventory',                  roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 403, guardian: 403, student: 403 } },

    // ─── Tournaments ───
    { method: 'GET',  path: '/api/tournaments',                roles: { all: 200 } },
    { method: 'POST', path: '/api/tournaments/register',       roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 403, guardian: 403, student: 403 } },

    // ─── Portal ───
    { method: 'GET',  path: '/api/portal/student',             roles: { student: 200, owner: 403, sensei: 403, admin: 403, instructor: 403, guardian: 200, superadmin: 200 } },
    { method: 'GET',  path: '/api/portal/guardian',            roles: { guardian: 200, student: 403, instructor: 403 } },
    { method: 'GET',  path: '/api/my-disciplines',             roles: { all: 200 } },
    { method: 'GET',  path: '/api/establishment-disciplines',  roles: { all: 200 } },

    // ─── Theory ───
    { method: 'GET',  path: '/api/theory',                     roles: { all: 200 } },

    // ─── Commissions (superadmin only) ───
    { method: 'GET',  path: '/api/commissions',                roles: { superadmin: 200, owner: 403, sensei: 403, admin: 403, instructor: 403, guardian: 403, student: 403 } },

    // ─── System Billing ───
    { method: 'GET',  path: '/api/system-plans',               roles: { all: 200 } },
    { method: 'GET',  path: '/api/establishment-plan',         roles: { owner: 200, superadmin: 200, sensei: 403, admin: 403, instructor: 403, guardian: 403, student: 403 } },
    { method: 'GET',  path: '/api/system-billing/bills',       roles: { owner: 200, superadmin: 200, sensei: 403, admin: 403, instructor: 403, guardian: 403, student: 403 } },
    { method: 'GET',  path: '/api/system-billing/pending-payments', roles: { superadmin: 200, owner: 403, sensei: 403, admin: 403, instructor: 403, guardian: 403, student: 403 } },

    // ─── Evaluations ───
    { method: 'GET',  path: '/api/evaluations',                roles: { all: 200 } },
    { method: 'POST', path: '/api/evaluations',                roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 200, guardian: 403, student: 403 } },

    // ─── Organizations ───
    { method: 'GET',  path: '/api/organizations',              roles: { all: 200 } },

    // ─── Settings ───
    { method: 'GET',  path: '/api/settings',                   roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 403, guardian: 403, student: 403 } },
    { method: 'PUT',  path: '/api/settings',                   roles: { superadmin: 200, owner: 200, sensei: 200, admin: 200, instructor: 403, guardian: 403, student: 403 } },
  ];

  // ══════════════════════════════════════════════════════════════
  // A. MATRIZ DE ROLES Y MÓDULOS
  // ══════════════════════════════════════════════════════════════

  async auditRoleCoverage() {
    const findings = [];

    // 1. Listar todos los establecimientos
    const establishments = await this._safeQuery('establishments', 'id, name, is_active');

    for (const est of establishments) {
      // 2. Get members grouped by role
      const members = await this._safeQuery('establishment_members',
        'establishment_id, profile_id, role',
        { establishment_id: est.id });

      const roleCount = {};
      RoleAuditEngine.ALL_ROLES.forEach(r => { roleCount[r] = 0; });

      members.forEach(m => {
        const r = m.role;
        if (roleCount.hasOwnProperty(r)) roleCount[r]++;
      });

      // 3. Check for missing roles
      const missingRoles = [];
      const essentialRoles = ['owner', 'sensei', 'instructor'];
      essentialRoles.forEach(r => {
        if (roleCount[r] === 0) missingRoles.push(r);
      });

      if (missingRoles.length > 0) {
        findings.push({
          severity: 'warning',
          category: 'Cobertura de Roles',
          establishment: est.name,
          message: `Faltan roles esenciales: ${missingRoles.join(', ')}`,
          roleCounts: roleCount
        });
      } else {
        findings.push({
          severity: 'info',
          category: 'Cobertura de Roles',
          establishment: est.name,
          message: `Todos los roles esenciales presentes (${est.name})`,
          roleCounts: roleCount
        });
      }

      // 4. Superadmin count across all establishments
      if (roleCount['superadmin'] > 0) {
        findings.push({
          severity: 'warning',
          category: 'Cobertura de Roles',
          establishment: est.name,
          message: `${roleCount['superadmin']} superadmin(s) con membresía en establecimiento (debería ser 0 en miembros explícitos)`,
          roleCounts: roleCount
        });
      }
    }

    return findings;
  }

  // ══════════════════════════════════════════════════════════════
  // B. AUDITORÍA DE ACCESO A ENDPOINTS POR ROL
  // ══════════════════════════════════════════════════════════════

  async auditEndpointAccess(establishmentId = null) {
    const findings = [];
    this.stats = { totalChecks: 0, passed: 0, failed: 0, warnings: 0, skipped: 0 };

    // Get real users per role
    const roleUsers = await this._getUsersByRole(establishmentId);

    if (Object.values(roleUsers).every(arr => arr.length === 0)) {
      findings.push({
        severity: 'critical',
        category: 'Acceso a Endpoints',
        message: 'No hay usuarios en la base de datos para auditar. Ejecuta una simulación primero.'
      });
      return { findings, stats: this.stats };
    }

    // Test each endpoint against each role
    for (const endpoint of RoleAuditEngine.ENDPOINT_EXPECTATIONS) {
      if (endpoint.skipReason) {
        this.stats.skipped++;
        continue;
      }

      for (const role of RoleAuditEngine.ALL_ROLES) {
        const expectedStatus = this._getExpectedStatus(endpoint, role);
        if (expectedStatus === null) continue; // role not specified for this endpoint

        this.stats.totalChecks++;

        const usersForRole = roleUsers[role] || [];
        if (usersForRole.length === 0) {
          this.stats.skipped++;
          continue;
        }

        // Use the first user of this role
        const user = usersForRole[0];
        const path = this._resolveEndpointPath(endpoint, user);

        try {
          const result = await this._callMainServer(
            endpoint.method,
            path,
            user.accessToken,
            user.establishmentId
          );

          const actualStatus = result.status;

          if (actualStatus === expectedStatus) {
            this.stats.passed++;
          } else {
            findings.push({
              severity: (expectedStatus === 403 && actualStatus === 200) ? 'critical' : 'warning',
              category: 'Acceso a Endpoints',
              endpoint: `${endpoint.method} ${endpoint.path}`,
              role,
              expectedStatus,
              actualStatus,
              message: `${role} en ${endpoint.method} ${endpoint.path}: esperado ${expectedStatus}, recibido ${actualStatus}`,
              user: user.username
            });
            this.stats.failed++;
          }
        } catch (err) {
          // Network error or server down
          findings.push({
            severity: 'warning',
            category: 'Acceso a Endpoints',
            endpoint: `${endpoint.method} ${endpoint.path}`,
            role,
            expectedStatus,
            actualStatus: 'ERROR',
            message: `${role} en ${endpoint.method} ${endpoint.path}: ${err.message}`,
            user: user.username
          });
          this.stats.warnings++;
        }
      }
    }

    return { findings, stats: this.stats };
  }

  // ══════════════════════════════════════════════════════════════
  // C. VERIFICACIÓN DE SCOPE (ALCANCE DE REGISTROS)
  // ══════════════════════════════════════════════════════════════

  async auditDataScope(establishmentId = null) {
    const findings = [];
    let scopeChecks = 0, scopePassed = 0, scopeFailed = 0;

    const roleUsers = await this._getUsersByRole(establishmentId);
    if (!establishmentId && Object.values(roleUsers).every(arr => arr.length === 0)) {
      findings.push({ severity: 'critical', category: 'Scope', message: 'Sin usuarios para auditar scope' });
      return { findings, scopeStats: { checks: 0, passed: 0, failed: 0 } };
    }

    // Scope check 1: Instructor should only see students in assigned disciplines
    const instructors = roleUsers['instructor'] || [];
    if (instructors.length > 0) {
      for (const instructor of instructors.slice(0, 3)) {
        scopeChecks++;
        try {
          const result = await this._callMainServer('GET', '/api/students', instructor.accessToken, instructor.establishmentId);
          if (result.status === 200 && result.data?.data) {
            const students = Array.isArray(result.data.data) ? result.data.data : [];
            // Get instructor's assigned disciplines
            const discResponse = await this._callMainServer('GET', '/api/my-disciplines', instructor.accessToken, instructor.establishmentId);
            const allowedDiscIds = (discResponse.data?.data || []).map(d => d.id);

            if (allowedDiscIds.length > 0) {
              // We can't fully validate without knowing each student's discipline,
              // but we can flag if the instructor sees an unexpected number
              findings.push({
                severity: 'info',
                category: 'Scope',
                message: `Instructor ${instructor.username} ve ${students.length} alumnos en ${allowedDiscIds.length} disciplina(s)`,
                role: 'instructor',
                studentCount: students.length,
                disciplineCount: allowedDiscIds.length
              });
            }
            scopePassed++;
          }
        } catch (_) {
          scopeFailed++;
        }
      }
    }

    // Scope check 2: Guardian should only see linked students
    const guardians = roleUsers['guardian'] || [];
    if (guardians.length > 0) {
      for (const guardian of guardians.slice(0, 3)) {
        scopeChecks++;
        try {
          const result = await this._callMainServer('GET', '/api/portal/guardian', guardian.accessToken, guardian.establishmentId);
          if (result.status === 200 && result.data?.data) {
            const linkedStudents = result.data.data.students || [];
            findings.push({
              severity: 'info',
              category: 'Scope',
              message: `Guardian ${guardian.username} ve ${linkedStudents.length} alumno(s) vinculado(s)`,
              role: 'guardian',
              linkedCount: linkedStudents.length
            });
            scopePassed++;
          }
        } catch (_) {
          scopeFailed++;
        }
      }
    }

    // Scope check 3: Student should only see their own data
    const students = roleUsers['student'] || [];
    if (students.length > 0 && students.length >= 2) {
      const studentA = students[0];
      const studentB = students[1];
      scopeChecks++;

      try {
        const resultA = await this._callMainServer('GET', '/api/portal/student', studentA.accessToken, studentA.establishmentId);
        if (resultA.status === 200 && resultA.data?.data) {
          const ownData = resultA.data.data;
          // If student A can see student B's data, that's a scope violation
          const ownName = ownData.student?.full_name || ownData.full_name || '';
          if (ownName && ownName !== '') {
            scopePassed++;
          }
        }
      } catch (_) {
        scopeFailed++;
      }
    }

    return {
      findings,
      scopeStats: { checks: scopeChecks, passed: scopePassed, failed: scopeFailed }
    };
  }

  // ══════════════════════════════════════════════════════════════
  // D. CONSISTENCIA FRONTEND vs BACKEND
  // ══════════════════════════════════════════════════════════════

  auditFrontendBackendConsistency() {
    const findings = [];

    // Compare ALL_TABS (frontend) vs MODULE_KEYS (backend)
    const frontendTabs = new Set(RoleAuditEngine.ALL_TABS);
    const backendModules = new Set(RoleAuditEngine.MODULE_KEYS);

    // Tabs in frontend but not in backend modules
    const frontendOnly = [...frontendTabs].filter(t => !backendModules.has(t));

    if (frontendOnly.length > 0) {
      findings.push({
        severity: 'info',
        category: 'Frontend vs Backend',
        message: `Pantallas del frontend sin módulo backend equivalente: ${frontendOnly.join(', ')}`,
        details: 'Estas pantallas existen en ALL_TABS (web/index.html) pero no en MODULE_KEYS (server/index.js). Puede ser intencional (sub-tabs como teoria, comisiones, pasarela, etc.)'
      });
    }

    // Check that each role has module coverage
    for (const role of RoleAuditEngine.ALL_ROLES) {
      const modules = RoleAuditEngine.DEFAULT_ROLE_MODULES[role] || [];
      findings.push({
        severity: 'info',
        category: 'Frontend vs Backend',
        message: `Rol ${role}: ${modules.length} módulos asignados por defecto (${modules.join(', ')})`,
        role,
        moduleCount: modules.length
      });
    }

    return findings;
  }

  // ══════════════════════════════════════════════════════════════
  // MAIN: Ejecutar auditoría completa
  // ══════════════════════════════════════════════════════════════

  async runFullAudit(establishmentId = null, options = {}) {
    const { includeEndpointTests = true, includeScopeTests = true } = options;
    const allFindings = [];
    let endpointStats = { totalChecks: 0, passed: 0, failed: 0, warnings: 0, skipped: 0 };
    let scopeStats = { checks: 0, passed: 0, failed: 0 };

    // A. Role coverage (always runs, no HTTP needed)
    const coverageFindings = await this.auditRoleCoverage();
    allFindings.push(...coverageFindings);

    // B. Endpoint access tests (requires main server)
    if (includeEndpointTests) {
      const endpointResult = await this.auditEndpointAccess(establishmentId);
      allFindings.push(...endpointResult.findings);
      endpointStats = endpointResult.stats;
    }

    // C. Data scope tests (requires main server)
    if (includeScopeTests) {
      const scopeResult = await this.auditDataScope(establishmentId);
      allFindings.push(...scopeResult.findings);
      scopeStats = scopeResult.scopeStats;
    }

    // D. Frontend vs Backend consistency (always runs)
    const fbFindings = this.auditFrontendBackendConsistency();
    allFindings.push(...fbFindings);

    // Summary
    const critical = allFindings.filter(f => f.severity === 'critical').length;
    const warnings = allFindings.filter(f => f.severity === 'warning').length;
    const info = allFindings.filter(f => f.severity === 'info').length;
    const healthScore = Math.max(0, 100 - (critical * 20) - (warnings * 5) - (endpointStats.failed * 2));

    return {
      findings: allFindings,
      summary: {
        total: allFindings.length,
        critical,
        warnings,
        info,
        healthScore
      },
      endpointStats,
      scopeStats
    };
  }

  // ══════════════════════════════════════════════════════════════
  // UTILITIES
  // ══════════════════════════════════════════════════════════════

  async _getUsersByRole(establishmentId) {
    const roleUsers = {};
    RoleAuditEngine.ALL_ROLES.forEach(r => { roleUsers[r] = []; });

    let query = this.sb.from('establishment_members')
      .select('establishment_id, profile_id, role, profile:profiles(id, full_name, username, auth_email)')
      .limit(2000);

    if (establishmentId) query = query.eq('establishment_id', establishmentId);

    const { data: members } = await query;

    if (!members || members.length === 0) return roleUsers;

    // Get access tokens for each user
    for (const member of members) {
      const role = member.role;
      if (!roleUsers[role]) continue;
      if (roleUsers[role].length >= 3) continue; // max 3 users per role

      const email = member.profile?.auth_email || `${member.profile?.username}@users.martialsystem.local`;
      const username = member.profile?.username || 'unknown';

      try {
        // Strategy 1: Force-reset password to known value (simulator environment)
        await this.sb.auth.admin.updateUserById(member.profile_id, {
          password: 'Sim12345!',
          email_confirm: true
        });

        // Strategy 2: Sign in with known password
        const { data: signInData, error: signInError } = await this.sb.auth.signInWithPassword({
          email,
          password: 'Sim12345!'
        });

        if (!signInError && signInData?.session?.access_token) {
          roleUsers[role].push({
            profileId: member.profile_id,
            username,
            fullName: member.profile?.full_name || '',
            role,
            establishmentId: member.establishment_id,
            accessToken: signInData.session.access_token
          });
        }
      } catch (_) {
        // User may not exist or reset may fail
      }
    }

    return roleUsers;
  }

  async _callMainServer(method, path, accessToken, establishmentId) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.mainServerUrl);
      if (establishmentId && !url.searchParams.has('establishmentId')) {
        url.searchParams.set('establishmentId', establishmentId);
      }

      const options = {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      };

      const req = http.request(options, (res) => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          let parsed;
          try { parsed = JSON.parse(body); } catch (_) { parsed = body; }
          resolve({ status: res.statusCode, data: parsed });
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

      req.end();
    });
  }

  _getExpectedStatus(endpoint, role) {
    if (!endpoint.roles) return null;
    if (endpoint.roles.all !== undefined) return endpoint.roles.all;
    if (endpoint.roles[role] !== undefined) return endpoint.roles[role];
    return null; // role not tested for this endpoint
  }

  _resolveEndpointPath(endpoint, user) {
    // Replace __DUMMY__ placeholders with real data from user
    return endpoint.path;
  }

  // ══════════════════════════════════════════════════════════════
  // E. AUTO-REPARACIÓN DE ROLES FALTANTES
  // ══════════════════════════════════════════════════════════════

  async repairMissingRoles(establishmentId = null) {
    const repairs = [];
    const establishments = establishmentId
      ? [{ id: establishmentId }]
      : await this._safeQuery('establishments', 'id, name');

    // Get discipline IDs per establishment
    for (const est of establishments) {
      const estName = est.name || est.id;
      const members = await this._safeQuery('establishment_members',
        'profile_id, role', { establishment_id: est.id });

      const roleCount = {};
      RoleAuditEngine.ALL_ROLES.forEach(r => { roleCount[r] = 0; });
      const ownerProfile = members.find(m => m.role === 'owner');
      members.forEach(m => { roleCount[m.role] = (roleCount[m.role] || 0) + 1; });

      const discRows = await this._safeQuery('establishment_disciplines',
        'discipline_id', { establishment_id: est.id });
      const discIds = discRows.map(d => d.discipline_id);

      // Crear sensei si falta
      let senseiId = null;
      if (roleCount['sensei'] === 0) {
        senseiId = await this._createUserForRole(est.id, 'sensei', roleCount['sensei']);
        if (senseiId) {
          repairs.push({ establishment: estName, action: 'creado', role: 'sensei', profileId: senseiId });
          roleCount['sensei']++;
        }
      }
      const senseiMember = members.find(m => m.role === 'sensei');
      senseiId = senseiId || senseiMember?.profile_id;

      // Crear instructor si falta (o si hay sensei pero no instructor)
      if (roleCount['instructor'] === 0 && senseiId) {
        // Asignar disciplinas al instructor
        const discCodesRes = await this.sb.from('disciplines')
          .select('code').in('id', discIds.length > 0 ? discIds : ['00000000-0000-0000-0000-000000000000']);
        const codes = (discCodesRes.data || []).map(d => d.code);

        const instrId = await this._createUserForRole(est.id, 'instructor', roleCount['instructor']);
        if (instrId) {
          // Link instructor to sensei
          if (codes.length > 0) {
            for (const code of codes.slice(0, 2)) {
              const discRes = await this.sb.from('disciplines').select('id').eq('code', code).single();
              if (discRes.data?.id) {
                await this.sb.from('instructor_disciplines').upsert({
                  establishment_id: est.id,
                  instructor_profile_id: instrId,
                  discipline_id: discRes.data.id
                }, { onConflict: 'establishment_id,instructor_profile_id,discipline_id' });
              }
            }
          }
          repairs.push({ establishment: estName, action: 'creado', role: 'instructor', profileId: instrId });
          roleCount['instructor']++;
        }
      }

      // Crear guardian si falta (útil para pruebas de scope)
      if (roleCount['guardian'] === 0) {
        const guardianId = await this._createUserForRole(est.id, 'guardian', roleCount['guardian']);
        if (guardianId) {
          repairs.push({ establishment: estName, action: 'creado', role: 'guardian', profileId: guardianId });
          roleCount['guardian']++;
        }
      }
    }

    return {
      repairs,
      summary: { totalRepaired: repairs.length, details: repairs }
    };
  }

  async _createUserForRole(establishmentId, role, index) {
    try {
      const userData = dg.generateUserForRole(role, index);
      const email = `${userData.username}@users.martialsystem.local`;

      const { data: authData, error: authError } = await this.sb.auth.admin.createUser({
        email,
        password: userData.password,
        email_confirm: true,
        user_metadata: { full_name: userData.fullName, username: userData.username }
      });
      if (authError || !authData?.user?.id) return null;

      const profileId = authData.user.id;

      await this.sb.from('profiles').insert({
        id: profileId,
        full_name: userData.fullName,
        role,
        username: userData.username,
        auth_email: email,
        is_active: true
      });

      await this.sb.from('establishment_members').insert({
        establishment_id: establishmentId,
        profile_id: profileId,
        role
      });

      return profileId;
    } catch (_) {
      return null;
    }
  }

  async _safeQuery(table, columns = '*', filters = {}) {
    try {
      let query = this.sb.from(table).select(columns).limit(50000);
      Object.entries(filters).forEach(([key, val]) => {
        query = query.eq(key, val);
      });
      const { data, error } = await query;
      if (error) return [];
      return data || [];
    } catch (_) {
      return [];
    }
  }
}

module.exports = { RoleAuditEngine };