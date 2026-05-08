#!/usr/bin/env node
// cortex-hermes.cjs — Sprint 4.7 backward-compat shim.
//
// Renamed to cortex-steward.cjs in Sprint 4.7. This shim forwards every
// invocation to the new entrypoint and emits a one-line deprecation warning
// to stderr. Removed in v0.2.0.
//
// Set STEWARD_SUPPRESS_DEPRECATION=1 to silence the warning.

'use strict';

if (process.env.STEWARD_SUPPRESS_DEPRECATION !== '1') {
  process.stderr.write(
    '[steward:deprecation] `cortex-hermes` was renamed to `cortex-steward` in ' +
    'Sprint 4.7. This shim is removed in v0.2.0 — please update your scripts/cron.\n'
  );
}

const { main } = require('./cortex-steward.cjs');
process.exit(main(process.argv));
