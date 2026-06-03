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

function buildSignedVerdict({ sprintId = '2.46', decision = 'PASS' } = {}) {
  // Only callable when HAVE_VERDICT_MODULE — sites guard before invoking.
  // impl-1 signature: buildVerdict(input) — secret is `input.secret`, NOT positional.
  return r2.buildVerdict({
    sprintId,
    workflowRunId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    agentRoster: ['security', 'correctness', 'acceptance', 'ssot', 'blind', 'edge-case'],
    findings: { HIGH: 0, MEDIUM: 2, LOW: 7 },
    applied: [],
    deferred: [],
    refuted: [],
    decision,
    secret: TEST_SECRET,
  });
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
});
