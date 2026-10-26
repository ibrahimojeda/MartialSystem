// server/ai-security.js
// Funciones PURAS de seguridad del asistente IA (sin E/S, sin Supabase, sin red).
// Se usan desde server/index.js y se testean en tests/ai-security.test.js.

const AI_PROVIDERS = {
  openai:   { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
  gemini:   { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-3.6-flash' },
  custom:   { label: 'Custom (OpenAI-compatible)', baseUrl: '', defaultModel: '' }
};

const AI_TOOLS = {
  students:      { label: 'Alumnos',        formId: 'student-form',           read: ['superadmin','owner','admin','sensei','instructor','student','guardian'], write: ['superadmin','owner','admin','sensei','instructor'], delete: ['superadmin','owner','admin'] },
  classes:       { label: 'Clases',         formId: 'class-form',             read: ['superadmin','owner','admin','sensei','instructor'],                 write: ['superadmin','owner','admin','sensei','instructor'], delete: ['superadmin','owner','admin','sensei'] },
  payments:      { label: 'Pagos',          formId: 'payment-form',           read: ['superadmin','owner','admin','sensei','instructor','student','guardian'], write: ['superadmin','owner','admin'], delete: ['superadmin','owner','admin'] },
  notifications: { label: 'Notificaciones', formId: 'notification-form',      read: ['superadmin','owner','admin','sensei','instructor'],                 write: ['superadmin','owner','admin','sensei','instructor'], delete: [] },
  billing:       { label: 'Mensualidades/Facturas', formId: 'billing-form',   read: ['superadmin','owner','admin'],                                        write: [], delete: [] },
  charges:       { label: 'Cargos/Cuotas',        formId: 'charge-form',      read: ['superadmin','owner','admin','sensei','instructor','student','guardian'], write: ['superadmin','owner','admin'], delete: [] },
  users:         { label: 'Usuarios',       formId: 'admin-create-user-form', read: ['superadmin','owner','sensei'],                                       write: ['superadmin','owner','sensei'], delete: [] }
};

function aiToolAllowed(tool, role, mode) {
  const def = AI_TOOLS[tool];
  if (!def) return false;
  if (mode === 'read') return def.read.includes(role);
  if (mode === 'write') return def.write.includes(role);
  if (mode === 'delete') return def.delete.includes(role);
  return false;
}

// Detecta la intención del mensaje: lectura (read_*), escritura (write) o charla.
function aiDetectIntent(message) {
  const text = String(message || '').toLowerCase().trim();
  const readWords = /revisa|revisar|busca|buscar|muestra|mostrar|consulta|consultar|lista|listar|mira|mirar|cu[aá]les|qui[eé]nes|[úu]ltim|historial|cu[aá]ntos/.test(text);
  const writeWords = /crear|crea|registrar|registra|agregar|agrega|guardar|guarda|ingresar|cobra|cobrar|editar|actualizar/.test(text);
  if (writeWords && !readWords) return 'write';
  if (/(dojo|academia|establecimiento|dueñ|propietario|plataforma|martialsystem|sistema|moros).*(deben|debe|deuda|vencid|atrasad|factura|mensualidad|cuota|saldo|pendiente|moros)|(deuda|factura|mensualidad|cuota de la plataforma).*(dojo|academia|plataforma|sistema)/.test(text)) return 'read_billing';
  if (/alumno|alumnos|estudiante|estudiantes/.test(text) && /mensualidad|cargo|cargos|cuota|cuotas|vencid|atrasad|ad[eu]dan/.test(text)) return 'read_charges';
  if (/pago|pagos|cobro|cobros|monto|importe|fecha de pago|pagaron|deben|adeudan/.test(text)) return 'read_payments';
  if (/alumno|alumnos|estudiante|estudiantes/.test(text)) return 'read_students';
  if (/clase|clases|horario|horarios|agenda/.test(text)) return 'read_classes';
  if (/usuario|usuarios|rol|roles|instructor|sensei|owner/.test(text)) return 'read_users';
  return 'chat';
}

// Extrae parámetros de búsqueda determinísticos desde lenguaje natural (sin llamar a la IA).
function aiExtractSearchParams(message, tool) {
  const text = String(message || '').toLowerCase();
  const params = { limit: 80 };
  if (tool === 'payments') {
    if (/monto\s+(superior|mayor)\s+a\s+cero|mayor\s+que\s+cero|amount\s*>\s*0|cualquier\s+monto\s+superior\s+a\s+0|superior\s+a\s+cero|m[aá]s\s+de\s+0/.test(text)) {
      params.amountMin = 0;
    }
    if (/[úu]ltim[oa].*(pago|pagos|fecha)|fecha[s]?\s+de\s+pagos?|[úu]ltimos?\s+pagos?|cada\s+alumno/.test(text)) {
      params.latestPerStudent = true;
    }
    const m = text.match(/(?:[úu]ltimos?)\s+(\d+)/);
    if (m) params.limit = Math.min(Math.max(Number(m[1]), 1), 80);
  }
  return params;
}

// Construye una intención estructurada determinística (fallback sin IA y base para validar).
function buildAIIntent(message) {
  const text = String(message || '').toLowerCase().trim();
  const base = aiDetectIntent(message);
  const out = { intent: 'chat', domain: 'unknown', operation: 'explain', filters: {}, data: {}, scope: 'current_establishment', needs_confirmation: false, missing: [], confidence: 0.9 };

  if (/haz\s+algo|no\s+s[eé]\s+qu[eé]\s+hacer|algo\s+con/.test(text) && base === 'chat') {
    out.intent = 'clarify'; out.domain = 'unknown'; out.operation = 'unknown'; out.missing = ['acción']; out.confidence = 0.4; return out;
  }

  if (base === 'write') {
    out.intent = 'write'; out.needs_confirmation = true;
    if (/pago|pagos|cobro|cobros|monto|importe/.test(text)) { out.domain = 'payments'; out.operation = 'create'; }
    else if (/alumno|alumnos|estudiante|estudiantes/.test(text)) { out.domain = 'students'; out.operation = 'create'; out.missing = ['full_name', 'discipline']; }
    else if (/usuario|usuarios|instructor|sensei|owner/.test(text)) { out.domain = 'users'; out.operation = 'create'; out.missing = ['full_name', 'username', 'role']; }
    else if (/clase|clases/.test(text)) { out.domain = 'classes'; out.operation = 'create'; }
    else { out.intent = 'clarify'; out.domain = 'unknown'; out.operation = 'unknown'; out.needs_confirmation = false; out.missing = ['acción']; out.confidence = 0.5; }
    return out;
  }

  if (base === 'read_payments' || base === 'read_students' || base === 'read_classes' || base === 'read_users' || base === 'read_billing' || base === 'read_charges') {
    out.intent = 'read';
    out.domain = base.slice(5);
    const sem = normalizeAISemantics(text);
    Object.assign(out.filters, sem.filters);
    out.operation = (out.domain === 'payments') ? (sem.operation || 'list') : 'list';
    return out;
  }

  if (/mensualidad|mensualidades|factura|facturas|billing/.test(text)) {
    out.intent = 'read'; out.domain = 'billing'; out.operation = 'list'; return out;
  }

  return out;
}

// Normaliza filtros y operación desde lenguaje natural.
function normalizeAISemantics(message) {
  const text = String(message || '').toLowerCase();
  const out = { filters: {}, operation: null };
  if (/mayor\s+a\s+0|superior\s+a\s+0|m[aá]s\s+de\s+cero|amount\s*>\s*0|cualquier\s+pago\s+positivo|monto\s+(superior|mayor)\s+a\s+cero/.test(text)) {
    out.filters.amount = { operator: '>', value: 0 };
  }
  if (/[úu]ltim[oa].*(pago|pagos|fecha)|fecha[s]?\s+de\s+pagos?|[úu]ltimos?\s+pagos?|cu[aá]ndo\s+pag[oó]\s+cada\s+alumno|cada\s+alumno/.test(text)) {
    out.operation = 'latest_per_student';
  }
  return out;
}

// Valida la intención estructurada contra el contexto (rol/establecimiento).
function validateAIIntent(intent, ctx) {
  const errors = [];
  const allowedIntents = ['read', 'write', 'delete', 'chat', 'clarify'];
  const allowedDomains = ['students', 'payments', 'classes', 'users', 'billing', 'attendance', 'notifications', 'reports', 'unknown'];
  if (!intent || typeof intent !== 'object') return { ok: false, errors: ['intención inválida'] };
  if (!allowedIntents.includes(intent.intent)) errors.push('intent no permitido: ' + intent.intent);
  if (!allowedDomains.includes(intent.domain)) errors.push('domain no permitido: ' + intent.domain);
  const conf = Number(intent.confidence);
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) errors.push('confidence inválido');
  if (intent.scope === 'global' && !(ctx && ctx.isSuperadmin)) errors.push('scope global no permitido');
  if (intent.filters && intent.filters.establishmentId && ctx && !ctx.isSuperadmin && intent.filters.establishmentId !== ctx.establishmentId) errors.push('establishmentId ajeno');
  if (intent.intent === 'write' && !intent.needs_confirmation) errors.push('escritura requiere confirmación');
  if (intent.filters && intent.filters.amount && !Number.isFinite(Number(intent.filters.amount.value))) errors.push('amount no numérico');
  if (intent.filters && intent.filters.limit !== undefined && (Number(intent.filters.limit) < 1 || Number(intent.filters.limit) > 80)) errors.push('limit fuera de rango');
  return { ok: errors.length === 0, errors, intent };
}

// Decide si una intención local requiere interpretación adicional por el modelo.
function needsModelInterpretation(intent, message) {
  const text = String(message || '').toLowerCase();
  if (!intent) return true;
  if (intent.intent === 'chat') return false; // conversación simple, sin interpretación
  if (intent.intent === 'clarify' || intent.intent === 'unknown') return true;
  if (!intent.domain || intent.domain === 'unknown') return true;
  const conf = Number(intent.confidence);
  if (!Number.isFinite(conf) || conf < 0.70) return true;
  if (/(ellos|ellas|ese|esa|aqu[eé]l|aquella|lo anterior|el anterior|la anterior)/.test(text)) return true;
  return false;
}

// Parsea la salida JSON del modelo de interpretación y rechaza valores inválidos/peligrosos.
function parseStructuredAIIntent(raw) {
  if (!raw) return null;
  let cleaned = String(raw).trim();
  if (cleaned.length > 4000) return null;
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) cleaned = m[0];
  let obj;
  try { obj = JSON.parse(cleaned); } catch (_) { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const allowedFields = ['intent', 'domain', 'operation', 'filters', 'data', 'scope', 'needs_confirmation', 'missing', 'confidence'];
  for (const k of Object.keys(obj)) if (!allowedFields.includes(k)) return null;

  const ALLOWED_INTENTS = ['read', 'write', 'delete', 'chat', 'clarify'];
  const ALLOWED_DOMAINS = ['students', 'payments', 'classes', 'users', 'billing', 'attendance', 'notifications', 'reports', 'unknown'];
  const ALLOWED_OPERATIONS = ['list', 'search', 'count', 'latest_per_student', 'create', 'update', 'delete', 'explain', 'unknown'];
  const ALLOWED_SCOPES = ['current_establishment', 'own_records', 'global'];

  if (!ALLOWED_INTENTS.includes(obj.intent)) return null;
  if (!ALLOWED_DOMAINS.includes(obj.domain)) return null;
  if (!ALLOWED_OPERATIONS.includes(obj.operation)) return null;
  if (!ALLOWED_SCOPES.includes(obj.scope)) return null;

  const conf = Number(obj.confidence);
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) return null;
  if (typeof obj.needs_confirmation !== 'boolean') return null;
  if (obj.filters !== undefined && (typeof obj.filters !== 'object' || Array.isArray(obj.filters) || obj.filters === null)) return null;
  if (obj.data !== undefined && (typeof obj.data !== 'object' || Array.isArray(obj.data) || obj.data === null)) return null;
  if (obj.missing !== undefined && !Array.isArray(obj.missing)) return null;

  // Rechazar prototipos, strings largos, anidados y contenido ejecutable en filters/data/missing.
  for (const section of [obj.filters, obj.data, obj.missing]) {
    if (!section) continue;
    for (const k of Object.keys(section)) {
      if (/__proto__|constructor|prototype/.test(k)) return null;
      const v = section[k];
      if (typeof v === 'string') {
        if (v.length > 200) return null;
        if (/https?:\/\/|javascript:|<\s*script|\b(select|drop|truncate|alter|union)\b\s|--/i.test(v)) return null;
      } else if (v && typeof v === 'object') {
        return null; // no anidados
      }
    }
  }

  return obj;
}

