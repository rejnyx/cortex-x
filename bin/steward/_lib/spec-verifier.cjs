// spec-verifier.cjs — Sprint 1.9.0 spec-driven verification runner.
//
// Purpose: gate `applyEditsToFilesystem` results with per-kind acceptance
// criteria declared in `action-kinds.cjs`, BEFORE `verifier.runNpmTest`.
// Generalizes the Sprint 1.8.13 hardcoded `EDIT_DESTRUCTIVE_REWRITE` rule
// into a per-kind, per-criterion declarative pattern.
//
// Decision memo: docs/research/sprint-1.9-spec-driven-verification-2026-05-09.md
// Sub-rec: 1.9.0 ships shell + file_predicate + regex deterministic runners;
// ears_text validates structure but is runtime no-op; llm_judge throws.
//
// Criterion shape (see action-kinds.cjs entries):
//   {
//     id: "no_destructive_rewrite",     // stable key for journal/lessons
//     kind: "shell" | "file_predicate" | "regex" | "ears_text" | "llm_judge" | "read_set",
//     description: "human-readable purpose",
//     severity: "block" | "warn",       // default block
//     applies_to: ["docs/**"],          // glob; null/missing = all touched
//     // kind-specific:
//     cmd: "npm run lint -- --no-fix",          // shell
//     predicate: "touchedFiles.every(p => fileSize(p) >= prevSize(p) * 0.5)", // file_predicate
//     pattern: "^Sprint 1\\.[78]\\.",           // regex (must-match in file)
//     flags: "m",                                // optional regex flags
//     ears: "WHEN edit.replace_all=false ...",   // ears_text (doc-only)
//     timeoutMs: 30000,                          // shell timeout cap
//     // Sprint 2.18 read_set:
//     expected_glob: "src/api/**/*.ts",          // file set the action must cover
//     min_coverage: 1.0,                          // fraction in [0,1], default 1.0
//     expected_count: 278,                        // optional absolute lower bound on declared paths
//     excludes: ["node_modules", ".git"],         // optional override of default excludes
//   }
//
// Sprint 2.18 read-coverage contract: when a criterion of kind `read_set` is
// declared, the action plan returned by the LLM must include a top-level
// `read_set: string[]` field listing every path the agent read. The verifier
// enumerates `expected_glob` on the working tree and asserts
// |declared ∩ enumerated| / |enumerated| ≥ min_coverage. Closes the failure
// class where an agent claims to have processed all inputs but only sampled
// a fraction — the edit-side artifact is internally consistent, just wrong
// about coverage.
//
// Plan-level overrides (`plan.acceptance_criteria`):
//   - May ADD new ids (additional criteria for one specific action).
//   - May STRENGTHEN existing ids (same kind, same-or-stricter severity).
//   - May NOT downgrade severity (block→warn) → SPEC_OVERRIDE_REJECTED.
//   - May NOT change kind for an existing id → SPEC_OVERRIDE_REJECTED.
//
// Failure model:
//   - SPEC_VIOLATION              — at least one block-severity criterion failed
//   - SPEC_WARNING                — only warn-severity criteria failed (returns ok=true)
//   - SPEC_MALFORMED              — unknown kind, missing fields, invalid pattern (fail-closed)
//   - SPEC_PREDICATE_THREW        — file_predicate compile/runtime threw (fail-closed)
//   - SPEC_SHELL_TIMEOUT          — shell criterion exceeded timeoutMs (fail-closed)
//   - SPEC_REGEX_NO_MATCH         — required pattern absent from target file
//   - SPEC_OVERRIDE_REJECTED      — plan attempted to weaken a criterion
//   - SPEC_LLM_JUDGE_NOT_IMPLEMENTED — kind: "llm_judge" reserved for v2.0+
//   - SPEC_READ_SET_INCOMPLETE    — Sprint 2.18: plan.read_set fails to cover
//                                    expected_glob enumeration × min_coverage
//                                    (read-coverage proof)

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VALID_KINDS = ['shell', 'file_predicate', 'regex', 'ears_text', 'llm_judge', 'read_set'];
const VALID_SEVERITIES = ['block', 'warn'];
const DEFAULT_SHELL_TIMEOUT_MS = 30_000;
const SHELL_TIMEOUT_MAX_MS = 5 * 60_000;

// Sprint 2.18 read_set: filesystem enumeration caps. Without these the glob
// walker can wander into node_modules / .git / build artefacts and produce
// O(repo-size) enumeration sets — defeating the proof and risking ENOMEM.
// Numbers are conservative; legitimate read_set scopes on cortex-x action_kinds
// stay under 200 files. If you bump these, also raise the property-test cap.
const READ_SET_DEFAULT_EXCLUDES = [
  'node_modules', '.git', '.next', '.turbo', 'dist', 'build', 'coverage',
  '.cache', '.stryker-tmp', '.husky', 'out',
];
const READ_SET_MAX_FILES_ENUMERATED = 5_000;
const READ_SET_MAX_WALK_DEPTH = 12;

