// A deliberately simulated PDM endpoint for testing HTTP, failure recovery and multiple metrics.
import { createServer } from 'node:http';

const port = Number(process.env.PROGRESS_DEMO_PORT ?? 8787);
const start = Date.now();
createServer((request, response) => {
  const allowed = new Set(['http://127.0.0.1:5173', 'http://localhost:5173', 'http://localhost', 'https://localhost']);
  const origin = request.headers.origin;
  if (origin && allowed.has(origin)) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin'); response.setHeader('Cache-Control', 'no-store');
  if (request.url !== '/progress') { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'application/json');
  const value = Math.floor((Date.now() - start) / 1000) % 101;
  response.end(JSON.stringify({ metrics: [
    { id: 'transfer', name: 'HTTP 传输模拟', kind: 'range', value, max: 100, unit: '%', meaning: 'completed', status: 'running', observed_at: new Date().toISOString(), stale_after: 45 },
    { id: 'temperature', name: 'HTTP 温度模拟', kind: 'gauge', value: 63, unit: '°C', observed_at: new Date().toISOString(), stale_after: 45 },
  ] }));
}).listen(port, '127.0.0.1', () => console.log(`模拟数据源 http://127.0.0.1:${port}/progress`));
