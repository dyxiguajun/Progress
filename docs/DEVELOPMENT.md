# Development

[简体中文开发指南](DEVELOPMENT.zh-CN.md) · [Documentation index](README.md)

This guide covers the v0.6.5 Web source distribution. Read [Architecture](ARCHITECTURE.md) for data flow and persistence, [Extending Progress](EXTENDING.md) to add sources or renderers, and [Testing](TESTING.md) to validate changes.

## Set up a checkout

Install Git, Node.js **22.12+** and pnpm **9+**. Node 22 is the baseline: the locked Vite version requires Node 20.19+ or 22.12+, while the included Capacitor CLI requires Node 22+. Retain the committed lockfile when installing.

```sh
git clone https://github.com/dyxiguajun/Progress.git
cd Progress
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. Vite binds to loopback and uses a strict port: an occupied 5173 causes startup to fail. Stop your own conflicting service or use `pnpm dev --port 5174`. The demo source's CORS allowlist assumes port 5173; update it if you change the development origin.

The initial workspace is empty. Add a manual progress or time card to start without accounts or network permissions. Examples are opt-in and simulated. No `.env` file or hosted backend is required.

## Commands and execution modes

Run commands from the repository root.

| Command | Result |
| --- | --- |
| `pnpm dev` | Vite development server with React refresh and local agent middleware |
| `pnpm test` | One complete Vitest run; see [Testing](TESTING.md) for focused runs |
| `pnpm build` | TypeScript check followed by Vite output in `dist/` |
| `pnpm preview` | Serve an existing `dist/` build on loopback, normally port 4173 |
| `pnpm desktop` | Build, serve `dist/` with local agents on port 5180, and open the browser |
| `pnpm extension:build` | Build the optional Chrome collector directory and ZIP under `artifacts/` |
| `node scripts/demo-source.mjs` | Synthetic PDM at `http://127.0.0.1:8787/progress` |
| `node scripts/pack-examples.mjs` | Package the three `examples/` directories into `.progressmod` files under `artifacts/` |

`pnpm preview` and static hosting serve Web files without local agent middleware. Codex and owner-side pairing routes are supplied by `vite.config.ts` in development and `scripts/desktop.mjs` in desktop mode. A static preview does not verify local agent integration.

For a desktop run without automatically opening a browser:

```sh
pnpm build
node scripts/desktop.mjs --no-open
```

Stop development, preview, demo and desktop processes with Ctrl+C in their terminal. The desktop launcher also closes its agent resources. `Progress.command` (macOS), `Progress.bat` (Windows) and `scripts/dev.sh` are convenience wrappers; Node and pnpm still need to be installed. The shell wrappers have an optional Codex runtime fallback.

### Local process settings

These environment variables are read by Node scripts, not embedded as Web configuration. Set them using your shell's environment-variable syntax before starting the process.

| Variable | Default / purpose |
| --- | --- |
| `PROGRESS_PORT` | Desktop Web server port, default `5180` |
| `PROGRESS_DEMO_PORT` | Synthetic HTTP source port, default `8787` |
| `PROGRESS_CODEX_BIN` | Optional Codex executable path, checked before PATH and bundled app locations |
| `PROGRESS_AGENT_HOME` | Pairing identity/device state directory, default `.progress-agent/` relative to the working directory |
| `PROGRESS_AGENT_BIND` | Set to `127.0.0.1` to restrict the separate pairing listener to loopback; otherwise it binds to `0.0.0.0` when started |

The pairing listener is separate from the loopback Web server and starts through the pairing flow. Using loopback restricts remote-device pairing. Keep development servers off the public internet.

## Find the code

