# Development

Use Node.js 22.12+ and pnpm 9+. The pnpm lockfile uses format 9; Vite requires Node 20.19+ or 22.12+. Node 22 is the recommended baseline.

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
pnpm preview
```

`./scripts/dev.sh` also starts Vite when Node / pnpm are on PATH. Its optional Codex runtime fallback is a convenience, not a requirement. `pnpm desktop` builds and starts the loopback browser + agent launcher; close that process to stop its child processes.

- `src/core`: models, validation, providers, storage, formatting and grid logic.
- `src/ui`: cards, dialogs, gestures and presentation.
- `src/hooks`: collection and subscription lifecycle.
- `scripts`: local agents, desktop launcher, simulated HTTP source and example packaging.
- `tests`: Vitest regression tests; fixtures are synthetic / test-only.
- `examples`, `spec`: module examples and schemas.
- `dist`: generated Web output, never committed.

No credentials are required for tests or manual / time cards. For a simulated HTTP source, run `node scripts/demo-source.mjs` and follow [PDM](PDM.md). Do not commit workspaces, secrets, local agent state or screenshots of real accounts.

If startup fails, verify Node version, dependency installation and port availability. HTTP failures may be CORS, mixed content or denied local-network access; do not disable browser protections to bypass them. Include a redacted reproduction and environment in an issue.

Android assets and local build tooling are excluded from this initial Web source distribution. No Android synchronization, compilation or APK release is part of it. There is no CI claim: run the commands locally before submitting changes.