// Formatea una respuesta determinística legible (sin llamar al modelo).
function formatDeterministicAIResult(intent, rows, ctx) {
  const domain = (intent && intent.domain) || 'unknown';
  const n = (rows && rows.length) || 0;
  if (!n) {
    const label = { students: 'alumnos', payments: 'pagos', classes: 'clases', users: 'usuarios', billing: 'facturas' }[domain] || 'resultados';
    return 'No encontré ' + label + ' dentro de tu alcance autorizado.';
  }
  if (domain === 'payments') {
    const lines = rows.slice(0, 10).map(r => {
      const name = r.student_name || r.full_name || 'Alumno';
      const date = r.paid_at ? String(r.paid_at).slice(0, 10) : '—';
      const amount = r.amount !== undefined ? '$' + Number(r.amount).toLocaleString() : '';
      const concept = r.concept ? ' — ' + r.concept : '';
      return '- ' + name + ' — ' + date + ' — ' + amount + concept;
    }).join('\n');
    return 'Encontré los últimos pagos:\n' + lines;
  }
  if (domain === 'students') {
    const lines = rows.slice(0, 10).map(r => '- ' + (r.full_name || 'Alumno') + (r.discipline_name ? ' — ' + r.discipline_name : '')).join('\n');
    return 'Encontré ' + n + ' alumnos:\n' + lines;
  }
  if (domain === 'classes') {
    const lines = rows.slice(0, 10).map(r => '- ' + (r.title || 'Clase') + (r.scheduled_date ? ' — ' + r.scheduled_date : '')).join('\n');
    return 'Encontré ' + n + ' clases:\n' + lines;
  }
  const lines = rows.slice(0, 10).map(r => '- ' + (r.full_name || r.title || r.username || 'Registro')).join('\n');
  return 'Encontré ' + n + ' resultados:\n' + lines;
}

