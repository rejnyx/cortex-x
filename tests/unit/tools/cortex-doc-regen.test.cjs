// SPDX-License-Identifier: Apache-2.0
'use strict';

/**
 * cortex-doc-regen.test.cjs
 *
 * Sprint 2.45 Implementation 3 — contract tests for bin/cortex-doc-regen.cjs,
 * the living-documentation engine that regenerates state-snapshot blocks
 * inside docs/operator-pov/atlas-*.md and capability-tree-*.md.
 *
 * State-block contract under test (SSOT: standards/documentation.md § State block convention):
 *
 *   <!-- BEGIN cortex-x <block-id> (v<N>) - managed by <tool> -->
 *   <!-- Do not edit between markers - regenerate via: <command> -->
 *   <rendered content>
 *   <!-- END cortex-x <block-id> -->
 *
 * Test coverage (T1-T8):
 *   T1 - default invocation prints state snapshot to stdout + exit 0
 *   T2 - --json emits valid JSON with required snapshot keys
 *   T3 - --check on matching atlas returns exit 0
 *   T4 - --check on tampered atlas returns exit 1
 *   T5 - --apply writes only inside markers (content outside preserved)
 *   T6 - --apply is idempotent (byte-equal after second run)
 *   T7 - CORTEX_DOC_REGEN_ROOT with dot-dot is rejected
 *   T8 - --help prints usage + exit 0
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'bin', 'cortex-doc-regen.cjs');

// Track every tmp directory we create so after() can sweep them all.
const TMP_DIRS = [];

function mkTmp(label) {
  const dir = path.join(os.tmpdir(), `cortex-doc-regen-${label}-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  TMP_DIRS.push(dir);
  return dir;
}

function tryRm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function runCli(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * Build a minimal fixture root that cortex-doc-regen can scan.
 * Sprint 2.45 R2 HIGH-1/HIGH-9 fix: paths now match production layout —
 *   package.json + bin/ at root (validateRoot precondition)
 *   cortex/atlas-*.md / cortex/capability-tree-*.md (MANAGED constant)
 *   shared/skills/, agents/, bin/, standards/, prompts/, detectors/,
 *   profiles/, .github/workflows/, tests/ (extractor inputs — match
 *   the actual path.join(root, X) calls in cortex-doc-regen.cjs).
 */
function buildFixtureRoot(label, atlasContent, capabilityTreeContent) {
  const root = mkTmp(label);
  const dirs = [
    'cortex',
    'shared/skills/example-skill',
    'agents',
    'bin',
    'standards',
    'prompts',
    'detectors',
    'profiles',
    '.github/workflows',
    'tests/unit',
  ];
  for (const d of dirs) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  // validateRoot precondition: package.json + bin/ must exist at root.
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture","version":"0.0.0"}\n');
  fs.writeFileSync(path.join(root, 'bin/cortex-example.cjs'), '#!/usr/bin/env node\n');
  // Seed minimum content so extractors return non-zero counts.
  fs.writeFileSync(path.join(root, 'shared/skills/example-skill/SKILL.md'), '# Example skill\n');
  fs.writeFileSync(path.join(root, 'agents/example.md'), '# Example agent\n');
  fs.writeFileSync(path.join(root, 'standards/example.md'), '# Standard\n');
  fs.writeFileSync(path.join(root, 'prompts/example.md'), '# Prompt\n');
  fs.writeFileSync(path.join(root, 'detectors/example.cjs'), '"use strict";\n');
  fs.writeFileSync(path.join(root, 'profiles/example.yaml'), 'name: example\n');
  fs.writeFileSync(path.join(root, '.github/workflows/example.yml'), 'name: example\n');
  fs.writeFileSync(path.join(root, 'tests/unit/example.test.cjs'), 'test("x", () => {});\n');
  fs.writeFileSync(
    path.join(root, 'cortex', `atlas-${label}.md`),
    atlasContent,
  );
  fs.writeFileSync(
    path.join(root, 'cortex', `capability-tree-${label}.md`),
    capabilityTreeContent || atlasContent,
  );
  return root;
}

const PRELUDE = '# atlas\n\nIntro prose that must be preserved verbatim.\n\n';
const POSTLUDE = '\n\nClosing prose that must be preserved verbatim.\n';

function atlasWithStateBlock(body) {
  return (
    PRELUDE
    + '<!-- BEGIN cortex-x state-snapshot (v1) - managed by cortex-doc-regen -->\n'
    + '<!-- Do not edit between markers - regenerate via: npm run docs:regen -->\n'
    + body
    + '\n<!-- END cortex-x state-snapshot -->'
    + POSTLUDE
  );
}

