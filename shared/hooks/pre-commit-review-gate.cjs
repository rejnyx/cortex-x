#!/usr/bin/env node
// cortex-x PreToolUse hook — commit-time review gate.
//
// When a `git commit` would land a NON-TRIVIAL diff and no adversarial review
// ran this session, DENY the commit (decision is handed to the agent, NOT a
// user prompt) with a reason telling it to run the review pipeline first, then
// retry. This is the one hard gate cortex places on top of the soft
// auto-orchestrate nudge — sited at the commit, the moment skipping review
// costs the most.
//
// "Review ran" is detected via TWO complementary signals:
//   1. Session marker dropped by post-tool-use.cjs when a review agent
//      (blind-hunter, edge-case-hunter, …) fires.
//   2. (Sprint 2.46) A signed R2 verdict at `cortex/r2-verdict.json` that
//      verifies against `bin/steward/_lib/r2-verdict.cjs` with decision=PASS.
//      Lets workflows that ran R2 in a different session (or in CI) unblock
//      the commit without relying on the per-session marker.
//
// Escape hatches (conscious skip, not noise): `[skip-review]` in the commit
// message, or `CORTEX_REVIEW_GATE=0` in the environment.
//
// Contract:
//   stdin  — JSON { tool_name, tool_input:{command}, session_id, cwd }
//   stdout — deny → { hookSpecificOutput:{ permissionDecision:'deny', … } }
//            allow/pass → { continue:true }
//   Fail-open: any error or uncertainty → allow. A gate must never wedge work.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { REVIEW_AGENTS } = require('./_lib/review-agents.cjs');

const TRIVIAL_FILE_THRESHOLD = 3; // < 3 staged files = trivial, no gate

// Detect a real `git commit` action. `git commit` must sit at a command
// position — start of string or just after a chain operator (&& || | ; ) — so
// `echo "git commit"` (the phrase inside an argument) does NOT trigger.
// Excludes the forms that never create a commit (--help/-h, --dry-run).
function isGitCommit(command) {
  if (!command || typeof command !== 'string') return false;
  if (!/(^|&&|\|\||[&|;])\s*git\s+commit\b/.test(command)) return false;
  if (/\bgit\s+commit\s+(--help|-h)\b/.test(command)) return false;      // help form
  if (/\bgit\s+commit\b[^&|;]*--dry-run\b/.test(command)) return false;  // dry-run never commits
  return true;
}

function hasSkipMarker(command) {
  return /\[skip-review\]/i.test(String(command || ''));
}

function gateDisabled(env) {
  return String((env || {}).CORTEX_REVIEW_GATE || '') === '0';
}

function hashSessionId(sessionId) {
  if (!sessionId) return '';
  return crypto.createHash('sha1').update(String(sessionId)).digest('hex').slice(0, 12);
}

function reviewMarkerPath(sessionHash) {
  return path.join(os.tmpdir(), `cortex-review-${sessionHash}.flag`);
}

