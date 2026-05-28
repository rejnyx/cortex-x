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
// "Review ran" is detected via the session marker dropped by post-tool-use.cjs
// when a review agent (blind-hunter, edge-case-hunter, …) fires.
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
function decide({ isCommit, skip, disabled, sessionHash, stagedCount, markerExists }) {
  if (!isCommit) return { decision: 'allow' };
  if (disabled || skip) return { decision: 'allow' };
  if (!sessionHash) return { decision: 'allow' };       // can't correlate → fail-open
  if (!Number.isFinite(stagedCount) || stagedCount < TRIVIAL_FILE_THRESHOLD) {
    return { decision: 'allow' };                        // trivial / unknown → fail-open
  }
  if (markerExists) return { decision: 'allow' };        // review ran this session
  return {
    decision: 'deny',
    reason:
      `cortex review-gate: this commit stages ${stagedCount} files but no review pipeline ran this session. ` +
      `Run the adversarial review (paste prompts/code-review.md, or dispatch the review agents — ${REVIEW_AGENTS.join(', ')} ` +
      '— in parallel), apply consensus HIGH findings, then retry the commit. ' +
      'Conscious skip: add [skip-review] to the commit message, or set CORTEX_REVIEW_GATE=0.',
  };
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

  const verdict = decide({ isCommit: true, skip, disabled, sessionHash, stagedCount, markerExists });

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

module.exports = { isGitCommit, hasSkipMarker, gateDisabled, hashSessionId, decide, TRIVIAL_FILE_THRESHOLD };

if (require.main === module) {
  try { main(); }
  catch { try { allow(); } catch {} process.exit(0); }
}
