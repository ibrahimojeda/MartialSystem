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

  if (base === 'read_payments' || base === 'read_students' || base === 'read_classes' || base === 'read_users') {
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

module.exports = {
  AI_PROVIDERS, AI_TOOLS, aiToolAllowed, detectImageType, aiParseToolBlock,
  isSSRFUnsafeUrl, aiSanitizeBaseUrl, aiSanitizeModel,
  hasAIFeatureWith, shouldBlockBilling, isOverBudget, aiFailoverWith,
  aiDetectIntent, aiExtractSearchParams, buildAIIntent, normalizeAISemantics, validateAIIntent
};

