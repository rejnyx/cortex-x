// SPDX-License-Identifier: Apache-2.0
'use strict';

// tests/integration/workflow-hook-compatibility.test.cjs
//
// Sprint 2.44 Probe 1 — hook-firing integration test.
//
// Verifies the post-tool-use.cjs hook honors its 4 load-bearing contracts when
// receiving Workflow / Task tool calls (subagent dispatches):
//   T1 — writes a journal entry for any Task call (here: subagent_type=general-purpose)
//   T2 — writes a per-session review marker when subagent_type is in the ROSTER
//   T3 — does NOT write a review marker for subagent_type outside the ROSTER
//   T4 — fail-open: exits 0 even on malformed stdin
//
// Isolation: each test spawns post-tool-use.cjs as a child process with
// CORTEX_HOME pointed at a temp dir (faked cortex install with the required
// standards/ship-ready.md signature file). Review markers land in os.tmpdir()
// keyed by sha1(session_id) — we use a unique session id per test to avoid
// cross-test pollution. Cleanup removes both the fake CORTEX_HOME and any
// review-marker files we wrote.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const HOOK_PATH = path.join(
  __dirname, '..', '..',
  'shared', 'hooks', 'post-tool-use.cjs',
);

// Unique session ids per test case — sha1 hashed by the hook to derive the
// marker file path. Different ids guarantee independent marker files.
const SESSION_T1 = 'workflow-test-t1-' + crypto.randomUUID();
const SESSION_T2 = 'workflow-test-t2-' + crypto.randomUUID();
const SESSION_T3 = 'workflow-test-t3-' + crypto.randomUUID();

function hashSession(sid) {
  return crypto.createHash('sha1').update(String(sid)).digest('hex').slice(0, 12);
}

function markerPathFor(sid) {
  return path.join(os.tmpdir(), `cortex-review-${hashSession(sid)}.flag`);
}

// Build a fake CORTEX_HOME inside the user's $HOME (validateCortexHome enforces
// containment unless CORTEX_HOME_ALLOW_EXTERNAL=1). os.tmpdir() on Windows is
// inside %USERPROFILE%\AppData\Local\Temp which is under $HOME — safe.
let FAKE_CORTEX_HOME = '';

before(() => {
  FAKE_CORTEX_HOME = path.join(
    os.tmpdir(),
    'cortex-hook-test-' + crypto.randomUUID(),
  );
  fs.mkdirSync(path.join(FAKE_CORTEX_HOME, 'standards'), { recursive: true });
  // Signature file required by validateCortexHome — content irrelevant
  fs.writeFileSync(
    path.join(FAKE_CORTEX_HOME, 'standards', 'ship-ready.md'),
    '# fake ship-ready stub for hook integration test\n',
  );
});

after(() => {
  // Remove the fake cortex home + any marker files we may have left
  try { fs.rmSync(FAKE_CORTEX_HOME, { recursive: true, force: true }); } catch {}
  for (const sid of [SESSION_T1, SESSION_T2, SESSION_T3]) {
    try { fs.unlinkSync(markerPathFor(sid)); } catch {}
  }
});

// Spawn the hook with stdin payload. Returns {code, stderr}.
function runHook(payload, extraEnv) {
  const result = cp.spawnSync(
    process.execPath,
    [HOOK_PATH],
    {
      input: typeof payload === 'string' ? payload : JSON.stringify(payload),
      env: {
        ...process.env,
        CORTEX_HOME: FAKE_CORTEX_HOME,
        // Belt-and-braces — we already place inside $HOME, but in case the
        // test runs in an exotic CI layout we accept external too.
        CORTEX_HOME_ALLOW_EXTERNAL: '1',
        // Suppress budget tracking noise — not under test here.
        CORTEX_BUDGET_DISABLED: '1',
        ...(extraEnv || {}),
      },
      encoding: 'utf8',
      timeout: 10000,
    },
  );
  return { code: result.status, stderr: result.stderr || '' };
}

// Find today's journal file for the cortex-x project slug (test harness runs
// from the cortex-x repo, so getProjectSlug() will read its package.json).
function findTodaysJournalFile() {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  // Slug is derived from package.json name in CWD — when tests run from the
  // cortex-x repo this is "cortex-x". Match any .jsonl for the date prefix
  // to stay robust to slug changes.
  const journalDir = path.join(FAKE_CORTEX_HOME, 'journal');
  if (!fs.existsSync(journalDir)) return null;
  const prefix = `${yyyy}-${mm}-${dd}-`;
  const candidates = fs.readdirSync(journalDir).filter(
    (f) => f.startsWith(prefix) && f.endsWith('.jsonl'),
  );
  if (candidates.length === 0) return null;
  return path.join(journalDir, candidates[0]);
}

test('T1 — post-tool-use writes journal entry on workflow Task call', () => {
  const payload = {
    session_id: SESSION_T1,
    tool_name: 'Task',
    tool_input: {
      description: 'fake',
      subagent_type: 'general-purpose',
    },
    tool_response: { success: true },
  };
  const { code } = runHook(payload);
  assert.strictEqual(code, 0, 'hook must exit 0');

  const journalFile = findTodaysJournalFile();
  assert.ok(journalFile, 'journal file must be created under CORTEX_HOME/journal/');

  const lines = fs.readFileSync(journalFile, 'utf8').split('\n').filter(Boolean);
  assert.ok(lines.length >= 1, 'at least one journal line expected');

  const lastEntry = JSON.parse(lines[lines.length - 1]);
  assert.strictEqual(lastEntry.tool, 'Task', 'last journal entry tool field must be Task');
});

test('T2 — post-tool-use writes review marker for ROSTER subagent', () => {
  const payload = {
    session_id: SESSION_T2,
    tool_name: 'Task',
    tool_input: {
      description: 'adversarial review',
      subagent_type: 'blind-hunter', // in shared/hooks/_lib/review-agents.cjs ROSTER
    },
    tool_response: { success: true },
  };
  const { code } = runHook(payload);
  assert.strictEqual(code, 0, 'hook must exit 0');

  const marker = markerPathFor(SESSION_T2);
  assert.ok(fs.existsSync(marker), `review marker must be written at ${marker}`);
});

test('T3 — post-tool-use does NOT write review marker for non-ROSTER subagent', () => {
  const payload = {
    session_id: SESSION_T3,
    tool_name: 'Task',
    tool_input: {
      description: 'non-review work',
      subagent_type: 'random-name-not-in-roster',
    },
    tool_response: { success: true },
  };
  const { code } = runHook(payload);
  assert.strictEqual(code, 0, 'hook must exit 0');

  const marker = markerPathFor(SESSION_T3);
  assert.ok(!fs.existsSync(marker), `review marker must NOT exist at ${marker}`);
});

test('T4 — post-tool-use exits 0 even on malformed stdin (fail-open contract)', () => {
  // Garbage payload — not valid JSON
  const { code } = runHook('this is not json {{{{{{');
  assert.strictEqual(code, 0, 'hook must fail-open with exit 0 on malformed input');
});