// Detecta consultas de CONTEO determinísticas ("¿cuántos...?") para resolverlas en
// backend sin enviar listados al modelo ni llamar al proveedor de IA.
// Devuelve { tool, kind, filters } o null si no es una consulta de conteo.
function aiDetectCountQuery(message) {
  const text = String(message || '').toLowerCase().trim();
  if (!/cu[aá]nt[oa]s?|n[uú]mero\s+de|total\s+de|cantidad\s+de/.test(text)) return null;

  const hasStudents = /alumno|alumnos|estudiante|estudiantes/.test(text);
  const hasPayments = /pago|pagos|pagaron|pag[aó]|cobro|cobros/.test(text);
  const hasClasses = /clase|clases/.test(text);
  const hasBilling = /mensualidad|mensualidades|factura|facturas|billing/.test(text);
  const hasDojoDebt = /dojo|academia|establecimiento|dueñ|propietario|plataforma|martialsystem|sistema|moros/.test(text);

  // PRIORIDAD SEMÁNTICA: deuda de dojos/academias → system_usage_bills (antes que payments/students/charges).
  if (hasDojoDebt && /deben|debe|deuda|vencid|atrasad|factura|mensualidad|cuota|saldo|adeudan|pendiente|moros/.test(text)) {
    const overdue = /vencid|atrasad|moros/.test(text);
    if (overdue) return { tool: 'billing', kind: 'overdue_establishments', filters: { status: ['overdue'] } };
    if (/pendiente|pendientes/.test(text)) return { tool: 'billing', kind: 'pending_establishments', filters: { status: ['pending'] } };
    return { tool: 'billing', kind: 'summary', filters: { status: ['pending', 'overdue'] } };
  }

  // ALUMNOS con obligaciones vencidas/cargos → student_charges (NO payments).
  if (hasStudents && /vencid|atrasad|cargo|cargos|cuota|cuotas|mensualidad|ad[eu]dan/.test(text)) {
    return { tool: 'charges', kind: 'total', filters: { status: /vencid|atrasad/.test(text) ? 'overdue' : 'pending' } };
  }

  // "¿Cuántos alumnos pagaron más de 0?" → alumnos únicos con al menos un pago > 0.
  if (hasStudents && hasPayments) {
    return { tool: 'payments', kind: 'unique_students', filters: { amountMin: 0, amountMax: null, period: null, date: null } };
  }

  if (hasPayments) {
    const filters = { amountMin: null, amountMax: null, period: null, date: null };
    if (/mayor\s+a\s+0|superior\s+a\s+0|m[aá]s\s+de\s+cero|mayores?\s+a\s+cero|positivos?/.test(text)) filters.amountMin = 0;
    if (/este\s+mes/.test(text)) filters.period = 'this_month';
    else if (/hoy/.test(text)) filters.date = 'today';
    else if (/ma[nñ]ana/.test(text)) filters.date = 'tomorrow';
    return { tool: 'payments', kind: 'total', filters };
  }

  if (hasClasses) {
    const filters = { period: null, date: null };
    if (/ma[nñ]ana/.test(text)) filters.date = 'tomorrow';
    else if (/hoy/.test(text)) filters.date = 'today';
    return { tool: 'classes', kind: 'total', filters };
  }

  if (hasStudents) {
    return { tool: 'students', kind: 'total', filters: {} };
  }

  if (hasBilling) {
    return { tool: 'billing', kind: 'total', filters: {} };
  }

  if (/cargo|cargos|cuota|cuotas|ad[eu]dan|deben\s+(?:este\s+mes|dinero)|vencid[oa]s?|atrasad[oa]s?/.test(text)) {
    return { tool: 'charges', kind: 'total', filters: { status: /vencid|atrasad/.test(text) ? 'overdue' : 'pending' } };
  }

  if (/instructor|instructores|profesor|profesores|maestro|maestros/.test(text)) {
    return { tool: 'users', kind: 'total', filters: { role: 'instructor' } };
  }
  if (/sensei|senseis/.test(text)) {
    return { tool: 'users', kind: 'total', filters: { role: 'sensei' } };
  }
  if (/usuario|usuarios/.test(text)) {
    return { tool: 'users', kind: 'total', filters: {} };
  }

  return null;
}