// Pure decision core — all I/O resolved by the caller so this is unit-testable.
// Returns { decision: 'allow' | 'deny', reason? }.
//
// `verdictValid` (Sprint 2.46): the caller has read `cortex/r2-verdict.json`,
// verified its HMAC signature against the R2 secret, and confirmed
// decision === 'PASS'. When true, this is a SECOND independent unblock path
// equivalent to `markerExists`.
//
// Sprint 2.46.1 added three new inputs that close the replay window left
// open by Sprint 2.46:
//   - `commitShaMismatch` (bool): verdict v2 is signed against a payload
//     whose `commit_sha` field does NOT match `git rev-parse HEAD` at the
//     moment of commit. Stale verdict from an earlier HEAD; reject.
//   - `runIdBurned` (bool): verdict's `workflow_run_id` was already
//     recorded in the per-operator nonce journal — single-use semantics,
//     so a re-presented verdict is a replay attempt; reject.
//   - `strictSecretMissing` (bool): CORTEX_R2_VERDICT_STRICT=1 is set
//     but `resolveSecret()` could neither read the env var nor a persisted
//     key, so the hook cannot cryptographically verify ANY incoming
//     verdict. Hard-fail rather than fall through silently.
//
// Precedence inside the gate:
//   strictSecretMissing → DENY (operator wants fail-CLOSED; honor it)
//   marker present       → ALLOW (existing path)
//   verdictValid && (commitShaMismatch | runIdBurned) → DENY
//   verdictValid          → ALLOW (existing path)
//   otherwise            → DENY with the original "run a review" reason
function decide({ isCommit, skip, disabled, sessionHash, stagedCount, markerExists, verdictValid, commitShaMismatch, runIdBurned, strictSecretMissing }) {
  if (!isCommit) return { decision: 'allow' };
  if (disabled || skip) return { decision: 'allow' };
  if (!sessionHash) return { decision: 'allow' };       // can't correlate → fail-open
  if (!Number.isFinite(stagedCount) || stagedCount < TRIVIAL_FILE_THRESHOLD) {
    return { decision: 'allow' };                        // trivial / unknown → fail-open
  }
  // STRICT_SECRET hard-fail: operator opted into fail-CLOSED, so a missing
  // secret is itself a deny condition — we cannot pretend the verdict path
  // is intact. This precedes the marker check intentionally: in STRICT
  // mode, an operator who relies on the marker alone is exposed to a quiet
  // downgrade attack if the verdict pipeline silently falls back to the
  // host-derived fallback. Force the operator to provision the secret.
  if (strictSecretMissing) {
    return {
      decision: 'deny',
      reason:
        'cortex review-gate: STRICT_SECRET=1 is set but the verdict-signing secret cannot be resolved. ' +
        'Provision $CORTEX_R2_VERDICT_SECRET (env), initialize the persisted key via cortex-doctor, ' +
        'or unset CORTEX_R2_VERDICT_STRICT to fall back to host-derived signing.',
    };
  }
  if (markerExists) return { decision: 'allow' };        // review ran this session
  // Sprint 2.46.1 — verdict is signature-valid but stale w.r.t. HEAD.
  // Re-running the R2 pipeline against the current tree produces a fresh
  // verdict bound to the new HEAD; the operator does not get to reuse the
  // old one across commits.
  if (verdictValid && commitShaMismatch) {
    return {
      decision: 'deny',
      reason:
        'cortex review-gate: signed verdict present but verdict.commit_sha does not match git rev-parse HEAD ' +
        '(stale verdict — the tree under review is not the tree about to commit). ' +
        'Re-run /cortex-sprint to produce a fresh verdict bound to the current HEAD.',
    };
  }
  // Sprint 2.46.1 — verdict is signature-valid AND fresh against HEAD, but
  // its workflow_run_id was already burned by a previous commit on this
  // host. Replay attempt; reject.
  if (verdictValid && runIdBurned) {
    return {
      decision: 'deny',
      reason:
        'cortex review-gate: signed verdict workflow_run_id was already consumed by a previous commit ' +
        '(replay attempt — a verdict is single-use). ' +
        'Generate a new workflow run via /cortex-sprint to produce a fresh workflow_run_id.',
    };
  }
  if (verdictValid) return { decision: 'allow' };        // signed R2 verdict present (Sprint 2.46)
  return {
    decision: 'deny',
    reason:
      `cortex review-gate: this commit stages ${stagedCount} files but no review pipeline ran this session. ` +
      `Run the adversarial review (paste prompts/code-review.md, or dispatch the review agents — ${REVIEW_AGENTS.join(', ')} ` +
      '— in parallel), apply consensus HIGH findings, then retry the commit. ' +
      'Alternative: emit a signed R2 verdict to cortex/r2-verdict.json (see shared/skills/cortex-sprint Phase 6.5). ' +
      'Conscious skip: add [skip-review] to the commit message, or set CORTEX_REVIEW_GATE=0.',
  };
}