// EARS — Easy Approach to Requirements Syntax. Five canonical patterns from
// Mavin et al. 2009 / Rolls-Royce / Kiro IDE. Pattern-match is intentionally
// case-insensitive but anchored — fragments without a SHALL clause are
// rejected. ears_text is documentation-only at runtime; this validator
// enforces well-formedness at action-kinds.cjs registry edit time.
const EARS_PATTERNS = [
  /^\s*THE\s+SYSTEM\s+SHALL\s+\S/i,                                        // Ubiquitous
  /^\s*WHEN\s+.+\s+THE\s+SYSTEM\s+SHALL\s+\S/i,                            // Event-driven
  /^\s*WHILE\s+.+\s+THE\s+SYSTEM\s+SHALL\s+\S/i,                           // State-driven
  /^\s*WHERE\s+.+\s+THE\s+SYSTEM\s+SHALL\s+\S/i,                           // Optional feature
  /^\s*IF\s+.+\s*,?\s*THEN\s+(THE\s+SYSTEM\s+SHALL|.+\s+SHALL)\s+\S/i,     // Unwanted behaviour
];

// Sprint 1.9.0 review (security/MED): defense-in-depth token denylist for
// file_predicate strings. The override seam (plan.acceptance_criteria) is
// hot-wired; refuse predicates that name globals that could escape the
// curated context. Word-boundary anchored so legitimate substrings
// (e.g. "fileSize" containing "size") aren't false-positive.
const PREDICATE_DENYLIST = /\b(process|require|globalThis|global|import|Function|eval|child_process|fetch|Buffer|XMLHttpRequest|WebSocket|Worker|module|exports|__dirname|__filename|setTimeout|setInterval|setImmediate)\b/;

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

