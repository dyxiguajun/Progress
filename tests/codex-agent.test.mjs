import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { request, createServer } from 'node:http';
import { CodexAgent, createCodexMiddleware, publicLimits, maskEmail } from '../scripts/codex-agent.mjs';
let agent, server;
beforeEach(() => { vi.stubEnv('PROGRESS_CODEX_BIN', resolve('tests/fixtures/fake-codex.mjs')); agent = new CodexAgent(); });
afterEach(async () => { agent.stop(); if (server) { server.closeAllConnections(); await new Promise(ok => server.close(ok)); server = undefined; } vi.unstubAllEnvs(); });
describe('local app-server bridge', () => {
  it('initializes once and reads real protocol methods concurrently with masked account output', async () => {
    const [status, usage] = await Promise.all([agent.status(), agent.usage()]);
    expect(status.state).toBe('ready'); expect(usage.account.key).toMatch(/^[a-f0-9]{64}$/);
    expect(usage.limits.rateLimitsByLimitId.codex.primary.usedPercent).toBe(25);
    expect(JSON.stringify({ status, usage })).not.toContain('private'); expect(JSON.stringify(usage)).not.toContain('secret');
  });
  it('returns signed-out status and supports Codex-managed login and cancellation', async () => {
    vi.stubEnv('PROGRESS_TEST_SCENARIO', 'signed-out');
    expect((await agent.status()).state).toBe('signed-out'); await expect(agent.usage()).rejects.toMatchObject({ code: 'auth' });
    expect((await agent.login()).authUrl).toBe('https://auth.openai.com/test'); await agent.cancelLogin(); expect(agent.loginId).toBeUndefined();
  });
  it('maps auth errors without exposing raw diagnostics or secrets', async () => {
    vi.stubEnv('PROGRESS_TEST_SCENARIO', 'expired');
    try { await agent.usage(); throw new Error('expected error'); } catch (e) { expect(e.code).toBe('auth'); expect(e.message).not.toMatch(/private|secret/); }
  });
  it('whitelists rate-limit payloads and masks both sides of an email', () => {
    expect(maskEmail('private@example.com')).toBe('p***@e***.com');
    expect(publicLimits({ accessToken: 'secret', rateLimits: { primary: { usedPercent: 10, token: 'secret' } } })).toEqual({ rateLimits: { primary: { usedPercent: 10 }, secondary: null, credits: null }, rateLimitsByLimitId: null });
  });
  it('rejects cross-origin reads, DNS rebinding, missing headers and arbitrary RPC routes', async () => {
    const bridge = createCodexMiddleware(agent);
    server = createServer((req,res) => void bridge.handler(req,res, () => { res.writeHead(404); res.end(); }));
    await new Promise(ok => server.listen(0,'127.0.0.1',ok));
    const origin = `http://127.0.0.1:${server.address().port}`;
    expect((await fetch(origin+'/api/codex/status')).status).toBe(403);
    expect((await fetch(origin+'/api/codex/status',{ headers: { 'X-Progress-Client':'usage-v1', Origin:'https://evil.example' } })).status).toBe(403);
    const rebinding = await new Promise(ok => { const req = request(origin+'/api/codex/status', { headers: { 'X-Progress-Client': 'usage-v1', Host: 'evil.example:5180' } }, res => { res.resume(); ok(res.statusCode); }); req.end(); });
    expect(rebinding).toBe(403);
    const headers = { 'X-Progress-Client':'usage-v1', Origin:origin };
    expect((await fetch(origin+'/api/codex/status',{headers})).status).toBe(200);
    expect((await fetch(origin+'/api/codex/thread/start',{headers,method:'POST'})).status).toBe(404);
    expect((await fetch(origin+'/api/codex/usage',{headers,method:'DELETE'})).status).toBe(404);
  });
});