// Formatea una respuesta determinística de conteo (sin llamar al modelo).
function formatCountResult(query, result) {
  const n = Math.max(0, Number(result && result.count) || 0);
  const tool = (query && query.tool) || 'students';
  const kind = (query && query.kind) || 'total';
  const filters = (query && query.filters) || {};
  const tp = filters.period === 'this_month' ? ' este mes'
    : filters.date === 'tomorrow' ? ' para mañana'
    : filters.date === 'today' ? ' para hoy' : '';

  if (tool === 'payments' && kind === 'unique_students') {
    return n === 0
      ? 'No encontré alumnos con pagos superiores a 0 dentro de tu alcance autorizado.'
      : 'Encontré ' + n + (n === 1 ? ' alumno' : ' alumnos') + ' con al menos un pago superior a 0.';
  }
  if (tool === 'payments') {
    return n === 0
      ? 'No encontré pagos' + tp + ' dentro de tu alcance autorizado.'
      : 'Encontré ' + n + (n === 1 ? ' pago' : ' pagos') + ' registrado' + (n === 1 ? '' : 's') + tp + '.';
  }
  if (tool === 'classes') {
    return n === 0
      ? 'No encontré clases programadas' + tp + ' dentro de tu alcance autorizado.'
      : 'Hay ' + n + (n === 1 ? ' clase' : ' clases') + ' programada' + (n === 1 ? '' : 's') + tp + '.';
  }
  if (tool === 'students') {
    return n === 0
      ? 'No encontré alumnos dentro de tu alcance autorizado.'
      : 'Encontré ' + n + (n === 1 ? ' alumno' : ' alumnos') + ' en tu dojo.';
  }
  if (tool === 'billing') {
    if (kind === 'overdue_establishments') {
      return n === 0
        ? 'No encontré dojos con facturas vencidas dentro de tu alcance autorizado.'
        : 'Hay ' + n + (n === 1 ? ' dojo' : ' dojos') + ' con facturas vencidas.';
    }
    if (kind === 'pending_establishments') {
      return n === 0
        ? 'No encontré dojos con facturas pendientes dentro de tu alcance autorizado.'
        : 'Hay ' + n + (n === 1 ? ' dojo' : ' dojos') + ' con facturas pendientes.';
    }
    if (kind === 'summary') {
      const oc = Math.max(0, Number(result && result.overdueCount) || 0);
      const pc = Math.max(0, Number(result && result.pendingCount) || 0);
      if (oc === 0 && pc === 0) return 'No encontré facturas pendientes o vencidas de los dojos dentro de tu alcance autorizado.';
      const parts = [];
      if (oc) parts.push('Hay ' + oc + (oc === 1 ? ' dojo' : ' dojos') + ' con facturas vencidas');
      if (pc) parts.push(pc + (pc === 1 ? ' dojo' : ' dojos') + ' con facturas pendientes');
      let msg = parts.join(' y ') + '.';
      const overdueTotals = (result && result.overdueTotals) || {};
      const curEntries = Object.keys(overdueTotals).filter(c => Number(overdueTotals[c]) > 0);
      if (curEntries.length === 1) {
        msg += ' El saldo vencido total es de ' + formatCurrencyAmount(curEntries[0], overdueTotals[curEntries[0]]) + '.';
      } else if (curEntries.length > 1) {
        msg += ' Saldo vencido: ' + curEntries.map(c => formatCurrencyAmount(c, overdueTotals[c])).join(' · ') + '.';
      }
      return msg;
    }
    return n === 0
      ? 'No encontré facturas dentro de tu alcance autorizado.'
      : 'Encontré ' + n + (n === 1 ? ' factura' : ' facturas') + '.';
  }
  if (tool === 'users') {
    const ulabel = (query && query.filters && query.filters.role === 'instructor') ? 'instructores'
      : (query && query.filters && query.filters.role === 'sensei') ? 'senseis' : 'usuarios';
    return n === 0
      ? 'No encontré ' + ulabel + ' dentro de tu alcance autorizado.'
      : 'Hay ' + n + ' ' + ulabel + '.';
  }
  if (tool === 'charges') {
    const cstatus = (query && query.filters && query.filters.status) || 'pending';
    const clabel = cstatus === 'overdue' ? 'cargos vencidos' : 'cargos pendientes';
    return n === 0
      ? 'No encontré ' + clabel + ' dentro de tu alcance autorizado.'
      : 'Hay ' + n + ' ' + clabel + '.';
  }
  return n === 0
    ? 'No encontré resultados dentro de tu alcance autorizado.'
    : 'Encontré ' + n + (n === 1 ? ' resultado' : ' resultados') + '.';
}

