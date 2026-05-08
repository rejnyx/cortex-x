'use strict';

/**
 * env.cjs — STEWARD_* env-var reader.
 *
 * Single SSOT helper for env-var reads. `readEnv(NAME)` reads `STEWARD_<NAME>`.
 *
 * Sprint 4.7 introduced the rebrand (Hermes → Steward) with HERMES_*
 * backward-compat aliases honored through v0.2.0; the v0.2.0 release dropped
 * those aliases. Operators previously running with HERMES_* env vars must
 * rename to STEWARD_* — there is no warning fall-through anymore.
 */

function readEnv(name) {
  return process.env[`STEWARD_${name}`];
}

module.exports = { readEnv };
