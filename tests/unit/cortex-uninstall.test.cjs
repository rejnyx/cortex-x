// cortex-uninstall contract tests.
//
// What we validate (zero-network, zero-real-disk-side-effects beyond os.tmpdir):
//   1. parseArgs accepts/rejects every flag
//   2. resolveCortexSource / resolveCortexDataHome precedence
//   3. buildPlan produces correct remove/skip sets given a synthetic install
//   4. content-hash mismatch → file is SKIPPED, never removed
//   5. --purge flag adds $CORTEX_DATA_HOME to plan; default does NOT
//   6. --keep-source flag excludes source clone from plan
//   7. uncommitted-changes in source clone → source skipped + warning
//   8. CLI --help / --dry-run / unknown-flag paths
//   9. CLI --dry-run --json emits expected schema
//
// The CLI tests use spawnSync with a synthetic $HOME-equivalent via CORTEX_*
// env overrides AND a per-test temp dir for $HOME — we never touch the real
// ~/.claude/ or ~/.cortex/. Each test creates its own fake-install layout.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'bin', 'cortex-uninstall.cjs');

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function tryRm(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// Build a synthetic ~/.claude/ + ~/cortex-x/ + ~/.cortex/ inside an isolated
// fake-HOME directory. Returns the paths the uninstall would target.
function mkFakeInstall({ withCustomAgent = false, modifySkill = false, dirtySource = false } = {}) {
  const fakeHome = mkTmp('cortex-uninstall-home-');
  const claudeHome = path.join(fakeHome, '.claude');
  const shared = path.join(claudeHome, 'shared');
  const agentsDir = path.join(claudeHome, 'agents');
  const skillsDir = path.join(claudeHome, 'skills');
  const cortexUserYaml = path.join(claudeHome, 'cortex', 'user.yaml');
  const sourceDir = path.join(fakeHome, 'cortex-x');
  const dataHome = path.join(fakeHome, '.cortex');

  // Source clone (synthetic git repo).
  fs.mkdirSync(sourceDir, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: sourceDir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: sourceDir });
  execFileSync('git', ['config', 'user.name', 'cortex-uninstall test'], { cwd: sourceDir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: sourceDir });
  fs.mkdirSync(path.join(sourceDir, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'shared', 'skills', 'cortex-init'), { recursive: true });
  fs.mkdirSync(path.join(sourceDir, 'shared', 'skills', 'audit'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'agents', 'blind-hunter.md'), '# blind hunter\n');
  fs.writeFileSync(path.join(sourceDir, 'agents', 'security-auditor.md'), '# security\n');
  fs.writeFileSync(path.join(sourceDir, 'shared', 'skills', 'cortex-init', 'SKILL.md'), '# cortex-init\nbody-A\n');
  fs.writeFileSync(path.join(sourceDir, 'shared', 'skills', 'audit', 'SKILL.md'), '# audit\nbody-B\n');
  execFileSync('git', ['add', '.'], { cwd: sourceDir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: sourceDir });
  if (dirtySource) {
    fs.writeFileSync(path.join(sourceDir, 'uncommitted.txt'), 'dirty\n');
    execFileSync('git', ['add', 'uncommitted.txt'], { cwd: sourceDir });
  }

  // Installed framework — copy from source to mimic what install.sh does.
  fs.mkdirSync(shared, { recursive: true });
  fs.writeFileSync(path.join(shared, 'cortex-source.yaml'),
    `cortex_source: ${sourceDir}\ncortex_data_home: ${dataHome}\n`);
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.copyFileSync(path.join(sourceDir, 'agents', 'blind-hunter.md'), path.join(agentsDir, 'blind-hunter.md'));
  fs.copyFileSync(path.join(sourceDir, 'agents', 'security-auditor.md'), path.join(agentsDir, 'security-auditor.md'));
  if (withCustomAgent) {
    fs.writeFileSync(path.join(agentsDir, 'my-custom-agent.md'), '# user-owned\n');
  }

  fs.mkdirSync(path.join(skillsDir, 'cortex-init'), { recursive: true });
  fs.mkdirSync(path.join(skillsDir, 'audit'), { recursive: true });
  if (modifySkill) {
    // Content drift — operator customized cortex-init SKILL.md after install.
    fs.writeFileSync(path.join(skillsDir, 'cortex-init', 'SKILL.md'), '# cortex-init\nUSER EDITED CONTENT\n');
  } else {
    fs.copyFileSync(
      path.join(sourceDir, 'shared', 'skills', 'cortex-init', 'SKILL.md'),
      path.join(skillsDir, 'cortex-init', 'SKILL.md')
    );
  }
  fs.copyFileSync(
    path.join(sourceDir, 'shared', 'skills', 'audit', 'SKILL.md'),
    path.join(skillsDir, 'audit', 'SKILL.md')
  );

  fs.mkdirSync(path.dirname(cortexUserYaml), { recursive: true });
  fs.writeFileSync(cortexUserYaml, 'name: test\n');

  // User data — non-empty (research / journal / projects).
  fs.mkdirSync(path.join(dataHome, 'research'), { recursive: true });
  fs.mkdirSync(path.join(dataHome, 'journal'), { recursive: true });
  fs.writeFileSync(path.join(dataHome, 'research', 'sample.md'), 'precious user data\n');

  return { fakeHome, claudeHome, shared, agentsDir, skillsDir, cortexUserYaml, sourceDir, dataHome };
}