// ─── Consultas detalladas genéricas (listados paginados determinísticos) ───────
// Disciplinas reconocibles en lenguaje natural para filtrar listados.
const DETAILED_LIST_DISCIPLINES = ['karate', 'judo', 'bjj', 'taekwondo', 'kickboxing', 'mma', 'kung fu', 'aikido'];

// Detecta una petición de LISTADO DETALLADO. Devuelve
// { tool, kind:'list', filters, options:{ detailed, paginated, page, pageSize } } o null.
function aiDetectDetailedQuery(message) {
  const text = String(message || '').toLowerCase().trim();
  if (!text) return null;

  const detailedMarkers = /lista\s+detallada|listado\s+detallado|detalle\s+completo|cada\s+(instructor|sensei|alumno|estudiante|usuario|pago|clase|profesor|maestro)|todos\s+los\s+(instructores|senseis|usuarios|pagos|profesores|maestros)|lista\s+completa|nombres\s+y\s+(disciplinas|academias)|relaci[oó]n\s+completa|desglose|informaci[oó]n\s+individual/;
  const hasFilter = new RegExp('de\\s+(' + DETAILED_LIST_DISCIPLINES.join('|') + ')').test(text)
    || /del?\s+(?:dojo|academia|gimnasio)\s+[a-z0-9áéíóúñü]/.test(text);
  const listVerb = /mu[eé]strame|l[ií]stame|quiero\s+(?:ver|la\s+lista)|dame\s+la\s+lista|lista\s+de\b|listado\s+de\b/.test(text);
  const chargesMarkers = /qui[eé]nes\s+(deben|ad[eu]dan|tienen\s+.*vencid)|cargo|cargos|cuota|cuotas|vencid[oa]s?|atrasad[oa]s?/.test(text);

  if (!detailedMarkers.test(text) && !(listVerb && hasFilter) && !chargesMarkers) return null;

  const filters = {};
  let tool = null;

  if (/cargo|cargos|cuota|cuotas|deben|ad[eu]dan|vencid|atrasad|mensualidad\s+vencida/.test(text) && !/instructor|sensei|clase|pago|pagos/.test(text)) {
    tool = 'charges';
    filters.status = /vencid|atrasad/.test(text) ? 'overdue' : 'pending';
  } else if (/instructor|instructores|profesor|profesores|maestro|maestros/.test(text)) { tool = 'users'; filters.role = 'instructor'; }
  else if (/sensei|senseis/.test(text)) { tool = 'users'; filters.role = 'sensei'; }
  else if (/pago|pagos/.test(text)) { tool = 'payments'; }
  else if (/clase|clases|horario|horarios/.test(text)) { tool = 'classes'; }
  else if (/mensualidad|mensualidades|factura|facturas|billing/.test(text)) { tool = 'billing'; }
  else if (/alumno|alumnos|estudiante|estudiantes/.test(text)) { tool = 'students'; }
  else if (/usuario|usuarios/.test(text)) { tool = 'users'; }

  if (!tool) return null;

  const discMatch = text.match(new RegExp('de\\s+(' + DETAILED_LIST_DISCIPLINES.join('|') + ')'));
  if (discMatch) filters.disciplineCode = discMatch[1];

  const estMatch = text.match(/del?\s+(?:dojo|academia|gimnasio)\s+([a-z0-9áéíóúñü\s]+?)(?:\s*(?:por\s+favor|$|,|\?|\.))/);
  if (estMatch) filters.establishmentName = estMatch[1].trim();

  return { tool, kind: 'list', filters, options: { detailed: true, paginated: true, page: 1, pageSize: 25 } };
}

