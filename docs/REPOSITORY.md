# Repository contents

GitHub contains the files needed to build, test and understand the Web app, local desktop agent and optional Chrome extension.

| Include in Git | Keep local and ignored |
| --- | --- |
| `src/`, `public/`, `index.html` | `node_modules/`, `dist/`, `coverage/`, TypeScript build cache |
| `extension/`, reproducible build and agent scripts | Generated extension files / ZIPs, APKs and screenshots in `artifacts/` |
| `tests/` and synthetic fixtures | Real accounts, private endpoints, workspaces and captured traffic |
| `examples/`, `spec/`, public `docs/` | Historical requests, handoffs and acceptance evidence in `docs/local/` |
| Package manifest, pnpm lockfile and build configuration | `.tools/`, `.progress-agent/`, environment files, keys and logs |
| README files, contribution guide, license and notices | Local `AGENTS.md`, `BUILD_STATUS.md`, Android project and device build scripts |

The two `.progressmod` files under `tests/fixtures/` are intentional regression inputs. Exported `.progress` and `.progresspack` user workspaces remain ignored. Build outputs are reproducible and do not belong in source commits; any future binary release needs its own version and validation record.

Local development records have an index at `docs/local/README.md` when present. That directory is deliberately absent from a fresh clone. Public documents must be understandable without private handoffs, machine paths or local evidence files. Preserve the component, instance, metric and card layers and existing workspace compatibility when reorganizing source.

## Before pushing

Run `pnpm test`, `pnpm build` and `pnpm extension:build` for changes affecting the extension or its shared code. Review `git status --short`, `git diff --cached --stat` and the staged diff. Stage named paths after reviewing them; do not force-add ignored development records or user data. Check new fixtures for real credentials and account data.

The project's Cloudflare Pages site is linked to `main`: pushing or merging there triggers the configured deployment. Use a topic branch for work that is still being reviewed. A successful source build does not establish real phone, extension installation or production deployment acceptance; record those checks separately.
