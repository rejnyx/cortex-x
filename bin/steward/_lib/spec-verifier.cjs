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
//     kind: "shell" | "file_predicate" | "regex" | "ears_text" | "llm_judge",
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
//   }
//
// Plan-level overrides (`plan.acceptance_criteria`):
//   - May ADD new ids (additional criteria for one specific action).
//   - May STRENGTHEN existing ids (same kind, same-or-stricter severity).
//   - May NOT downgrade severity (block→warn) → SPEC_OVERRIDE_REJECTED.
//   - May NOT change kind for an existing id → SPEC_OVERRIDE_REJECTED.
//
// Failure model:
//   - SPEC_VIOLATION         — at least one block-severity criterion failed
//   - SPEC_WARNING           — only warn-severity criteria failed (returns ok=true)
//   - SPEC_MALFORMED         — unknown kind, missing fields, invalid pattern (fail-closed)
//   - SPEC_PREDICATE_THREW   — file_predicate compile/runtime threw (fail-closed)
//   - SPEC_SHELL_TIMEOUT     — shell criterion exceeded timeoutMs (fail-closed)
//   - SPEC_REGEX_NO_MATCH    — required pattern absent from target file
//   - SPEC_OVERRIDE_REJECTED — plan attempted to weaken a criterion
//   - SPEC_LLM_JUDGE_NOT_IMPLEMENTED — kind: "llm_judge" reserved for v2.0+

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VALID_KINDS = ['shell', 'file_predicate', 'regex', 'ears_text', 'llm_judge'];
const VALID_SEVERITIES = ['block', 'warn'];
const DEFAULT_SHELL_TIMEOUT_MS = 30_000;
const SHELL_TIMEOUT_MAX_MS = 5 * 60_000;

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

const RUNNERS = {
  shell: runShell,
  file_predicate: runFilePredicate,
  regex: runRegex,
  ears_text: runEarsText,
  llm_judge: runLlmJudge,
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
  // constants
  EARS_PATTERNS,
  VALID_KINDS,
  VALID_SEVERITIES,
  FAIL_CLOSED_CODES,
  DEFAULT_SHELL_TIMEOUT_MS,
  SHELL_TIMEOUT_MAX_MS,
  PREDICATE_DENYLIST,
};
