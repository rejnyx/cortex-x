// research-trigger.cjs — Sprint 2.14 research-when-uncertain rule mechanics.
//
// Implements the policy designed in:
//   docs/research/sprint-research-self-invoking-and-research-default-2026-05-10.md
//   docs/research/sprint-2.14-research-trigger-implementation-2026-05-10.md
//
// Conservative trigger rule with 3 sub-50-LoC detectors covering ~80% of
// research-worthy categories; a graduated cost ceiling (log → warn →
// throttle → hard-stop, fail-closed); and a per-category-TTL cache.
//
// API:
//
//   const trig = require('./research-trigger.cjs');
//   const verdict = trig.shouldResearch({
//     userPrompt: '...',
//     recentEdits: [{ path: 'auth.ts', diff: '...' }],
//     recentImports: [],   // optional
//   });
//   // verdict = { should: true, category: 'security', reason: '...' }
//   //         | { should: false, category: 'api'|null, reason: '...' }
//
//   trig.recordResearchCall({ category: 'api', costUsd: 0.005 });
//   trig.readLedger();             // { day, spentUsd, calls, circuit }
//   trig.cacheGet(category, key);  // { hit, value, expired }
//   trig.cachePut(category, key, value);
//
// Defaults overridable via env (STEWARD_RESEARCH_DAILY_USD_CAP,
// STEWARD_RESEARCH_CACHE_DIR). Zero-deps.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');

const { readEnv } = require('./env.cjs');

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_DAILY_USD_CAP = 0.50;
const DEFAULT_CACHE_DIR_BYTES_CAP = 200 * 1024 * 1024; // 200 MiB
const DEFAULT_PER_CALL_ESTIMATE = {
  websearch: 0.005,
  webfetch: 0.02,
};
const TTL_SECONDS = Object.freeze({
  security: 86_400,           // 1 day — CVE feeds change fast
  api: 1_209_600,             // 14 days — SDK signatures move slower
  taxonomy: 7_776_000,        // 90 days — naming conventions stable
});
const VALID_CATEGORIES = new Set(['api', 'security', 'taxonomy', 'architectural']);

// Throttle thresholds as fractions of the daily cap.
const THRESH_LOG_ONLY = 0.60;
const THRESH_WARN = 0.80;
const THRESH_THROTTLE = 1.00;

// ─── Detector regex catalog ──────────────────────────────────────────────────

// Q1: framework-version mention. Captures fw + major.
const VERSION_RE = /\b(next\.?js|react|tailwind|astro|vite|node|drizzle|supabase|prisma|hono|elysia|effect|zod|wagmi|viem|ai\s?sdk)[\s@]?v?(\d{1,2})(?:\.\d+)?\b/gi;

// Q2: security-sensitive path/keyword. Path-component, filename, OR
// security-marker-bearing filename. R2 LOW fix: previous regex had a
// trailing `(\.[tj]sx?|\/|$)` group that produced false negatives on
// `authentication.ts`, `loginHandler.ts`, etc. (the `e` after `auth`
// blocked match). Broaden by accepting either a word boundary OR an
// uppercase letter immediately after the keyword (camelCase splits)
// OR the original suffixes. Plus add `secret`, `token`, `apikey`, and
// dotfiles like `.env*` to the catalog.
const SECURITY_PATH_RE = /(?:^|[\/.\\])(?:\.env(?:\.[a-z]+)?|secrets?|private[._-]?key|id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:[\/.\\]|$)|\b(auth|authn|authz|authentication|authorization|session|login|logout|signin|signup|password|crypto|jwt|bcrypt|argon2?|scrypt|cookie|cors|csrf|oauth\d*|saml|webauthn|passkey|apikey|api[_-]?key|secret|token|credential)(?:[A-Z_\-./\\]|\.[tj]sx?|\/|$)/i;

// Q1 supporting: SemVer in package.json values. Used for diff detection.
const SEMVER_RE = /^[\^~]?(\d+)\.(\d+)\.(\d+)/;

// Recognized framework name normalization (regex → known-versions key).
function normalizeFwName(raw) {
  return String(raw || '').toLowerCase().replace(/\s+/g, '').replace('.', '');
}

// ─── Cache + ledger paths ────────────────────────────────────────────────────

function cacheDir() {
  // R2 HIGH fix: validate env override. Reject NUL/control chars, require
  // absolute path, require containment under operator HOME (defense-in-depth
  // against poisoned environments). Falls back to default on rejection.
  const override = readEnv('RESEARCH_CACHE_DIR');
  if (override && typeof override === 'string' && override.length > 0) {
    if (!/[\x00-\x1f]/.test(override) && path.isAbsolute(override)) {
      const resolved = path.resolve(override);
      const home = path.resolve(os.homedir());
      if (resolved === home || resolved.startsWith(home + path.sep)) {
        return resolved;
      }
    }
    // Override rejected — fall through to default. Stderr signal so an
    // operator who set a hostile/typo'd value notices.
    process.stderr.write(`[research-trigger] STEWARD_RESEARCH_CACHE_DIR rejected (must be absolute path under HOME); using default\n`);
  }
  return path.join(os.homedir(), '.claude', 'cache', 'research');
}

