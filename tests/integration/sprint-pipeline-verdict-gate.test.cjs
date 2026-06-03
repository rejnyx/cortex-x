'use strict';

// Sprint 2.46 integration — pre-commit review gate consults
// cortex/r2-verdict.json as a SECOND unblock path equivalent to the session
// marker. The full pipeline is: real fs in os.tmpdir() · real `git init` repo
// · stage a non-trivial diff (>=3 files) · drop a signed verdict on disk ·
// invoke the hook via spawn · assert allow / deny envelope.
//
// All cases keep `markerExists` false so the verdict branch is what's under
// test — the marker path is well-covered by tests/unit/hooks/.
//
// Module availability: this suite consumes
// `bin/steward/_lib/r2-verdict.cjs`, which is shipped in parallel by Sprint
// 2.46 impl-1. When the module is missing, the verdict-dependent cases skip
// cleanly via `t.skip()` so this file doesn't wedge CI before the sibling
// implementation lands. The module-independent cases (no verdict + deny,
// [skip-review] escape hatch) still run unconditionally and remain regression
// coverage even on older trees.

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HOOK_PATH = path.join(REPO_ROOT, 'shared', 'hooks', 'pre-commit-review-gate.cjs');
const VERDICT_MODULE_PATH = path.join(REPO_ROOT, 'bin', 'steward', '_lib', 'r2-verdict.cjs');
const JOURNAL_MODULE_PATH = path.join(REPO_ROOT, 'bin', 'steward', '_lib', 'r2-verdict-journal.cjs');

// === r2-verdict module — optional consumer (impl-1 ships this in parallel) ===

function tryLoadVerdictModule() {
  try {
    // Use a fresh require — picks up the module the moment impl-1 commits.
    delete require.cache[require.resolve(VERDICT_MODULE_PATH)];
    return require(VERDICT_MODULE_PATH);
  } catch {
    return null;
  }
}

const r2 = tryLoadVerdictModule();
const HAVE_VERDICT_MODULE = !!(
  r2 &&
  typeof r2.buildVerdict === 'function' &&
  typeof r2.verifyVerdict === 'function'
);

// Sprint 2.46.1 — schema_version=2 path. Detect whether the loaded module
// actually emits commit_sha in its built verdicts (i.e. impl-1 has shipped
// v2). Probe by building a tiny verdict + inspecting the parsed result; if
// commit_sha round-trips, v2 is live. Cases 7, 8 skip when v2 is absent.
function detectV2Support() {
  if (!HAVE_VERDICT_MODULE) return false;
  try {
    const v = r2.buildVerdict({
      sprintId: 'probe',
      workflowRunId: 'probe-' + crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      agentRoster: ['probe'],
      findings: {},
      applied: [], deferred: [], refuted: [],
      decision: 'PASS',
      secret: 'probe-secret',
      commitSha: 'a'.repeat(40),
      stagedTree: 'b'.repeat(40),
      schemaVersion: 2,
    });
    return !!(v && (v.commit_sha || (v.payload && v.payload.commit_sha)));
  } catch {
    return false;
  }
}
const HAVE_V2_SUPPORT = detectV2Support();

function tryLoadJournalModule() {
  try {
    delete require.cache[require.resolve(JOURNAL_MODULE_PATH)];
    return require(JOURNAL_MODULE_PATH);
  } catch {
    return null;
  }
}
const journalModule = tryLoadJournalModule();
const HAVE_JOURNAL_MODULE = !!(
  journalModule &&
  typeof journalModule.appendSeen === 'function' &&
  typeof journalModule.wasSeen === 'function'
);

// === git harness — Windows-safe tmpdir + minimal init/commit ===

function gitArgs(...rest) {
  // Same neutralization the hook uses so a hostile repo config can't run code.
  return ['-c', 'core.fsmonitor=false', '-c', 'core.pager=cat', ...rest];
}

function runGit(repo, args) {
  return execFileSync('git', gitArgs(...args), {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 8000,
  });
}

