#!/usr/bin/env node
// A test-only protocol peer. Never used by production detection.
import { createInterface } from 'node:readline';
const scenario = process.env.PROGRESS_TEST_SCENARIO;
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method } = JSON.parse(line); if (id === undefined) return;
  let result;
  if (method === 'initialize') result = { userAgent: 'codex/0.160.1' };
  else if (method === 'account/read') result = { account: scenario === 'signed-out' ? null : { type: 'chatgpt', email: 'private@example.com', planType: 'plus' }, requiresOpenaiAuth: true };
  else if (method === 'account/rateLimits/read') {
    if (scenario === 'expired') { process.stdout.write(JSON.stringify({ id, error: { code: -32000, message: '401 unauthorized private accessToken=secret' } })+'\n'); return; }
    result = { accountId: 'private-id', rateLimitsByLimitId: { codex: { primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1791400000 }, secondary: null, token: 'secret' } }, accessToken: 'secret' };
  } else if (method === 'account/login/start') { result = { type: 'chatgpt', loginId: 'test-id', authUrl: 'https://auth.openai.com/test' }; }
  else if (method === 'account/login/cancel') { result = {}; }
  else { process.stdout.write(JSON.stringify({ id, error: { code: -32601, message: 'unknown' } })+'\n'); return; }
  process.stdout.write(JSON.stringify({ id, result })+'\n');
});
