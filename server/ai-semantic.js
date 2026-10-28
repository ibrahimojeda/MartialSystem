// server/ai-semantic.js
// Capa de interpretación semántica (híbrida) del asistente IA.
// Separa etapas: normalización → clasificación local → validación de esquema →
// detección de entidades/referencias → detección de contenido inseguro.
// NO ejecuta SQL, NO toca Supabase y NO llama al modelo por sí sola.

// ── Esquema estricto de intención ──────────────────────────────────────
const INTENT_KINDS = ['read', 'create', 'update', 'delete', 'clarify', 'chat'];
const DOMAINS = ['students', 'profiles', 'users', 'instructors', 'guardians', 'payments', 'student_charges', 'classes', 'system_billing', 'plans'];
const OPERATIONS = ['list', 'detail', 'count', 'summary', 'latest', 'search', 'create', 'update', 'delete', 'mark_overdue', 'apply_payment', 'unknown'];
const SCOPES = ['self', 'linked', 'own', 'global', 'explicit'];

const SCHEMA_KEYS = ['intent', 'domain', 'operation', 'scope', 'entity', 'filters', 'dateRange', 'sort', 'limit', 'page', 'fields', 'groupBy', 'confidence', 'needs_confirmation', 'missing', 'ambiguities'];
const ENTITY_KEYS = ['id', 'name', 'username', 'type'];
const COMPARISON_OPS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'contains'];

