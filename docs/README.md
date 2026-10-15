# Documentation

Start with the [project README](../README.md) or [简体中文说明](../README.zh-CN.md).

New contributors: follow [Development](DEVELOPMENT.md) or the [中文开发指南](DEVELOPMENT.zh-CN.md), then read [Architecture](ARCHITECTURE.md). To connect a service or create a module, continue with [Extending Progress](EXTENDING.md). Use [Testing](TESTING.md) before submitting changes.

| Document | Purpose |
| --- | --- |
| [Development](DEVELOPMENT.md) / [中文开发指南](DEVELOPMENT.zh-CN.md) | Fresh checkout, commands, execution modes, source map and troubleshooting |
| [Architecture](ARCHITECTURE.md) | Data ownership, collection lifecycle, storage/portability, agents and layout profiles |
| [Extending Progress](EXTENDING.md) | HTTP sources, declarative component packages and runtime/provider/renderer contributions |
| [Testing](TESTING.md) | Automated checks, synthetic smoke flows, UI/input regression and verification limits |
| [PDM](PDM.md) | HTTP JSON progress data and examples |
| [Chrome background collection](Chrome_Background.md) | Optional extension installation, permissions and limits |
| [Repository contents](REPOSITORY.md) | What belongs in GitHub and what stays local |
| [Prototype contract](../spec/Prototype_Contract_v0.1.md) | Component packages and compatible workspace extensions |
| [Provider and pairing contract](../spec/Provider_Pairing_Contract_v0.5.md) | Connections, credentials and device pairing |
| [Contributing](../CONTRIBUTING.md) | Change scope and required checks |

Schema filenames retain their format version; they do not identify the current app version. Current formats are defined by the schemas and runtime validation together.