| Location | Responsibility |
| --- | --- |
| [`src/main.tsx`](../src/main.tsx), [`src/App.tsx`](../src/App.tsx) | Load/upgrade workspace; navigation, configuration and import confirmation |
| [`model.ts`](../src/core/model.ts), [`validation.ts`](../src/core/validation.ts), [`metrics.ts`](../src/core/metrics.ts) | Types, workspace/component validation and PDM normalization |
| [`runtime.ts`](../src/core/runtime.ts), [`providers.ts`](../src/core/providers.ts), [`sourceState.ts`](../src/core/sourceState.ts) | Collection adapters, connection selection and freshness/error states |
| [`useMetrics.ts`](../src/hooks/useMetrics.ts) | Polling, cancellation, retry, visibility and subscriptions |
| [`storage.ts`](../src/core/storage.ts), [`vault.ts`](../src/core/vault.ts), [`packages.ts`](../src/core/packages.ts) | Persistence, device secrets, export/import and conflicts |
| [`grid.ts`](../src/core/grid.ts), [`cardGroups.ts`](../src/core/cardGroups.ts), [`gestures.ts`](../src/core/gestures.ts) | Integer grid, local reflow, grouping and input intent |
| [`src/ui/`](../src/ui/), [`src/styles.css`](../src/styles.css) | Cards, renderers, dialogs, search, motion and responsive presentation |
| [`scripts/`](../scripts/), [`extension/`](../extension/) | Local agents, demo/package/build scripts and optional MV3 collector |
| [`tests/`](../tests/), [`examples/`](../examples/), [`spec/`](../spec/) | Regression inputs, declarative components and format contracts |

## Data during development

Browser workspaces belong to their origin. `localhost`, `127.0.0.1`, different ports and the hosted site have separate storage. Use a dedicated browser profile for experiments and export a backup before migration or destructive storage debugging. Changing the origin can explain an apparently empty workspace.

Workspace configuration, device credentials and sample caches have different lifecycles; see the [storage map](ARCHITECTURE.md#storage-and-portability). Normal exports strip connection credentials, account bindings and collection consent. Legacy configuration may still contain private URLs; export checks are not a general redaction guarantee. Use synthetic data in shared reproductions.

## Troubleshooting

| Symptom | Check / recovery |
| --- | --- |
| Install or build fails on Node 20 | Use Node 22.12+ and install again with `--frozen-lockfile` |
| Frozen install reports a manifest/lockfile mismatch | Review changes to `package.json` and `pnpm-lock.yaml`; update both deliberately for dependency changes |
| Development server cannot start | Verify dependencies and port 5173; use a free port if needed |
| Manual cards work but HTTP does not | Use the full JSON endpoint; inspect CORS, mixed content, permissions and [PDM validation](PDM.md) |
| HTTP demo fails from preview/desktop | Its allowlist covers development port 5173; explicitly allow your chosen local origin in the demo server |
| Codex unavailable on hosted site or preview | Use local development/desktop mode with Codex installed and signed in, then confirm the account |
| Workspace empty after changing URL | Return to the previous origin or import your backup |
| Saved workspace cannot be read | Preserve the browser data; the app starts a temporary workspace with automatic persistence disabled until explicit recovery |
| Background collector does not respond | Build/install or reload the extension, reload Progress and follow [Chrome background collection](Chrome_Background.md) |

Do not disable browser protections to bypass network failures. Report the environment, exact steps, expected/actual behavior and a redacted reproduction when opening an issue.

## Validate and contribute

Follow [Testing](TESTING.md) and [Contributing](../CONTRIBUTING.md). Preserve the Component → Instance → Metric → Card separation and workspace compatibility. Public documentation must work from a fresh clone without local development records.

The repository has no configured CI workflow. Run local checks before submitting. `main` is connected to Cloudflare Pages: pushes there trigger deployment. The Web build command is `pnpm build`, with output directory `dist`. Other static hosts can serve that output; extension origins must be updated explicitly for a different deployment.

The public source includes Capacitor dependencies and platform-aware storage code; the Android project and local device build scripts are excluded. The `android:*` package commands require that absent local project and are outside this Web checkout's setup. Real Android/iPhone testing and installed-Chrome alarm acceptance are separate checks; see [verification limits](TESTING.md#verification-limits).