function validateCriterion(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return { ok: false, reason: 'criterion must be a plain object' };
  }
  if (typeof c.id !== 'string' || c.id.length === 0) {
    return { ok: false, reason: 'criterion.id must be a non-empty string' };
  }
  if (!VALID_KINDS.includes(c.kind)) {
    return { ok: false, reason: `criterion.kind must be one of ${VALID_KINDS.join('|')}, got '${c.kind}'` };
  }
  if (c.severity !== undefined && !VALID_SEVERITIES.includes(c.severity)) {
    return { ok: false, reason: `criterion.severity must be block|warn, got '${c.severity}'` };
  }
  if (c.applies_to !== undefined && c.applies_to !== null) {
    if (!Array.isArray(c.applies_to)) {
      return { ok: false, reason: 'criterion.applies_to must be array of glob strings or null' };
    }
    // Sprint 1.9.0 review (edge HIGH-D): empty array is semantically distinct
    // from null/missing. null = "apply to all touched files"; [] is ambiguous
    // ("apply to nothing"? "narrow to nothing"?). Reject explicitly to force
    // the registry author to disambiguate (omit the field, or list globs).
    if (c.applies_to.length === 0) {
      return { ok: false, reason: `criterion '${c.id}' has empty applies_to array — omit the field to apply to all touched files, or list explicit globs` };
    }
    for (const g of c.applies_to) {
      if (typeof g !== 'string' || g.length === 0) {
        return { ok: false, reason: `criterion '${c.id}' applies_to entry must be non-empty string, got ${JSON.stringify(g)}` };
      }
    }
  }

  switch (c.kind) {
    case 'shell':
      if (typeof c.cmd !== 'string' || c.cmd.length === 0) {
        return { ok: false, reason: `shell criterion '${c.id}' missing cmd` };
      }
      if (c.timeoutMs !== undefined && (typeof c.timeoutMs !== 'number' || c.timeoutMs <= 0)) {
        return { ok: false, reason: `shell criterion '${c.id}' has invalid timeoutMs` };
      }
      break;
    case 'file_predicate':
      if (typeof c.predicate !== 'string' || c.predicate.length === 0) {
        return { ok: false, reason: `file_predicate criterion '${c.id}' missing predicate` };
      }
      // Sprint 1.9.0 review (security/MED — defense-in-depth): even though
      // predicates are repo-resident today, the override seam in
      // plan.acceptance_criteria is hot-wired. Refuse predicate strings that
      // reference globals that could escape the curated context (`new Function`
      // does NOT capture module-scope `require`, but `globalThis`, `process`,
      // `Buffer`, `import`, etc. are still reachable). Token-level denylist
      // closes the obvious RCE shapes; sophisticated bypass (computed property
      // access, eval-in-Function-toString) would still need v1.9.1 hardening
      // (vm.runInNewContext or expression DSL).
      if (PREDICATE_DENYLIST.test(c.predicate)) {
        return { ok: false, reason: `file_predicate criterion '${c.id}' references denylisted token (process|require|globalThis|global|import|Function|eval|child_process|fetch|Buffer|XMLHttpRequest|WebSocket)` };
      }
      // Compile-test now so SPEC_MALFORMED (not SPEC_PREDICATE_THREW) fires
      // for a typo in the registry. Predicates are repo-resident + code-reviewed,
      // so new Function over a curated context is the agreed sandbox (Q1=A).
      try {
        // eslint-disable-next-line no-new-func
        new Function(`return ( ${c.predicate} );`);
      } catch (err) {
        return { ok: false, reason: `file_predicate criterion '${c.id}' won't compile: ${err.message}` };
      }
      break;
    case 'regex':
      if (typeof c.pattern !== 'string' || c.pattern.length === 0) {
        return { ok: false, reason: `regex criterion '${c.id}' missing pattern` };
      }
      try {
        new RegExp(c.pattern, c.flags || 'm');
      } catch (err) {
        return { ok: false, reason: `regex criterion '${c.id}' invalid pattern: ${err.message}` };
      }
      break;
    case 'ears_text':
      if (typeof c.ears !== 'string' || c.ears.length === 0) {
        return { ok: false, reason: `ears_text criterion '${c.id}' missing ears clause` };
      }
      if (!EARS_PATTERNS.some((re) => re.test(c.ears))) {
        return { ok: false, reason: `ears_text criterion '${c.id}' clause does not match any of the 5 EARS patterns: '${c.ears.slice(0, 80)}'` };
      }
      break;
    case 'llm_judge':
      // Declared for v2.0+. validateCriterion accepts it so action-kinds.cjs
      // can document future criteria; the runner throws at execution time.
      break;
    case 'read_set':
      // Sprint 2.18: read-coverage proof. Agent declares `plan.read_set` (paths
      // it read to compose the plan); criterion enumerates `expected_glob` on
      // the working tree and asserts the declared set covers ≥ min_coverage of
      // the enumeration. Catches the failure class where an agent claims to
      // have processed N inputs but only sampled K — the edit-side artifact
      // can be internally consistent while being wrong about coverage.
      if (typeof c.expected_glob !== 'string' || c.expected_glob.length === 0) {
        return { ok: false, reason: `read_set criterion '${c.id}' missing expected_glob (non-empty string)` };
      }
      // Sprint 2.18 R2 (edge/blind/security): expected_glob hardening. Leading
      // '/' silently matches nothing against repo-relative paths (vacuous pass
      // disguised as success). `..` segments are nonsense in the contract.
      // NUL bytes / control chars produce regex-compiled silent-no-match. Cap
      // length so a 1MB string can't be compiled into a 1MB regex.
      if (c.expected_glob.length > 500) {
        return { ok: false, reason: `read_set criterion '${c.id}' expected_glob length ${c.expected_glob.length} exceeds 500-char cap` };
      }
      if (c.expected_glob.includes('\0')) {
        return { ok: false, reason: `read_set criterion '${c.id}' expected_glob contains NUL byte` };
      }
      // eslint-disable-next-line no-control-regex
      if (/[-]/.test(c.expected_glob)) {
        return { ok: false, reason: `read_set criterion '${c.id}' expected_glob contains control characters` };
      }
      if (c.expected_glob.startsWith('/') || /^[A-Za-z]:[\\/]/.test(c.expected_glob) || c.expected_glob.startsWith('\\')) {
        return { ok: false, reason: `read_set criterion '${c.id}' expected_glob must be repo-relative (got absolute '${c.expected_glob.slice(0, 50)}')` };
      }
      if (c.expected_glob.split(/[\\/]/).includes('..')) {
        return { ok: false, reason: `read_set criterion '${c.id}' expected_glob contains '..' segment` };
      }
      if (c.min_coverage !== undefined) {
        if (typeof c.min_coverage !== 'number' || !Number.isFinite(c.min_coverage)) {
          return { ok: false, reason: `read_set criterion '${c.id}' min_coverage must be a finite number, got ${JSON.stringify(c.min_coverage)}` };
        }
        if (c.min_coverage < 0 || c.min_coverage > 1) {
          return { ok: false, reason: `read_set criterion '${c.id}' min_coverage must be in [0, 1], got ${c.min_coverage}` };
        }
      }
      if (c.expected_count !== undefined) {
        if (!Number.isInteger(c.expected_count) || c.expected_count < 0) {
          return { ok: false, reason: `read_set criterion '${c.id}' expected_count must be non-negative integer, got ${JSON.stringify(c.expected_count)}` };
        }
        if (c.expected_count > 100_000) {
          return { ok: false, reason: `read_set criterion '${c.id}' expected_count ${c.expected_count} exceeds 100_000 sanity ceiling` };
        }
      }
      if (c.excludes !== undefined && c.excludes !== null) {
        if (!Array.isArray(c.excludes)) {
          return { ok: false, reason: `read_set criterion '${c.id}' excludes must be array of directory names or null` };
        }
        for (const e of c.excludes) {
          if (typeof e !== 'string' || e.length === 0) {
            return { ok: false, reason: `read_set criterion '${c.id}' excludes entry must be non-empty string, got ${JSON.stringify(e)}` };
          }
          // Sprint 2.18 R2 (edge HIGH): walker matches single basename
          // components via Set.has(ent.name); excludes entries containing path
          // separators silently don't exclude anything — registry author
          // footgun. Reject loudly so they get the SPEC_MALFORMED at registry
          // edit time, not silent under-coverage at runtime.
          if (e.includes('/') || e.includes('\\')) {
            return { ok: false, reason: `read_set criterion '${c.id}' excludes entry '${e}' must be a single basename (no path separators)` };
          }
        }
      }
      break;
    default:
      return { ok: false, reason: `unknown kind '${c.kind}'` };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Glob matching (small, predictable, no deps)
// ─────────────────────────────────────────────────────────────────────────────

function simpleGlobMatch(glob, p) {
  if (typeof glob !== 'string' || typeof p !== 'string') return false;
  const norm = p.replace(/\\/g, '/');
  // ** ⇒ .*  (cross-segment)
  // *  ⇒ [^/]*  (within segment)
  // ?  ⇒ [^/]
  // everything else ⇒ literal
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      re += '.*';
      i += 2;
      // consume optional trailing /
      if (glob[i] === '/') i += 1;
    } else if (ch === '*') {
      re += '[^/]*';
      i += 1;
    } else if (ch === '?') {
      re += '[^/]';
      i += 1;
    } else if (/[.+^${}()|[\]\\]/.test(ch)) {
      re += '\\' + ch;
      i += 1;
    } else {
      re += ch;
      i += 1;
    }
  }
  re += '$';
  return new RegExp(re).test(norm);
}

