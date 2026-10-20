// tests/helpers/mock-ai-provider.js
// Servidor HTTP local que imita un proveedor OpenAI-compatible (sin red externa).
// Responde por secuencia: push(content) o push429().

const http = require('http');

function createMockAIProvider() {
  const queue = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const next = queue.length ? queue.shift() : { content: 'respuesta válida' };
      if (next.status === 429) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'quota exceeded' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: next.content } }], usage: {} }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        url: `http://localhost:${server.address().port}`,
        push: (content) => queue.push({ content }),
        push429: () => queue.push({ status: 429 }),
        clear: () => { queue.length = 0; },
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

module.exports = { createMockAIProvider };
