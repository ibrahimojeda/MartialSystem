// tests/ai-security.test.js
// Suite de seguridad IA (pura, sin red, sin Supabase real). Ejecutar: node --test tests/ai-security.test.js
const test = require('node:test');
const assert = require('node:assert');
const {
  AI_TOOLS, aiToolAllowed, aiParseToolBlock, detectImageType,
  isSSRFUnsafeUrl, aiSanitizeBaseUrl, aiSanitizeModel,
  hasAIFeatureWith, shouldBlockBilling, isOverBudget, aiFailoverWith
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

console.log('Suite ai-security: ejecutada con node:test');


