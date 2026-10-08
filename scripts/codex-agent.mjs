// Only this local process talks to Codex. Credentials stay in Codex's managed store.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export class AgentError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function maskEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return 'ChatGPT 账户';
  const [name, domain] = email.split('@');
  return `${name.slice(0, 1)}***@${domain.slice(0, 1)}***${domain.includes('.') ? domain.slice(domain.lastIndexOf('.')) : ''}`;
}
export async function findCodex() {
  const candidates = [process.env.PROGRESS_CODEX_BIN,
    ...((process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').flatMap(dir => process.platform === 'win32' ? [join(dir, 'codex.exe'), join(dir, 'codex.cmd')] : [join(dir, 'codex')])),
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  ].filter(Boolean);
  for (const path of candidates) { try { await access(path, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return path; } catch {} }
  throw new AgentError('not-installed', '未找到本机 Codex。安装后重新检测。');
}
const windowData = w => w == null ? null : { usedPercent: w.usedPercent, windowDurationMins: w.windowDurationMins, resetsAt: w.resetsAt };
export function publicLimits(raw) {
  if (raw?.rateLimitsByLimitId && (Array.isArray(raw.rateLimitsByLimitId) || Object.keys(raw.rateLimitsByLimitId).length > 64)) throw new AgentError('invalid', 'Codex 配额组格式或数量不受支持。');
  const snapshot = v => {
    if (Array.isArray(v?.windows) && v.windows.length > 16) throw new AgentError('invalid', 'Codex 配额窗口数量不受支持。');
    return v && typeof v === 'object' ? {
    limitId: v.limitId, limitName: v.limitName, primary: windowData(v.primary), secondary: windowData(v.secondary),
    ...(Array.isArray(v.windows) ? { windows: v.windows.slice(0, 16).map((w, i) => ({ ...windowData(w), id: typeof w.id === 'string' ? w.id : String(i) })) } : {}),
    credits: v.credits ? { hasCredits: v.credits.hasCredits, unlimited: v.credits.unlimited, balance: v.credits.balance } : null,
  } : null; };
  return { rateLimits: snapshot(raw?.rateLimits), rateLimitsByLimitId: raw?.rateLimitsByLimitId && typeof raw.rateLimitsByLimitId === 'object'
    ? Object.fromEntries(Object.entries(raw.rateLimitsByLimitId).slice(0, 64).map(([id, v]) => [id, snapshot(v)])) : null };
}
export class CodexAgent {
  child; starting; reading; accountKey; loginId; counter = 0; pending = new Map(); listeners = new Set(); version;
  emit(type) { for (const fn of this.listeners) fn(type); }
  async start() {
    if (this.starting) return this.starting;
    if (this.child) return;
    this.starting = (async () => {
      const binary = await findCodex();
      const child = spawn(binary, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: process.platform === 'win32' && binary.endsWith('.cmd') });
      this.child = child;
      // Never pipe raw stderr/RPC/account responses to logs or the renderer.
      child.stderr.on('data', () => {});
      const fail = () => {
        if (this.child !== child) return;
        this.child = undefined;
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new AgentError('unavailable', 'Codex 连接已中断。请重新连接。')); }
        this.pending.clear(); this.emit('connection');
      };
      child.on('error', fail); child.on('exit', fail);
      createInterface({ input: child.stdout }).on('line', line => {
        let message; try { message = JSON.parse(line); } catch { return; }
        const p = this.pending.get(message.id);
        if (p) {
          this.pending.delete(message.id); clearTimeout(p.timer);
          if (message.error) {
            const detail = String(message.error.message ?? '');
            const code = /401|unauthorized|authentication|not logged|sign in|token.*expired/i.test(detail) ? 'auth' : message.error.code === -32601 ? 'incompatible' : 'connection';
            p.reject(new AgentError(code, code === 'auth' ? '登录已失效，请重新登录 ChatGPT。' : code === 'incompatible' ? '当前 Codex 版本不支持读取配额，请更新 Codex。' : '无法读取 Codex 配额，请重试。'));
          } else p.resolve(message.result);
        } else if (['account/rateLimits/updated', 'account/updated', 'account/login/completed'].includes(message.method)) {
          if (message.method === 'account/login/completed') this.loginId = undefined;
          this.emit(message.method === 'account/rateLimits/updated' ? 'usage' : 'account');
        } else if (message.id !== undefined && message.method) {
          child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32601, message: 'Unsupported by Progress Usage' } }) + '\n');
        }
      });
      try {
        const init = await this.call('initialize', { clientInfo: { name: 'progress_usage', title: 'Progress', version: '0.4.0' } });
        this.version = typeof init?.userAgent === 'string' ? init.userAgent.match(/\/(\d+\.\d+\.\d+)/)?.[1] : undefined;
        child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
      } catch (e) { this.stop(); throw e; }
    })();
    try { await this.starting; } finally { this.starting = undefined; }
  }
  call(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.child) return reject(new AgentError('unavailable', '无法启动 Codex，请重新连接。'));
      const id = ++this.counter;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new AgentError('timeout', 'Codex 响应超时，请重试。')); }, 12000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, ...(params ? { params } : {}) }) + '\n');
    });
  }
  async status() {
    await this.start();
    const { account } = await this.call('account/read', { refreshToken: false });
    return { state: !account ? 'signed-out' : account.type === 'chatgpt' ? 'ready' : 'unsupported-account',
      account: account?.type === 'chatgpt' ? { maskedEmail: maskEmail(account.email), plan: account.planType } : undefined, version: this.version };
  }
  async usage() {
    if (this.reading) return this.reading;
    this.reading = (async () => {
      await this.start();
      const { account } = await this.call('account/read', { refreshToken: true });
      if (!account) throw new AgentError('auth', '请登录 ChatGPT 后读取配额。');
      if (account.type !== 'chatgpt') throw new AgentError('unsupported-account', '此配额需要 ChatGPT 登录。请在 Codex 中切换登录方式后重新连接。');
      const raw = await this.call('account/rateLimits/read');
      const { account: after } = await this.call('account/read', { refreshToken: false });
      if (after?.type !== 'chatgpt' || after.email !== account.email) throw new AgentError('account-mismatch', '账户已改变，请重新连接并确认当前账户。');
      if (!raw?.accountId && !account.email) throw new AgentError('incompatible', 'Codex 未提供可识别的账户信息。请更新 Codex 后重试。');
      this.accountKey = createHash('sha256').update(`${account.email ?? ''}|${raw?.accountId ?? ''}`).digest('hex');
      return { account: { key: this.accountKey, maskedEmail: maskEmail(account.email), plan: account.planType },
        limits: publicLimits(raw), observedAt: new Date().toISOString(), version: this.version };
    })();
    try { return await this.reading; } finally { this.reading = undefined; }
  }
  async login() {
    await this.start();
    if (this.loginId) await this.call('account/login/cancel', { loginId: this.loginId });
    const result = await this.call('account/login/start', { type: 'chatgpt' });
    const url = new URL(result.authUrl);
    if (result.type !== 'chatgpt' || url.protocol !== 'https:' || !['auth.openai.com', 'chatgpt.com', 'auth.chatgpt.com'].includes(url.hostname)) throw new AgentError('incompatible', 'Codex 未返回受支持的登录地址。请更新 Codex。');
    this.loginId = result.loginId;
    return { authUrl: url.href };
  }
  async cancelLogin() { if (this.loginId) { const id = this.loginId; this.loginId = undefined; await this.call('account/login/cancel', { loginId: id }); } }
  stop() { const child = this.child; this.child = undefined; child?.kill(); for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new AgentError('unavailable', 'Codex 连接已关闭。')); } this.pending.clear(); }
}
export function createCodexMiddleware(agent = new CodexAgent()) {
  const handler = async (req, res, next) => {
    const path = req.url?.split('?')[0];
    if (!path?.startsWith('/api/codex/')) return next?.();
    const origin = req.headers.origin;
    const host = req.headers.host;
    const ownHost = /^((127\.0\.0\.1)|(localhost)):\d+$/.test(host ?? '');
    // Header forces a cross-origin preflight, which is never granted. Host blocks DNS rebinding.
    if (!ownHost || req.headers['x-progress-client'] !== 'usage-v1' || origin && origin !== `http://${host}` || req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403); res.end(); return;
    }
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (path === '/api/codex/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' }); res.write(': connected\n\n');
      const listener = type => res.write(`data: ${JSON.stringify({ type })}\n\n`);
      agent.listeners.add(listener);
      const timer = setInterval(() => res.write(': keepalive\n\n'), 25000);
      req.on('close', () => { clearInterval(timer); agent.listeners.delete(listener); }); return;
    }
    try {
      let data;
      if (path === '/api/codex/status' && req.method === 'GET') data = await agent.status();
      else if (path === '/api/codex/usage' && req.method === 'GET') data = await agent.usage();
      else if (path === '/api/codex/login' && req.method === 'POST') data = await agent.login();
      else if (path === '/api/codex/login/cancel' && req.method === 'POST') { await agent.cancelLogin(); data = {}; }
      else if (path === '/api/codex/reconnect' && req.method === 'POST') { agent.stop(); data = await agent.status(); }
      else { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: e instanceof AgentError ? e.code : 'unavailable', message: e instanceof AgentError ? e.message : '无法连接本机 Codex，请重新连接。' }));
    }
  };
  return { handler, close: () => agent.stop(), agent };
}