// ── Normalización y seguridad ──────────────────────────────────────────
const UNSAFE_PATTERNS = [
  { name: 'url', re: /https?:\/\/|www\./i },
  { name: 'sql', re: /\b(select\b.+\bfrom\b|insert\s+into|drop\s+table|truncate|alter\s+table|union\s+select|delete\s+from|update\b.+\bset\b)/i },
  { name: 'js', re: /<\s*script|javascript:|eval\s*\(|function\s*\(|new\s+Function|=>/i },
  { name: 'injection', re: /ignore\s+(previous|all)\s+instructions|system\s+prompt|you\s+are\s+now|act\s+as\b|jailbreak|developer\s+mode/i }
];

function detectUnsafeContent(text) {
  const s = String(text || '');
  const hits = [];
  for (const p of UNSAFE_PATTERNS) { if (p.re.test(s)) hits.push(p.name); }
  return hits;
}

function isUnsafe(text) { return detectUnsafeContent(text).length > 0; }

function normalizeUserMessage(message) {
  const raw = String(message == null ? '' : message);
  const text = raw.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  const lower = text.toLowerCase();
  return { raw, text, lower, length: text.length, flags: detectUnsafeContent(text) };
}

// ── Clasificador local (híbrido, por dominio + verbo + estado) ─────────
function emptyIntent() {
  return {
    intent: 'read', domain: null, operation: null, scope: null,
    entity: { id: null, name: null, username: null, type: null },
    filters: {}, dateRange: { from: null, to: null, relative: null },
    sort: null, limit: 50, page: 1, fields: [], groupBy: [],
    confidence: 0, needs_confirmation: false, missing: [], ambiguities: []
  };
}

function classifySemanticIntent(message, context) {
  const n = normalizeUserMessage(message);
  const text = n.lower;
  const out = emptyIntent();

  if (isUnsafe(text)) {
    out.intent = 'clarify'; out.confidence = 0.1; out.missing = ['consulta válida'];
    return out;
  }

  // 1) Saludos / charla
  if (/^(hola|buenas|buenos|hey|saludos|gracias|ok|okay|adi[oó]s|buen\s+d[ií]a)\b/.test(text)) {
    out.intent = 'chat'; out.confidence = 0.95; return out;
  }

  // 2) Identidad de sesión
  if (/(qui[eé]n\s+soy|qui[eé]n\s+eres|qu[eé]\s+usuario\s+soy|mi\s+rol|qu[eé]\s+rol\s+tengo)/.test(text)) {
    out.intent = 'read'; out.domain = 'profiles'; out.operation = 'detail'; out.scope = 'self';
    out.entity = { id: null, name: null, username: null, type: 'profile' };
    out.confidence = 0.92; return out;
  }

  // 3) Escrituras (siempre requieren confirmación)
  if (/(crea|crear|registra|registrar|agrega|agregar|nuevo\s+(alumno|pago|usuario)|cambia|cambiar|modifica|actualiza|marca|marcar|asigna)/.test(text)) {
    out.intent = /cambia|cambiar|modifica|actualiza|asigna/.test(text) ? 'update' : 'create';
    out.needs_confirmation = true;
    if (/pago|pagos|cobro|monto|importe/.test(text)) { out.domain = 'payments'; out.operation = 'apply_payment'; }
    else if (/alumno|alumnos|estudiante|estudiantes/.test(text)) { out.domain = 'students'; out.operation = 'create'; }
    else if (/plan|planes|suscripci[oó]n/.test(text)) { out.domain = 'plans'; out.operation = 'update'; }
    else if (/usuario|instructor|sensei|owner/.test(text)) { out.domain = 'profiles'; out.operation = 'create'; }
    else if (/clase|clases/.test(text)) { out.domain = 'classes'; out.operation = 'create'; }
    else { out.intent = 'clarify'; out.missing = ['acción']; out.confidence = 0.4; return out; }
    out.confidence = 0.8; return out;
  }

  // 4) Lectura por dominio (entidad + verbo + estado)
  const d = classifyDomain(text);
  if (d) {
    out.intent = 'read';
    out.domain = d.domain;
    out.operation = detectOperation(text, d.domain);
    out.scope = detectScope(text);
    out.confidence = d.confidence;
    if (d.ambiguity) out.ambiguities.push(d.ambiguity);
    return out;
  }

  // 5) Sin clasificación local → pedir aclaración (o modelo)
  out.intent = 'clarify'; out.domain = null; out.operation = null; out.scope = null;
  out.confidence = 0.3; out.missing = ['intención'];
  return out;
}

function classifyDomain(text) {
  const hasStudent = /alumno|alumnos|estudiante|estudiantes/.test(text);
  const hasDojo = /dojo|academia|academias|establecimiento|establecimientos|plataforma|martialsystem/.test(text);
  const hasOwe = /deben|debe|adeudan|deuda|atrasad|vencid|moros/.test(text);
  const hasUnpaid = /no\s+han?\s+pagado|no\s+pag[oó]|sin\s+pagar|falta\s+de\s+pago/.test(text);
  const hasChargeWord = /mensualidad|mensualidades|cuota|cuotas|cargo|cargos|pendiente/.test(text);
  const hasPlan = /plan|planes|suscripci[oó]n|suscripciones|contratad/.test(text);
  const hasPayment = /pago|pagos|pag[oó]|pagaron|cobro|cobros|abon/.test(text);
  const hasProfile = /usuario|perfil|ficha|persona|instructor|sensei|owner|rol/.test(text);
  const hasClass = /clase|clases|horario|agenda/.test(text);

  // Deuda de dojos hacia MartialSystem (facturación de plataforma).
  if (hasDojo && (hasOwe || /factura|saldo/.test(text))) return { domain: 'system_billing', confidence: 0.9 };
  // Obligaciones de alumnos (explícito o implícito por mensualidad/cuota/pendiente).
  if ((hasStudent || hasChargeWord) && (hasOwe || hasUnpaid || hasChargeWord)) return { domain: 'student_charges', confidence: 0.88 };
  // Planes/suscripciones de los dojos.
  if (hasDojo && hasPlan) return { domain: 'plans', confidence: 0.9 };
  // Pagos realizados.
  if (hasPayment) return { domain: 'payments', confidence: 0.82 };
  // Clases.
  if (hasClass) return { domain: 'classes', confidence: 0.8 };
  // Perfiles/usuarios.
  if (hasProfile) return { domain: 'profiles', confidence: 0.75 };
  // Alumnos genéricos.
  if (hasStudent) return { domain: 'students', confidence: 0.7 };
  return null;
}

function detectOperation(text, domain) {
  if (/cu[aá]ntos|cu[aá]ntas|qu[eé]\s+cantidad|cu[aá]nto\s+debe/.test(text)) return 'count';
  if (/[úu]ltim/.test(text)) return 'latest';
  if (domain === 'profiles' && /resumen|ficha|detalle|informaci[oó]n|perfil/.test(text)) return 'detail';
  if (/resumen|suma|total|agrupad|por\s+cada/.test(text)) return 'summary';
  if (/busca|buscar|encuentra|encontrar|por\s+nombre/.test(text)) return 'search';
  return 'list';
}

function detectScope(text) {
  if (/mi\s+perfil|mi\s+usuario/.test(text)) return 'self';
  if (/mi\s+dojo|mi\s+academia|mi\s+establecimiento|mi\s+clase/.test(text)) return 'own';
  if (/todos\s+los\s+dojos|cada\s+dojo|cada\s+academia|todas\s+las\s+academias|la\s+plataforma|martialsystem/.test(text)) return 'global';
  if (/este\b|ese\b|esta\b|esa\b|ellos|ellas|aquel|aquella|el\s+anterior|la\s+anterior/.test(text)) return 'explicit';
  return 'own';
}

// ── Validación estricta del esquema ────────────────────────────────────
function validateIntentSchema(intent) {
  const errors = [];
  if (!intent || typeof intent !== 'object' || Array.isArray(intent)) return { valid: false, errors: ['intent debe ser un objeto'] };

  for (const k of Object.keys(intent)) if (!SCHEMA_KEYS.includes(k)) errors.push('campo desconocido: ' + k);

  if (!INTENT_KINDS.includes(intent.intent)) errors.push('intent inválido: ' + intent.intent);
  if (intent.domain != null && !DOMAINS.includes(intent.domain)) errors.push('dominio no permitido: ' + intent.domain);
  if (intent.operation != null && !OPERATIONS.includes(intent.operation)) errors.push('operación no soportada: ' + intent.operation);
  if (intent.scope != null && !SCOPES.includes(intent.scope)) errors.push('scope inválido: ' + intent.scope);

  const conf = Number(intent.confidence);
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) errors.push('confidence fuera de 0..1');

  if (typeof intent.needs_confirmation !== 'boolean') errors.push('needs_confirmation debe ser boolean');
  if (intent.missing != null && !Array.isArray(intent.missing)) errors.push('missing debe ser array');
  if (intent.ambiguities != null && !Array.isArray(intent.ambiguities)) errors.push('ambiguities debe ser array');
  if (intent.fields != null && !Array.isArray(intent.fields)) errors.push('fields debe ser array');
  if (intent.groupBy != null && !Array.isArray(intent.groupBy)) errors.push('groupBy debe ser array');
  if (intent.limit != null && (!Number.isInteger(intent.limit) || intent.limit < 1 || intent.limit > 500)) errors.push('limit inválido');
  if (intent.page != null && (!Number.isInteger(intent.page) || intent.page < 1)) errors.push('page inválido');

  if (intent.entity != null) {
    if (typeof intent.entity !== 'object' || Array.isArray(intent.entity)) errors.push('entity debe ser objeto');
    else {
      for (const k of Object.keys(intent.entity)) if (!ENTITY_KEYS.includes(k)) errors.push('campo de entity desconocido: ' + k);
      for (const k of ENTITY_KEYS) if (intent.entity[k] != null && typeof intent.entity[k] !== 'string') errors.push('entity.' + k + ' debe ser string');
    }
  }

  if (intent.filters != null) {
    if (typeof intent.filters !== 'object' || Array.isArray(intent.filters)) errors.push('filters debe ser objeto');
    else errors.push(...validateFilters(intent.filters, 'filters'));
  }

  if (intent.dateRange != null) {
    if (typeof intent.dateRange !== 'object' || Array.isArray(intent.dateRange)) errors.push('dateRange debe ser objeto');
    else for (const k of Object.keys(intent.dateRange)) {
      if (!['from', 'to', 'relative'].includes(k)) errors.push('campo de dateRange desconocido: ' + k);
      else if (intent.dateRange[k] != null && typeof intent.dateRange[k] !== 'string') errors.push('dateRange.' + k + ' debe ser string');
    }
  }

  const scan = (v) => { if (typeof v === 'string' && isUnsafe(v)) errors.push('contenido no permitido detectado'); };
  if (intent.entity) { scan(intent.entity.name); scan(intent.entity.username); scan(intent.entity.id); }
  scan(intent.sort);

  return { valid: errors.length === 0, errors };
}

function validateFilters(filters, path) {
  const errors = [];
  for (const k of Object.keys(filters)) {
    if (/__proto__|constructor|prototype/.test(k)) { errors.push(path + ' tiene clave peligrosa'); continue; }
    const v = filters[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const op of Object.keys(v)) {
        if (!COMPARISON_OPS.includes(op)) errors.push(path + '.' + k + ' comparador inválido: ' + op);
        else if (v[op] != null && typeof v[op] !== 'string' && typeof v[op] !== 'number' && typeof v[op] !== 'boolean') errors.push(path + '.' + k + '.' + op + ' debe ser escalar');
      }
    } else if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean' && v !== null) {
      errors.push(path + '.' + k + ' debe ser escalar o comparador');
    }
  }
  return errors;
}