function ledgerPath() {
  return path.join(cacheDir(), '_ledger.json');
}

function knownVersionsPath() {
  return path.join(cacheDir(), 'known-versions.json');
}

function categoryDir(category) {
  if (!VALID_CATEGORIES.has(category)) {
    throw new Error(`research-trigger: unknown category ${category}`);
  }
  return path.join(cacheDir(), category);
}

function entryPath(category, queryKey) {
  // Sanitize: queryKey is sha256 hex, but be defensive.
  if (!/^[a-f0-9]{16,64}$/i.test(queryKey)) {
    throw new Error('research-trigger: invalid query key');
  }
  return path.join(categoryDir(category), `${queryKey}.json`);
}

// ─── Hashing ─────────────────────────────────────────────────────────────────

function canonicalize(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function queryKey(category, query) {
  const h = crypto.createHash('sha256');
  h.update(`${category}:${canonicalize(query)}`);
  return h.digest('hex').slice(0, 32);
}

// ─── Cache I/O ───────────────────────────────────────────────────────────────

function ensureDirs() {
  try {
    for (const c of VALID_CATEGORIES) {
      fs.mkdirSync(categoryDir(c), { recursive: true });
    }
  } catch (_) { /* best-effort */ }
}

// R2 MEDIUM fix: cap on cache file read size. Adversarial cache entry won't
// OOM the process; legitimate research summaries are well under this.
const MAX_CACHE_ENTRY_BYTES = 1 * 1024 * 1024; // 1 MiB

function cacheGet(category, key) {
  let p;
  try {
    p = entryPath(category, key);
  } catch {
    // R2 HIGH fix: distinguish rejected (invalid input) from cold miss.
    return { hit: false, rejected: true, reason: 'invalid category or key' };
  }
  // R2 MEDIUM fix: lstat first — refuse to read a cache file that is a
  // symlink (cache-poisoning vector on shared boxes).
  let lstat;
  try {
    lstat = fs.lstatSync(p);
  } catch {
    return { hit: false }; // doesn't exist
  }
  if (lstat.isSymbolicLink()) {
    return { hit: false, rejected: true, reason: 'cache entry is symlink' };
  }
  if (!lstat.isFile()) return { hit: false };
  if (lstat.size > MAX_CACHE_ENTRY_BYTES) {
    return { hit: false, rejected: true, reason: 'cache entry exceeds size cap' };
  }
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return { hit: false };
  }
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return { hit: false, expired: true };
  }
  const fetchedAt = Date.parse(entry.fetchedAt || '');
  const ttl = Number(entry.ttlSeconds);
  if (!Number.isFinite(fetchedAt) || !Number.isFinite(ttl)) {
    return { hit: false, expired: true };
  }
  const ageMs = Date.now() - fetchedAt;
  const expired = ageMs > ttl * 1000;
  return { hit: !expired, expired, value: entry };
}

