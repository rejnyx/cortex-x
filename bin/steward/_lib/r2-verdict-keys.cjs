// SPDX-License-Identifier: Apache-2.0
// r2-verdict-keys.cjs — Ed25519 signing key persistence helper (Sprint 2.46.1).
//
// Manages the on-disk lifecycle of the Ed25519 keypair used to sign R2
// verdicts in the schema_version=2 path. The private key lives under
// $CORTEX_DATA_HOME (per-operator, never committed); the public key is
// emitted alongside as a sibling PEM the caller is expected to write into
// the repo's `cortex/r2-verdict-pubkey.pem` so verifiers in another session
// can resolve the signer's identity.
//
// Determinism contract:
//   - This module's BODY never reads wall-clock time or generates random
//     bytes implicitly. The only non-deterministic operation is the
//     `generateKeyPair('ed25519', ...)` call inside `loadOrCreateSigningKey`,
//     and that ONLY fires when `generateIfMissing === true` AND the private
//     key file does not already exist on disk. Pure callers (verify path)
//     pass `generateIfMissing: false` to fail-fast in deterministic contexts.
//   - All paths flow through `resolveDataHome(arg)` — argument > env > default.
//
// Zero npm deps: node:crypto + node:fs + node:path + node:os only.

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ---------------------------------------------------------------------------
// resolveDataHome(argument) — argument > canonical SSOT resolver
//
// Sprint 2.46.1 R2 fix HIGH-4: previously this module had its own resolver
// that drifted from `tools/lib/resolve-cortex-home.cjs` (the canonical SSOT
// used by 7+ other modules including journal.cjs / halt-check.cjs). On
// Windows with no $CORTEX_DATA_HOME env var, the Ed25519 key resolved to
// ~/.cortex/ while the HMAC key in r2-verdict.cjs resolved to %APPDATA%/cortex/
// — cryptographic trust roots SPLIT across the same subsystem. Both modules
// now delegate to the canonical resolver. The `argument` win still allows
// tests + callers to point at a tmp dir without mutating the process env.
// ---------------------------------------------------------------------------
let _resolveCortexDataHome;
function resolveDataHome(argument) {
  if (typeof argument === 'string' && argument.length > 0) {
    return path.normalize(argument);
  }
  if (!_resolveCortexDataHome) {
    try {
      _resolveCortexDataHome = require(path.join(__dirname, '..', '..', '..', 'tools', 'lib', 'resolve-cortex-home.cjs')).resolveCortexDataHome;
    } catch {
      // Fallback for distributions without tools/lib/ — env-or-home only.
      _resolveCortexDataHome = () => {
        const fromEnv = process.env.CORTEX_DATA_HOME;
        if (fromEnv && fromEnv.length > 0) return path.normalize(fromEnv);
        return path.join(os.homedir(), '.cortex');
      };
    }
  }
  return _resolveCortexDataHome();
}

function signingKeyDir(dataHome) {
  return path.join(resolveDataHome(dataHome), 'r2-verdict');
}

function privateKeyPath(dataHome) {
  return path.join(signingKeyDir(dataHome), 'ed25519-sign.pem');
}

function publicKeyPath(dataHome) {
  // Mirror of the private key, on the same per-operator path, so callers
  // that need to copy it into the repo (`cortex/r2-verdict-pubkey.pem`)
  // have a canonical source. The repo-side path is the verifier registry's
  // job, not this module's.
  return path.join(signingKeyDir(dataHome), 'ed25519-sign.pub.pem');
}

// ---------------------------------------------------------------------------
// computePublicKeyId(publicKeyPem) → 'ed25519:<16 hex chars>'
//
// Stable identifier across re-exports of the same key. Hashing the PEM
// text is sufficient for cortex's purposes — the PEM is canonicalized by
// node:crypto on export (single algorithm, single encoding), so two exports
// of the same keypair always produce byte-identical PEM. We DO normalize
// line endings (CRLF → LF) before hashing so a Windows checkout of a public
// key committed under LF still resolves to the same kid.
// ---------------------------------------------------------------------------
function computePublicKeyId(publicKeyPem) {
  if (typeof publicKeyPem !== 'string' || publicKeyPem.length === 0) {
    throw new Error('CORTEX_R2_VERDICT_KEYS_INVALID_PEM');
  }
  const normalized = publicKeyPem.replace(/\r\n/g, '\n');
  const digest = crypto
    .createHash('sha256')
    .update(normalized, 'utf8')
    .digest('hex');
  return 'ed25519:' + digest.slice(0, 16);
}

