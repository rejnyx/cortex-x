// bin/steward/_lib/external-adapter.cjs — Sprint 3.4 v0
//
// Pure-deterministic SKILL.md `external_dependency` frontmatter parser
// + license-tier gate. v0 ships the INVOCATION CONTRACT (schema +
// validation + gate), not the executor — per Sprint 3.4 R1 (`docs/
// research/sprint-3.4-external-adapters-research-2026-05-11.md`):
// "The HARD part is the invocation contract; the per-tool wrapper is
// thin."
//
// v0 scope:
//   - Parse SKILL.md frontmatter, extract `external_dependency` block
//   - Validate against schema (repo URL, install_cmd, version, license_tier,
//     secret_env)
//   - License gate: refuse to run `license_required` adapters when
//     STEWARD_LICENSE_AUTHORIZED=<adapter-slug> env unset
//   - Resolve workspace path `~/.cortex/external/<slug>/`
//
// v1+ (deferred):
//   - Docker-per-action sandbox (matches existing execute.cjs mutex model)
//   - git clone + install command execution
//   - Cost attribution rollup into journal
//   - First real adapter wiring (Hyperframes — Apache-2.0, oss-permissive)
//   - Second adapter (Remotion — proves license_required + per_invocation
//     metered tier)

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const LICENSE_TIERS = new Set([
  'oss-permissive',       // Apache-2.0 / MIT / BSD — no gate
  'license_required',     // Operator must accept license — gated by env
  'seat_metered',         // Per-seat billing (Figma plugins, etc.)
  'per_invocation_metered', // Per-call billing (Remotion Automators, etc.)
]);

const URL_RE = /^https?:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/;
const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;
// Allow semver-constraint operators: ^, ~, >=, etc. in addition to plain
// version strings. Bounded length + char allowlist keeps the surface narrow.
const VERSION_RE = /^[A-Za-z0-9.^~<>=*_-]{1,64}$/;

// Sprint 3.4 v0 R2 (security-auditor HIGH Finding 2): explicit allowlist
// for install_cmd. v0 ships the invocation contract — if the contract
// allows arbitrary 256-char strings, v1's executor (child_process) inherits
// shell-injection exposure. Allowlist excludes shell metacharacters: ; & |
// $ ` ( ) { } < > ' " newline. Permits typical `npm/pip/cargo install`
// invocations + flags + URLs but not chaining or substitution.
const INSTALL_CMD_RE = /^[A-Za-z0-9 @\/.:_^~=*+,?-]{1,256}$/;

