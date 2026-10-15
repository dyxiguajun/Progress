# Progress

A minimal, extensible, local-first workspace for tracking anything measurable.

**Progress is a container, not the content. Less is More.**

Try Online: https://progress-dyxiguajun.pages.dev/

[简体中文](README.zh-CN.md)

Progress separates data sources from presentation. Local goals, time ranges, HTTP metrics and supported quota providers become cards in a workspace stored on your device.

## Current capabilities

- Progress bars, rings, numbers and fill renderers; card details and configuration.
- Sixteen rectangular card sizes, horizontal / vertical arrangement, drag, resize and grouped cards.
- Compact four-column phone grid with separately saved mobile / desktop layouts.
- Optional Chrome extension for collecting approved HTTP sources after closing the page.
- Optional display fields and ordering; whole fields hide when space is insufficient and return after resizing.
- HTTP JSON / URL Progress, reusable component packages and workspace import / export.
- Local Codex quota integration through the desktop agent; credentials remain managed by Codex.

## Quick start

Use Node.js **22.12 or newer** and pnpm **9 or newer**.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the local address printed by Vite (normally `http://127.0.0.1:5173`). The initial workspace is empty; examples are opt-in and explicitly simulated. No real service credentials are needed to develop.

```sh
pnpm test
pnpm build
```

For the local browser + agent desktop workflow, use `pnpm desktop`. Codex must be installed and signed in to read its quota. Static hosting does not include the local agent.

## Data and development

- [Documentation index](docs/README.md)
- [Developer guide](docs/DEVELOPMENT.md) / [中文开发指南](docs/DEVELOPMENT.zh-CN.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Extending Progress](docs/EXTENDING.md)
- [Testing and validation](docs/TESTING.md)
- [PDM and URL Progress](docs/PDM.md)
- [Chrome background collection](docs/Chrome_Background.md)
- [Contributing](CONTRIBUTING.md)
- [Repository contents](docs/REPOSITORY.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

Current Web source: **v0.6.5**, early development. Interfaces and package formats may change. This initial source distribution focuses on Web; it does not include an updated Android APK or Android build output. Real hardware and service integration coverage is still evolving.

## License

Original project code is licensed under [MIT](LICENSE). Third-party components retain their own licenses. Service names and logos identify providers and do not imply endorsement.
