#!/usr/bin/env bash
set -euo pipefail
PROGRESS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROGRESS_ROOT"
if ! command -v node >/dev/null 2>&1; then export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"; fi
if ! command -v pnpm >/dev/null 2>&1; then export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:$PATH"; fi
exec pnpm dev
