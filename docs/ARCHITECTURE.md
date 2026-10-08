# Architecture

Data source → Provider / Connection / Agent → PDM → Renderer → Card.

Progress owns collection lifecycle, validation, freshness, storage, formatting, navigation and rendering. Source-specific business rules belong to adapters / agents, not the grid or renderer.

A Component defines a manifest, runtime and configuration schema. An Instance stores a configured component and can be shared by cards. A Metric is one stable PDM item within an instance. A Card refers to instanceId + metricId and owns its display preferences, renderer, color and layout.

Provider definitions and Connections describe supported authentication and transport. Secrets use the local vault; exported workspaces omit connection credentials. Codex credentials remain in Codex. Pairing is an explicit local agent flow, not a hosted account / cloud synchronization service.

The HTTP runtime requests a configured URL after network consent, omits browser cookies, rejects redirects, limits responses to 2 MB and normalizes PDM. Failed collection preserves the last successful sample; connection state is separate from business lifecycle.

Renderers consume validated data; they do not infer completion from a label or hide errors by inventing zero. Workspace Grid controls the card footprint. Display budgeting measures the actual content area and temporarily hides whole low-priority fields without modifying saved selection. Groups reference original cards and preserve their instances / metrics.

`src/core/packages.ts` handles `.progressmod` component ZIPs, `.progress` workspace JSON and `.progresspack` workspace ZIPs. Modules are declarative supported runtimes, not arbitrary JavaScript plugins. Import validates manifests, schemas and relationships. Schemas / runtime validation are the current authority; the formats are still evolving.

Mobile uses a four-column compact grid on narrow canvases. Desktop size and position remain in the existing Card layout fields; `layout.mobile` stores independent size, vertical position and horizontal position. Legacy packages fall back to the existing layout until mobile hints are generated. Groups use the same profile model. Both profiles survive export and import; copying and moving preserve size preferences while clearing destination positions.

The optional Chrome extension supplies a background HTTP transport through a narrowly scoped page bridge. An event-driven MV3 worker schedules approved sources using Chrome alarms and stores normalized samples locally. It requires both an explicitly approved complete endpoint URL and Chrome host permission. Network / background consent is local and stripped from exported packages. This adapter does not execute remote tasks or provide an Android / iOS background service. See [Chrome background collection](Chrome_Background.md).
