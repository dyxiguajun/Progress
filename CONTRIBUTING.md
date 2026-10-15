# Contributing

Start with the [developer guide](docs/DEVELOPMENT.md) or [中文开发指南](docs/DEVELOPMENT.zh-CN.md). The [architecture](docs/ARCHITECTURE.md), [extension points](docs/EXTENDING.md) and [testing guide](docs/TESTING.md) describe the current v0.6.5 implementation. For broad changes, discuss the intended behavior in an issue with a small, redacted reproduction.

## Prepare a change

1. Create a topic branch from current `main` (for example, `git switch -c docs/improve-setup`). Keep each contribution focused on one problem.
2. Preserve Component / Instance / Metric / Card ownership and existing workspace compatibility. Source adapters own collection and business interpretation; renderers consume validated metrics.
3. Include a regression test when it establishes a meaningful behavior or fixes a bug. Update schemas, examples and public docs when their contract changes.
4. Complete the relevant configuration, persistence and export/import flows, including failure recovery. Report any deliberate capability boundary.

## UI and interaction requirements

Prioritize the user's information. Use functional labels in operational pages, keep healthy states quiet and give actionable recovery for failures. Examples must be opt-in and clearly simulated.

Cards use supported integer-span variants resolved from the actual container. Preserve local reflow, independent desktop/mobile layout profiles, direct configuration, long-press/right-click menus, native touch scrolling while editing and non-drag alternatives. Grouping uses the fixed 24px inset plus 420ms dwell. Optional fields can hide as whole items when space is insufficient, while saved preferences remain intact.

Check keyboard focus, readable text, reduced motion and source states as part of the [UI/input regression](docs/TESTING.md#ui-and-input-regression). Avoid adding product slogans, decorative counts or fake live readings to daily-use pages.

## Validate and submit

Run `pnpm test` and `pnpm build`; also run `pnpm extension:build` when changing the extension or shared collection code. CI is not configured. A docs-only change should check links, examples and source accuracy; it does not need tests that merely repeat the prose.

Review `git status --short`, stage named paths, and inspect `git diff --cached --check` and the full staged diff. Never include real credentials, private endpoints, account screenshots or exported user workspaces. Generated output and local development records stay ignored; see [repository contents](docs/REPOSITORY.md).

In the pull request, state the problem, resulting behavior, actual checks and remaining limitations. Distinguish mocks/simulated viewports from real browser, device and account acceptance. Include tool/browser versions when they affect reproduction. Keep logs and screenshots synthetic or redacted.

Open a pull request against `main`. The branch is connected to Cloudflare Pages, so merging there triggers the configured deployment. Production deployment and any binary release need their own verification; Web build success does not establish phone or installed-extension acceptance.