// ---------------------------------------------------------------------------
// loadOrCreateSigningKey({ dataHome, generateIfMissing }) →
//   { privateKeyPem, publicKeyPem, publicKeyId, privateKeyPath, publicKeyPath }
//
// First use (generateIfMissing=true, no key on disk):
//   - generate Ed25519 keypair (PKCS8 private PEM + SPKI public PEM)
//   - mkdir -p <dataHome>/r2-verdict (mode 0700 on POSIX)
//   - write private PEM (mode 0600 on POSIX; default mask on win32)
//   - write public PEM alongside
//   - return parsed PEMs + derived kid
//
// Subsequent use:
//   - read both PEMs from disk, derive kid, return.
//
// generateIfMissing=false + key absent:
//   - throw CORTEX_R2_VERDICT_KEYS_SIGNING_KEY_MISSING
//   - (verify-only callers don't need to generate; they want a hard fail.)
//
// Idempotent: invoking twice with the same dataHome returns the same key.
// ---------------------------------------------------------------------------
function loadOrCreateSigningKey(options) {
  const opts = options || {};
  const generateIfMissing = opts.generateIfMissing !== false; // default true
  const dataHome = resolveDataHome(opts.dataHome);
  const dir = signingKeyDir(dataHome);
  const privPath = privateKeyPath(dataHome);
  const pubPath = publicKeyPath(dataHome);

  const privExists = safeExistsSync(privPath);
  const pubExists = safeExistsSync(pubPath);

  if (privExists && pubExists) {
    // Load existing — happy path on second+ invocation.
    const privateKeyPem = fs.readFileSync(privPath, 'utf8');
    const publicKeyPem = fs.readFileSync(pubPath, 'utf8');
    return {
      privateKeyPem,
      publicKeyPem,
      publicKeyId: computePublicKeyId(publicKeyPem),
      privateKeyPath: privPath,
      publicKeyPath: pubPath,
    };
  }

  if (!generateIfMissing) {
    const err = new Error('CORTEX_R2_VERDICT_KEYS_SIGNING_KEY_MISSING');
    err.code = 'CORTEX_R2_VERDICT_KEYS_SIGNING_KEY_MISSING';
    err.privateKeyPath = privPath;
    throw err;
  }

  // Generate a fresh Ed25519 keypair. This is the only non-deterministic
  // call in the module body, and it is guarded by the generateIfMissing
  // flag + an explicit "key absent" precondition — pure verifiers never
  // reach this line.
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });

  // Persist atomically per-file: write to a sibling .tmp path then rename.
  // (We don't strictly need atomicity here because a partial write would
  // be detected on next load as a malformed PEM — but it keeps the contract
  // tidy and survives a SIGKILL between the two writes.)
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform !== 'win32') {
    try { fs.chmodSync(dir, 0o700); } catch { /* best effort */ }
  }

  writeFileAtomic(privPath, privateKey, { mode: 0o600 });
  writeFileAtomic(pubPath, publicKey, { mode: 0o644 });

  return {
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
    publicKeyId: computePublicKeyId(publicKey),
    privateKeyPath: privPath,
    publicKeyPath: pubPath,
  };
}

// ---------------------------------------------------------------------------
// loadPublicKeyRegistry({ repoRoot, dataHome }) → Map<kid, publicKeyPem>
//
// Builds the verifier's public-key registry by scanning:
//   - <repoRoot>/cortex/r2-verdict-pubkey.pem        (the default signer)
//   - <repoRoot>/cortex/keys/*.pem                   (rotation slot)
//   - <dataHome>/r2-verdict/ed25519-sign.pub.pem    (this operator's key)
//
// Each PEM is hashed → kid → inserted. Files that are missing or not
// PEM-shaped are skipped (no throw) — the registry is best-effort because
// a verifier needs to gracefully handle "key not registered" anyway.
// ---------------------------------------------------------------------------
function loadPublicKeyRegistry(options) {
  const opts = options || {};
  const registry = new Map();

  const repoRoot = typeof opts.repoRoot === 'string' && opts.repoRoot.length > 0
    ? opts.repoRoot
    : null;
  const dataHome = resolveDataHome(opts.dataHome);

  const candidates = [];
  if (repoRoot) {
    candidates.push(path.join(repoRoot, 'cortex', 'r2-verdict-pubkey.pem'));
    const keysDir = path.join(repoRoot, 'cortex', 'keys');
    try {
      const entries = fs.readdirSync(keysDir);
      for (const name of entries) {
        if (name.endsWith('.pem')) candidates.push(path.join(keysDir, name));
      }
    } catch {
      // No keys dir is fine.
    }
  }
  candidates.push(publicKeyPath(dataHome));

  for (const filePath of candidates) {
    let pem;
    try {
      pem = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue; // missing or unreadable — skip
    }
    if (typeof pem !== 'string' || !/-----BEGIN PUBLIC KEY-----/.test(pem)) {
      continue; // not a public-key PEM
    }
    let kid;
    try {
      kid = computePublicKeyId(pem);
    } catch {
      continue;
    }
    if (!registry.has(kid)) registry.set(kid, pem);
  }

  return registry;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function safeExistsSync(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function writeFileAtomic(targetPath, contents, options) {
  const opts = options || {};
  const dir = path.dirname(targetPath);
  // We use the file's own basename + a fixed sentinel so we do not need
  // process.pid (which would be a runtime input the spec marks as "MAY only
  // be passed in"). For a single-process cortex install the tmp path is
  // safe; for the unlikely concurrent case the second writer's rename wins.
  const tmpPath = targetPath + '.tmp';
  const writeOpts = process.platform === 'win32'
    ? { encoding: 'utf8' }
    : { encoding: 'utf8', mode: opts.mode };
  fs.writeFileSync(tmpPath, contents, writeOpts);
  try {
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    // On Windows, rename across same dir is atomic for new files but
    // fails with EEXIST on some FS configs — fall back to unlink + rename.
    if (err && err.code === 'EEXIST') {
      try { fs.unlinkSync(targetPath); } catch { /* ignore */ }
      fs.renameSync(tmpPath, targetPath);
    } else {
      throw err;
    }
  }
  // Best-effort tighten on POSIX (some filesystems ignore the mode in
  // writeFile when the file already existed). Skip on win32 — chmod is
  // a no-op-ish there and our defense is icacls, handled by cortex-doctor.
  if (process.platform !== 'win32' && typeof opts.mode === 'number') {
    try { fs.chmodSync(targetPath, opts.mode); } catch { /* best effort */ }
  }
}

module.exports = {
  loadOrCreateSigningKey,
  loadPublicKeyRegistry,
  computePublicKeyId,
  // exported for tests / advanced callers; not part of public contract
  _resolveDataHome: resolveDataHome,
  _privateKeyPath: privateKeyPath,
  _publicKeyPath: publicKeyPath,
};
