# Testing and validation

[Development](DEVELOPMENT.md) · [Contributing](../CONTRIBUTING.md)

Run checks from the repository root with dependencies installed. Automated tests use synthetic data, fake Codex and mock Chrome APIs; they do not require real service credentials.

## Automated checks

```sh
pnpm test
pnpm build
pnpm extension:build
```

`pnpm test` runs Vitest once. `pnpm build` runs `tsc -b` and Vite; TypeScript includes source, tests and the main configuration files. The extension has a separate build. Run it when changing the extension, its bridge, shared HTTP/PDM logic or extension build configuration. There is no configured CI workflow, lint script or separate end-to-end browser test command.

During development, select a relevant file or test name:

```sh
pnpm exec vitest run tests/core.test.ts
pnpm exec vitest run tests/grid.test.ts tests/mobile-background.test.ts
pnpm exec vitest run tests/core.test.ts -t 'PDM semantics and validation'
pnpm exec vitest tests/grid.test.ts
```

The final command watches for changes; stop it with Ctrl+C. Focused tests speed up iteration; run the full suite before submitting behavior changes.

| Test file(s) | Main coverage |
| --- | --- |
| `core.test.ts` | PDM semantics, workspace references/migration, component packages and HTTP runtime |
| `presentation.test.ts`, `display.test.ts` | Formatting, truthful metric presentation, optional fields and measured content budgeting |
| `ux-state.test.ts` | Source states, storage recovery, refresh configuration and missing-data behavior |
| `grid.test.ts` | Pointer intent, integer grid, supported variants, stable reflow and layout lifecycle |
| `card-groups.test.ts`, `scroll.test.ts` | Group references/intent, directional layouts and native input scrolling |
| `mobile-background.test.ts` | Mobile profile portability, all sixteen footprints, HTTP diagnostics and mock extension scheduling/cache/permissions |
| `motion-visual.test.ts` | Geometry and presentation helpers; not browser screenshot comparison |
| `codex.test.ts`, `codex-agent.test.mjs` | Quota adaptation, account binding, cache/portability and fake app-server protocol/HTTP guards |
| `providers.test.ts` | Connection references, provider semantics, source selection and continuation regressions |
| `pairing-agent.test.mjs`, `vault.test.ts` | Synthetic encrypted pairing, approval/revocation/restart behavior and device-store concurrency |

Pairing tests use temporary directories and local HTTP servers. Codex protocol tests point to [`fake-codex.mjs`](../tests/fixtures/fake-codex.mjs). Keep tests isolated from real identities, private endpoints and existing browser storage. New fixtures must be synthetic; see [fixture notes](../tests/fixtures/README.md).

## Pick checks by change

| Change area | Automated checks | Manual checks |
| --- | --- | --- |
| PDM / HTTP / runtime | Core, presentation, source-state and mobile/background tests; full suite + Web build; extension build for shared logic | Valid/malformed JSON, HTML, permissions, timeout/offline, last sample and recovery |
| Workspace / migration / packages | Core, providers, groups, mobile tests; full suite + Web build | Existing workspace reload; export/import with conflicts; both layout profiles; reconnect |
| Grid / cards / search / motion | Grid, groups, scroll, display, geometry tests; full suite + Web build | Input/layout matrix below, field budgeting and focus cleanup |
| Providers / local agents | Provider, Codex, pairing and vault tests; full suite + Web build | Complete configuration/reconnect flow; separately identified real-account/device checks |
| Chrome collector | Mobile/background tests; full suite + both builds | Installed Chrome lifecycle, exact URL/host grants, stop/revoke/cache behavior |
| Documentation only | Relative links, source/command accuracy, examples and public-file review | Fresh-clone instructions remain self-contained |

## Credential-free smoke flow

