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
function decide({ isCommit, skip, disabled, sessionHash, stagedCount, markerExists, verdictValid }) {
  if (!isCommit) return { decision: 'allow' };
  if (disabled || skip) return { decision: 'allow' };
  if (!sessionHash) return { decision: 'allow' };       // can't correlate → fail-open
  if (!Number.isFinite(stagedCount) || stagedCount < TRIVIAL_FILE_THRESHOLD) {
    return { decision: 'allow' };                        // trivial / unknown → fail-open
  }
  if (markerExists) return { decision: 'allow' };        // review ran this session
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

// Load + verify cortex/r2-verdict.json. Returns true iff the verdict exists,
// parses, verifies cryptographically, AND decision === 'PASS'. Any failure
// (missing file, bad JSON, missing module, secret-warning fail-open from the
// module, bad signature, decision: FAIL) → false, and the hook falls back to
// the existing markerExists / escape-hatch logic.
//
// This is fail-open by intent: a broken verdict pipeline never wedges the
// commit — at worst the operator gets the original "run the review" message
// and either runs it or uses [skip-review].
//
// Note (Sprint 2.46): the shipped r2-verdict module does NOT bind verdicts to
// a commit SHA. The HMAC covers sprint_id + workflow_run_id + findings +
// agent_roster, but a freshly-signed verdict can unblock any subsequent commit
// on the same machine until the file is overwritten. This is acceptable for
// single-operator local continuity; cross-commit replay defense is tracked
// as follow-up work alongside Ed25519 promotion.
function loadAndVerifyVerdict(repoRoot) {
  if (!repoRoot) return false;

  let r2;
  try {
    r2 = require('../../bin/steward/_lib/r2-verdict.cjs');
  } catch {
    return false; // module not installed (older cortex) → fail-open
  }
  if (!r2 || typeof r2.verifyVerdict !== 'function' || typeof r2.loadVerdict !== 'function') {
    return false; // module shape unexpected → fail-open
  }

  let loaded;
  try {
    loaded = r2.loadVerdict(repoRoot);
  } catch {
    return false; // unexpected I/O error (EACCES, …) → fail-open
  }
  if (!loaded || !loaded.json) return false; // ENOENT or bad JSON

  // Resolve the secret. The shipped module always returns a non-null secret
  // (env first, else host-derived fallback). We treat the warning-state from
  // verifyVerdict (secret missing) as a non-unblock — but with the shipped
  // resolver the secret is never empty, so that path is defensive only.
  let secret;
  try {
    const resolved = (typeof r2._resolveSecret === 'function')
      ? r2._resolveSecret()
      : null;
    secret = resolved && resolved.secret;
  } catch {
    return false;
  }
  if (!secret) return false;

  let result;
  try {
    result = r2.verifyVerdict(loaded.json, secret);
  } catch {
    return false;
  }
  if (!result || result.ok !== true) return false;
  // Don't accept the fail-open "no secret" warning state as a valid unblock —
  // we want a real signature check, not "couldn't check."
  if (result.reason === 'CORTEX_R2_VERDICT_NO_SECRET_WARNING') return false;
  // Decision must be PASS — a signed verdict with decision=FAIL means the R2
  // pipeline explicitly rejected the change, and the gate must enforce that.
  const parsed = result.parsed || loaded.json;
  if (!parsed || parsed.decision !== 'PASS') return false;

  return true;
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
  // Only resolve the repo root if the marker is absent (cheapest path first +
  // the verdict is only consulted when it actually matters).
  const verdictValid = markerExists ? false : (() => {
    try {
      const repoRoot = repoRootFor(data.cwd);
      return loadAndVerifyVerdict(repoRoot);
    } catch { return false; }
  })();

  const verdict = decide({ isCommit: true, skip, disabled, sessionHash, stagedCount, markerExists, verdictValid });

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
  TRIVIAL_FILE_THRESHOLD,
};

if (require.main === module) {
  try { main(); }
  catch { try { allow(); } catch {} process.exit(0); }
}
