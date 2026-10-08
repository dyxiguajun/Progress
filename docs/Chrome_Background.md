# Chrome background collection

The hosted Progress web app is static and local-first. Its HTTP cards read an existing JSON progress API; visiting a website successfully does not mean its home page returns progress data. A response must follow [PDM v1](PDM.md). If the source is on a different origin, ordinary web collection also needs appropriate CORS headers. HTTPS pages cannot directly read HTTP endpoints.

A domain alone does not create an API. The task's service or agent must publish the data. The browser extension collects that data; it does not run rclone, execute shell commands, or keep remote transfer tasks alive.

## Build and install locally

Requires Chrome 120 or newer and the repository's Node/pnpm toolchain:

```sh
pnpm extension:build
```

This creates `artifacts/progress-background/` and `artifacts/progress-background-v0.6.5.zip`. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked** with the generated directory. This is a local developer build, not a Chrome Web Store release. Reload Progress after installing or updating the extension.

1. Click the extension's action to open its settings.
2. Enter the full JSON progress endpoint, including `https://` and any path, port or query parameters; approve that host's Chrome permission.
3. Open the corresponding HTTP card's configuration in Progress, allow network access, and enable **关闭网页后继续采集**.
4. Test the connection, select the metrics, and save. Initial configuration testing performs a one-time read; scheduled collection starts only after saving.
5. Close the Progress page. Chrome's alarms continue collecting approved sources. Reopen Progress to read the cached results. Disable the connection's background option to unregister it; the extension settings also support revoking hosts and clearing all scheduled sources and cached metrics.

The web bridge supports the project's Cloudflare Pages origin and local development on localhost/127.0.0.1. Other hosted deployments must explicitly add their origin to both `manifest.json` and `approvedOwner` and rebuild. The extension does not inject into arbitrary websites.

## Scheduling and data

Manifest V3 uses an event-driven service worker, not a permanently resident process. Alarms run at a minimum 30-second cadence and can be delayed by browser/device power management. Chrome must keep running. Device sleep, browser shutdown and offline periods pause useful collection; startup and the next alarm restore scheduling from local storage. Actual transfers should run in their own agent/service.

Only explicitly approved **complete endpoint URLs** are fetched. Chrome host permission is additionally required; granting a host alone does not permit the Progress page to query other paths. Redirects and embedded username/password credentials are rejected. Requests omit browser login cookies; this version does not add an Authorization header. Responses are limited to 2 MB, normalized against PDM, and cached locally. Failed samples preserve the last good metrics and report an error instead of inventing progress.

Endpoint addresses and cached metrics are stored in `chrome.storage.local`, not sent to a Progress server. URLs can themselves contain private tokens; treat extension storage as local application data. Export/import strips network and background consent and never carries Chrome host grants. Desktop and mobile layouts remain in the workspace package, without copying permission state.

Mobile browsers without this extension keep using foreground web collection. No Android source or APK is changed by this feature. Mobile background execution requires a separate platform adapter.

## Verification boundary

Automated tests cover scheduling, recovery after worker recreation, exact endpoint/host permissions, owner rejection, source removal, caching, response validation and failed reads. They use a mock Chrome API. Loading the extension, granting permissions, closing a real Chrome page, and observing alarms after a worker has been suspended still need real Chrome acceptance testing.

References: [Chrome service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms), [cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS).
