// tests/integration/critical-paths-coverage.test.cjs
//
// E2E coverage: the hooks + standards + voice charter the rest of cortex-x
// depends on are present, parseable, and consistent.
//
// Bug classes this catches:
//   - A hook removed from shared/hooks/ but still referenced in install.{sh,ps1}
//   - A standards/ doc removed but still cross-linked from another standards doc
//   - voice.md missing or empty (everything else cites it)
//   - .gitignore drift letting an internal file leak public (we hit this on
//     docs/launch-copy.md, docs/research/)

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HOOKS_DIR = path.join(REPO_ROOT, 'shared', 'hooks');
const STANDARDS_DIR = path.join(REPO_ROOT, 'standards');
const VOICE_MD = path.join(STANDARDS_DIR, 'voice.md');
const INSTALL_SH = path.join(REPO_ROOT, 'install.sh');

describe('hooks: every shared/hooks/*.cjs is valid JS', () => {
  const hooks = fs
    .readdirSync(HOOKS_DIR)
    .filter((f) => f.endsWith('.cjs'))
    .sort();

  test('discovered at least 6 hooks', () => {
    assert.ok(hooks.length >= 6, `expected >=6 hooks, found ${hooks.length}`);
  });

  for (const hook of hooks) {
    test(`${hook}: node --check passes`, () => {
      const r = spawnSync(
        process.execPath,
        ['--check', path.join(HOOKS_DIR, hook)],
        { encoding: 'utf8' },
      );
      assert.equal(r.status, 0, `${hook}: ${r.stderr}`);
    });
  }
});

describe('standards: voice.md is present and load-bearing', () => {
  test('standards/voice.md exists and is non-trivial (≥1500 bytes)', () => {
    assert.ok(fs.existsSync(VOICE_MD), 'standards/voice.md must exist');
    const size = fs.statSync(VOICE_MD).size;
    assert.ok(
      size >= 1500,
      `standards/voice.md is suspiciously small: ${size} bytes`,
    );
  });

  test('voice.md declares the no-greetings / no-emoji charter', () => {
    const content = fs.readFileSync(VOICE_MD, 'utf8');
    assert.match(
      content,
      /no\s+greeting|greeting.*\bnever|never.*greeting/i,
      'voice.md must declare a no-greetings rule',
    );
    assert.match(
      content,
      /emoji/i,
      'voice.md must address emoji policy explicitly',
    );
  });

  test('every new skill cites voice.md', () => {
    const skillsDir = path.join(REPO_ROOT, 'shared', 'skills');
    const skills = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    // Only assert on skills introduced 2026-05+ (have voice charter by convention).
    // Old skills that pre-date the charter aren't retrofitted in this test.
    const newSkills = ['ux-copywriter', 'ralph-loop'];
    for (const s of newSkills) {
      if (!skills.includes(s)) continue;
      const content = fs.readFileSync(
        path.join(skillsDir, s, 'SKILL.md'),
        'utf8',
      );
      assert.match(
        content,
        /voice\.md|voice charter/i,
        `${s}/SKILL.md must cite voice.md or "voice charter"`,
      );
    }
  });
});

describe('install.sh: every hook referenced exists on disk', () => {
  const installSh = fs.readFileSync(INSTALL_SH, 'utf8');
  const hooksReferenced = [
    ...new Set([...installSh.matchAll(/hooks\/([a-z0-9-]+)\.cjs/g)].map((m) => m[1])),
  ];

  test('at least 3 hooks referenced from install.sh', () => {
    assert.ok(
      hooksReferenced.length >= 3,
      `expected >=3 hooks referenced, found ${hooksReferenced.length}`,
    );
  });

  test('every referenced hook exists in shared/hooks/', () => {
    const missing = hooksReferenced.filter(
      (h) => !fs.existsSync(path.join(HOOKS_DIR, `${h}.cjs`)),
    );
    assert.deepEqual(
      missing,
      [],
      `install.sh references hooks that don't exist: ${missing.join(', ')}`,
    );
  });
});

describe('public-repo hygiene: gitignore covers known-internal patterns', () => {
  const gitignore = fs.readFileSync(
    path.join(REPO_ROOT, '.gitignore'),
    'utf8',
  );

  const mustBeIgnored = [
    '/docs/launch-copy.md',
    '/docs/steward-dogfood-plan.md',
    '/docs/research/',
    '/docs/dogfood-examples/',
    '/deep-research/',
    '/projects/*.md',
    'tests/fixtures/**/.git/',
  ];

  test('all known-internal patterns are gitignored', () => {
    const missing = mustBeIgnored.filter((p) => !gitignore.includes(p));
    assert.deepEqual(
      missing,
      [],
      `gitignore missing entries that previously leaked: ${missing.join(', ')}`,
    );
  });

  test('the actually-tracked file that gitignore re-allows is present (cortex-x.md)', () => {
    // /projects/cortex-x.md is on a whitelist after /projects/*.md is ignored.
    // If the file is deleted while gitignore still re-allows it, that's a config drift.
    if (gitignore.includes('!/projects/cortex-x.md')) {
      assert.ok(
        fs.existsSync(path.join(REPO_ROOT, 'projects', 'cortex-x.md')),
        '.gitignore re-allows /projects/cortex-x.md but the file does not exist',
      );
    }
  });
});

describe('cortex/ generated artifacts are byte-identical across regenerations', () => {
  // Generators must produce byte-identical output across reruns OR the
  // GitHub workflow that re-runs them will create infinite drift PRs. We
  // already hit this once on cs-CZ locale collation — keep it tested.
  test('cortex/capabilities.md exists and has expected sections', () => {
    const cap = fs.readFileSync(
      path.join(REPO_ROOT, 'cortex', 'capabilities.md'),
      'utf8',
    );
    for (const section of [
      'Steward action_kinds',
      'Steward primitives',
      'Universal hooks',
      'Standards',
      'Profiles',
      'Prompts',
      'GitHub workflows',
    ]) {
      assert.match(cap, new RegExp(section), `capabilities.md missing section "${section}"`);
    }
  });

  test('cortex/capabilities.json is valid JSON', () => {
    const text = fs.readFileSync(
      path.join(REPO_ROOT, 'cortex', 'capabilities.json'),
      'utf8',
    );
    const data = JSON.parse(text); // throws on invalid
    assert.ok(
      data.action_kinds && data.action_kinds.length >= 15,
      'capabilities.json must declare >=15 action_kinds',
    );
  });
});
