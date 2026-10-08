# Progress Data Model

The HTTP runtime accepts one metric object, an array of 1–100 metrics, or `{ "metrics": [...] }`. A single object may omit id / name (defaults main / 当前进度); array members need unique non-empty ids and names, at most 200 characters each.

This is simulated data, not a real transfer:

```json
{"id":"transfer","name":"Example Transfer","kind":"range","value":42,"max":100,"unit":"percent","meaning":"completed","status":"running"}
```

## Types and semantics

- range: finite numeric value, required finite max greater than min (default 0).
- gauge / counter: finite numeric value.
- time_range: valid ISO end; optional start must precede end. Without start it has no proportion.
- state: non-empty text value.
- indeterminate: optional finite count; no invented total or percentage.

JSON null is not a valid numeric reading. Omit optional data rather than substitute zero. `meaning=completed` describes the measured quantity; only `status=completed` declares completion. Meaning and status are text, with known meanings / lifecycle labels used for presentation; unknown labels do not authorize semantic guesses.

Range proportion is `(value - min) / (max - min)`. The graphic is clamped to 0–100%; raw values are retained. `remaining` is not automatically inverted. Near-full ranges are not rounded up to completed. Bytes use binary units; bytes_per_second is formatted as a rate.

Optional ISO observed_at and nonnegative stale_after (seconds) describe freshness. HTTP defaults absent observed_at to receipt time and stale_after to three refresh intervals. Collection failure retains last-known-good data and reports the connection problem independently of task state.

Optional secondary contains up to 20 finite numeric role/value/unit items, with optional stable id / label (≤200 characters; ids unique within the metric). Other independent metrics can be selected for display in v0.6.4. Unknown / extra properties such as arbitrary meta are discarded by normalization, not automatically displayed. Missing selected fields keep their preferences but do not invent data.

## Local URL example

Start `pnpm dev` at its normal port 5173. In another terminal:

```sh
node scripts/demo-source.mjs
```

In Progress, choose Add → presets → URL Progress, enter `http://127.0.0.1:8787/progress`, allow network access, test and add a metric. UI labels currently use Chinese. This deliberately simulated Node endpoint permits CORS for localhost / 127.0.0.1 port 5173. Other ports / origins need explicit server CORS configuration. HTTPS pages cannot assume permission to access insecure HTTP LAN services.

The built-in URL Progress preset currently accepts only an endpoint; it does not expose a Token Key or Authorization-header setting. A third-party declarative module can define a Token Key configuration field and substitute it through its URL template, which is not a generic header or OAuth implementation. Avoid real credentials in example URLs. The separate Provider connection workflow supports declared API-key / Bearer / endpoint-secret authentication and local vault storage. Inspect the provider contract before choosing an authenticated source. Never publish a workspace containing private endpoint or token configuration.

See `src/core/model.ts`, `validation.ts`, `runtime.ts` and `spec/pdm-v0.1.schema.json` for the executable contract.
