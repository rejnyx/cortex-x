'use strict';

/**
 * env.cjs — Sprint 4.7 Steward rebrand env-var compat layer.
 *
 * Reads `STEWARD_<NAME>` first, falls back to `HERMES_<NAME>` with a
 * one-time deprecation warning per process. The HERMES_* aliases are
 * removed in v0.2.0; this layer exists so existing operator setups keep
 * working through the rename.
 *
 * Scope:
 *   - All Steward-scoped env vars route through `readEnv(NAME)`.
 *   - Halt sentinel filename (`.cortex/HERMES_HALT` vs `STEWARD_HALT`)
 *     is a filename, not an env var — handled in halt-check.cjs.
 *   - Git trailers (`Hermes-Action-Id` vs `Steward-Action-Id`) handled
 *     in git-trailers.cjs.
 *
 * Suppression: set `STEWARD_SUPPRESS_DEPRECATION=1` in CI/test envs to
 * silence the deprecation banner. Production stderr stays informative.
 */

const warned = new Set();

function readEnv(name) {
  const stewardKey = `STEWARD_${name}`;
  const hermesKey = `HERMES_${name}`;
  const stewardVal = process.env[stewardKey];
  if (stewardVal !== undefined) return stewardVal;
  const legacy = process.env[hermesKey];
  if (legacy !== undefined) {
    if (!warned.has(hermesKey) && process.env.STEWARD_SUPPRESS_DEPRECATION !== '1') {
      warned.add(hermesKey);
      try {
        process.stderr.write(
          `[steward:deprecation] ${hermesKey} is renamed to ${stewardKey} in Sprint 4.7. ` +
          `The ${hermesKey} alias will be removed in v0.2.0. ` +
          `Set STEWARD_SUPPRESS_DEPRECATION=1 to silence.\n`
        );
      } catch { /* stderr unavailable in some test runners */ }
    }
    return legacy;
  }
  return undefined;
}

function _resetWarnedForTests() {
  warned.clear();
}

module.exports = { readEnv, _resetWarnedForTests };
