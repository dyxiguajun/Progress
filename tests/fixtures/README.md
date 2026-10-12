# Test fixtures

`rclone-transfer-v0.1.3.progressmod` retains the v0.1.3 manifest and configuration constraints. `rclone-transfer-fixed.progressmod` retains the earlier draft-2020-12 declaration and schema title. Both exercise component ZIP import and schema compatibility.

Endpoint defaults use loopback. Companion README, marker and transfer log files are synthetic and are not executed or collected. The archives contain no original agent scripts, personal filesystem paths, private network addresses or real transfer logs. ZIP entries use a fixed timestamp for reproducibility.

Keep these as portable regression inputs, not user workspace exports. `fake-codex.mjs` is a synthetic app-server fixture used by protocol tests.