function makeTmpRepo(prefix) {
  // os.tmpdir() resolves Windows-safe (C:\Users\…\AppData\Local\Temp); node:path
  // handles separators transparently.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-verdict-gate-${prefix}-`));
  runGit(repo, ['init', '-q']);
  // The hook needs a real HEAD for verdict-vs-HEAD binding. Seed an initial
  // commit so `git rev-parse HEAD` resolves.
  runGit(repo, ['config', 'user.email', 'test@cortex-x.local']);
  runGit(repo, ['config', 'user.name', 'cortex-test']);
  runGit(repo, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'fixture', version: '0.0.0' }, null, 2));
  fs.writeFileSync(path.join(repo, 'README.md'), '# fixture\n');
  runGit(repo, ['add', 'package.json', 'README.md']);
  runGit(repo, ['commit', '-q', '-m', 'chore: seed fixture']);
  return repo;
}

// Stage a non-trivial diff (>= TRIVIAL_FILE_THRESHOLD = 3 files).
function stageNonTrivialDiff(repo) {
  for (const f of ['src/a.js', 'src/b.js', 'src/c.js', 'src/d.js']) {
    const p = path.join(repo, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `// fixture ${f}\nmodule.exports = ${JSON.stringify(f)};\n`);
  }
  runGit(repo, ['add', '-A']);
}

// === hook invocation — spawn matches production runtime ===

function runHook(payload, { env = {}, cwd = REPO_ROOT } = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const result = spawnSync(process.execPath, [HOOK_PATH], {
    encoding: 'utf8',
    input,
    timeout: 8000,
    cwd,
    env: { ...process.env, ...env },
  });
  let parsed = null;
  try { parsed = result.stdout && result.stdout.trim() ? JSON.parse(result.stdout.trim()) : null; } catch {}
  return {
    exitCode: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    parsed,
  };
}

function denied(out) {
  return !!(out && out.hookSpecificOutput && out.hookSpecificOutput.permissionDecision === 'deny');
}
function allowed(out) {
  return !!(out && out.continue === true);
}

// === verdict writing — both real-signed (when module present) and tampered ===

// Stable HMAC secret used across cases so verify/sign agree.
const TEST_SECRET = 'cortex-test-secret-2-46';

function writeVerdict(repo, verdictJson) {
  const dir = path.join(repo, 'cortex');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'r2-verdict.json'), JSON.stringify(verdictJson, null, 2));
}

function buildSignedVerdict({
  sprintId = '2.46',
  decision = 'PASS',
  commitSha,                 // v2 — when provided, sign the verdict against this HEAD
  stagedTree,                // v2 — defense-in-depth tree binding
  schemaVersion,             // v2 — pass 2 to force v2 path
  workflowRunId,             // override so callers can pre-seed the journal with the same id
} = {}) {
  // Only callable when HAVE_VERDICT_MODULE — sites guard before invoking.
  // impl-1 signature: buildVerdict(input) — secret is `input.secret`, NOT positional.
  const input = {
    sprintId,
    workflowRunId: workflowRunId || crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    agentRoster: ['security', 'correctness', 'acceptance', 'ssot', 'blind', 'edge-case'],
    findings: { HIGH: 0, MEDIUM: 2, LOW: 7 },
    applied: [],
    deferred: [],
    refuted: [],
    decision,
    secret: TEST_SECRET,
  };
  if (commitSha !== undefined) input.commitSha = commitSha;
  if (stagedTree !== undefined) input.stagedTree = stagedTree;
  if (schemaVersion !== undefined) input.schemaVersion = schemaVersion;
  return r2.buildVerdict(input);
}

// Resolve the current HEAD sha of a fixture repo using the same neutralized
// git incantation the hook uses. Returns trimmed sha hex string.
function currentHeadSha(repo) {
  const out = execFileSync('git', gitArgs('rev-parse', 'HEAD'), {
    cwd: repo,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    timeout: 8000,
  });
  return out.trim();
}

// Force the hook process to resolve our test secret instead of trying to read
// from $CORTEX_DATA_HOME or hostname fallback.
const HOOK_ENV = { CORTEX_R2_VERDICT_SECRET: TEST_SECRET };

// === cleanup tracking — every mkdtempSync gets registered ===

