// tests/ai-security.test.js
// Suite de seguridad IA (pura, sin red, sin Supabase real). Ejecutar: node --test tests/ai-security.test.js
const test = require('node:test');
const assert = require('node:assert');
const {
  AI_TOOLS, aiToolAllowed, aiParseToolBlock, detectImageType,
  isSSRFUnsafeUrl, aiSanitizeBaseUrl, aiSanitizeModel,
  hasAIFeatureWith, shouldBlockBilling, isOverBudget, aiFailoverWith,
  aiDetectIntent, aiExtractSearchParams, buildAIIntent, normalizeAISemantics, validateAIIntent,
  needsModelInterpretation, parseStructuredAIIntent, formatDeterministicAIResult,
  aiDetectCountQuery, formatCountResult, aiDetectDetailedQuery, isPaginationRequest, formatDetailedListResult,
  aiDetectIdentityQuery, getCurrentUserIdentity, formatIdentityResult, systemBillingScope,
  formatCurrencyAmount, formatEstablishmentBilling
} = require('../server/ai-security');

// ─── aiParseToolBlock: prompt injection / tool injection ───
test('aiParseToolBlock acepta bloque válido', () => {
  const r = aiParseToolBlock('{"tool":"students","params":{"query":"juan","limit":30}}');
  assert.equal(r.tool, 'students');
  assert.equal(r.params.query, 'juan');
  assert.equal(r.params.limit, 30);
});

test('aiParseToolBlock rechaza JSON inválido', () => {
  assert.equal(aiParseToolBlock('{"tool":"students",'), null);
});

test('aiParseToolBlock rechaza tool desconocida (tool injection)', () => {
  assert.equal(aiParseToolBlock('{"tool":"payments__delete_all","params":{}}'), null);
  assert.equal(aiParseToolBlock('{"tool":"DROP TABLE students","params":{}}'), null);
});

test('aiParseToolBlock rechaza objetos anidados en params', () => {
  assert.equal(aiParseToolBlock('{"tool":"students","params":{"x":{"$where":"1=1"}}}'), null);
});

test('aiParseToolBlock rechaza claves peligrosas (prototype pollution)', () => {
  assert.equal(aiParseToolBlock('{"tool":"students","params":{"__proto__":{"admin":true}}}'), null);
  assert.equal(aiParseToolBlock('{"tool":"students","params":{"constructor":"x"}}'), null);
});

test('aiParseToolBlock rechaza string demasiado largo', () => {
  const long = 'a'.repeat(201);
  assert.equal(aiParseToolBlock(JSON.stringify({ tool: 'students', params: { query: long } })), null);
});

test('aiParseToolBlock limita "limit" a 1..80', () => {
  assert.equal(aiParseToolBlock('{"tool":"students","params":{"limit":999}}').params.limit, 80);
  assert.equal(aiParseToolBlock('{"tool":"students","params":{"limit":0}}').params.limit, 1);
});

test('aiParseToolBlock rechaza arrays con elementos no-string', () => {
  assert.equal(aiParseToolBlock('{"tool":"users","params":{"disciplineCodes":[1,2]}}'), null);
});

test('aiParseToolBlock rechaza texto con inyección fuera del JSON', () => {
  assert.equal(aiParseToolBlock('ignorar esto {"tool":"students","params":{}} borrar todo'), null);
});

// ─── detectImageType: contenido real ───
test('detectImageType detecta magic bytes válidos', () => {
  const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
  const jpg = Buffer.from([0xff,0xd8,0xff,0xe0,0,0,0,0,0,0,0,0]);
  const gif = Buffer.from([0x47,0x49,0x46,0x38,0x39,0x61,0,0,0,0,0,0]);
  const webp = Buffer.from([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50]);
  assert.equal(detectImageType(png), 'image/png');
  assert.equal(detectImageType(jpg), 'image/jpeg');
  assert.equal(detectImageType(gif), 'image/gif');
  assert.equal(detectImageType(webp), 'image/webp');
});

