// tests/integration/install-coverage.test.cjs
//
// E2E coverage: install.sh + install.ps1 register the SAME set of skills, and
// every skill (especially the two with companion subfolders — ux-copywriter
// and ralph-loop) installs with its full directory contents intact.
//
// Bug classes this catches:
//   - install.ps1 drifting behind install.sh (we hit this on ux-copywriter)
//   - Slash-command promote loop copying only SKILL.md and leaving references/
//     behind (we hit this on ux-copywriter — fixed by switching to cp -r /
//     Copy-Item -Recurse)
//   - A new skill landing in shared/skills/ but never registered in either
//     installer (would be invisible at user-level)
//   - A registered skill that doesn't exist on disk (broken install)

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INSTALL_SH = path.join(REPO_ROOT, 'install.sh');
const INSTALL_PS1 = path.join(REPO_ROOT, 'install.ps1');
const SHARED_SKILLS = path.join(REPO_ROOT, 'shared', 'skills');

function readBash() { return fs.readFileSync(INSTALL_SH, 'utf8'); }
function readPwsh() { return fs.readFileSync(INSTALL_PS1, 'utf8'); }

function extractBashSkillList(content) {
  // Match: for SKILL_NAME in audit designer start ux-copywriter ...
  const m = content.match(/for\s+SKILL_NAME\s+in\s+([a-z0-9 \-]+);/);
  assert.ok(m, 'install.sh has slash-command promote loop with a skill list');
  return m[1].trim().split(/\s+/);
}

function extractPwshSkillList(content) {
  // Match: foreach ($SkillName in @("audit", "designer", "start", ...))
  const m = content.match(/foreach\s+\(\$SkillName\s+in\s+@\(([^)]+)\)\)/);
  assert.ok(m, 'install.ps1 has slash-command promote loop with a skill list');
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^"/, '').replace(/"$/, ''))
    .filter(Boolean);
}

describe('install.sh / install.ps1 parity', () => {
  test('both installers register the SAME skill list', () => {
    const bashSkills = new Set(extractBashSkillList(readBash()));
    const pwshSkills = new Set(extractPwshSkillList(readPwsh()));
    const onlyInBash = [...bashSkills].filter((s) => !pwshSkills.has(s));
    const onlyInPwsh = [...pwshSkills].filter((s) => !bashSkills.has(s));
    assert.deepEqual(
      onlyInBash,
      [],
      `Skills in install.sh but missing from install.ps1: ${onlyInBash.join(', ')}`,
    );
    assert.deepEqual(
      onlyInPwsh,
      [],
      `Skills in install.ps1 but missing from install.sh: ${onlyInPwsh.join(', ')}`,
    );
  });

  test('every registered skill exists on disk', () => {
    const skills = extractBashSkillList(readBash());
    for (const skill of skills) {
      const skillMd = path.join(SHARED_SKILLS, skill, 'SKILL.md');
      assert.ok(
        fs.existsSync(skillMd),
        `install.sh registers '${skill}' but ${skillMd} does not exist`,
      );
    }
  });

  test('every skill with companion subfolder is copied recursively', () => {
    // Find skills that have BOTH SKILL.md AND additional content (references/,
    // templates/). If installer only copies SKILL.md, the runtime links break.
    const bash = readBash();
    const pwsh = readPwsh();

    for (const entry of fs.readdirSync(SHARED_SKILLS, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(SHARED_SKILLS, entry.name);
      const skillMd = path.join(skillDir, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;

      const subdirs = fs
        .readdirSync(skillDir, { withFileTypes: true })
        .filter((d) => d.isDirectory());
      if (subdirs.length === 0) continue;

      // This skill has companion folders. Installer MUST use a recursive copy.
      // For bash, that's `cp -r ... .` not `cp SKILL.md`.
      // For pwsh, that's `Copy-Item -Recurse` not `Copy-Item -Destination ... SKILL.md`.
      // Check the promote loop body uses recursive copy.
      assert.match(
        bash,
        /cp\s+-r\s+"\$SRC_SKILL_DIR\/\.\"\s+"\$CLAUDE_HOME\/skills\/\$SKILL_NAME\/"/,
        'install.sh promote loop must recursively copy whole skill dir (bug fixed 2026-05-25)',
      );
      assert.match(
        pwsh,
        /Copy-Item\s+-Path\s+\(Join-Path\s+\$SrcSkillDir\s+"\*"\)\s+-Destination\s+\$DstSkillDir\s+-Recurse\s+-Force/,
        'install.ps1 promote loop must recursively copy whole skill dir (bug fixed 2026-05-25)',
      );
      return;
    }
  });
});

describe('every shared/skills/<name>/ has the expected shape', () => {
  for (const entry of fs.readdirSync(SHARED_SKILLS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skill = entry.name;
    const skillMd = path.join(SHARED_SKILLS, skill, 'SKILL.md');

    test(`${skill}: SKILL.md exists`, () => {
      assert.ok(
        fs.existsSync(skillMd),
        `${skill} is a directory but ${skillMd} is missing`,
      );
    });

    test(`${skill}: SKILL.md has YAML frontmatter with name + description`, () => {
      const content = fs.readFileSync(skillMd, 'utf8');
      assert.ok(
        content.startsWith('---\n'),
        `${skill}/SKILL.md must start with '---\\n' (YAML frontmatter)`,
      );
      const fmEnd = content.indexOf('\n---', 4);
      assert.ok(
        fmEnd > 0,
        `${skill}/SKILL.md must close its frontmatter with '\\n---'`,
      );
      const fm = content.slice(4, fmEnd);
      assert.match(
        fm,
        /(^|\n)name:\s*\S+/,
        `${skill}/SKILL.md frontmatter must declare a name field`,
      );
      assert.match(
        fm,
        /(^|\n)description:\s*\S/,
        `${skill}/SKILL.md frontmatter must declare a description field`,
      );
    });

    test(`${skill}: SKILL.md name field matches directory name`, () => {
      const content = fs.readFileSync(skillMd, 'utf8');
      const m = content.match(/(?:^|\n)name:\s*([a-z0-9-]+)/);
      assert.ok(m, `${skill}: name field present in frontmatter`);
      assert.equal(
        m[1],
        skill,
        `${skill}/SKILL.md declares name="${m[1]}" but lives in directory "${skill}"`,
      );
    });

    // For skills with subfolders, verify all referenced paths exist
    const skillDir = path.join(SHARED_SKILLS, skill);
    const subdirs = fs
      .readdirSync(skillDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    if (subdirs.length > 0) {
      test(`${skill}: SKILL.md links to all subfolder files`, () => {
        const content = fs.readFileSync(skillMd, 'utf8');
        for (const sub of subdirs) {
          const subDir = path.join(skillDir, sub);
          const subFiles = fs.readdirSync(subDir);
          for (const f of subFiles) {
            // Find at least one reference to the file in SKILL.md OR a sibling reference file
            const referenced =
              content.includes(`${sub}/${f}`) ||
              fs.readdirSync(subDir).some((other) => {
                if (other === f) return false;
                try {
                  return fs
                    .readFileSync(path.join(subDir, other), 'utf8')
                    .includes(f);
                } catch {
                  return false;
                }
              });
            assert.ok(
              referenced,
              `${skill}/${sub}/${f} exists but is not referenced from SKILL.md or any sibling — dead file`,
            );
          }
        }
      });
    }
  }
});