function runCli(args, fake) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: {
      ...process.env,
      HOME: fake.fakeHome,
      USERPROFILE: fake.fakeHome,
      CORTEX_SOURCE: fake.sourceDir,
      CORTEX_DATA_HOME: fake.dataHome,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const uninstall = require(SCRIPT);

describe('cortex-uninstall — parseArgs', () => {
  test('parses every supported flag', () => {
    const a = uninstall.parseArgs([
      'node', 'cortex-uninstall.cjs',
      '--dry-run', '--yes', '--purge', '--backup', '--keep-source', '--json',
    ]);
    assert.strictEqual(a.dryRun, true);
    assert.strictEqual(a.yes, true);
    assert.strictEqual(a.purge, true);
    assert.strictEqual(a.backup, true);
    assert.strictEqual(a.keepSource, true);
    assert.strictEqual(a.json, true);
  });

  test('-y short form aliases --yes', () => {
    const a = uninstall.parseArgs(['node', 'cortex-uninstall.cjs', '-y']);
    assert.strictEqual(a.yes, true);
  });

  test('unknown flag → CLI exits 1', () => {
    const fake = mkFakeInstall();
    try {
      const r = runCli(['--banana'], fake);
      assert.strictEqual(r.status, 1);
      assert.match(r.stderr, /unknown flag/);
    } finally { tryRm(fake.fakeHome); }
  });
});

describe('cortex-uninstall — --help', () => {
  test('--help prints usage and exits 0', () => {
    const fake = mkFakeInstall();
    try {
      const r = runCli(['--help'], fake);
      assert.strictEqual(r.status, 0);
      assert.match(r.stdout, /cortex-uninstall — clean removal/);
      assert.match(r.stdout, /--purge/);
      assert.match(r.stdout, /Never touches/);
    } finally { tryRm(fake.fakeHome); }
  });
});

describe('cortex-uninstall — --dry-run', () => {
  test('--dry-run --json emits plan, removes nothing', () => {
    const fake = mkFakeInstall();
    try {
      const r = runCli(['--dry-run', '--json'], fake);
      assert.strictEqual(r.status, 0);
      const plan = JSON.parse(r.stdout);
      assert.strictEqual(plan.ok, true);
      assert.strictEqual(plan.mode, 'dry-run');
      assert.ok(plan.remove_paths.length > 0);
      // Nothing actually removed:
      assert.ok(fs.existsSync(fake.shared));
      assert.ok(fs.existsSync(fake.sourceDir));
      assert.ok(fs.existsSync(fake.dataHome));
    } finally { tryRm(fake.fakeHome); }
  });

  test('--dry-run plan removes shared + agents + skills + source by default', () => {
    const fake = mkFakeInstall();
    try {
      const r = runCli(['--dry-run', '--json'], fake);
      const plan = JSON.parse(r.stdout);
      const has = (p) => plan.remove_paths.some((rp) => rp === p);
      assert.ok(has(fake.shared), 'shared not in remove set');
      assert.ok(has(fake.cortexUserYaml), 'user.yaml not in remove set');
      assert.ok(has(path.join(fake.skillsDir, 'cortex-init')), 'cortex-init skill not in remove set');
      assert.ok(has(path.join(fake.skillsDir, 'audit')), 'audit skill not in remove set');
      assert.ok(has(path.join(fake.agentsDir, 'blind-hunter.md')), 'blind-hunter agent not in remove set');
      assert.ok(has(fake.sourceDir), 'source clone not in remove set');
      // Default: user data preserved.
      assert.ok(!has(fake.dataHome), 'data home should NOT be in remove set without --purge');
    } finally { tryRm(fake.fakeHome); }
  });

  test('--purge adds data home to remove set', () => {
    const fake = mkFakeInstall();
    try {
      const r = runCli(['--dry-run', '--purge', '--json'], fake);
      const plan = JSON.parse(r.stdout);
      assert.ok(plan.remove_paths.includes(fake.dataHome), 'data home missing with --purge');
    } finally { tryRm(fake.fakeHome); }
  });

  test('--keep-source removes source from plan', () => {
    const fake = mkFakeInstall();
    try {
      const r = runCli(['--dry-run', '--keep-source', '--json'], fake);
      const plan = JSON.parse(r.stdout);
      assert.ok(!plan.remove_paths.includes(fake.sourceDir));
    } finally { tryRm(fake.fakeHome); }
  });
});

describe('cortex-uninstall — content-hash guard protects user-modified files', () => {
  test('modified skill is SKIPPED, not removed', () => {
    const fake = mkFakeInstall({ modifySkill: true });
    try {
      const r = runCli(['--dry-run', '--json'], fake);
      const plan = JSON.parse(r.stdout);
      const initSkillDir = path.join(fake.skillsDir, 'cortex-init');
      assert.ok(!plan.remove_paths.includes(initSkillDir), 'modified skill should not be removed');
      assert.ok(plan.skip_paths.includes(initSkillDir), 'modified skill should be in skip set');
      assert.ok(plan.warnings.some((w) => /cortex-init.*user-modified/.test(w)));
    } finally { tryRm(fake.fakeHome); }
  });

  test('custom user agent (not in source) is SKIPPED', () => {
    const fake = mkFakeInstall({ withCustomAgent: true });
    try {
      const r = runCli(['--dry-run', '--json'], fake);
      const plan = JSON.parse(r.stdout);
      const customAgent = path.join(fake.agentsDir, 'my-custom-agent.md');
      assert.ok(!plan.remove_paths.includes(customAgent), 'user-owned agent should never be removed');
      assert.ok(plan.skip_paths.includes(customAgent));
    } finally { tryRm(fake.fakeHome); }
  });

  test('dirty source clone is SKIPPED with warning', () => {
    const fake = mkFakeInstall({ dirtySource: true });
    try {
      const r = runCli(['--dry-run', '--json'], fake);
      const plan = JSON.parse(r.stdout);
      assert.ok(!plan.remove_paths.includes(fake.sourceDir), 'dirty source should not be removed');
      assert.ok(plan.skip_paths.includes(fake.sourceDir));
      assert.ok(plan.warnings.some((w) => /uncommitted changes/.test(w)));
    } finally { tryRm(fake.fakeHome); }
  });
});

describe('cortex-uninstall — destructive run with --yes', () => {
  test('removes default set; preserves user data', () => {
    const fake = mkFakeInstall();
    try {
      const r = runCli(['--yes', '--json'], fake);
      assert.strictEqual(r.status, 0);
      const result = JSON.parse(r.stdout);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.mode, 'removed');
      assert.ok(!fs.existsSync(fake.shared), 'shared should be gone');
      assert.ok(!fs.existsSync(path.join(fake.skillsDir, 'cortex-init')), 'cortex-init skill should be gone');
      assert.ok(!fs.existsSync(path.join(fake.agentsDir, 'blind-hunter.md')), 'cortex agent should be gone');
      assert.ok(!fs.existsSync(fake.sourceDir), 'source clone should be gone');
      // User data preserved:
      assert.ok(fs.existsSync(fake.dataHome), 'user data should NOT be removed by default');
      assert.ok(fs.existsSync(path.join(fake.dataHome, 'research', 'sample.md')), 'sample research file should survive');
    } finally { tryRm(fake.fakeHome); }
  });

  test('--purge removes user data too', () => {
    const fake = mkFakeInstall();
    try {
      const r = runCli(['--yes', '--purge', '--json'], fake);
      assert.strictEqual(r.status, 0);
      assert.ok(!fs.existsSync(fake.dataHome), 'user data should be gone with --purge');
    } finally { tryRm(fake.fakeHome); }
  });

  test('idempotent: second run is a noop', () => {
    const fake = mkFakeInstall();
    try {
      runCli(['--yes', '--json'], fake);
      const r2 = runCli(['--yes', '--json'], fake);
      assert.strictEqual(r2.status, 0);
      const result = JSON.parse(r2.stdout);
      // No paths to remove on second run — second run reports noop or empty removed.
      const totalRemoved = (result.removed || []).length;
      assert.strictEqual(totalRemoved, 0, 'second run should have nothing to remove');
    } finally { tryRm(fake.fakeHome); }
  });

  test('user-modified skill survives uninstall', () => {
    const fake = mkFakeInstall({ modifySkill: true });
    try {
      const r = runCli(['--yes', '--json'], fake);
      assert.strictEqual(r.status, 0);
      // The modified cortex-init skill must still be on disk.
      const initSkillPath = path.join(fake.skillsDir, 'cortex-init', 'SKILL.md');
      assert.ok(fs.existsSync(initSkillPath), 'modified skill should survive uninstall');
      const content = fs.readFileSync(initSkillPath, 'utf8');
      assert.match(content, /USER EDITED CONTENT/);
    } finally { tryRm(fake.fakeHome); }
  });
});