// Resolve the repo root for a working directory. Neutralizes core.fsmonitor +
// core.pager on the command line so a hostile repo config can't run code.
// Returns '' (falsy) on any failure — caller treats that as "no verdict".
function repoRootFor(cwd) {
  try {
    const out = execFileSync('git', [
      '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat',
      'rev-parse', '--show-toplevel',
    ], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim();
  } catch {
    return '';
  }
}

// Resolve the current HEAD SHA inside a working directory. Same neutralization
// as repoRootFor — a hostile repo config can't run code. Returns '' on any
// failure; the caller treats falsy as "could not bind verdict to HEAD".
function headShaFor(cwd) {
  try {
    const out = execFileSync('git', [
      '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat',
      'rev-parse', 'HEAD',
    ], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim();
  } catch {
    return '';
  }
}

// Load + verify cortex/r2-verdict.json. Returns a structured result instead
// of a bare boolean (Sprint 2.46.1) so the caller can route the three new
// deny conditions (commitShaMismatch, runIdBurned, strictSecretMissing) to
// `decide()` rather than collapsing them into a single "verdictValid: false".
//
// Return shape:
//   {
//     verdictValid: bool,       // signature OK + decision === 'PASS'
//     commitShaMismatch: bool,  // v2-only: payload.commit_sha !== HEAD
//     runIdBurned: bool,        // workflow_run_id present in nonce journal
//     strictSecretMissing: bool // STRICT mode + secret unresolvable
//   }
//
// Failure modes (missing file, malformed JSON, broken module, bad signature,
// decision=FAIL) collapse to { verdictValid: false, commitShaMismatch: false,
// runIdBurned: false, strictSecretMissing: false } — preserves the Sprint
// 2.46 fail-open posture for everything EXCEPT STRICT mode, which is
// surfaced separately so `decide()` can hard-fail.
//
// Sprint 2.46.1 binds the verdict to a commit SHA + a single-use journal,
// closing the cross-commit replay window described in Sprint 2.46.
function loadAndVerifyVerdict(repoRoot, opts) {
  const options = opts || {};
  const out = {
    verdictValid: false,
    commitShaMismatch: false,
    runIdBurned: false,
    strictSecretMissing: false,
  };
  if (!repoRoot) return out;

  let r2;
  try {
    r2 = require('../../bin/steward/_lib/r2-verdict.cjs');
  } catch {
    return out; // module not installed (older cortex) → fail-open
  }
  if (!r2 || typeof r2.verifyVerdict !== 'function' || typeof r2.loadVerdict !== 'function') {
    return out; // module shape unexpected → fail-open
  }

  // Resolve the secret.
  //
  // In NORMAL mode we use r2._resolveSecret() — the WITH-generate variant.
  // It auto-creates a persisted random key on first use, so a fresh install
  // gets a usable secret without operator setup.
  //
  // In STRICT mode (Sprint 2.46.1 R2 fix HIGH-2) we MUST use
  // r2._resolveSecretNoGenerate() instead. The point of STRICT is to force
  // the operator to provision the secret explicitly — auto-generating would
  // silently bypass the strict knob and return `source: 'file'`. The
  // no-generate variant returns `source: 'host-derived'` (or 'none') on a
  // clean $CORTEX_DATA_HOME, which the strict guard below correctly trips.
  let resolved = null;
  try {
    const resolverFn = options.strictSecret
      ? (typeof r2._resolveSecretNoGenerate === 'function'
          ? r2._resolveSecretNoGenerate
          : r2._resolveSecret)
      : r2._resolveSecret;
    resolved = (typeof resolverFn === 'function') ? resolverFn() : null;
  } catch {
    resolved = null;
  }
  const secret = resolved && resolved.secret;
  const secretSource = (resolved && resolved.source) || 'none';

  if (options.strictSecret) {
    // In STRICT mode the gate refuses to honor host-derived signatures or
    // any auto-bootstrap path. Either the env secret is set, or the
    // persisted key file exists, or the operator gets a hard fail telling
    // them which knob to flip.
    if (!secret || secretSource === 'host-derived' || secretSource === 'none') {
      out.strictSecretMissing = true;
      return out;
    }
  }
  if (!secret) return out;

  let loaded;
  try {
    loaded = r2.loadVerdict(repoRoot);
  } catch {
    return out; // unexpected I/O error (EACCES, …) → fail-open
  }
  if (!loaded || !loaded.json) return out; // ENOENT or bad JSON

  // Call verifyVerdict. Two shapes are supported:
  //   v1 (Sprint 2.46):     verifyVerdict(json, secret) → { ok, reason, parsed }
  //   v2 (Sprint 2.46.1):   verifyVerdict(json, secret, options) → { ok, reason, parsed }
  // Both accept the same first two positional args; the third options arg
  // is silently ignored by the v1 module. We always pass the v2 options
  // so the v2 module enforces headSha / journalLookup at the source, and
  // also re-derive the flags at the hook level as a defense-in-depth so
  // v1 modules still get the binding enforced from the outside.
  const verifyOptions = {
    headSha: options.headSha || undefined,
    journalLookup: options.journalLookup || undefined,
    strictSecret: !!options.strictSecret,
  };

  let result;
  try {
    result = r2.verifyVerdict(loaded.json, secret, verifyOptions);
  } catch {
    return out;
  }
  if (!result || result.ok !== true) return out;
  // Don't accept the fail-open "no secret" warning state as a valid unblock —
  // we want a real signature check, not "couldn't check."
  if (result.reason === 'CORTEX_R2_VERDICT_NO_SECRET_WARNING') return out;
  // Decision must be PASS — a signed verdict with decision=FAIL means the R2
  // pipeline explicitly rejected the change, and the gate must enforce that.
  const parsed = result.parsed || loaded.json;
  if (!parsed || parsed.decision !== 'PASS') return out;

  // Defense-in-depth: re-check commit_sha + journal at the hook level even
  // if the underlying module already did. This keeps the gate's behavior
  // identical across v1 (which doesn't know about these fields) and v2
  // (which enforces them internally). A v1 verdict with no commit_sha
  // field is treated as "no commit binding" (legacy compat, allow).
  const schemaVersion = Number(parsed.schema_version) || 1;
  if (schemaVersion >= 2) {
    if (parsed.commit_sha && options.headSha && parsed.commit_sha !== options.headSha) {
      out.commitShaMismatch = true;
      out.verdictValid = true; // signature ok; staleness is a separate deny path
      return out;
    }
  }

  // workflow_run_id replay check applies to BOTH v1 and v2 — the journal
  // is just a per-operator nonce store; a v1 verdict that has already been
  // burned is still a replay attempt. Guarded by the presence of a working
  // journalLookup; absence is fail-open.
  if (typeof options.journalLookup === 'function' && parsed.workflow_run_id) {
    let burned = false;
    try {
      burned = options.journalLookup(parsed.workflow_run_id);
    } catch {
      burned = false; // lookup failure → fail-open (don't block on infra)
    }
    if (burned) {
      out.runIdBurned = true;
      out.verdictValid = true; // signature ok; replay is a separate deny path
      return out;
    }
  }

  // Sprint 2.46.1 R2 fix HIGH-1: BURN the nonce so the SAME verdict cannot
  // unblock a SECOND commit on this machine. Without this append, the
  // single-use semantics promised by the journal are non-functional —
  // wasSeen() always returns false in production because nothing ever
  // writes. Failure to append must NOT block the commit (fail-OPEN on
  // journal I/O); but the attempt is mandatory.
  if (parsed.workflow_run_id && options.appendSeen) {
    try {
      options.appendSeen({
        workflowRunId: parsed.workflow_run_id,
        sprintId: parsed.sprint_id,
        commitSha: parsed.commit_sha || options.headSha,
        seenAt: options.nowIso || new Date().toISOString(),
      });
    } catch {
      // fail-OPEN: replay defense is best-effort; never block a commit on
      // journal write failure (disk full, EACCES, etc.)
    }
  }

  out.verdictValid = true;
  return out;
}

function countStagedFiles(cwd) {
  try {
    // `cwd` comes from the hook payload, so we run git in a possibly-untrusted
    // repo. `diff --name-only` executes no diff driver/pager, but the target's
    // config could set core.fsmonitor (spawns a program) — neutralize it (and
    // the pager) on the command line so the repo's config can't run code.
    const out = execFileSync('git', [
      '-c', 'core.fsmonitor=false', '-c', 'core.pager=cat',
      'diff', '--cached', '--name-only',
    ], {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').filter((l) => l.trim()).length;
  } catch {
    return NaN; // not a repo / git missing / timeout → unknown → fail-open allow
  }
}

function readInput() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function allow() {
  process.stdout.write(JSON.stringify({ continue: true }));
}

function main() {
  const data = readInput();
  const toolName = data.tool_name || data.toolName || '';
  const ti = data.tool_input || data.toolInput || {};
  const command = ti.command || '';

  // Cheap pre-checks first — the vast majority of Bash calls are not commits,
  // so we only spawn git for an actual commit command.
  if (toolName !== 'Bash' || !isGitCommit(command)) { allow(); return; }

  const skip = hasSkipMarker(command);
  const disabled = gateDisabled(process.env);
  const sessionHash = hashSessionId(data.session_id || data.sessionId || '');

  // Short-circuit before spawning git if an escape hatch already allows it.
  if (skip || disabled || !sessionHash) { allow(); return; }

  const stagedCount = countStagedFiles(data.cwd);
  const markerExists = (() => {
    try { return fs.existsSync(reviewMarkerPath(sessionHash)); } catch { return false; }
  })();
  // Sprint 2.46 — second independent unblock path via signed R2 verdict.
  // Sprint 2.46.1 — bind verdict to HEAD + check the nonce journal +
  // honor CORTEX_R2_VERDICT_STRICT=1 (fail-CLOSED on host-derived secret).
  //
  // Sprint 2.46.1 R2 fix HIGH-5: we now ALWAYS consult the verdict path
  // even when markerExists, so a verdict file present on disk gets its
  // nonce burned regardless of whether the session-marker also allows.
  // Previously a markerExists shortcut skipped the verdict entirely,
  // leaving the file replayable on a subsequent commit in a new session.
  const strictSecret = String(process.env.CORTEX_R2_VERDICT_STRICT || '') === '1';
  const verdictResult = (() => {
    try {
      const repoRoot = repoRootFor(data.cwd);
      const headSha = headShaFor(data.cwd);
      // r2-verdict-journal.cjs is a shipped sibling (Sprint 2.46.1 impl-2).
      // Guard the require: when the journal module isn't present yet,
      // journalLookup + appendSeen are undefined → loadAndVerifyVerdict
      // treats the replay window as undefended (fail-open) AND skips burn.
      let journalLookup;
      let appendSeen;
      try {
        const journal = require('../../bin/steward/_lib/r2-verdict-journal.cjs');
        if (journal && typeof journal.wasSeen === 'function') {
          journalLookup = (workflowRunId) => journal.wasSeen(repoRoot, workflowRunId);
        }
        if (journal && typeof journal.appendSeen === 'function') {
          appendSeen = (entry) => journal.appendSeen(repoRoot, entry);
        }
      } catch {
        journalLookup = undefined;
        appendSeen = undefined;
      }
      return loadAndVerifyVerdict(repoRoot, {
        headSha,
        journalLookup,
        appendSeen,
        strictSecret,
      });
    } catch {
      return { verdictValid: false, commitShaMismatch: false, runIdBurned: false, strictSecretMissing: false };
    }
  })();

  const verdict = decide({
    isCommit: true,
    skip,
    disabled,
    sessionHash,
    stagedCount,
    markerExists,
    verdictValid: verdictResult.verdictValid,
    commitShaMismatch: verdictResult.commitShaMismatch,
    runIdBurned: verdictResult.runIdBurned,
    strictSecretMissing: verdictResult.strictSecretMissing,
  });

  if (verdict.decision === 'deny') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: verdict.reason,
      },
    }));
    return;
  }
  allow();
}

module.exports = {
  isGitCommit,
  hasSkipMarker,
  gateDisabled,
  hashSessionId,
  decide,
  loadAndVerifyVerdict,
  repoRootFor,
  headShaFor,
  TRIVIAL_FILE_THRESHOLD,
};

if (require.main === module) {
  try { main(); }
  catch { try { allow(); } catch {} process.exit(0); }
}
