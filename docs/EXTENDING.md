# Extending Progress

[Development](DEVELOPMENT.md) · [Architecture](ARCHITECTURE.md) · [Testing](TESTING.md)

Choose the smallest extension point that fits the source. An existing service can emit PDM and use the built-in URL Progress preset. A reusable configuration can be distributed as a declarative `.progressmod`. A new transport or renderer requires a source-code contribution.

## Connect an HTTP source

Expose a full HTTP/HTTPS JSON endpoint following [PDM](PDM.md). One instance can return several metrics; use stable metric IDs so existing cards keep referring to the same reading. Return source timestamps and freshness limits where possible.

A minimal simulated reading is:

```json
{
  "id": "transfer",
  "name": "Example transfer",
  "kind": "range",
  "value": 42,
  "max": 100,
  "unit": "%",
  "meaning": "completed",
  "status": "running"
}
```

Run `pnpm dev` and, in another terminal, `node scripts/demo-source.mjs`. Add → presets → URL Progress, enter `http://127.0.0.1:8787/progress`, allow network access, test, choose metrics and save. UI labels currently use Chinese. Test failure/recovery by stopping and restarting the demo service.

The built-in HTTP preset exposes an endpoint, not arbitrary headers or login cookies. Direct Web collection requires CORS and compatible HTTPS/HTTP transport. The optional Chrome collector requires explicit endpoint/host approval; it does not convert a website homepage into a data API. Provider connections are a separate path for supported authentication methods.

## Create a declarative component

Use the committed examples as complete starting points:

| Example | Runtime | Files |
| --- | --- | --- |
| [Countdown](../examples/countdown/) | `time_range` | Manifest and configuration schema |
| [HTTP metrics](../examples/http/) | `http` | Manifest and endpoint configuration schema |
| [Transfer sample](../examples/transfer/) | `static` | Manifest, configuration schema and synthetic `data.json` |

Build installable examples with:

```sh
node scripts/pack-examples.mjs
```

This writes `artifacts/countdown.progressmod`, `artifacts/http.progressmod` and `artifacts/transfer.progressmod`. Import through Add → import component, configure the installed component, create a card, edit it and verify persistence. Generated packages remain ignored by Git.

For your own package, ZIP the files at the archive root, then use the `.progressmod` extension. The loader requires the exact names `manifest.json` and `config.schema.json`; `static` also requires `data.json`. Nested parent directories will not work as package roots.

### Manifest and runtime

The [HTTP manifest](../examples/http/manifest.json) demonstrates `schema: "progress/module/v1"`, a reverse-domain ID, a three-part numeric version, metadata, `configuration.schema`, runtime, permissions and default renderer. Use your own stable component ID to avoid collisions.

| Runtime | Contract |
| --- | --- |
| `time_range` | Configuration has ISO `end`, optionally `start`; start must precede end |
| `manual` | Configuration has finite `value`, positive `max`, string `unit` and `meaning` |
| `quota` | Local manual remaining quota; requires `value`, `max`, `unit`; does not connect to a real account |
| `static` | PDM metric array in `data.json`; `runtime.entry` must be `data.json` |
| `http` | `runtime.url` and declared `network` permission; optional refresh interval is at least 5 seconds |
| `provider_quota` | Supported provider/connection workflow; see the provider section below |
| `codex_usage` | Reserved for the official `dev.progress.codex-usage` preset |

URL templates replace `{{fieldName}}` with configuration values as strings. Substitution does not URL-encode them or create an Authorization header; prefer a complete endpoint field. Do not package real tokens or private endpoints.

The package is declarative. Arbitrary JavaScript/WASM, shell commands, custom configuration UI and executable custom renderers are not loaded from `.progressmod` files in v0.6.5.

### Generated configuration form

Use an object schema with at most 30 named properties. Field types are `string`, `number`, `integer` and `boolean`. Supported field keywords are `type`, `title`, `description`, `default`, `enum`, `format`, `minimum`, `maximum`, `minLength` and `maxLength`; the supported format is `date-time`. Root keywords are `type`, `properties`, `required`, `additionalProperties`, `$schema`, `title` and `description`.

Draft-07 and draft-2020-12 declarations use this restricted form subset. Nested objects, arrays, references and arbitrary schema keywords are not accepted. The host also applies runtime-specific semantic checks. See [`assertComponent` and `configErrors`](../src/core/validation.ts), rather than assuming all JSON Schema features are supported.

### Supported layouts

A manifest can declare `cardLayouts.default` and named `variants` containing integer `span.columns` / `span.rows`, optional labels and optional fallback IDs. A default must exist, fallback targets must exist and chains must be acyclic. See the [prototype contract](../spec/Prototype_Contract_v0.1.md) and [`grid.ts`](../src/core/grid.ts).

Declare only layouts that remain legible. The host resolves grid capacity, fallback, drag/resize, local reflow and persistence. Size changes must preserve the Component/Instance/Metric layers. Omitted layout declarations use the host's official layouts.

## Add a provider declaration

A `provider_quota` manifest can include `quotaProvider` with its ID/name, HTTPS help URL, credential instructions, required scopes and supported `connectionMethods`. Installed declarations accept `api-key`, `bearer`, `read-only-url`, `endpoint-secret` and `pairing`. Reserved provider IDs include `codex`, `manual` and `claude`; an installed declaration cannot claim them.

The generic direct adapter consumes compatible PDM quota readings. Service-specific responses need an adapter or upstream translator. Merely declaring a provider does not implement OAuth or account discovery. The broader TypeScript connection union is not a promise that every method is available to installed packages.

Review [`providers.ts`](../src/core/providers.ts), [`ProviderWizard.tsx`](../src/ui/ProviderWizard.tsx), [`vault.ts`](../src/core/vault.ts) and the [provider/pairing contract](../spec/Provider_Pairing_Contract_v0.5.md). Keep secrets in the device vault, preserve independent windows, re-confirm accounts after migration, and verify direct/relay failure and fallback paths. Codex credentials remain managed by Codex.

## Add a runtime or renderer in source

| Change | Update together |
| --- | --- |
| New runtime | `Runtime` in `model.ts`; `assertComponent` / `configErrors`; `runtime.ts` or `providers.ts`; collection lifecycle in `useMetrics.ts`; configuration flow and package compatibility |
| New built-in component | Definition/schema in `components.ts`; stable identity; upgrade behavior; complete add/edit flow; synthetic example if useful |
| New renderer | `Renderer` / `compatibleRenderers` in `model.ts`; validator; `MetricView.tsx` or dedicated view; configuration/preview controls; CSS and content budgeting |
| New PDM field | `Metric` and normalization in `metrics.ts`; semantic formatting; display field selection; schema/docs; import/export compatibility |
| New layout behavior | `grid.ts`, `WorkspaceGrid.tsx`, group/profile handling and supported variant validation |

Renderers receive validated data and source state. Keep network access and business interpretation in adapters. Preserve textual semantics, missing/invalid states, reduced motion, keyboard focus and small-card readability. A larger card may use a different arrangement; resize must not become arbitrary CSS scaling.

For each change, exercise **add → configure/test → create → refresh → edit → reload → export → import → reconnect**, including invalid data and failure recovery. Use targeted regression tests and the [validation matrix](TESTING.md). Update public contracts and developer docs when the supported behavior changes.