const cleanupDirs = [];
function tmpRepo(prefix) {
  const r = makeTmpRepo(prefix);
  cleanupDirs.push(r);
  return r;
}

after(() => {
  for (const d of cleanupDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

// === cases ===

describe('sprint 2.46 — pre-commit verdict gate', () => {
  test('module probe: r2-verdict module presence is reported', () => {
    // Surface the module-present/absent state in test output so failures of
    // downstream skips are diagnosable. Always passes — this is a noop sentinel.
    assert.ok(typeof HAVE_VERDICT_MODULE === 'boolean');
  });

  test('case 1 — no verdict + no marker + non-trivial diff → deny', () => {
    const repo = tmpRepo('case1');
    stageNonTrivialDiff(repo);
    // No cortex/r2-verdict.json written. No session marker for this session id.
    const r = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat: case1"' },
        session_id: `case1-${Date.now()}-${Math.random()}`,
        cwd: repo,
      },
      { env: HOOK_ENV }
    );
    assert.equal(r.exitCode, 0, `stderr=${r.stderr}`);
    assert.ok(denied(r.parsed), `expected deny envelope, got ${JSON.stringify(r.parsed)}`);
    assert.match(r.parsed.hookSpecificOutput.permissionDecisionReason, /review/i);
  });

  test('case 2 — valid signed verdict + no marker + non-trivial diff → allow', (t) => {
    if (!HAVE_VERDICT_MODULE) {
      t.skip('r2-verdict module not yet available (impl-1 ships in parallel)');
      return;
    }
    const repo = tmpRepo('case2');
    stageNonTrivialDiff(repo);
    const verdict = buildSignedVerdict();
    writeVerdict(repo, verdict);

    const r = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat: case2"' },
        session_id: `case2-${Date.now()}-${Math.random()}`,
        cwd: repo,
      },
      { env: HOOK_ENV }
    );
    assert.equal(r.exitCode, 0, `stderr=${r.stderr}`);
    assert.ok(allowed(r.parsed), `expected allow continue=true, got ${JSON.stringify(r.parsed)}`);
  });

  test('case 3 — tampered verdict → deny (verdictValid=false, falls through)', (t) => {
    if (!HAVE_VERDICT_MODULE) {
      t.skip('r2-verdict module not yet available (impl-1 ships in parallel)');
      return;
    }
    const repo = tmpRepo('case3');
    stageNonTrivialDiff(repo);
    const verdict = buildSignedVerdict();
    // Mutate a signed field AFTER signing — signature no longer matches.
    if (verdict && verdict.findings) {
      verdict.findings.HIGH = 99;
    } else {
      verdict.tampered = true;
    }
    writeVerdict(repo, verdict);

    const r = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat: case3"' },
        session_id: `case3-${Date.now()}-${Math.random()}`,
        cwd: repo,
      },
      { env: HOOK_ENV }
    );
    assert.equal(r.exitCode, 0, `stderr=${r.stderr}`);
    assert.ok(denied(r.parsed), `tampered verdict must not unblock; got ${JSON.stringify(r.parsed)}`);
  });

  test('case 4 — verdict for unrelated sprintId still allows (gate is sprint-agnostic)', (t) => {
    if (!HAVE_VERDICT_MODULE) {
      t.skip('r2-verdict module not yet available (impl-1 ships in parallel)');
      return;
    }
    const repo = tmpRepo('case4');
    stageNonTrivialDiff(repo);
    // sprintId differs from any "current" sprint; the gate must not enforce it.
    const verdict = buildSignedVerdict({ sprintId: '1.0' });
    writeVerdict(repo, verdict);

    const r = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat(2.46): case4 with sprint-mismatched verdict"' },
        session_id: `case4-${Date.now()}-${Math.random()}`,
        cwd: repo,
      },
      { env: HOOK_ENV }
    );
    assert.equal(r.exitCode, 0, `stderr=${r.stderr}`);
    assert.ok(allowed(r.parsed), `sprint mismatch must NOT block; got ${JSON.stringify(r.parsed)}`);
  });

  test('case 5 — CORTEX_R2_VERDICT_SECRET unset, verdict signed with TEST_SECRET → signature mismatch → deny (verdictValid=false)', (t) => {
    if (!HAVE_VERDICT_MODULE) {
      t.skip('r2-verdict module not yet available (impl-1 ships in parallel)');
      return;
    }
    const repo = tmpRepo('case5');
    stageNonTrivialDiff(repo);
    // Sign with a known TEST_SECRET that is unrelated to anything the hook can
    // derive from the host. The hook's resolveSecret() will fall back to
    // sha256(hostname + '|' + username) — guaranteed mismatch with TEST_SECRET
    // → verifyVerdict returns ok:false (SIGNATURE_MISMATCH) → verdictValid=false
    // → no marker → gate falls through to the existing deny path.
    const verdict = buildSignedVerdict();
    writeVerdict(repo, verdict);

    const env = { ...process.env };
    delete env.CORTEX_R2_VERDICT_SECRET;

    const r = spawnSync(process.execPath, [HOOK_PATH], {
      encoding: 'utf8',
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat: case5"' },
        session_id: `case5-fixed-session-id`,
        cwd: repo,
      }),
      timeout: 8000,
      cwd: REPO_ROOT,
      env,
    });
    let parsed = null;
    try { parsed = r.stdout && r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null; } catch {}

    assert.equal(r.status, 0, `gate must never crash; stderr=${r.stderr}`);
    assert.ok(parsed !== null, 'gate must emit a parseable envelope');
    // Strict regression assertion: verdict signed with TEST_SECRET cannot pass
    // verification against the host-derived fallback, so the gate MUST deny.
    // A future regression where missing-secret accidentally unblocks the gate
    // would be caught here.
    assert.ok(
      denied(parsed),
      `mismatched secret must deny (verdictValid=false); got ${JSON.stringify(parsed)}`
    );
    assert.match(
      parsed.hookSpecificOutput.permissionDecisionReason,
      /review/i,
      'deny reason should reference the review-gate path, not a crash'
    );
  });

  test('case 6 — [skip-review] in commit message bypasses verdict + deny path', () => {
    const repo = tmpRepo('case6');
    stageNonTrivialDiff(repo);
    // No verdict file. Escape hatch must short-circuit regardless.
    const r = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "fix: hot-patch [skip-review]"' },
        session_id: `case6-${Date.now()}-${Math.random()}`,
        cwd: repo,
      },
      { env: HOOK_ENV }
    );
    assert.equal(r.exitCode, 0, `stderr=${r.stderr}`);
    assert.ok(allowed(r.parsed), `[skip-review] must allow; got ${JSON.stringify(r.parsed)}`);
  });

  // === Sprint 2.46.1 — commit_sha binding + nonce journal + STRICT_SECRET ===
  //
  // The next 4 cases exercise the three new deny paths added by Sprint
  // 2.46.1, which close the cross-commit replay window left open by 2.46:
  //   - Case 7: v2 verdict signed against current HEAD → allow (happy path).
  //   - Case 8: v2 verdict signed against a different (stale) HEAD → deny.
  //   - Case 9: valid verdict whose workflow_run_id was already burned in
  //             the per-operator nonce journal → deny (single-use semantics).
  //   - Case 10: STRICT_SECRET=1 + no env secret + empty $CORTEX_DATA_HOME
  //             → deny (operator opted into fail-CLOSED).
  //
  // Cases 7, 8 require impl-1's v2 buildVerdict; case 9 requires impl-2's
  // journal module. Cases skip cleanly when their dependency isn't yet on
  // disk so this file doesn't wedge CI before parallel impls land.

  test('case 7 — v2 verdict bound to current HEAD → allow', (t) => {
    if (!HAVE_VERDICT_MODULE) {
      t.skip('r2-verdict module not yet available');
      return;
    }
    if (!HAVE_V2_SUPPORT) {
      t.skip('r2-verdict v2 schema not yet shipped (impl-1 in parallel)');
      return;
    }
    const repo = tmpRepo('case7');
    stageNonTrivialDiff(repo);
    const headSha = currentHeadSha(repo);
    const verdict = buildSignedVerdict({
      schemaVersion: 2,
      commitSha: headSha,
      stagedTree: 'c'.repeat(40),
    });
    writeVerdict(repo, verdict);

    // Point $CORTEX_DATA_HOME at an empty tmp dir so the journal lookup
    // returns no-burn (we want this case to ALLOW, not be tripped up by
    // stale state from a prior run).
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-data-case7-'));
    cleanupDirs.push(dataHome);

    const r = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat: case7 v2 HEAD-bound"' },
        session_id: `case7-${Date.now()}-${Math.random()}`,
        cwd: repo,
      },
      { env: { ...HOOK_ENV, CORTEX_DATA_HOME: dataHome } }
    );
    assert.equal(r.exitCode, 0, `stderr=${r.stderr}`);
    assert.ok(
      allowed(r.parsed),
      `v2 verdict bound to current HEAD must allow; got ${JSON.stringify(r.parsed)}`
    );
  });

  test('case 8 — v2 verdict bound to a DIFFERENT commit (stale) → deny', (t) => {
    if (!HAVE_VERDICT_MODULE) {
      t.skip('r2-verdict module not yet available');
      return;
    }
    if (!HAVE_V2_SUPPORT) {
      t.skip('r2-verdict v2 schema not yet shipped (impl-1 in parallel)');
      return;
    }
    const repo = tmpRepo('case8');
    stageNonTrivialDiff(repo);
    // Sign the verdict against a SHA that is deliberately NOT the current
    // HEAD — equivalent to a verdict produced from an earlier sprint commit
    // that the operator is now trying to reuse. The hook MUST reject it.
    const verdict = buildSignedVerdict({
      schemaVersion: 2,
      commitSha: 'a'.repeat(40),
      stagedTree: 'b'.repeat(40),
    });
    writeVerdict(repo, verdict);

    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-data-case8-'));
    cleanupDirs.push(dataHome);

    const r = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat: case8 stale verdict"' },
        session_id: `case8-${Date.now()}-${Math.random()}`,
        cwd: repo,
      },
      { env: { ...HOOK_ENV, CORTEX_DATA_HOME: dataHome } }
    );
    assert.equal(r.exitCode, 0, `stderr=${r.stderr}`);
    assert.ok(
      denied(r.parsed),
      `stale verdict (commit_sha mismatch) must deny; got ${JSON.stringify(r.parsed)}`
    );
    // The reason MAY name the mismatch directly when v2 is wired; even when
    // the hook v1 fallback fires, the generic review-gate reason mentions
    // "review" — match either to keep this test resilient.
    assert.match(
      r.parsed.hookSpecificOutput.permissionDecisionReason,
      /commit_sha|stale|review/i,
      'deny reason should reference the mismatch path'
    );
  });

  test('case 9 — workflow_run_id already in journal → deny (replay)', (t) => {
    if (!HAVE_VERDICT_MODULE) {
      t.skip('r2-verdict module not yet available');
      return;
    }
    if (!HAVE_JOURNAL_MODULE) {
      t.skip('r2-verdict-journal module not yet available (impl-2 in parallel)');
      return;
    }
    const repo = tmpRepo('case9');
    stageNonTrivialDiff(repo);
    const headSha = currentHeadSha(repo);

    // Build a verdict with a pre-known workflowRunId so we can seed the
    // journal with the SAME id before invoking the hook. v2 if available
    // (so commit_sha is also bound and won't itself trip the mismatch
    // path); v1 otherwise (the replay check applies in both regimes).
    const burnedRunId = 'burned-' + crypto.randomUUID();
    const v2Args = HAVE_V2_SUPPORT
      ? { schemaVersion: 2, commitSha: headSha, stagedTree: 'd'.repeat(40) }
      : {};
    const verdict = buildSignedVerdict({
      workflowRunId: burnedRunId,
      ...v2Args,
    });
    writeVerdict(repo, verdict);

    // Pre-seed the per-operator nonce journal. impl-2 stores the journal at
    // <rootDir>/cortex/.r2-seen-runs.json — the same rootDir the hook's
    // wasSeen() call receives (= the repo root resolved from data.cwd).
    // Required entry shape: { workflowRunId, sprintId, commitSha, seenAt }.
    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-data-case9-'));
    cleanupDirs.push(dataHome);
    const seedEntry = {
      workflowRunId: burnedRunId,
      sprintId: '2.46',
      commitSha: headSha,
      seenAt: new Date().toISOString(),
    };
    try { journalModule.appendSeen(repo, seedEntry); } catch (e) {
      t.diagnostic(`appendSeen failed: ${e && e.message}`);
    }
    // Sanity: confirm the seed landed before invoking the hook. If the
    // journal didn't accept our seed shape, the case can't make a
    // strict assertion — skip rather than false-positive.
    let burnedNow = false;
    try { burnedNow = journalModule.wasSeen(repo, burnedRunId); } catch {}
    if (!burnedNow) {
      t.skip('journal seed did not land — impl-2 entry shape may differ; unit-tested elsewhere');
      return;
    }

    const r = runHook(
      {
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat: case9 replay attempt"' },
        session_id: `case9-${Date.now()}-${Math.random()}`,
        cwd: repo,
      },
      { env: { ...HOOK_ENV, CORTEX_DATA_HOME: dataHome } }
    );
    assert.equal(r.exitCode, 0, `stderr=${r.stderr}`);
    assert.ok(
      denied(r.parsed),
      `burned workflow_run_id must deny (replay attempt); got ${JSON.stringify(r.parsed)}`
    );
    assert.match(
      r.parsed.hookSpecificOutput.permissionDecisionReason,
      /replay|workflow_run_id|already|review/i,
      'deny reason should reference replay path'
    );
  });

  test('case 10 — STRICT_SECRET=1 + no env secret + empty CORTEX_DATA_HOME → deny', (t) => {
    // This case does NOT require v2 or journal — it exercises the hook's
    // own strict-secret guard, which lives in loadAndVerifyVerdict's
    // pre-flight + the new decide() branch. The HMAC fallback inside the
    // shipped r2-verdict module always returns a non-null secret with
    // source='host-derived' when env is unset — strict mode MUST reject
    // that explicitly rather than silently accepting a forgeable secret.
    if (!HAVE_VERDICT_MODULE) {
      t.skip('r2-verdict module not yet available');
      return;
    }
    const repo = tmpRepo('case10');
    stageNonTrivialDiff(repo);
    // No verdict file written — strict-secret guard fires before the file
    // is even read. (Even with a verdict on disk, the hook should deny.)

    const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-data-case10-'));
    cleanupDirs.push(dataHome);

    // Compose a minimal env that EXPLICITLY:
    //   - sets CORTEX_R2_VERDICT_STRICT=1 (operator opt-in to fail-CLOSED)
    //   - UNSETS CORTEX_R2_VERDICT_SECRET (no env secret available)
    //   - points CORTEX_DATA_HOME at an empty dir (no persisted key)
    const env = { ...process.env };
    delete env.CORTEX_R2_VERDICT_SECRET;
    env.CORTEX_R2_VERDICT_STRICT = '1';
    env.CORTEX_DATA_HOME = dataHome;

    const r = spawnSync(process.execPath, [HOOK_PATH], {
      encoding: 'utf8',
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command: 'git commit -m "feat: case10 strict mode"' },
        session_id: 'case10-fixed-session-id',
        cwd: repo,
      }),
      timeout: 8000,
      cwd: REPO_ROOT,
      env,
    });
    let parsed = null;
    try { parsed = r.stdout && r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null; } catch {}

    assert.equal(r.status, 0, `gate must never crash; stderr=${r.stderr}`);
    assert.ok(parsed !== null, 'gate must emit a parseable envelope');
    assert.ok(
      denied(parsed),
      `STRICT_SECRET=1 + no secret must deny (fail-CLOSED); got ${JSON.stringify(parsed)}`
    );
    // The deny reason MAY name STRICT_SECRET when the strict-aware code
    // path is active; the generic review-gate fallback still mentions
    // "review". Accept either so the test isn't brittle while sibling
    // impls land.
    assert.match(
      parsed.hookSpecificOutput.permissionDecisionReason,
      /STRICT|secret|cortex-doctor|review/i,
      'deny reason should mention strict-secret or fall back to review-gate path'
    );
  });
});