// Detecta una petición de paginación conversacional ("siguiente página").
function isPaginationRequest(message) {
  const text = String(message || '').toLowerCase().trim();
  if (!text) return false;
  return /^(siguiente|ver\s+m[aá]s|mu[eé]strame\s+m[aá]s|contin[uú]a|dame\s+m[aá]s|m[aá]s\s+resultados)/.test(text)
    || /siguiente\s+p[aá]gina|p[aá]gina\s+siguiente/.test(text);
}

// Formatea un listado detallado de forma determinística (sin llamar al modelo).
function formatDetailedListResult(listRes, query, ctx) {
  const meta = (listRes && listRes.meta) || {};
  const rows = (listRes && listRes.rows) || [];
  const total = (meta.total === null || meta.total === undefined) ? null : meta.total;
  const page = meta.page || 1;
  const totalPages = meta.totalPages || 0;
  const domain = (query && query.tool) || meta.domain || 'users';
  const role = (query && query.filters && query.filters.role) || null;

  const label = role === 'instructor' ? 'instructores'
    : role === 'sensei' ? 'senseis'
    : { students: 'alumnos', payments: 'pagos', classes: 'clases', billing: 'facturas', charges: 'cargos', users: 'usuarios' }[domain] || 'registros';

  if (!rows.length) {
    return 'No encontré ' + label + ' dentro de tu alcance autorizado.';
  }

  const header = total != null
    ? 'Encontré ' + total + ' ' + label + '. Mostrando ' + rows.length + ' de ' + total + ', página ' + page + ' de ' + totalPages + '.'
    : 'Mostrando ' + rows.length + ' ' + label + ' (página ' + page + ').';

  const body = rows.map((r, i) => formatDetailedRow(r, domain, i)).join('\n\n');
  const footer = (meta.hasNextPage ? 'Escribe "siguiente página" para ver más ' + label + '.' : 'Fin de la lista.')
    + ' También puedes filtrar por academia, disciplina o nombre.';

  return header + '\n\n' + body + '\n\n' + footer;
}

function formatDetailedRow(r, domain, idx) {
  const name = r.full_name || r.student_name || r.title || r.username || 'Registro';
  const lines = [(idx + 1) + '. ' + name];
  if (r.establishment_name) lines.push('   Academia: ' + r.establishment_name);
  if (Array.isArray(r.disciplines) && r.disciplines.length) lines.push('   Disciplinas: ' + r.disciplines.join(', '));
  else if (r.discipline_name) lines.push('   Disciplina: ' + r.discipline_name);
  if (r.is_active !== undefined && r.is_active !== null) lines.push('   Estado: ' + (r.is_active ? 'Activo' : 'Inactivo'));
  if (r.username && r.username !== name) lines.push('   Usuario: ' + r.username);
  if (r.email) lines.push('   Email: ' + r.email);
  if (r.phone) lines.push('   Teléfono: ' + r.phone);
  if (r.current_rank) lines.push('   Rango: ' + r.current_rank);
  if (r.status && r.status !== r.is_active) lines.push('   Estado: ' + r.status);
  if (r.description) lines.push('   Concepto: ' + r.description);
  if (r.period_key) lines.push('   Periodo: ' + r.period_key);
  if (r.amount !== undefined && r.amount !== null) lines.push('   Monto: $' + Number(r.amount).toLocaleString());
  if (r.paid_at) lines.push('   Fecha: ' + String(r.paid_at).slice(0, 10));
  if (r.concept) lines.push('   Concepto: ' + r.concept);
  if (r.remaining_amount !== undefined && r.remaining_amount !== null) lines.push('   Saldo pendiente: $' + Number(r.remaining_amount).toLocaleString());
  if (r.due_date) lines.push('   Vence: ' + String(r.due_date).slice(0, 10));
  if (r.scheduled_date) lines.push('   Fecha: ' + String(r.scheduled_date).slice(0, 10));
  if (r.start_time && r.end_time) lines.push('   Horario: ' + r.start_time + ' – ' + r.end_time);
  if (r.location) lines.push('   Lugar: ' + r.location);
  return lines.join('\n');
}