function cachePut(category, key, partial) {
  let p;
  try {
    p = entryPath(category, key);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  ensureDirs();
  const ttlSeconds = Number(partial.ttlSeconds) || TTL_SECONDS[category] || TTL_SECONDS.api;
  const entry = {
    key,
    category,
    fetchedAt: new Date().toISOString(),
    ttlSeconds,
    sourceUrls: Array.isArray(partial.sourceUrls) ? partial.sourceUrls : [],
    summary: typeof partial.summary === 'string' ? partial.summary.slice(0, 4000) : '',
    contentSha256: partial.contentSha256 || null,
    costUsd: Number(partial.costUsd) || 0,
  };
  try {
    fs.writeFileSync(p, `${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    return { ok: true, path: p };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Ledger I/O + cost gate ──────────────────────────────────────────────────

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function readDailyCap() {
  const raw = Number(readEnv('RESEARCH_DAILY_USD_CAP'));
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_DAILY_USD_CAP;
  return raw;
}

function readLedger() {
  ensureDirs();
  const p = ledgerPath();
  const today = todayUtc();
  const empty = { day: today, spentUsd: 0, calls: 0, circuit: 'closed' };
  if (!fs.existsSync(p)) return empty;
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return empty;
  }
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return empty;
  }
  // Roll over at UTC day boundary.
  if (entry.day !== today) return empty;
  return {
    day: entry.day,
    spentUsd: Number(entry.spentUsd) || 0,
    calls: Number(entry.calls) || 0,
    circuit: entry.circuit === 'open' ? 'open' : 'closed',
  };
}

function writeLedger(ledger) {
  ensureDirs();
  try {
    fs.writeFileSync(ledgerPath(), `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Returns 'allow' | 'throttle' | 'deny' for the requested category.
// `throttle` = only `security` category may fire; others go cache-only.
// `deny` = hard-stop, all categories cache-only until next UTC day.
function gateFor(category, ledger, cap) {
  // R2 HIGH fix: validate cap shape. Without `Number.isFinite` guard,
  // cap=NaN would skip the `<=0` branch (NaN comparisons are false),
  // make pct=NaN, fail every threshold compare, and return 'allow'
  // regardless of spend — opening a hole that defeats the gate's purpose.
  const usedCap = cap == null ? readDailyCap() : cap;
  if (!Number.isFinite(usedCap) || usedCap <= 0) return 'deny'; // operator opt-out OR poisoned cap
  const led = ledger || readLedger();
  if (led.circuit === 'open') return 'deny';
  const pct = led.spentUsd / usedCap;
  if (!Number.isFinite(pct) || pct >= THRESH_THROTTLE) return 'deny';
  if (pct >= THRESH_WARN) {
    return category === 'security' ? 'allow' : 'throttle';
  }
  return 'allow';
}

function recordResearchCall(call = {}) {
  // R2 HIGH fix: clamp cost to non-negative finite. Infinity would JSON-
  // serialize as null and re-read as 0 (silently re-closing the circuit);
  // negative would let the budget recover across calls. Both are
  // ledger-poisoning failure modes for a cost-cap primitive.
  const raw = call && call.costUsd;
  const cost = Number.isFinite(raw) && raw >= 0 ? Number(raw) : 0;
  const led = readLedger();
  led.spentUsd = Math.max(0, led.spentUsd + cost);
  led.calls += 1;
  const cap = readDailyCap();
  if (cap > 0 && led.spentUsd >= cap) led.circuit = 'open';
  writeLedger(led);
  return led;
}

function resetCircuitForNewDay() {
  const led = { day: todayUtc(), spentUsd: 0, calls: 0, circuit: 'closed' };
  writeLedger(led);
  return led;
}

// ─── Cache size cap (mtime eviction) ─────────────────────────────────────────

function pruneCacheIfOverBudget() {
  const root = cacheDir();
  if (!fs.existsSync(root)) return { pruned: 0, totalBytes: 0 };
  const files = [];
  let totalBytes = 0;
  for (const cat of VALID_CATEGORIES) {
    const dir = categoryDir(cat);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      try {
        const st = fs.statSync(p);
        if (st.isFile()) {
          files.push({ p, mtimeMs: st.mtimeMs, size: st.size });
          totalBytes += st.size;
        }
      } catch (_) { /* skip */ }
    }
  }
  if (totalBytes <= DEFAULT_CACHE_DIR_BYTES_CAP) return { pruned: 0, totalBytes };
  files.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
  let pruned = 0;
  let bytesAfter = totalBytes;
  for (const f of files) {
    if (bytesAfter <= DEFAULT_CACHE_DIR_BYTES_CAP * 0.75) break;
    try {
      fs.unlinkSync(f.p);
      pruned += 1;
      bytesAfter -= f.size;
    } catch (_) { /* skip */ }
  }
  return { pruned, totalBytes: bytesAfter };
}

// ─── Detector helpers ────────────────────────────────────────────────────────

function readKnownVersions() {
  const p = knownVersionsPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function detectVersionTriggers(text, knownVersions) {
  const triggers = [];
  if (!text || typeof text !== 'string') return triggers;
  // Reset regex state because /g is stateful.
  VERSION_RE.lastIndex = 0;
  let m;
  while ((m = VERSION_RE.exec(text))) {
    const fwRaw = m[1];
    const major = Number(m[2]);
    const fw = normalizeFwName(fwRaw);
    const known = knownVersions[fw];
    const knownMajor = known && Number(known.major);
    if (!known || (Number.isFinite(knownMajor) && major > knownMajor)) {
      triggers.push({
        category: 'api',
        framework: fw,
        major,
        knownMajor: knownMajor || null,
        reason: `${fwRaw}@${major} ahead of cache (${knownMajor ?? 'none'})`,
      });
    }
    if (triggers.length >= 5) break; // cap to prevent spam
  }
  return triggers;
}

function detectSecurityTriggers(recentEdits) {
  const triggers = [];
  if (!Array.isArray(recentEdits)) return triggers;
  for (const edit of recentEdits) {
    if (!edit || typeof edit.path !== 'string') continue;
    if (SECURITY_PATH_RE.test(edit.path)) {
      triggers.push({
        category: 'security',
        path: edit.path,
        reason: `sensitive path: ${edit.path}`,
      });
      if (triggers.length >= 3) break;
    }
  }
  return triggers;
}

function detectPackageJsonTriggers(packageJsonDiff) {
  const triggers = [];
  if (!packageJsonDiff || typeof packageJsonDiff !== 'object') return triggers;
  const added = Array.isArray(packageJsonDiff.added) ? packageJsonDiff.added : [];
  const upgraded = Array.isArray(packageJsonDiff.upgraded) ? packageJsonDiff.upgraded : [];
  const known = readKnownVersions();
  for (const pkg of added) {
    triggers.push({ category: 'security', package: pkg, reason: `new dependency: ${pkg}` });
  }
  for (const up of upgraded) {
    const km = known[normalizeFwName(up.name)];
    const newMajor = (typeof up.to === 'string' ? up.to.match(SEMVER_RE) : null);
    if (newMajor && km && Number(newMajor[1]) > Number(km.major)) {
      triggers.push({
        category: 'api',
        package: up.name,
        reason: `${up.name} major-bump ${km.major} → ${newMajor[1]}`,
      });
    }
  }
  return triggers;
}

// ─── Public API: shouldResearch ──────────────────────────────────────────────

function shouldResearch(input) {
  // R2 HIGH fix: default-param `input = {}` does NOT trigger when caller
  // explicitly passes `null`. Property test caught this. Coerce here.
  const safe = (input && typeof input === 'object') ? input : {};
  const userPrompt = typeof safe.userPrompt === 'string' ? safe.userPrompt : '';
  const recentEdits = Array.isArray(safe.recentEdits) ? safe.recentEdits : [];
  const packageJsonDiff = safe.packageJsonDiff || null;
  const known = safe.knownVersions || readKnownVersions();
  const cap = safe.dailyUsdCap;

  const reasons = [];

  // Q1: api category — version mentions in prompt + recent edit diffs
  reasons.push(...detectVersionTriggers(userPrompt, known));
  for (const e of recentEdits) {
    if (e && typeof e.diff === 'string') {
      reasons.push(...detectVersionTriggers(e.diff, known));
    }
  }

  // Q2: security category — sensitive paths
  reasons.push(...detectSecurityTriggers(recentEdits));

  // Q1+Q2 supporting: package.json diff
  reasons.push(...detectPackageJsonTriggers(packageJsonDiff));

  if (reasons.length === 0) {
    return { should: false, category: null, reason: 'no trigger fired' };
  }

  // Exit criteria: cache hit covers it
  const live = reasons.filter((r) => {
    const k = queryKey(r.category, r.reason);
    const hit = cacheGet(r.category, k);
    return !hit.hit; // not a fresh hit → still need to research
  });
  if (live.length === 0) {
    return { should: false, category: reasons[0].category, reason: 'all triggers covered by fresh cache' };
  }

  // Prefer security category first (most-critical), then api, then others.
  live.sort((a, b) => {
    const w = { security: 3, api: 2, architectural: 1, taxonomy: 0 };
    return (w[b.category] || 0) - (w[a.category] || 0);
  });
  const top = live[0];

  // Cost gate
  const verdict = gateFor(top.category, undefined, cap);
  if (verdict === 'deny') {
    return { should: false, category: top.category, reason: 'cost-cap reached', verdict };
  }
  if (verdict === 'throttle' && top.category !== 'security') {
    return {
      should: false,
      category: top.category,
      reason: 'throttled — non-security cache-only at 80-100% of daily cap',
      verdict,
    };
  }

  return {
    should: true,
    category: top.category,
    reason: top.reason,
    verdict,
    detail: top,
  };
}

// ─── Module exports ─────────────────────────────────────────────────────────

module.exports = {
  shouldResearch,
  cacheGet,
  cachePut,
  readLedger,
  writeLedger,
  recordResearchCall,
  resetCircuitForNewDay,
  pruneCacheIfOverBudget,
  gateFor,
  // Detector helpers (exported for testing)
  detectVersionTriggers,
  detectSecurityTriggers,
  detectPackageJsonTriggers,
  readKnownVersions,
  // Internal helpers (exported for testing)
  cacheDir,
  ledgerPath,
  knownVersionsPath,
  categoryDir,
  entryPath,
  queryKey,
  canonicalize,
  // Constants
  DEFAULT_DAILY_USD_CAP,
  DEFAULT_CACHE_DIR_BYTES_CAP,
  DEFAULT_PER_CALL_ESTIMATE,
  TTL_SECONDS,
  VALID_CATEGORIES,
  THRESH_LOG_ONLY,
  THRESH_WARN,
  THRESH_THROTTLE,
  VERSION_RE,
  SECURITY_PATH_RE,
};
