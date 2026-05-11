// Sprint 2.7 — sibling-projects manifest validator.
//
// Reads cortex/sibling-projects.json (NOT yaml — zero-deps invariant) and
// validates the schema before passing to sibling-reader.cjs. JSON-only avoids
// a 200KB js-yaml dependency for a 4-entry list.
//
// Schema (R1 memo §2):
//   {
//     "version": 1,
//     "siblings": [
//       {
//         "id": "sibling-app",                          // kebab-case slug
//         "root": "${HOME}/dev/sibling-app",            // or ${USERPROFILE}/...
//         "read_only": true,                            // v1: must be true
//         "purpose": "pattern-transfer",
//         "paths_allowed": ["src/", "docs/"],           // prefix list
//         "paths_denied": [".env*", "secrets/", "**/*.pem"]  // glob list
//       }
//     ]
//   }
//
// Env expansion: only ${HOME} and ${USERPROFILE} → os.homedir(). All other
// ${VAR} references rejected (prevents ${PATH} traversal).

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MANIFEST_PATH = 'cortex/sibling-projects.json';
const SUPPORTED_VERSION = 1;
const ID_REGEX = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/i; // kebab-case slug
const ENV_VAR_REGEX = /\$\{([A-Z_]+)\}/g;
const ALLOWED_ENV_VARS = new Set(['HOME', 'USERPROFILE']);

// Normalize path on win32: forward-slash + lowercased drive letter.
function normalizePath(p) {
  if (typeof p !== 'string') return null;
  if (process.platform !== 'win32') return path.posix.normalize(p);
  // Windows: forward-slash + lower drive letter
  return path.posix.normalize(
    p.replace(/\\/g, '/').replace(/^([A-Z]):/, (_m, d) => d.toLowerCase() + ':')
  );
}

// Expand ${HOME} / ${USERPROFILE} only. Reject other ${VAR}.
function expandEnvVars(rawPath) {
  if (typeof rawPath !== 'string') return { ok: false, error: 'path is not a string' };
  let invalid = null;
  const expanded = rawPath.replace(ENV_VAR_REGEX, (match, varName) => {
    if (!ALLOWED_ENV_VARS.has(varName)) {
      invalid = varName;
      return match;
    }
    return os.homedir();
  });
  if (invalid !== null) {
    return { ok: false, error: `disallowed env var \${${invalid}}; only \${HOME} and \${USERPROFILE} are allowed` };
  }
  return { ok: true, expanded };
}

// Validate one sibling entry. Returns { ok, sibling|error }.
function validateSibling(s, index) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    return { ok: false, error: `sibling[${index}] is not an object` };
  }
  if (typeof s.id !== 'string' || !ID_REGEX.test(s.id)) {
    return { ok: false, error: `sibling[${index}].id must be a kebab-case slug (^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$)` };
  }
  if (typeof s.root !== 'string' || !s.root) {
    return { ok: false, error: `sibling[${index}].root must be a non-empty string` };
  }
  if (s.read_only !== true) {
    return { ok: false, error: `sibling[${index}].read_only must be exactly true (v1 has no write-capable siblings)` };
  }
  if (typeof s.purpose !== 'string' || !s.purpose) {
    return { ok: false, error: `sibling[${index}].purpose must be a non-empty string` };
  }
  if (!Array.isArray(s.paths_allowed) || s.paths_allowed.length === 0) {
    return { ok: false, error: `sibling[${index}].paths_allowed must be a non-empty array` };
  }
  if (!Array.isArray(s.paths_denied)) {
    return { ok: false, error: `sibling[${index}].paths_denied must be an array (may be empty)` };
  }
  for (let i = 0; i < s.paths_allowed.length; i += 1) {
    if (typeof s.paths_allowed[i] !== 'string' || !s.paths_allowed[i]) {
      return { ok: false, error: `sibling[${index}].paths_allowed[${i}] must be a non-empty string` };
    }
  }
  for (let i = 0; i < s.paths_denied.length; i += 1) {
    if (typeof s.paths_denied[i] !== 'string' || !s.paths_denied[i]) {
      return { ok: false, error: `sibling[${index}].paths_denied[${i}] must be a non-empty string` };
    }
  }

  // Expand env vars in root.
  const expanded = expandEnvVars(s.root);
  if (!expanded.ok) {
    return { ok: false, error: `sibling[${index}].root: ${expanded.error}` };
  }

  // Resolve to absolute + normalize.
  const absRoot = path.resolve(expanded.expanded);
  const normRoot = normalizePath(absRoot);

  return {
    ok: true,
    sibling: {
      id: s.id,
      rootRaw: s.root,
      root: normRoot,
      rootAbs: absRoot,
      read_only: true,
      purpose: s.purpose,
      paths_allowed: s.paths_allowed.slice(),
      paths_denied: s.paths_denied.slice(),
    },
  };
}

// Validate a parsed manifest object. Returns { ok, manifest|error }.
function validateManifest(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'manifest must be a JSON object' };
  }
  if (parsed.version !== SUPPORTED_VERSION) {
    return { ok: false, error: `manifest.version must be ${SUPPORTED_VERSION} (got ${JSON.stringify(parsed.version)})` };
  }
  if (!Array.isArray(parsed.siblings)) {
    return { ok: false, error: 'manifest.siblings must be an array' };
  }
  const siblings = [];
  const seenIds = new Set();
  for (let i = 0; i < parsed.siblings.length; i += 1) {
    const result = validateSibling(parsed.siblings[i], i);
    if (!result.ok) return { ok: false, error: result.error };
    if (seenIds.has(result.sibling.id)) {
      return { ok: false, error: `duplicate sibling id "${result.sibling.id}"` };
    }
    seenIds.add(result.sibling.id);
    siblings.push(result.sibling);
  }
  return { ok: true, manifest: { version: SUPPORTED_VERSION, siblings } };
}

// Load manifest from disk. Returns { ok, manifest|code, error }.
//   code values:
//     MANIFEST_NOT_FOUND       — file does not exist (operator hasn't set up)
//     MANIFEST_PARSE_FAILED    — file is not valid JSON
//     MANIFEST_SCHEMA_INVALID  — JSON parse OK but schema rejected
function loadManifest(repoRoot, opts = {}) {
  const root = repoRoot || process.cwd();
  const manifestPath = path.join(root, MANIFEST_PATH);
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, code: 'MANIFEST_NOT_FOUND', error: `${MANIFEST_PATH} not found in ${root}` };
  }
  let content;
  try {
    content = fs.readFileSync(manifestPath, 'utf8');
  } catch (err) {
    return { ok: false, code: 'MANIFEST_READ_FAILED', error: err.message };
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return { ok: false, code: 'MANIFEST_PARSE_FAILED', error: `JSON parse error: ${err.message}` };
  }
  const result = validateManifest(parsed);
  if (!result.ok) {
    return { ok: false, code: 'MANIFEST_SCHEMA_INVALID', error: result.error };
  }
  return { ok: true, manifest: result.manifest, manifestPath };
}

module.exports = {
  loadManifest,
  validateManifest,
  validateSibling,
  expandEnvVars,
  normalizePath,
  MANIFEST_PATH,
  SUPPORTED_VERSION,
  ALLOWED_ENV_VARS,
};
