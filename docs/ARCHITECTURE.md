# Architecture

Data source → Provider / Connection / Agent → PDM → Renderer → Card.

Progress owns collection lifecycle, validation, freshness, storage, formatting, navigation and rendering. Source-specific business rules belong to adapters / agents, not the grid or renderer.

A Component defines a manifest, runtime and configuration schema. An Instance stores a configured component and can be shared by cards. A Metric is one stable PDM item within an instance. A Card refers to instanceId + metricId and owns its display preferences, renderer, color and layout.

Provider definitions and Connections describe supported authentication and transport. Secrets use the local vault; exported workspaces omit connection credentials. Codex credentials remain in Codex. Pairing is an explicit local agent flow, not a hosted account / cloud synchronization service.

The HTTP runtime requests a configured URL after network consent, omits browser cookies, rejects redirects, limits responses to 2 MB and normalizes PDM. Failed collection preserves the last successful sample; connection state is separate from business lifecycle.

Renderers consume validated data; they do not infer completion from a label or hide errors by inventing zero. Workspace Grid controls the card footprint. Display budgeting measures the actual content area and temporarily hides whole low-priority fields without modifying saved selection. Groups reference original cards and preserve their instances / metrics.

`src/core/packages.ts` handles `.progressmod` component ZIPs, `.progress` workspace JSON and `.progresspack` workspace ZIPs. Modules are declarative supported runtimes, not arbitrary JavaScript plugins. Import validates manifests, schemas and relationships. Schemas / runtime validation are the current authority; the formats are still evolving.