// ── Lectura vs escritura y confirmación ────────────────────────────────
function isWriteIntent(intent) { return ['create', 'update', 'delete'].includes(intent && intent.intent); }
function requiresConfirmation(intent) { return isWriteIntent(intent) || Boolean(intent && intent.needs_confirmation); }

// ── Referencias de entidad ─────────────────────────────────────────────
function detectEntityReferences(message) {
  const text = String(message || '').toLowerCase();
  const refs = [];
  if (/mi\s+perfil/.test(text)) refs.push({ type: 'profile', resolution: 'self' });
  if (/mi\s+(dojo|academia|establecimiento)/.test(text)) refs.push({ type: 'establishment', resolution: 'self' });
  if (/este\s+(perfil|alumno|usuario)|ese\s+(perfil|alumno|usuario)|esta\s+academia|esa\s+academia|este\s+dojo/.test(text)) {
    refs.push({ type: 'contextual', resolution: 'contextual', needsClarification: true });
  }
  if (/\bellos\b|\bellas\b/.test(text)) refs.push({ type: 'contextual', resolution: 'contextual', needsClarification: true });
  const uname = text.match(/(?:el|la|del|de)\s+usuario\s+([\w.@]+)/);
  if (uname) refs.push({ type: 'profile', resolution: 'explicit', username: uname[1] });
  const acad = text.match(/(?:la|el)\s+academia\s+([\w\s]+)/);
  if (acad) refs.push({ type: 'establishment', resolution: 'explicit', name: acad[1].trim() });
  return refs;
}