1. Run `pnpm dev` at its default origin and open a dedicated development browser profile.
2. Add a manual card, edit its value/name, change its size and reload. Verify configuration and layout persist.
3. Run `node scripts/demo-source.mjs` in another terminal. Add URL Progress with `http://127.0.0.1:8787/progress`, allow network access, test, select metrics and save. Confirm the synthetic transfer value changes.
4. Stop the demo source. Wait for the next read or refresh manually. Confirm an actionable connection error with the last valid sample retained. Restart and retry.
5. Run `node scripts/pack-examples.mjs`. Import a generated `.progressmod`, configure it and create/edit a card.
6. Export a synthetic workspace and import it into another development origin/profile. Complete the confirmation/conflict flow. Verify data relationships, display preferences and layouts; re-authorize network access on the target.

The demo server's CORS allowlist covers development port 5173. Other ports, preview or desktop require an explicit allowlist adjustment. Export/import can contain private ordinary URLs even when credentials are stripped; use synthetic workspaces.

## UI and input regression

Use wide/medium/narrow desktop, tablet and phone-sized canvases. Check light/dark appearance, long titles, many mixed-size cards and empty/loading/stale/error states. Preserve these interaction contracts:

- Resolve integer grid spans from the actual content container; resize switches supported variants and moves only conflicting neighbors where possible.
- Card configuration opens directly; stationary long press/right click opens context actions. Preserve a non-drag size/configuration path.
- Editing allows ordinary touch scrolling until a held drag/resize starts. Check release outside the card, pointer cancellation and Escape/explicit exits.
- Grouping uses a fixed 24px inset on all edges and 420ms dwell. Test enter/leave/cancel, group resize, copy/move and member removal.
- Desktop/mobile layouts remain independent through rotation, reload and export/import. Phone-sized canvases use the compact four-column layout.
- Small cards hide whole optional fields without changing saved preferences; enlarging restores them. Test supported renderers across the sixteen official footprints.
- Search repeatedly opens/closes through selection and Escape; source control, focus and inert cleanup remain correct. Test soft-keyboard/visual-viewport changes and reduced motion.
- Keyboard users can reach controls with visible focus; labels describe actions, errors have recovery actions and text remains readable at larger system font sizes.

A simulated narrow viewport establishes responsive behavior only. Real Android Chrome and iPhone Safari checks must cover native pan/long press, safe areas, keyboard/visual viewport, rotation, drag/resize and cancellation on actual devices. Browser geometry tests do not verify screen-reader behavior or animation quality.

## Installed Chrome collector

Follow [build/install instructions](Chrome_Background.md). Use an approved synthetic endpoint and record the Chrome version, extension version, exact endpoint and timestamps.

Verify a saved background source updates with the Progress page closed for at least 30 seconds while Chrome remains running. Test worker suspension, Chrome restart and cache recovery. Denying a complete endpoint, granting only its host, revoking permission, disabling background collection and removing a source must each have the intended effect. A failed read retains the last valid sample with an error.

Mock alarm tests cannot establish real worker suspension/restart behavior. Device sleep and browser shutdown can delay collection. This collector reads HTTP data; transfers or other jobs need their own service.

## Verification limits

Describe what actually ran, its environment and what remains untested. Build success, a mock API, browser pairing and real device/account acceptance are distinct evidence.

For v0.6.5, real Android/iPhone interaction, installed-Chrome closed-page alarm lifecycle, the complete renderer/size visual matrix, large mixed touch workspaces, accessibility/performance coverage and extension stress/concurrent-page behavior remain acceptance areas. Real-account, Windows-local and private-service integrations need their own evidence. The public checkout does not include the Android project or a current APK build.

The Web build may emit the existing chunk-size warning. Report warnings separately from errors; do not claim they demonstrate runtime performance. Keep detailed local screenshots/logs and private evidence out of Git.

## Before and after publishing

Review named staged files, `git diff --cached --check` and the staged diff. Check Markdown relative links against tracked files, and ensure public instructions do not depend on ignored documents, local machine paths or generated output. See [Repository contents](REPOSITORY.md).

Pushing `main` triggers the configured Cloudflare Pages deployment. Record the commit and deployment result separately. Check the production page and its JS/CSS assets after a successful deployment; an HTTP 200 alone does not prove that the intended build or its interactive flows are active. Do not present production availability as real phone or real-account acceptance.