function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  const b = buffer;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

const AI_TOOL_PARAM_LIMITS = { string: 200, arrayItems: 40, params: 20 };
// Parser ESTRICTO de bloques <<<TOOL>>>: esquema + límites + rechazo de payloads inválidos.
function aiParseToolBlock(raw) {
  if (!raw) return null;
  const cleaned = String(raw).trim();
  if (!cleaned.startsWith('{') || !cleaned.endsWith('}')) return null;
  let obj;
  try { obj = JSON.parse(cleaned); } catch (_) { return null; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  const tool = obj.tool;
  if (typeof tool !== 'string' || !tool || tool.length > 40) return null;
  if (!AI_TOOLS[String(tool).toLowerCase()]) return null;

  const params = obj.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const keys = Object.keys(params);
  if (keys.length > AI_TOOL_PARAM_LIMITS.params) return null;

  const safeParams = {};
  for (const k of keys) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') return null;
    if (!/^[A-Za-z0-9_]{1,40}$/.test(k)) return null;
    const v = params[k];
    if (v === null || v === undefined) continue;
    const t = typeof v;
    if (t === 'string') {
      if (v.length > AI_TOOL_PARAM_LIMITS.string) return null;
      safeParams[k] = v;
    } else if (t === 'number' || t === 'boolean') {
      safeParams[k] = v;
    } else if (Array.isArray(v)) {
      if (v.length > 20) return null;
      if (!v.every(x => typeof x === 'string' && x.length <= AI_TOOL_PARAM_LIMITS.arrayItems)) return null;
      safeParams[k] = v;
    } else {
      return null;
    }
  }
  if (typeof safeParams.limit === 'number') {
    safeParams.limit = Math.max(1, Math.min(80, Math.floor(safeParams.limit)));
  }
  return { tool: String(tool).toLowerCase(), params: safeParams };
}

// Bloquea SSRF: solo https; rechaza loopback, IPs privadas, link-local y metadata.
function isSSRFUnsafeUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (_) { return true; }
  if (u.protocol !== 'https:') return true;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === '::') return true;
  if (/^169\.254\./.test(host) || /^fe80:/i.test(host)) return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return true;
  if (host === 'metadata' || host === 'metadata.google.internal' || host.endsWith('.internal') || host.endsWith('.local')) return true;
  return false;
}