// ── Extracción de fechas y montos ──────────────────────────────────────
function extractDateRange(message) {
  const text = String(message || '').toLowerCase();
  const out = { from: null, to: null, relative: null };
  if (/mañana/.test(text)) out.relative = 'tomorrow';
  else if (/hoy/.test(text)) out.relative = 'today';
  else if (/ayer/.test(text)) out.relative = 'yesterday';
  else if (/esta\s+semana/.test(text)) out.relative = 'this_week';
  else if (/este\s+mes/.test(text)) out.relative = 'this_month';
  const rel = text.match(/(?:últimos|ultimos)\s+(\d+)\s+d[ií]as/);
  if (rel) out.relative = 'last_' + rel[1] + '_days';
  return out;
}

function extractAmount(message) {
  const text = String(message || '');
  const out = {};
  const gt = text.match(/(?:mayores?|superiores?|m[aá]s)\s+(?:a|de|que)\s*\$?\s*(\d+(?:\.\d+)?)/i);
  const lt = text.match(/(?:menores?|menos)\s+(?:a|de|que)\s*\$?\s*(\d+(?:\.\d+)?)/i);
  if (gt) out.gt = Number(gt[1]);
  if (lt) out.lt = Number(lt[1]);
  return out;
}

function extractGroupBy(message) {
  const text = String(message || '').toLowerCase();
  const out = [];
  if (/por\s+cada\s+(alumno|estudiante)|cada\s+(alumno|estudiante)/.test(text)) out.push('student');
  if (/por\s+(dojo|academia)/.test(text)) out.push('establishment');
  return out;
}

module.exports = {
  INTENT_KINDS, DOMAINS, OPERATIONS, SCOPES, SCHEMA_KEYS, ENTITY_KEYS, COMPARISON_OPS,
  normalizeUserMessage, detectUnsafeContent, isUnsafe,
  classifySemanticIntent, emptyIntent,
  validateIntentSchema, validateFilters,
  isWriteIntent, requiresConfirmation,
  detectEntityReferences, extractDateRange, extractAmount, extractGroupBy
};