function parseFrontmatter(content) {
  if (typeof content !== 'string' || !content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return null;
  return content.slice(4, end);
}

// Sprint 3.4 v0 — minimal YAML-ish line parser (matches the existing
// SKILL.md convention: `key: value` lines, no nesting). For nested
// external_dependency block we use indented key:value.
function readExternalDependencyBlock(frontmatterRaw) {
  if (typeof frontmatterRaw !== 'string') return null;
  const lines = frontmatterRaw.split(/\r?\n/);
  let inBlock = false;
  const block = {};
  for (const line of lines) {
    if (/^external_dependency\s*:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      // Indented `  key: value` line
      const m = line.match(/^\s{2,}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
      if (m) {
        let v = m[2].trim();
        // Strip surrounding quotes
        if ((v.startsWith('"') && v.endsWith('"'))
            || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        block[m[1]] = v;
        continue;
      }
      // Non-indented or empty line ends the block
      if (line.trim() === '' || /^[A-Za-z_]/.test(line)) {
        inBlock = false;
      }
    }
  }
  return Object.keys(block).length > 0 ? block : null;
}

/**
 * Validate the parsed external_dependency block.
 * @returns {object} { ok, code?, path?, error? }
 */
function validateExternalDependency(block) {
  if (!block || typeof block !== 'object') {
    return { ok: false, code: 'EXTERNAL_DEP_MISSING', error: 'external_dependency block missing or empty' };
  }
  if (typeof block.repo !== 'string' || !URL_RE.test(block.repo)) {
    return { ok: false, code: 'EXTERNAL_DEP_INVALID', path: 'repo', error: 'must be HTTPS URL' };
  }
  if (typeof block.install_cmd !== 'string' || !INSTALL_CMD_RE.test(block.install_cmd)) {
    return {
      ok: false,
      code: 'EXTERNAL_DEP_INVALID',
      path: 'install_cmd',
      error: 'must match install-cmd allowlist (alphanumeric + @/.:_-^~=*+,? — shell metacharacters ; & | $ ` ( ) { } rejected)',
    };
  }
  if (block.version !== undefined) {
    if (typeof block.version !== 'string' || !VERSION_RE.test(block.version)) {
      return { ok: false, code: 'EXTERNAL_DEP_INVALID', path: 'version', error: 'must match version pattern' };
    }
  }
  if (typeof block.license_tier !== 'string' || !LICENSE_TIERS.has(block.license_tier)) {
    return { ok: false, code: 'EXTERNAL_DEP_INVALID', path: 'license_tier', error: `must be one of: ${[...LICENSE_TIERS].join(', ')}` };
  }
  if (block.adapter_slug !== undefined && !SLUG_RE.test(String(block.adapter_slug))) {
    return { ok: false, code: 'EXTERNAL_DEP_INVALID', path: 'adapter_slug', error: 'must match /^[A-Za-z0-9_-]{1,64}$/' };
  }
  if (block.secret_env !== undefined) {
    if (typeof block.secret_env !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(block.secret_env)) {
      return { ok: false, code: 'EXTERNAL_DEP_INVALID', path: 'secret_env', error: 'must be SCREAMING_SNAKE_CASE env name' };
    }
  }
  return { ok: true };
}

/**
 * Resolve the workspace path for an external adapter.
 * @param {string} slug — adapter slug, must pass SLUG_RE
 * @returns {string} absolute path under $CORTEX_DATA_HOME/external/<slug>/
 */
function resolveAdapterWorkspace(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    throw new Error(`external-adapter: slug must match /^[A-Za-z0-9_-]{1,64}$/ (got "${slug}")`);
  }
  const home = process.env.CORTEX_DATA_HOME || path.join(os.homedir(), '.cortex');
  return path.join(home, 'external', slug);
}

/**
 * License-tier gate. Returns { ok, code, error? } describing whether
 * the adapter is permitted to execute under the current operator env.
 *
 *   - oss-permissive       → always allowed
 *   - license_required     → must have STEWARD_LICENSE_AUTHORIZED=<slug>
 *   - seat_metered         → must have STEWARD_LICENSE_AUTHORIZED=<slug>
 *   - per_invocation_metered → must have STEWARD_LICENSE_AUTHORIZED=<slug>
 *                              + optional cost-cap (Sprint 4.0 expands)
 */
function checkLicenseGate(adapterSlug, licenseTier, env = process.env) {
  if (!LICENSE_TIERS.has(licenseTier)) {
    return { ok: false, code: 'LICENSE_TIER_UNKNOWN', error: `unknown tier "${licenseTier}"` };
  }
  if (licenseTier === 'oss-permissive') return { ok: true };
  const authVar = (env.STEWARD_LICENSE_AUTHORIZED || '').trim();
  if (!authVar) {
    return {
      ok: false,
      code: 'LICENSE_NOT_AUTHORIZED',
      error: `adapter "${adapterSlug}" has license_tier=${licenseTier} but STEWARD_LICENSE_AUTHORIZED env is unset. Set STEWARD_LICENSE_AUTHORIZED=${adapterSlug} after accepting the upstream license.`,
    };
  }
  // Comma-separated list of authorized slugs
  const authorized = authVar.split(',').map((s) => s.trim()).filter(Boolean);
  if (!authorized.includes(adapterSlug)) {
    return {
      ok: false,
      code: 'LICENSE_NOT_AUTHORIZED',
      error: `adapter "${adapterSlug}" not in STEWARD_LICENSE_AUTHORIZED (have: ${authorized.join(', ')})`,
    };
  }
  return { ok: true };
}

/**
 * Parse an adapter SKILL.md file end-to-end: parse frontmatter →
 * extract external_dependency block → validate → return shape.
 *
 * @param {string} skillPath — absolute path to SKILL.md
 * @returns {object} { ok, adapter?, code?, error? }
 */
function loadAdapterFromSkill(skillPath) {
  let content;
  try { content = fs.readFileSync(skillPath, 'utf8'); }
  catch (err) { return { ok: false, code: 'SKILL_READ_FAILED', error: err && err.message }; }
  const fmRaw = parseFrontmatter(content);
  if (!fmRaw) {
    return { ok: false, code: 'SKILL_NO_FRONTMATTER', error: 'no frontmatter found' };
  }
  const block = readExternalDependencyBlock(fmRaw);
  if (!block) {
    return { ok: false, code: 'EXTERNAL_DEP_MISSING', error: 'no external_dependency block in frontmatter' };
  }
  const validation = validateExternalDependency(block);
  if (!validation.ok) return { ...validation, raw: block };

  // Sprint 3.4 v0 R2 (security-auditor HIGH Finding 4): directory-name
  // is authoritative for the adapter slug, NOT the frontmatter claim. A
  // malicious skill at evil-skill/SKILL.md cannot claim adapter_slug:
  // hyperframes and shadow the legitimate adapter's workspace +
  // STEWARD_LICENSE_AUTHORIZED grant. CWE-345 / CWE-706.
  const dirSlug = path.basename(path.dirname(skillPath));
  if (!SLUG_RE.test(dirSlug)) {
    return {
      ok: false,
      code: 'EXTERNAL_DEP_DIRNAME_INVALID',
      error: `skill directory name "${dirSlug}" must match /^[A-Za-z0-9_-]{1,64}$/`,
    };
  }
  if (block.adapter_slug && block.adapter_slug !== dirSlug) {
    return {
      ok: false,
      code: 'EXTERNAL_DEP_SLUG_MISMATCH',
      error: `adapter_slug "${block.adapter_slug}" in frontmatter must match directory name "${dirSlug}" — directory is authoritative to prevent slug-spoofing`,
    };
  }

  return {
    ok: true,
    adapter: {
      slug: dirSlug, // directory wins
      repo: block.repo,
      install_cmd: block.install_cmd,
      version: block.version || null,
      license_tier: block.license_tier,
      secret_env: block.secret_env || null,
    },
  };
}

/**
 * High-level: given a skill dir, load + validate + gate-check.
 */
function probeAdapter(skillDir, env = process.env) {
  const skillPath = path.join(skillDir, 'SKILL.md');
  const loaded = loadAdapterFromSkill(skillPath);
  if (!loaded.ok) return loaded;
  const gate = checkLicenseGate(loaded.adapter.slug, loaded.adapter.license_tier, env);
  if (!gate.ok) {
    return { ok: false, code: gate.code, error: gate.error, adapter: loaded.adapter };
  }
  return {
    ok: true,
    adapter: loaded.adapter,
    workspace: resolveAdapterWorkspace(loaded.adapter.slug),
  };
}

module.exports = {
  LICENSE_TIERS,
  parseFrontmatter,
  readExternalDependencyBlock,
  validateExternalDependency,
  resolveAdapterWorkspace,
  checkLicenseGate,
  loadAdapterFromSkill,
  probeAdapter,
};