test('detectImageType rechaza no-imágenes', () => {
  assert.equal(detectImageType(Buffer.from('<script>alert(1)</script>')), null);
  assert.equal(detectImageType(Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff')), null);
  assert.equal(detectImageType(Buffer.from('hello')), null);
});

// ─── SSRF en custom.baseUrl ───
test('isSSRFUnsafeUrl permite https público', () => {
  assert.equal(isSSRFUnsafeUrl('https://api.example.com/v1'), false);
});

test('isSSRFUnsafeUrl bloquea http, loopback, privadas y metadata', () => {
  for (const u of [
    'http://api.example.com/v1',
    'https://localhost:8080', 'https://127.0.0.1', 'https://[::1]', 'https://0.0.0.0',
    'https://10.0.0.1', 'https://192.168.1.1', 'https://172.16.0.1', 'https://169.254.169.254',
    'https://metadata.google.internal', 'https://foo.internal', 'https://foo.local',
    'not-a-url'
  ]) {
    assert.equal(isSSRFUnsafeUrl(u), true, 'debería bloquear: ' + u);
  }
});

test('aiSanitizeBaseUrl rechaza SSRF', () => {
  assert.equal(aiSanitizeBaseUrl('https://api.example.com/v1'), 'https://api.example.com/v1');
  assert.equal(aiSanitizeBaseUrl('http://api.example.com'), '');
  assert.equal(aiSanitizeBaseUrl('https://127.0.0.1'), '');
  assert.equal(aiSanitizeBaseUrl('venta'), '');
});

// ─── aiToolAllowed: matriz de permisos por rol ───
test('aiToolAllowed respeta roles owner/sensei/instructor/student/guardian', () => {
  assert.equal(aiToolAllowed('payments', 'owner', 'read'), true);
  assert.equal(aiToolAllowed('payments', 'owner', 'write'), true);
  assert.equal(aiToolAllowed('payments', 'sensei', 'write'), false);
  assert.equal(aiToolAllowed('payments', 'instructor', 'write'), false);
  assert.equal(aiToolAllowed('students', 'student', 'read'), true);
  assert.equal(aiToolAllowed('students', 'student', 'write'), false);
  assert.equal(aiToolAllowed('students', 'guardian', 'read'), true);
  assert.equal(aiToolAllowed('users', 'sensei', 'write'), true);
  assert.equal(aiToolAllowed('users', 'instructor', 'write'), false);
  assert.equal(aiToolAllowed('billing', 'sensei', 'read'), false);
  assert.equal(aiToolAllowed('billing', 'owner', 'read'), true);
});

// ─── hasAIFeatureWith: gating fail-closed ───
function mockSb({ establishmentPlan = null, planFeatures = null, fail = false }) {
  return {
    from(table) {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        maybeSingle() {
          if (fail) return Promise.resolve({ data: null, error: { message: 'boom' } });
          if (table === 'establishment_plans') return Promise.resolve({ data: establishmentPlan ? { plan_code: establishmentPlan } : null, error: null });
          if (table === 'system_plans') return Promise.resolve({ data: planFeatures !== null ? { features: planFeatures } : null, error: null });
          return Promise.resolve({ data: null, error: null });
        }
      };
      return chain;
    }
  };
}

test('hasAIFeatureWith es fail-closed (sin plan / error / sin feature)', async () => {
  assert.equal(await hasAIFeatureWith(mockSb({ establishmentPlan: null }), 'est-1'), false);
  assert.equal(await hasAIFeatureWith(mockSb({ establishmentPlan: 'bushido', planFeatures: null }), 'est-1'), false);
  assert.equal(await hasAIFeatureWith(mockSb({ establishmentPlan: 'bushido', planFeatures: ['gestion_alumnos'] }), 'est-1'), false);
  assert.equal(await hasAIFeatureWith(mockSb({ fail: true }), 'est-1'), false);
});

test('hasAIFeatureWith permite plan con ia_features y superadmin', async () => {
  assert.equal(await hasAIFeatureWith(mockSb({ establishmentPlan: 'bushido', planFeatures: ['ia_features'] }), 'est-1'), true);
  assert.equal(await hasAIFeatureWith(mockSb({}), 'superadmin'), true);
});

// ─── shouldBlockBilling: billing bloqueado >= 15 días ───
const NOW = Date.parse('2026-10-19T00:00:00Z');
test('shouldBlockBilling bloquea a los 15 días de vencimiento', () => {
  assert.equal(shouldBlockBilling(null, NOW), false);
  assert.equal(shouldBlockBilling({ status: 'confirmed', due_date: '2026-09-01' }, NOW), false);
  assert.equal(shouldBlockBilling({ status: 'waived', due_date: '2026-09-01' }, NOW), false);
  assert.equal(shouldBlockBilling({ status: 'pending', due_date: '2026-10-05' }, NOW), false); // 14 días
  assert.equal(shouldBlockBilling({ status: 'pending', due_date: '2026-10-04' }, NOW), true);  // 15 días
  assert.equal(shouldBlockBilling({ status: 'pending', due_date: '2026-09-01' }, NOW), true);
});

// ─── isOverBudget: presupuesto global ───
test('isOverBudget bloquea cuando el costo supera el presupuesto', () => {
  assert.equal(isOverBudget({ estCost: 5 }, 10), false);
  assert.equal(isOverBudget({ estCost: 15 }, 10), true);
  assert.equal(isOverBudget({ estCost: 15 }, 0), false);
  assert.equal(isOverBudget({ estCost: 15 }, undefined), false);
  assert.equal(isOverBudget(null, 10), false);
});

// ─── aiFailoverWith: failover con proveedor mock ───
test('aiFailoverWith usa el siguiente proveedor si el primero falla', async () => {
  const providers = [{ id: 'p1', provider: 'gemini' }, { id: 'p2', provider: 'openai' }];
  const requestFn = async (p) => {
    if (p.id === 'p1') { const e = new Error('cuota agotada'); e.status = 429; throw e; }
    return { content: 'ok', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' };
  };
  const res = await aiFailoverWith(providers, requestFn, (p) => p.id);
  assert.equal(res.providerId, 'p2');
  assert.equal(res.content, 'ok');
});

test('aiFailoverWith lanza cuando todas fallan', async () => {
  const providers = [{ id: 'p1', provider: 'gemini' }, { id: 'p2', provider: 'openai' }];
  const requestFn = async () => { const e = new Error('fallo'); e.status = 500; throw e; };
  await assert.rejects(() => aiFailoverWith(providers, requestFn, (p) => p.id), (e) => {
    assert.equal(e.status, 502);
    assert.equal(e.providerErrors.length, 2);
    return true;
  });
});

test('aiFailoverWith trata content vacío como fallo y usa el siguiente', async () => {
  const providers = [{ id: 'p1', provider: 'gemini' }, { id: 'p2', provider: 'openai' }];
  const requestFn = async (p) => {
    if (p.id === 'p1') return { content: '   ', model: 'x', baseUrl: 'https://x' };
    return { content: 'respuesta real', model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' };
  };
  const res = await aiFailoverWith(providers, requestFn, (p) => p.id);
  assert.equal(res.providerId, 'p2');
  assert.equal(res.content, 'respuesta real');
});

// ─── aiDetectIntent: lectura vs escritura ───
test('aiDetectIntent distingue lectura de escritura por verbo', () => {
  assert.equal(aiDetectIntent('revisa todos los alumnos y mira sus ultimas fechas de pago de cualquier monto superior a 0'), 'read_payments');
  assert.equal(aiDetectIntent('¿Quiénes pagaron este mes?'), 'read_payments');
  assert.equal(aiDetectIntent('Muéstrame los últimos pagos de mis alumnos'), 'read_payments');
  assert.equal(aiDetectIntent('¿Cuántos alumnos pagaron más de 0?'), 'read_payments');
  assert.equal(aiDetectIntent('Registra un pago de 50 para Juan Pérez'), 'write');
  assert.equal(aiDetectIntent('Crea un estudiante nuevo'), 'write');
  assert.equal(aiDetectIntent('hola'), 'chat');
});

// ─── aiExtractSearchParams: filtros desde lenguaje natural ───
test('aiExtractSearchParams extrae amountMin y latestPerStudent', () => {
  const p = aiExtractSearchParams('revisa todos los alumnos y mira sus ultimas fechas de pago de cualquier monto superior a 0', 'payments');
  assert.equal(p.amountMin, 0);
  assert.equal(p.latestPerStudent, true);
  const p2 = aiExtractSearchParams('Muéstrame los últimos pagos de mis alumnos', 'payments');
  assert.equal(p2.latestPerStudent, true);
  assert.equal(p2.amountMin, undefined);
});

// ─── buildAIIntent: intención estructurada ───
test('buildAIIntent A: lectura de pagos latest_per_student con amount>0', () => {
  const i = buildAIIntent('revisa todos los alumnos y mira sus ultimas fechas de pago de cualquier monto superior a 0');
  assert.equal(i.intent, 'read');
  assert.equal(i.domain, 'payments');
  assert.equal(i.operation, 'latest_per_student');
  assert.deepEqual(i.filters.amount, { operator: '>', value: 0 });
});

test('buildAIIntent B: escritura de pago con confirmación', () => {
  const i = buildAIIntent('registra un pago de 50 para Juan Pérez');
  assert.equal(i.intent, 'write');
  assert.equal(i.domain, 'payments');
  assert.equal(i.operation, 'create');
  assert.equal(i.needs_confirmation, true);
});

test('buildAIIntent C: alumnos que pagaron → payments, no students', () => {
  const i = buildAIIntent('muestra los alumnos que pagaron este mes');
  assert.equal(i.intent, 'read');
  assert.equal(i.domain, 'payments');
});

test('buildAIIntent D: ambigua → clarify', () => {
  const i = buildAIIntent('haz algo con Juan');
  assert.equal(i.intent, 'clarify');
});

test('buildAIIntent E: clases → classes', () => {
  const i = buildAIIntent('qué clases hay mañana');
  assert.equal(i.intent, 'read');
  assert.equal(i.domain, 'classes');
});

// ─── validateAIIntent ───
test('validateAIIntent rechaza scope global sin superadmin y establishmentId ajeno', () => {
  const base = { intent: 'read', domain: 'payments', operation: 'list', filters: {}, data: {}, scope: 'global', needs_confirmation: false, missing: [], confidence: 0.9 };
  const ownerCtx = { isSuperadmin: false, establishmentId: 'est-1' };
  const r1 = validateAIIntent(base, ownerCtx);
  assert.equal(r1.ok, false);
  assert.ok(r1.errors.some(e => e.includes('global')));

  const base2 = { ...base, scope: 'current_establishment', filters: { establishmentId: 'est-2' } };
  const r2 = validateAIIntent(base2, ownerCtx);
  assert.equal(r2.ok, false);
  assert.ok(r2.errors.some(e => e.includes('ajeno')));
});

test('validateAIIntent rechaza escritura sin confirmación', () => {
  const w = { intent: 'write', domain: 'payments', operation: 'create', filters: {}, data: {}, scope: 'current_establishment', needs_confirmation: false, missing: [], confidence: 0.9 };
  const r = validateAIIntent(w, { isSuperadmin: false, establishmentId: 'est-1' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('confirmación')));
});

// ─── needsModelInterpretation: modo híbrido ───
test('needsModelInterpretation: consultas claras no requieren modelo', () => {
  const a = buildAIIntent('revisa todos los alumnos y mira sus ultimas fechas de pago de cualquier monto superior a 0');
  assert.equal(needsModelInterpretation(a, 'revisa todos los alumnos y mira sus ultimas fechas de pago de cualquier monto superior a 0'), false);
  const b = buildAIIntent('qué clases hay mañana');
  assert.equal(needsModelInterpretation(b, 'qué clases hay mañana'), false);
  const c = buildAIIntent('muéstrame mis alumnos');
  assert.equal(needsModelInterpretation(c, 'muéstrame mis alumnos'), false);
});

test('needsModelInterpretation: ambigua o con referencias requiere modelo', () => {
  const a = buildAIIntent('haz algo con Juan');
  assert.equal(needsModelInterpretation(a, 'haz algo con Juan'), true);
  const b = buildAIIntent('muéstrame los pagos de ellos');
  assert.equal(needsModelInterpretation(b, 'muéstrame los pagos de ellos'), true);
});

// ─── parseStructuredAIIntent ───
test('parseStructuredAIIntent acepta JSON válido y rechaza campos desconocidos', () => {
  const p = parseStructuredAIIntent('{"intent":"read","domain":"payments","operation":"list","filters":{},"data":{},"scope":"current_establishment","needs_confirmation":false,"missing":[],"confidence":0.9}');
  assert.equal(p.intent, 'read');
  assert.equal(p.domain, 'payments');
  assert.equal(parseStructuredAIIntent('{"intent":"read","hack":"x"}'), null);
  assert.equal(parseStructuredAIIntent('no es json'), null);
});

// ─── parseStructuredAIIntent hardening ───
test('parseStructuredAIIntent rechaza valores inválidos y contenido peligroso', () => {
  assert.equal(parseStructuredAIIntent('{"intent":"hack","domain":"payments","operation":"list","scope":"current_establishment","needs_confirmation":false,"missing":[],"confidence":0.9}'), null);
  assert.equal(parseStructuredAIIntent('{"intent":"read","domain":"payments","operation":"list","scope":"current_establishment","needs_confirmation":false,"missing":[],"confidence":1.5}'), null);
  assert.equal(parseStructuredAIIntent('{"intent":"read","domain":"payments","operation":"list","scope":"current_establishment","needs_confirmation":false,"missing":[],"confidence":0.9,"filters":{"amount":{"operator":">","value":"DROP TABLE"}}}'), null);
  assert.equal(parseStructuredAIIntent('{"intent":"read","domain":"payments","operation":"list","scope":"current_establishment","needs_confirmation":false,"missing":[],"confidence":0.9,"filters":{"__proto__":{"x":1}}}'), null);
});

// ─── formatDeterministicAIResult ───
test('formatDeterministicAIResult produce texto legible sin IDs', () => {
  const intent = { intent: 'read', domain: 'payments', operation: 'latest_per_student' };
  const rows = [{ student_name: 'Juan Pérez', paid_at: '2026-10-15', amount: 50000, concept: 'Mensualidad' }];
  const s = formatDeterministicAIResult(intent, rows, {});
  assert.ok(s.includes('Juan Pérez'));
  assert.ok(s.includes('$50'));
  assert.ok(!s.includes('stu-1'));
  const empty = formatDeterministicAIResult({ domain: 'payments' }, [], {});
  assert.ok(empty.includes('No encontré pagos'));
});

// ─── parseStructuredAIIntent: español válido vs contenido peligroso ───
test('parseStructuredAIIntent no bloquea español válido', () => {
  const mk = (filters) => '{"intent":"read","domain":"students","operation":"list","scope":"current_establishment","needs_confirmation":false,"missing":[],"confidence":0.9,"filters":' + JSON.stringify(filters) + '}';
  assert.ok(parseStructuredAIIntent(mk({ q: 'selecciona los alumnos' })));
  assert.ok(parseStructuredAIIntent(mk({ q: 'muéstrame los pagos' })));
  assert.ok(parseStructuredAIIntent(mk({ q: 'el alumno se llama Carlos' })));
  assert.ok(parseStructuredAIIntent(mk({ q: 'revisa la disciplina de Juan' })));
});

test('parseStructuredAIIntent rechaza contenido peligroso claro', () => {
  const mk = (filters) => '{"intent":"read","domain":"students","operation":"list","scope":"current_establishment","needs_confirmation":false,"missing":[],"confidence":0.9,"filters":' + JSON.stringify(filters) + '}';
  assert.equal(parseStructuredAIIntent(mk({ q: 'DROP TABLE students' })), null);
  assert.equal(parseStructuredAIIntent(mk({ q: 'SELECT * FROM users' })), null);
  assert.equal(parseStructuredAIIntent(mk({ q: '<script>alert(1)</script>' })), null);
  assert.equal(parseStructuredAIIntent(mk({ q: 'javascript:alert(1)' })), null);
});

// ─── aiDetectCountQuery / formatCountResult (conteos determinísticos) ───
test('aiDetectCountQuery detecta los 4 casos de conteo', () => {
  assert.deepEqual(aiDetectCountQuery('¿Cuántos alumnos tiene mi dojo?'), { tool: 'students', kind: 'total', filters: {} });
  assert.deepEqual(aiDetectCountQuery('¿Cuántos pagos hubo este mes?'), { tool: 'payments', kind: 'total', filters: { amountMin: null, amountMax: null, period: 'this_month', date: null } });
  assert.deepEqual(aiDetectCountQuery('¿Cuántos alumnos pagaron más de 0?'), { tool: 'payments', kind: 'unique_students', filters: { amountMin: 0, amountMax: null, period: null, date: null } });
  assert.deepEqual(aiDetectCountQuery('¿Cuántas clases hay mañana?'), { tool: 'classes', kind: 'total', filters: { period: null, date: 'tomorrow' } });
});

test('aiDetectCountQuery devuelve null para consultas no conteo', () => {
  assert.equal(aiDetectCountQuery('Muéstrame los pagos'), null);
  assert.equal(aiDetectCountQuery('Registra un pago de 50'), null);
  assert.equal(aiDetectCountQuery('Hola'), null);
});

test('formatCountResult produce plantillas determinísticas legibles', () => {
  assert.equal(
    formatCountResult({ tool: 'payments', kind: 'unique_students' }, { count: 12 }),
    'Encontré 12 alumnos con al menos un pago superior a 0.'
  );
  assert.equal(
    formatCountResult({ tool: 'payments', kind: 'unique_students' }, { count: 0 }),
    'No encontré alumnos con pagos superiores a 0 dentro de tu alcance autorizado.'
  );
  assert.equal(
    formatCountResult({ tool: 'payments', kind: 'total', filters: { period: 'this_month' } }, { count: 8 }),
    'Encontré 8 pagos registrados este mes.'
  );
  assert.equal(
    formatCountResult({ tool: 'classes', kind: 'total', filters: { date: 'tomorrow' } }, { count: 5 }),
    'Hay 5 clases programadas para mañana.'
  );
  assert.ok(formatCountResult({ tool: 'students', kind: 'total' }, { count: 1 }).includes('1 alumno'));
});

// ─── aiDetectDetailedQuery / isPaginationRequest / formatDetailedListResult ───
test('aiDetectDetailedQuery detecta instructores/senseis/alumnos y filtros', () => {
  assert.deepEqual(
    aiDetectDetailedQuery('Me gustaría la lista detallada de cada instructor por favor'),
    { tool: 'users', kind: 'list', filters: { role: 'instructor' }, options: { detailed: true, paginated: true, page: 1, pageSize: 25 } }
  );
  const karate = aiDetectDetailedQuery('Muéstrame los instructores de Karate');
  assert.equal(karate.tool, 'users');
  assert.equal(karate.filters.role, 'instructor');
  assert.equal(karate.filters.disciplineCode, 'karate');
  const sensei = aiDetectDetailedQuery('Quiero la lista detallada de senseis');
  assert.equal(sensei.tool, 'users');
  assert.equal(sensei.filters.role, 'sensei');
  const students = aiDetectDetailedQuery('Quiero ver la lista detallada de estudiantes');
  assert.equal(students.tool, 'students');
});

test('aiDetectDetailedQuery devuelve null para no-listados', () => {
  assert.equal(aiDetectDetailedQuery('¿Cuántos instructores hay?'), null);
  assert.equal(aiDetectDetailedQuery('revisa todos los alumnos y mira sus pagos'), null);
  assert.equal(aiDetectDetailedQuery('hola'), null);
});

test('isPaginationRequest detecta continuación', () => {
  assert.ok(isPaginationRequest('siguiente página'));
  assert.ok(isPaginationRequest('muéstrame más'));
  assert.ok(isPaginationRequest('continúa'));
  assert.ok(!isPaginationRequest('Muéstrame los instructores'));
});

test('formatDetailedListResult produce texto paginado legible', () => {
  const res = {
    rows: [
      { full_name: 'Ana López', username: 'ana', establishment_name: 'Dojo Bushido', disciplines: ['Karate', 'Judo'], is_active: true },
      { full_name: 'Carlos Pérez', username: 'carlos', establishment_name: 'Academia MMA', disciplines: ['MMA'], is_active: true }
    ],
    meta: { total: 474, page: 1, pageSize: 25, totalPages: 19, hasNextPage: true, hasPreviousPage: false, domain: 'users' }
  };
  const s = formatDetailedListResult(res, { tool: 'users', filters: { role: 'instructor' } }, {});
  assert.ok(s.includes('Encontré 474 instructores'));
  assert.ok(s.includes('página 1 de 19'));
  assert.ok(s.includes('Ana López'));
  assert.ok(s.includes('Dojo Bushido'));
  assert.ok(s.includes('Karate, Judo'));
  assert.ok(s.includes('siguiente página'));
  assert.ok(!s.includes('profile_id'));
  const empty = formatDetailedListResult({ rows: [], meta: { total: 0 } }, { tool: 'users', filters: { role: 'instructor' } }, {});
  assert.ok(empty.includes('No encontré instructores'));
});

// ─── Identidad determinística ───
test('aiDetectIdentityQuery detecta "¿quién soy?" y variantes', () => {
  assert.ok(aiDetectIdentityQuery('¿Qué usuario soy?'));
  assert.ok(aiDetectIdentityQuery('¿Quién soy?'));
  assert.ok(aiDetectIdentityQuery('¿Cuál es mi rol?'));
  assert.ok(aiDetectIdentityQuery('¿Qué cuenta está conectada?'));
  assert.equal(aiDetectIdentityQuery('¿Cuántos alumnos hay?'), null);
  assert.equal(aiDetectIdentityQuery('hola'), null);
});

test('getCurrentUserIdentity extrae solo la identidad de la sesión', () => {
  assert.deepEqual(
    getCurrentUserIdentity({ profileId: 'p1', username: 'ana', fullName: 'Ana Lopez', role: 'owner', establishmentId: 'est-1' }),
    { profileId: 'p1', username: 'ana', fullName: 'Ana Lopez', role: 'owner', establishmentId: 'est-1' }
  );
});

test('formatIdentityResult superadmin es determinístico', () => {
  assert.equal(
    formatIdentityResult({ fullName: '', username: 'venta', role: 'superadmin' }),
    'Eres venta, con rol Superadmin. Tienes acceso administrativo global.'
  );
});

test('formatIdentityResult owner incluye username y rol', () => {
  const s = formatIdentityResult({ fullName: 'Hiroshi Tanaka', username: 'hiroshi_tanaka', role: 'owner' });
  assert.ok(s.includes('Eres Hiroshi Tanaka'));
  assert.ok(s.includes('usuario hiroshi_tanaka'));
  assert.ok(s.includes('con rol owner'));
});

// ─── Deuda de dojos → system_usage_bills (NO student_charges) ───
test('aiDetectCountQuery enruta deuda de dojos a billing (no charges)', () => {
  const q = aiDetectCountQuery('¿Cuántos dojos deben el sistema?');
  assert.equal(q.tool, 'billing');
  assert.equal(q.kind, 'summary');
  assert.deepEqual(q.filters.status, ['pending', 'overdue']);
});

test('aiDetectCountQuery enruta facturas vencidas de dojos a billing overdue', () => {
  const q = aiDetectCountQuery('¿Cuántos dojos tienen facturas vencidas?');
  assert.equal(q.tool, 'billing');
  assert.equal(q.kind, 'overdue_establishments');
  assert.deepEqual(q.filters.status, ['overdue']);
});

test('aiDetectCountQuery NO confunde cargos de alumnos con deuda de dojos', () => {
  const q = aiDetectCountQuery('¿Cuántos cargos están vencidos?');
  assert.equal(q.tool, 'charges');
});

test('aiDetectIntent enruta "¿qué dojos deben?" a read_billing', () => {
  assert.equal(aiDetectIntent('¿Qué dojos deben al sistema?'), 'read_billing');
});

// ─── Permisos de facturación del sistema ───
test('systemBillingScope aplica permisos por rol', () => {
  assert.equal(systemBillingScope({ role: 'superadmin' }), 'all');
  assert.equal(systemBillingScope({ role: 'owner' }), 'own');
  assert.equal(systemBillingScope({ role: 'admin' }), 'own');
  assert.equal(systemBillingScope({ role: 'instructor' }), 'none');
  assert.equal(systemBillingScope({ role: 'sensei' }), 'none');
  assert.equal(systemBillingScope({ role: 'student' }), 'none');
  assert.equal(systemBillingScope({ role: 'guardian' }), 'none');
});

// ─── formatCountResult billing ───
test('formatCountResult billing summary combina vencidos y pendientes', () => {
  const s = formatCountResult(
    { tool: 'billing', kind: 'summary', filters: { status: ['pending', 'overdue'] } },
    { overdueCount: 3, pendingCount: 2, overdueTotals: { ARS: 147 }, pendingTotals: {} }
  );
  assert.ok(s.includes('Hay 3 dojos con facturas vencidas'));
  assert.ok(s.includes('2 dojos con facturas pendientes'));
  assert.ok(s.includes('ARS 147'));
});

test('formatCountResult billing separa saldos por moneda (no suma monedas distintas)', () => {
  const s = formatCountResult(
    { tool: 'billing', kind: 'summary' },
    { overdueCount: 2, pendingCount: 0, overdueTotals: { ARS: 98000, USD: 120 } }
  );
  assert.ok(s.includes('ARS '));
  assert.ok(s.includes('USD 120'));
  assert.ok(!s.includes('$'), 'no usa $ genérico');
});

test('formatCurrencyAmount usa el código de moneda real', () => {
  assert.ok(formatCurrencyAmount('ARS', 98000).startsWith('ARS '));
  assert.equal(formatCurrencyAmount('USD', 120), 'USD 120');
});

test('formatEstablishmentBilling sin deuda', () => {
  assert.equal(formatEstablishmentBilling('Dojo Bushido', 0, 0, {}), 'Dojo Bushido no tiene facturas pendientes ni vencidas.');
});

test('formatEstablishmentBilling con deuda y factura vencida más antigua', () => {
  const s = formatEstablishmentBilling('Dojo Bushido', 1, 1, { ARS: 98000 }, { billing_month: '2026-08', due_date: '2026-08-05' });
  assert.ok(s.includes('Dojo Bushido tiene 2 facturas'));
  assert.ok(s.includes('ARS '));
  assert.ok(s.includes('2026-08'));
  assert.ok(s.includes('2026-08-05'));
});

test('aiDetectCountQuery enruta "dojos con pagos vencidos" a billing (no payments)', () => {
  const q = aiDetectCountQuery('¿Cuántos dojos tienen pagos vencidos?');
  assert.equal(q.tool, 'billing');
  assert.equal(q.kind, 'overdue_establishments');
  assert.deepEqual(q.filters.status, ['overdue']);
});

test('aiDetectCountQuery enruta "alumnos con pagos vencidos" a charges (student_charges)', () => {
  const q = aiDetectCountQuery('¿Cuántos alumnos tienen pagos vencidos?');
  assert.equal(q.tool, 'charges');
  assert.equal(q.filters.status, 'overdue');
});

test('aiDetectCountQuery distingue vencimiento de dominio en cargos de alumnos', () => {
  // Vencimiento explícito → overdue
  assert.deepEqual(aiDetectCountQuery('¿Cuántos alumnos adeudan?'), { tool: 'charges', kind: 'total', filters: { status: 'overdue' } });
  // Pendiente explícito → pending
  assert.deepEqual(aiDetectCountQuery('¿Cuántos alumnos tienen cuotas pendientes?'), { tool: 'charges', kind: 'total', filters: { status: 'pending' } });
  // Dominio sin señal de vencimiento → sin status obligatorio
  const c1 = aiDetectCountQuery('¿Cuántos alumnos tienen cargos?');
  assert.equal(c1.tool, 'charges');
  assert.equal(c1.filters.status, undefined);
  const c2 = aiDetectCountQuery('¿Cuántos alumnos pagan mensualidad?');
  assert.equal(c2.tool, 'charges');
  assert.equal(c2.filters.status, undefined);
  // Pagos realizados → payments (no charges)
  assert.equal(aiDetectCountQuery('¿Cuántos alumnos pagaron?').tool, 'payments');
});

test('aiDetectIntent prioriza entidad de establecimiento sobre "pagos vencidos"', () => {
  assert.equal(aiDetectIntent('¿Cuántos dojos tienen pagos vencidos?'), 'read_billing');
  assert.equal(aiDetectIntent('¿Qué academias deben al sistema?'), 'read_billing');
  assert.equal(aiDetectIntent('¿Qué establecimientos están atrasados con el sistema?'), 'read_billing');
  assert.equal(aiDetectIntent('¿Qué estudiantes deben mensualidad?'), 'read_charges');
});

test('aiDetectCountQuery "dojos ... pagos vencidos al sistema" → billing overdue', () => {
  const q = aiDetectCountQuery('¿Cuántos Dojos tienen pagos vencidos al sistema?');
  assert.equal(q.tool, 'billing');
  assert.equal(q.kind, 'overdue_establishments');
  assert.deepEqual(q.filters.status, ['overdue']);
});

test('formatCountResult billing vacío distingue superadmin de owner', () => {
  assert.equal(
    formatCountResult({ tool: 'billing', kind: 'overdue_establishments' }, { count: 0 }, { role: 'superadmin' }),
    'No encontré facturas vencidas de ningún dojo en el sistema.'
  );
  assert.equal(
    formatCountResult({ tool: 'billing', kind: 'overdue_establishments' }, { count: 0 }, { role: 'owner' }),
    'No encontré dojos con facturas vencidas dentro de tu alcance autorizado.'
  );
});

console.log('Suite ai-security: ejecutada con node:test');


