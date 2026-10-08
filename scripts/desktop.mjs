import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { createPairingMiddleware } from './pairing-agent.mjs';
import { createCodexMiddleware } from './codex-agent.mjs';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
try { await stat(resolve(root, 'index.html')); } catch { console.error('请先运行 pnpm build。'); process.exit(1); }
const bridge = createCodexMiddleware();
const pairing = createPairingMiddleware(bridge.agent);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer((req, res) => void pairing.handler(req, res, () => void bridge.handler(req, res, async () => {
  let path;
  try { path = decodeURIComponent((req.url ?? '/').split('?')[0]); } catch { res.writeHead(400); res.end(); return; }
  const file = resolve(root, `.${path === '/' ? '/index.html' : path}`);
  if (!file.startsWith(root) || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end(); return; }
  try { const data = await readFile(file); res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : data); }
  catch { res.writeHead(404); res.end(); }
})));
const port = Number(process.env.PROGRESS_PORT ?? 5180);
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}/`; console.log(`Progress ${url}（关闭此进程即可退出本机连接）`);
  if (!process.argv.includes('--no-open')) {
    const [command, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
    spawn(command, args, { stdio: 'ignore', windowsHide: true }).on('error', () => {});
  }
});
server.on('error', () => { console.error('无法启动 Progress，端口可能已被占用。'); pairing.close(); bridge.close(); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { pairing.close(); bridge.close(); server.closeAllConnections(); server.close(() => process.exit(0)); });