function aiSanitizeBaseUrl(v, prev) {
  const s = String((v !== undefined && v !== null) ? v : (prev || '')).trim();
  if (!/^https?:\/\//i.test(s)) return '';
  if (isSSRFUnsafeUrl(s)) return '';
  return s;
}

function aiSanitizeModel(v, prev) {
  const s = String((v !== undefined && v !== null) ? v : (prev || '')).trim();
  if (!s || /:\/\//.test(s)) return '';
  return s;
}

// Gating por plan fail-closed. sb = cliente Supabase inyectado.
async function hasAIFeatureWith(sb, establishmentId) {
  if (!establishmentId || establishmentId === 'superadmin') return true;
  try {
    const { data: ep } = await sb
      .from('establishment_plans').select('plan_code').eq('establishment_id', establishmentId).maybeSingle();
    if (!ep || !ep.plan_code) return false;
    const { data: sp } = await sb
      .from('system_plans').select('features').eq('code', ep.plan_code).maybeSingle();
    const feats = (sp && sp.features) || [];
    return Array.isArray(feats) && feats.includes('ia_features');
  } catch (_) { return false; }
}

// Decisión de bloqueo por factura vencida (>=15 días).
function shouldBlockBilling(bill, nowMs) {
  if (!bill) return false;
  if (bill.status === 'confirmed' || bill.status === 'waived') return false;
  const due = new Date(bill.due_date).getTime();
  if (!Number.isFinite(due)) return false;
  const daysOverdue = Math.max(0, Math.floor((nowMs - due) / 86400000));
  return daysOverdue >= 15;
}

// Presupuesto global: bloquea si el costo estimado supera el límite configurado.
function isOverBudget(totals, budgetUsd) {
  const budget = Number(budgetUsd);
  if (!Number.isFinite(budget) || budget <= 0) return false;
  const est = Number((totals && totals.estCost) || 0);
  return est > budget;
}

// Failover puro: prueba proveedores en orden; devuelve el primero que responde.
async function aiFailoverWith(providers, requestFn, labelFor) {
  if (!providers || !providers.length) throw new Error('AI no configurada. El superadmin debe colocar el API key en Configuración → IA.');
  const errors = [];
  for (const p of providers) {
    try {
      const res = await requestFn(p);
      if (!res || !String(res.content || '').trim()) { const e = new Error('AI_EMPTY_RESPONSE'); e.status = 502; e.code = 'AI_EMPTY_RESPONSE'; throw e; }
      const label = labelFor ? labelFor(p) : (p.provider || p.id || 'IA');
      return { content: res.content, model: res.model, baseUrl: res.baseUrl, providerId: p.id || p.provider || 'p1', providerLabel: label };
    } catch (err) {
      const label = labelFor ? labelFor(p) : (p.provider || p.id || 'IA');
      errors.push(label + ': ' + (err.message || ''));
    }
  }
  const e = new Error((providers.length > 1 ? 'Todas las IAs fallaron. ' : '') + (errors[errors.length - 1] || 'sin detalles'));
  e.status = 502;
  e.providerErrors = errors;
  throw e;
}

// ─── Identidad del usuario autenticado (determinística, sin modelo ni búsqueda) ───
function aiDetectIdentityQuery(message) {
  const text = String(message || '').toLowerCase().trim();
  if (/qu[eé] usuario soy|qui[eé]n soy|cu[aá]l es mi rol|qu[eé] rol tengo|cu[aá]l es mi usuario|mi identidad|qu[eé] cuenta est[aá] conectada|qu[eé] cuenta soy|cu[aá]l es mi nombre/.test(text)) {
    return { intent: 'read', domain: 'identity', operation: 'current_user', filters: {}, detailed: false, confidence: 1 };
  }
  return null;
}

function getCurrentUserIdentity(ctx) {
  return {
    profileId: (ctx && ctx.profileId) || null,
    username: (ctx && ctx.username) || '',
    fullName: (ctx && ctx.fullName) || '',
    role: (ctx && ctx.role) || '',
    establishmentId: (ctx && ctx.establishmentId) || null
  };
}

function formatIdentityResult(identity) {
  const role = String((identity && identity.role) || '').toLowerCase();
  const name = String((identity && identity.fullName) || '').trim();
  const username = String((identity && identity.username) || '').trim();
  const displayName = name || username || 'usuario';
  if (role === 'superadmin') {
    return 'Eres ' + displayName + ', con rol Superadmin. Tienes acceso administrativo global.';
  }
  const parts = ['Eres ' + displayName];
  if (username && username.toLowerCase() !== displayName.toLowerCase()) parts.push('usuario ' + username);
  if (role) parts.push('con rol ' + role);
  return parts.join(', ') + '.';
}

// Alcance de acceso a la facturación del sistema (system_usage_bills).
function systemBillingScope(ctx) {
  const role = String((ctx && ctx.role) || '').toLowerCase();
  if (role === 'superadmin') return 'all';
  if (role === 'owner' || role === 'admin') return 'own';
  return 'none';
}

// Formatea un importe con su moneda real (nunca "$" genérico).
function formatCurrencyAmount(cur, amount) {
  const c = String(cur || 'USD').toUpperCase();
  const amt = Number(amount) || 0;
  let s;
  try { s = amt.toLocaleString('es-AR', { maximumFractionDigits: 2 }); } catch (_) { s = String(amt); }
  return c + ' ' + s;
}

// Formatea el resumen de deuda de una academia específica.
function formatEstablishmentBilling(name, pendingCount, overdueCount, totals, oldestOverdue) {
  const n = (Number(pendingCount) || 0) + (Number(overdueCount) || 0);
  if (n === 0) return name + ' no tiene facturas pendientes ni vencidas.';
  const curEntries = Object.keys(totals || {}).filter(c => Number(totals[c]) > 0);
  let msg = name + ' tiene ' + n + (n === 1 ? ' factura' : ' facturas');
  if (Number(overdueCount) > 0) msg += ' (' + overdueCount + ' vencida' + (overdueCount === 1 ? '' : 's') + ')';
  if (curEntries.length) msg += ' por un total de ' + curEntries.map(c => formatCurrencyAmount(c, totals[c])).join(' · ');
  msg += '.';
  if (oldestOverdue && oldestOverdue.billing_month && oldestOverdue.due_date) {
    msg += ' La factura vencida más antigua corresponde a ' + oldestOverdue.billing_month + ' y venció el ' + oldestOverdue.due_date + '.';
  }
  return msg;
}

module.exports = {
  AI_PROVIDERS, AI_TOOLS, aiToolAllowed, detectImageType, aiParseToolBlock,
  isSSRFUnsafeUrl, aiSanitizeBaseUrl, aiSanitizeModel,
  hasAIFeatureWith, shouldBlockBilling, isOverBudget, aiFailoverWith,
  aiDetectIntent, aiExtractSearchParams, buildAIIntent, normalizeAISemantics, validateAIIntent,
  needsModelInterpretation, parseStructuredAIIntent, formatDeterministicAIResult,
  aiDetectCountQuery, formatCountResult, aiDetectDetailedQuery, isPaginationRequest, formatDetailedListResult,
  aiDetectIdentityQuery, getCurrentUserIdentity, formatIdentityResult, systemBillingScope,
  formatCurrencyAmount, formatEstablishmentBilling
};