function filterTargets(globs, touched) {
  if (!Array.isArray(globs) || globs.length === 0) return touched.slice();
  const out = [];
  for (const t of touched) {
    if (globs.some((g) => simpleGlobMatch(g, t))) out.push(t);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runners
// ─────────────────────────────────────────────────────────────────────────────

function runShell(c, ctx) {
  const requestedTimeout = Number.isFinite(c.timeoutMs) ? c.timeoutMs : DEFAULT_SHELL_TIMEOUT_MS;
  const timeoutMs = Math.max(1, Math.min(requestedTimeout, SHELL_TIMEOUT_MAX_MS));
  let r;
  try {
    r = spawnSync(c.cmd, {
      shell: true,
      cwd: ctx.repoRoot,
      timeout: timeoutMs,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (err) {
    return {
      ok: false,
      code: 'SPEC_SHELL_TIMEOUT',
      expected: 'cmd exits 0 within timeout',
      actual: `spawn error: ${err.message}`,
    };
  }
  // Sprint 1.9.0 review (edge HIGH-C): distinguish a real timeout (SIGTERM
  // signal) from spawnSync's other null-status modes (ENOENT command-not-
  // found, ENOBUFS stdout/stderr exceeded maxBuffer). Pre-fix labelled
  // every null-status as SPEC_SHELL_TIMEOUT, hiding "your cmd is misspelled"
  // failures behind a misleading code.
  if (r.signal === 'SIGTERM') {
    return {
      ok: false,
      code: 'SPEC_SHELL_TIMEOUT',
      expected: `cmd exits 0 within ${timeoutMs}ms`,
      actual: `timed out (SIGTERM)`,
    };
  }
  if (r.error) {
    // ENOENT (cmd not found), ENOBUFS (output exceeded maxBuffer), or
    // other spawn-level failures. Surface as SPEC_MALFORMED so the operator
    // sees the registry typo rather than a "shell timed out" red herring.
    return {
      ok: false,
      code: 'SPEC_MALFORMED',
      expected: 'spawnable shell command',
      actual: `${r.error.code || 'spawn-error'}: ${r.error.message}`,
    };
  }
  if (r.status === null) {
    return {
      ok: false,
      code: 'SPEC_SHELL_TIMEOUT',
      expected: `cmd exits 0 within ${timeoutMs}ms`,
      actual: `null exit status (no signal, no error — likely killed by host)`,
    };
  }
  if (r.status !== 0) {
    const tail = ((r.stderr || '') + '\n' + (r.stdout || '')).trim().slice(-300);
    return {
      ok: false,
      code: 'SPEC_VIOLATION',
      expected: 'exit code 0',
      actual: `exit ${r.status}: ${tail}`,
    };
  }
  return { ok: true };
}

function buildPredicateContext(ctx) {
  const repoRoot = ctx.repoRoot;
  const previousSizes = ctx.previousSizes || {};
  // Sprint 2.2.5: pre-edit content snapshot keyed by relative path. Captured
  // by applyEditsToFilesystem before any write, plumbed via applyResult.
  // Mirrors previousSizes plumbing. Used by edit_position_anchor_unique +
  // edit_position_after_pattern_preserved criteria. Files >1 MiB return ''
  // (predicates fail closed for safety).
  const previousContents = ctx.previousContents || {};
  const edits = Array.isArray(ctx.edits) ? ctx.edits : [];

  const cache = new Map();
  function read(rel) {
    if (cache.has(rel)) return cache.get(rel);
    const full = path.resolve(repoRoot, rel);
    let content = '';
    let exists = false;
    let size = 0;
    try {
      const stat = fs.statSync(full);
      if (stat.isFile()) {
        exists = true;
        size = stat.size;
        content = fs.readFileSync(full, 'utf8');
      }
    } catch { /* missing file or perm error → exists=false */ }
    const v = { exists, size, content };
    cache.set(rel, v);
    return v;
  }

  return {
    touchedFiles: Array.isArray(ctx.touchedFiles) ? ctx.touchedFiles.slice() : [],
    fileSize: (rel) => read(String(rel)).size,
    fileExists: (rel) => read(String(rel)).exists,
    fileContent: (rel) => read(String(rel)).content,
    prevSize: (rel) => previousSizes[String(rel)] || 0,
    prevContent: (rel) => previousContents[String(rel)] || '',
    edits,
    plan: ctx.plan || {},
  };
}

function runFilePredicate(c, ctx) {
  const helpers = buildPredicateContext(ctx);
  const argNames = Object.keys(helpers);
  const argValues = argNames.map((k) => helpers[k]);

  let fn;
  try {
    // eslint-disable-next-line no-new-func
    fn = new Function(...argNames, `"use strict"; return ( ${c.predicate} );`);
  } catch (err) {
    return {
      ok: false,
      code: 'SPEC_PREDICATE_THREW',
      expected: 'compilable JS expression',
      actual: `compile error: ${err.message}`,
    };
  }

  let result;
  try {
    result = fn(...argValues);
  } catch (err) {
    return {
      ok: false,
      code: 'SPEC_PREDICATE_THREW',
      expected: 'predicate returns truthy',
      actual: `runtime error: ${err.message}`,
    };
  }
  // Sprint 1.9.0 review (edge HIGH-B): a Promise-returning predicate (e.g.
  // an async expression) would be silently truthy regardless of the resolved
  // value. spec-verifier is intentionally synchronous in 1.9.0 — async
  // criteria are a follow-up sprint. Reject Promises explicitly so registry
  // authors see SPEC_PREDICATE_THREW rather than a falsely-passing criterion.
  if (result && typeof result.then === 'function') {
    return {
      ok: false,
      code: 'SPEC_PREDICATE_THREW',
      expected: 'predicate returns synchronous truthy value',
      actual: 'predicate returned a Promise; async file_predicate is reserved for v1.10+',
    };
  }
  if (!result) {
    return {
      ok: false,
      code: 'SPEC_VIOLATION',
      expected: 'predicate returns truthy',
      actual: `predicate returned ${typeof result === 'object' ? JSON.stringify(result) : String(result)}`,
    };
  }
  return { ok: true };
}

function runRegex(c, ctx) {
  let re;
  try {
    re = new RegExp(c.pattern, c.flags || 'm');
  } catch (err) {
    return {
      ok: false,
      code: 'SPEC_MALFORMED',
      expected: 'valid regex',
      actual: err.message,
    };
  }
  const targets = filterTargets(c.applies_to, ctx.touchedFiles || []);
  if (targets.length === 0) return { ok: true };

  for (const rel of targets) {
    const full = path.resolve(ctx.repoRoot, rel);
    let content;
    try {
      content = fs.readFileSync(full, 'utf8');
    } catch {
      // File missing post-edit (e.g. delete op). If pattern requires a match
      // and file is gone, that's a no-match.
      return {
        ok: false,
        code: 'SPEC_REGEX_NO_MATCH',
        expected: `pattern /${c.pattern}/${c.flags || 'm'} present in ${rel}`,
        actual: `file ${rel} not readable post-edit`,
      };
    }
    if (!re.test(content)) {
      return {
        ok: false,
        code: 'SPEC_REGEX_NO_MATCH',
        expected: `pattern /${c.pattern}/${c.flags || 'm'} present in ${rel}`,
        actual: `not found in ${rel} (${Buffer.byteLength(content, 'utf8')} bytes)`,
      };
    }
  }
  return { ok: true };
}

function runEarsText(_c, _ctx) {
  // 1.9.0: ears_text is documentation-only at runtime. Syntactic well-formedness
  // is enforced at validateCriterion time (registry edit). 1.9.1 may add a
  // runtime path that lifts EARS clauses to deterministic predicates; until
  // then, the no-op success keeps the criterion in the journal as a contract.
  return { ok: true };
}

function runLlmJudge(c, _ctx) {
  return {
    ok: false,
    code: 'SPEC_LLM_JUDGE_NOT_IMPLEMENTED',
    expected: 'kind: shell | file_predicate | regex | ears_text',
    actual: `criterion '${c.id}' uses kind 'llm_judge' (reserved for v2.0+; not implemented in 1.9)`,
  };
}

// Sprint 2.18: depth-bounded recursive walker with excludes. Returns posix-style
// relative paths against repoRoot. Caps total enumerated files to keep
// pathological scopes (e.g. expected_glob: '**/*') from running for minutes.
//
// Caller-side excludes are MERGED with defaults (Sprint 2.18 R2 edge fix —
// the previous "replace" semantics turned `excludes: ['secret']` into "include
// node_modules", a registry-author footgun).
//
// Symlinks are EXPLICITLY SKIPPED. Dirent.isSymbolicLink() is checked first
// so a symlink to a directory does not recurse (cycle risk) and a symlink to
// a file does not contribute to coverage (would let an attacker mount
// out-of-tree content into the enumeration). Symlink support is reserved for
// a follow-up sprint with realpath containment + visited-inode tracking.
//
// Permission-denied directories are surfaced via `partial` flag so the
// runner can flag a coverage proof that ran on incomplete enumeration.
function enumerateGlob(repoRoot, glob, excludes) {
  const merged = excludes && excludes.length > 0
    ? new Set([...READ_SET_DEFAULT_EXCLUDES, ...excludes])
    : new Set(READ_SET_DEFAULT_EXCLUDES);
  const out = [];
  let capped = false;
  let partial = false;
  let rootMissing = false;
  function walk(absDir, relDir, depth) {
    if (capped || depth > READ_SET_MAX_WALK_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch (err) {
      // Sprint 2.18 R2 (blind/edge MED): surface fail-open as `partial`. Root
      // directory unreadable is special — treat as SPEC_MALFORMED, not
      // vacuous pass.
      if (depth === 0) {
        rootMissing = true;
      } else if (err && (err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'EMFILE' || err.code === 'ENFILE')) {
        partial = true;
      }
      return;
    }
    for (const ent of entries) {
      if (capped) return;
      if (merged.has(ent.name)) continue;
      // Sprint 2.18 R2 (correctness/blind HIGH): explicit symlink skip. On
      // Linux/macOS Dirent.isDirectory()/isFile() return false for symlinks
      // (only isSymbolicLink() is true), so they implicitly skip — but on
      // Windows reparse points isDirectory() can return true and the walker
      // would follow the link out of the tree. Skip explicitly so behavior
      // is identical across platforms.
      if (ent.isSymbolicLink && ent.isSymbolicLink()) continue;
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      const abs = path.join(absDir, ent.name);
      if (ent.isDirectory()) {
        walk(abs, rel, depth + 1);
      } else if (ent.isFile()) {
        if (simpleGlobMatch(glob, rel)) {
          out.push(rel);
          if (out.length >= READ_SET_MAX_FILES_ENUMERATED) {
            capped = true;
            return;
          }
        }
      }
    }
  }
  walk(repoRoot, '', 0);
  return { files: out, capped, partial, rootMissing };
}

function normalizeReadSet(raw) {
  // Accepts arrays of strings; ignores non-strings, deduplicates, normalizes
  // separators to posix. Resilient to plan-side typos.
  //
  // Sprint 2.18 R2 normalization (correctness/edge MED):
  //  - Unicode NFC normalize so Czech filenames (e.g. složka/přečíst.md) line
  //    up across macOS HFS+/APFS (NFD) and Linux ext4 (NFC).
  //  - Strip leading `./` so agents declaring relative paths the natural way
  //    match the enumeration (which emits no `./` prefix).
  //  - Strip trailing `/` (declared paths that look like directories).
  //  - Drop entries with `..` segments — they cannot match repo-relative
  //    enumeration AND would otherwise inflate expected_count satisfaction
  //    with fake/external paths.
  //  - Drop absolute paths (leading `/` or Windows drive letter) — same
  //    reason as above. Defense-in-depth even though set-intersection alone
  //    would catch the mismatch.
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0) continue;
    let norm = item.replace(/\\/g, '/');
    if (typeof norm.normalize === 'function') norm = norm.normalize('NFC');
    while (norm.startsWith('./')) norm = norm.slice(2);
    while (norm.length > 1 && norm.endsWith('/')) norm = norm.slice(0, -1);
    if (norm.length === 0) continue;
    if (norm.startsWith('/')) continue;
    if (/^[A-Za-z]:/.test(norm)) continue;
    if (norm.split('/').includes('..')) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

function runReadSet(c, ctx) {
  // Sprint 2.18. Strategy:
  //   1. Enumerate `expected_glob` against repoRoot → expectedFiles[]
  //   2. Read agent-declared `plan.read_set` (paths the agent claims it read)
  //   3. coverage = |declaredSet ∩ expectedFiles| / |expectedFiles|
  //   4. coverage < min_coverage  → SPEC_READ_SET_INCOMPLETE
  //      expected_count set and |declaredSet ∩ expectedFiles| < expected_count
  //      → SPEC_READ_SET_INCOMPLETE  (intersection, NOT raw declared.length —
  //      Sprint 2.18 R2 fix: agent could otherwise pad with fake paths to
  //      satisfy expected_count while reading nothing real)
  //
  // Special cases:
  //   • plan.read_set missing/empty AND expectedFiles > 0 AND min_coverage > 0
  //     → fail (the whole point: agent must declare).
  //   • min_coverage = 0 → pass regardless of declared set (registry author
  //     opt-out of coverage check while keeping expected_count gate).
  //   • expectedFiles empty AND expected_count satisfied → vacuously pass.
  //   • Enumeration capped at READ_SET_MAX_FILES_ENUMERATED → SPEC_MALFORMED
  //     so the registry author narrows expected_glob (otherwise coverage proof
  //     is silently bounded by the cap, not by the glob).
  //   • Walker hit unreadable root → SPEC_MALFORMED (not vacuous pass).
  //
  // Note on FS-race: enumeration runs post-applyAction. If the action itself
  // creates/deletes files matching expected_glob, the verifier sees the
  // post-edit state, not the state the agent read. Registry authors should
  // scope expected_glob away from edit-target paths; the cleaner snapshot-
  // pre-edit plumbing is deferred follow-up (see Sprint 2.18 review notes).
  const repoRoot = ctx.repoRoot;
  const minCoverage = c.min_coverage !== undefined ? c.min_coverage : 1.0;
  const expectedCount = c.expected_count;

  const enumeration = enumerateGlob(repoRoot, c.expected_glob, c.excludes);
  if (enumeration.rootMissing) {
    return {
      ok: false,
      code: 'SPEC_MALFORMED',
      expected: 'readable repoRoot',
      actual: `repoRoot '${repoRoot}' not enumerable (missing or not a directory)`,
    };
  }
  if (enumeration.capped) {
    return {
      ok: false,
      code: 'SPEC_MALFORMED',
      expected: `expected_glob enumeration ≤ ${READ_SET_MAX_FILES_ENUMERATED} files`,
      actual: `glob '${c.expected_glob}' enumerated > ${READ_SET_MAX_FILES_ENUMERATED} files; narrow the glob or add excludes`,
    };
  }
  const expectedFiles = enumeration.files;
  const declared = normalizeReadSet(ctx.plan && ctx.plan.read_set);
  const declaredSet = new Set(declared);

  // Sprint 2.18 R2 (blind/correctness/edge HIGH — padding bypass): count only
  // declarations that intersect the enumeration. An agent declaring 10
  // fabricated paths to satisfy expected_count: 5 must now actually intersect
  // the enumerated set 5 times.
  let intersectionCount = 0;
  const missing = [];
  for (const f of expectedFiles) {
    if (declaredSet.has(f)) {
      intersectionCount += 1;
    } else if (missing.length < 5) {
      missing.push(f);
    }
  }

  if (expectedCount !== undefined && intersectionCount < expectedCount) {
    return {
      ok: false,
      code: 'SPEC_READ_SET_INCOMPLETE',
      expected: `plan.read_set ∩ expected_glob enumeration ≥ ${expectedCount} entries`,
      actual: `intersection has ${intersectionCount} entries (deficit ${expectedCount - intersectionCount}); declared ${declared.length}, enumerated ${expectedFiles.length}`,
    };
  }

  // Sprint 2.18 R2 (edge MED): min_coverage=0 means "no coverage required"
  // — the registry author opted out of the proportional check. Honor that
  // even when declared is empty.
  if (minCoverage === 0) {
    return enumeration.partial
      ? { ok: true, warning: 'enumeration was partial (permission-denied subdirs)' }
      : { ok: true };
  }

  if (expectedFiles.length === 0) {
    // Vacuous pass when the glob matches no files. If a registry author wants
    // "must read at least one file matching X", they use expected_count: 1.
    return { ok: true };
  }

  if (declared.length === 0) {
    return {
      ok: false,
      code: 'SPEC_READ_SET_INCOMPLETE',
      expected: `plan.read_set declares paths covering ${(minCoverage * 100).toFixed(1)}% of ${expectedFiles.length} files matching '${c.expected_glob}'`,
      actual: `plan.read_set is empty/missing — agent declared no read paths`,
    };
  }

  const coverage = intersectionCount / expectedFiles.length;

  if (coverage < minCoverage) {
    const sampleSuffix = expectedFiles.length - intersectionCount > missing.length
      ? `, +${expectedFiles.length - intersectionCount - missing.length} more`
      : '';
    return {
      ok: false,
      code: 'SPEC_READ_SET_INCOMPLETE',
      expected: `coverage ≥ ${(minCoverage * 100).toFixed(1)}% of ${expectedFiles.length} files matching '${c.expected_glob}'`,
      actual: `coverage ${(coverage * 100).toFixed(1)}% (${intersectionCount}/${expectedFiles.length}) — uncovered sample: ${missing.join(', ')}${sampleSuffix}${enumeration.partial ? ' [partial enumeration: permission-denied subdirs skipped]' : ''}`,
    };
  }

  return enumeration.partial
    ? { ok: true, warning: 'enumeration was partial (permission-denied subdirs)' }
    : { ok: true };
}

const RUNNERS = {
  shell: runShell,
  file_predicate: runFilePredicate,
  regex: runRegex,
  ears_text: runEarsText,
  llm_judge: runLlmJudge,
  read_set: runReadSet,
};

// ─────────────────────────────────────────────────────────────────────────────
// Override merging
// ─────────────────────────────────────────────────────────────────────────────

function severityRank(s) {
  // higher = stricter
  return s === 'block' ? 2 : 1;
}

function mergeCriteria(kindCriteria, planOverrides) {
  const out = Array.isArray(kindCriteria) ? kindCriteria.slice() : [];
  if (!Array.isArray(planOverrides) || planOverrides.length === 0) {
    return { ok: true, criteria: out };
  }

  for (const override of planOverrides) {
    const v = validateCriterion(override);
    if (!v.ok) {
      return { ok: false, code: 'SPEC_MALFORMED', error: `plan override invalid: ${v.reason}` };
    }
    const existingIdx = out.findIndex((c) => c.id === override.id);
    if (existingIdx === -1) {
      out.push(override);
      continue;
    }
    const existing = out[existingIdx];
    if (existing.kind !== override.kind) {
      return {
        ok: false,
        code: 'SPEC_OVERRIDE_REJECTED',
        error: `plan override '${override.id}' changes kind from '${existing.kind}' to '${override.kind}'`,
      };
    }
    const oldRank = severityRank(existing.severity || 'block');
    const newRank = severityRank(override.severity || 'block');
    if (newRank < oldRank) {
      return {
        ok: false,
        code: 'SPEC_OVERRIDE_REJECTED',
        error: `plan override '${override.id}' downgrades severity from '${existing.severity || 'block'}' to '${override.severity}'`,
      };
    }
    // Sprint 2.18 R2 (edge HIGH — override weakening): for read_set criteria,
    // severity-rank parity alone is insufficient. A plan can preserve severity
    // while swapping `expected_glob` to a narrower pattern, decreasing
    // expected_count, or lowering min_coverage — each weakens the proof.
    // Forbid those mutations; allow severity strengthening, allow expanding
    // the scope (longer glob, higher count, higher min_coverage).
    if (existing.kind === 'read_set' && override.kind === 'read_set') {
      if (existing.expected_glob !== override.expected_glob) {
        return {
          ok: false,
          code: 'SPEC_OVERRIDE_REJECTED',
          error: `plan override '${override.id}' changes read_set expected_glob from '${existing.expected_glob}' to '${override.expected_glob}' — overrides may strengthen but not redirect the proof`,
        };
      }
      const oldCount = existing.expected_count;
      const newCount = override.expected_count;
      if (oldCount !== undefined && (newCount === undefined || newCount < oldCount)) {
        return {
          ok: false,
          code: 'SPEC_OVERRIDE_REJECTED',
          error: `plan override '${override.id}' weakens read_set expected_count from ${oldCount} to ${newCount}`,
        };
      }
      const oldMinCov = existing.min_coverage !== undefined ? existing.min_coverage : 1.0;
      const newMinCov = override.min_coverage !== undefined ? override.min_coverage : 1.0;
      if (newMinCov < oldMinCov) {
        return {
          ok: false,
          code: 'SPEC_OVERRIDE_REJECTED',
          error: `plan override '${override.id}' weakens read_set min_coverage from ${oldMinCov} to ${newMinCov}`,
        };
      }
    }
    out[existingIdx] = override;
  }
  return { ok: true, criteria: out };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrypoint
// ─────────────────────────────────────────────────────────────────────────────

const FAIL_CLOSED_CODES = new Set([
  'SPEC_PREDICATE_THREW',
  'SPEC_SHELL_TIMEOUT',
  'SPEC_LLM_JUDGE_NOT_IMPLEMENTED',
  'SPEC_MALFORMED',
]);

function runChecks(plan, applyResult, opts = {}) {
  const repoRoot = opts.repoRoot || (plan && plan.repoRoot) || process.cwd();
  const actionKinds = opts.actionKinds || require('./action-kinds.cjs');
  const kindName = (plan && plan.action_kind) || actionKinds.DEFAULT_KIND;
  const kindEntry = actionKinds.getActionKind(kindName);

  if (!kindEntry) {
    return {
      ok: false,
      code: 'SPEC_MALFORMED',
      error: `unknown action_kind '${kindName}'`,
      spec_failures: [],
    };
  }
  const kindCriteria = kindEntry.acceptance_criteria;
  // Strict-mode default (Q2 = YES): kinds without acceptance_criteria fail-closed.
  if (!Array.isArray(kindCriteria)) {
    return {
      ok: false,
      code: 'SPEC_MALFORMED',
      error: `action_kind '${kindName}' has no acceptance_criteria array (strict mode)`,
      spec_failures: [],
    };
  }

  // Validate every kind-level criterion upfront — registry typos must fail loudly.
  for (const c of kindCriteria) {
    const v = validateCriterion(c);
    if (!v.ok) {
      return {
        ok: false,
        code: 'SPEC_MALFORMED',
        error: `kind '${kindName}' criterion '${(c && c.id) || '<no-id>'}' invalid: ${v.reason}`,
        spec_failures: [],
      };
    }
  }

  const planOverrides = plan && plan.acceptance_criteria;
  const merge = mergeCriteria(kindCriteria, planOverrides);
  if (!merge.ok) {
    return { ok: false, code: merge.code, error: merge.error, spec_failures: [] };
  }

  const ctx = {
    repoRoot,
    touchedFiles: (applyResult && applyResult.touchedFiles) || [],
    edits: (applyResult && applyResult.edits) || (plan && plan.applied_edits) || [],
    plan: plan || {},
    previousSizes: (applyResult && applyResult.previousSizes) || {},
    previousContents: (applyResult && applyResult.previousContents) || {},
  };

  const blockFailures = [];
  const warnFailures = [];

  for (const c of merge.criteria) {
    const runner = RUNNERS[c.kind];
    if (!runner) {
      return {
        ok: false,
        code: 'SPEC_MALFORMED',
        error: `no runner registered for kind '${c.kind}' (criterion '${c.id}')`,
        spec_failures: [],
      };
    }
    let r;
    try {
      r = runner(c, ctx);
    } catch (err) {
      return {
        ok: false,
        code: 'SPEC_MALFORMED',
        error: `runner for '${c.kind}' threw on criterion '${c.id}': ${err.message}`,
        spec_failures: [{ id: c.id, kind: c.kind, severity: c.severity || 'block', code: 'SPEC_MALFORMED', error: err.message }],
      };
    }
    if (r.ok) continue;

    const failure = {
      id: c.id,
      kind: c.kind,
      severity: c.severity || 'block',
      description: c.description || '',
      code: r.code,
      expected: r.expected,
      actual: r.actual,
    };

    if (FAIL_CLOSED_CODES.has(r.code)) {
      return {
        ok: false,
        code: r.code,
        error: `criterion '${c.id}' (${c.kind}): ${r.actual || r.expected || r.code}`,
        spec_failures: [failure],
      };
    }
    if ((c.severity || 'block') === 'warn') {
      warnFailures.push(failure);
    } else {
      blockFailures.push(failure);
    }
  }

  // Sprint 2.1 R2 fix (edge MAJOR): always return criteria_passed +
  // criteria_total so consumers (autoresearch delta-anomaly detector) can
  // compute spec margin. Pre-fix: return shape only had `spec_failures` —
  // autoresearch's `winner.spec_criteria_passed - 0` was always 0, the entire
  // delta-anomaly mechanism dead-on-arrival.
  const criteriaTotal = merge.criteria.length;
  const criteriaPassed = criteriaTotal - blockFailures.length - warnFailures.length;

  if (blockFailures.length > 0) {
    return {
      ok: false,
      code: 'SPEC_VIOLATION',
      error: `${blockFailures.length} block criterion failure(s): ${blockFailures.map((f) => f.id).join(', ')}`,
      spec_failures: [...blockFailures, ...warnFailures],
      criteria_passed: criteriaPassed,
      criteria_total: criteriaTotal,
    };
  }
  if (warnFailures.length > 0) {
    return {
      ok: true,
      code: 'SPEC_WARNING',
      warnings: warnFailures.length,
      spec_failures: warnFailures,
      criteria_passed: criteriaPassed,
      criteria_total: criteriaTotal,
    };
  }
  return {
    ok: true,
    spec_failures: [],
    criteria_passed: criteriaTotal,
    criteria_total: criteriaTotal,
  };
}

module.exports = {
  runChecks,
  validateCriterion,
  mergeCriteria,
  simpleGlobMatch,
  filterTargets,
  buildPredicateContext,
  // exposed for direct unit testing
  runShell,
  runFilePredicate,
  runRegex,
  runEarsText,
  runLlmJudge,
  runReadSet,
  enumerateGlob,
  normalizeReadSet,
  // constants
  EARS_PATTERNS,
  VALID_KINDS,
  VALID_SEVERITIES,
  FAIL_CLOSED_CODES,
  DEFAULT_SHELL_TIMEOUT_MS,
  SHELL_TIMEOUT_MAX_MS,
  PREDICATE_DENYLIST,
  READ_SET_DEFAULT_EXCLUDES,
  READ_SET_MAX_FILES_ENUMERATED,
  READ_SET_MAX_WALK_DEPTH,
};