after(() => {
  for (const d of TMP_DIRS) tryRm(d);
});

// --- T8 must run first because it's the only test that works even if the
// implementation is incomplete: --help should always be honored. We still
// declare it in describe-order: T1..T8 below.

describe('cortex-doc-regen — CLI contract', () => {
  test('T1 — default invocation prints state snapshot to stdout and exits 0', () => {
    if (!fs.existsSync(SCRIPT)) {
      assert.fail(`cortex-doc-regen.cjs not found at ${SCRIPT} - implementation missing`);
    }
    const root = buildFixtureRoot('t1', atlasWithStateBlock('placeholder\n'));
    const res = runCli([], { CORTEX_DOC_REGEN_ROOT: root });
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}; stderr=${res.stderr}`);
    assert.ok(res.stdout.length > 0, 'expected non-empty stdout');
    // Default mode renders a human-readable snapshot summary. We don't pin
    // exact wording but assert the snapshot mentions some core categories.
    const out = res.stdout.toLowerCase();
    const hits = ['skills', 'agents', 'standards', 'prompts'].filter(k => out.includes(k));
    assert.ok(hits.length >= 2, `expected at least 2 snapshot keys in stdout, found: ${hits.join(',')}`);
  });

  test('T2 — --json emits valid JSON with required snapshot keys', () => {
    if (!fs.existsSync(SCRIPT)) return;
    const root = buildFixtureRoot('t2', atlasWithStateBlock('placeholder\n'));
    const res = runCli(['--json'], { CORTEX_DOC_REGEN_ROOT: root });
    assert.equal(res.status, 0, `expected exit 0, got ${res.status}; stderr=${res.stderr}`);
    let parsed;
    assert.doesNotThrow(() => { parsed = JSON.parse(res.stdout); }, '--json output must be parseable');
    assert.equal(typeof parsed, 'object');
    assert.ok(parsed !== null);
    // The snapshot may be a top-level object or nested under `snapshot`.
    const snap = parsed.snapshot && typeof parsed.snapshot === 'object' ? parsed.snapshot : parsed;
    const required = ['skills', 'agents', 'clis', 'standards', 'prompts', 'detectors', 'workflows', 'profiles', 'tests', 'generated'];
    for (const k of required) {
      assert.ok(k in snap, `--json snapshot missing required key: ${k}`);
    }
  });

  test('T3 — --check returns exit 0 when state snapshot matches current data', () => {
    if (!fs.existsSync(SCRIPT)) return;
    const root = buildFixtureRoot('t3', atlasWithStateBlock('placeholder\n'));
    // First apply to write the canonical snapshot into the fixture.
    const applyRes = runCli(['--apply'], { CORTEX_DOC_REGEN_ROOT: root });
    assert.equal(applyRes.status, 0, `--apply prep failed: ${applyRes.stderr}`);
    // Now --check on the freshly-applied tree must be a no-op (exit 0).
    const checkRes = runCli(['--check'], { CORTEX_DOC_REGEN_ROOT: root });
    assert.equal(checkRes.status, 0, `expected --check exit 0 on clean tree, got ${checkRes.status}; stderr=${checkRes.stderr}`);
  });

  test('T4 — --check returns exit 1 when state block was tampered', () => {
    if (!fs.existsSync(SCRIPT)) return;
    const root = buildFixtureRoot('t4', atlasWithStateBlock('placeholder\n'));
    runCli(['--apply'], { CORTEX_DOC_REGEN_ROOT: root });
    // Synthesize tamper: rewrite the state block body with bogus values.
    const atlasPath = path.join(root, 'cortex', 'atlas-t4.md');
    const original = fs.readFileSync(atlasPath, 'utf8');
    const tampered = original.replace(
      /<!-- BEGIN cortex-x state-snapshot[\s\S]*?<!-- END cortex-x state-snapshot -->/,
      [
        '<!-- BEGIN cortex-x state-snapshot (v1) - managed by cortex-doc-regen -->',
        '<!-- Do not edit between markers - regenerate via: npm run docs:regen -->',
        '- skills: 999999',
        '- agents: 999999',
        '- tampered: yes',
        '<!-- END cortex-x state-snapshot -->',
      ].join('\n'),
    );
    assert.notEqual(tampered, original, 'tamper rewrite must change file content');
    fs.writeFileSync(atlasPath, tampered);
    const res = runCli(['--check'], { CORTEX_DOC_REGEN_ROOT: root });
    assert.equal(res.status, 1, `expected --check exit 1 on tampered block, got ${res.status}`);
  });

  test('T5 — --apply writes inside markers without touching content outside', () => {
    if (!fs.existsSync(SCRIPT)) return;
    const root = buildFixtureRoot('t5', atlasWithStateBlock('placeholder body\n'));
    const atlasPath = path.join(root, 'cortex', 'atlas-t5.md');
    const before = fs.readFileSync(atlasPath, 'utf8');
    const res = runCli(['--apply'], { CORTEX_DOC_REGEN_ROOT: root });
    assert.equal(res.status, 0, `--apply failed: ${res.stderr}`);
    const after = fs.readFileSync(atlasPath, 'utf8');
    // The prelude + postlude prose MUST survive byte-for-byte.
    assert.ok(after.includes(PRELUDE.trim()), 'prelude prose must be preserved');
    assert.ok(after.includes(POSTLUDE.trim()), 'postlude prose must be preserved');
    // The state-block markers themselves MUST still be present.
    assert.match(after, /<!-- BEGIN cortex-x state-snapshot \(v1\) - managed by cortex-doc-regen -->/);
    assert.match(after, /<!-- END cortex-x state-snapshot -->/);
    // The placeholder body MUST have been replaced with real content.
    assert.notEqual(before, after, '--apply must have changed the file');
    // Sanity: file should NOT contain the placeholder body anymore.
    assert.ok(!after.includes('placeholder body'), 'placeholder body must be replaced');
  });

  test('T6 — --apply is idempotent (byte-equal after second run)', () => {
    if (!fs.existsSync(SCRIPT)) return;
    const root = buildFixtureRoot('t6', atlasWithStateBlock('placeholder\n'));
    const atlasPath = path.join(root, 'cortex', 'atlas-t6.md');
    const r1 = runCli(['--apply'], { CORTEX_DOC_REGEN_ROOT: root });
    assert.equal(r1.status, 0, `first --apply failed: ${r1.stderr}`);
    const afterFirst = fs.readFileSync(atlasPath, 'utf8');
    const hashFirst = crypto.createHash('sha256').update(afterFirst).digest('hex');
    const r2 = runCli(['--apply'], { CORTEX_DOC_REGEN_ROOT: root });
    assert.equal(r2.status, 0, `second --apply failed: ${r2.stderr}`);
    const afterSecond = fs.readFileSync(atlasPath, 'utf8');
    const hashSecond = crypto.createHash('sha256').update(afterSecond).digest('hex');
    assert.equal(hashSecond, hashFirst, 'two consecutive --apply runs must produce byte-identical output');
  });

  test('T7 — CORTEX_DOC_REGEN_ROOT containing dot-dot is rejected', () => {
    if (!fs.existsSync(SCRIPT)) return;
    // Path traversal attempt - the CLI must refuse rather than walk up.
    const evilRoot = path.join(os.tmpdir(), '..', 'cortex-doc-regen-evil-' + crypto.randomUUID());
    const res = runCli([], { CORTEX_DOC_REGEN_ROOT: evilRoot });
    assert.notEqual(res.status, 0, `expected non-zero exit for dot-dot root, got ${res.status}`);
    const combined = (res.stderr + res.stdout).toLowerCase();
    // Some signal that the path was rejected for safety reasons.
    const rejected = /reject|invalid|unsafe|traversal|forbidden|denied|\.\./.test(combined);
    assert.ok(rejected, `expected rejection message for dot-dot path, got stderr=${res.stderr}`);
  });

  test('T8 — --help prints usage to stdout and exits 0', () => {
    if (!fs.existsSync(SCRIPT)) {
      assert.fail(`cortex-doc-regen.cjs not found at ${SCRIPT} - implementation missing`);
    }
    const res = runCli(['--help'], {});
    assert.equal(res.status, 0, `expected exit 0 for --help, got ${res.status}; stderr=${res.stderr}`);
    assert.ok(res.stdout.length > 0, 'expected non-empty stdout for --help');
    const out = res.stdout.toLowerCase();
    // Usage screen should mention at least the tool name and the core flags.
    assert.ok(out.includes('cortex-doc-regen') || out.includes('usage'), 'help must describe the tool');
    const flagsMentioned = ['--check', '--json', '--apply', '--help'].filter(f => out.includes(f));
    assert.ok(flagsMentioned.length >= 3, `expected >=3 flags in --help, found: ${flagsMentioned.join(',')}`);
  });
});
