'use strict';

// Tier 8 — agentskills.io v1 spec extension tests for tools/verify-skills.cjs.
// The base spec (name, description, body) is already covered by skill-shape.test.cjs.
// This file focuses on Anthropic Claude Code extensions: allowed-tools,
// disable-model-invocation, model, metadata, license.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERIFY_SKILLS = path.resolve(__dirname, '..', '..', 'tools', 'verify-skills.cjs');

function tmpSkillDir(prefix, skillName, frontmatter, body = 'Body content here that is at least 50 chars long for the body length check.') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `verify-skills-${prefix}-`));
  const skillDir = path.join(tmp, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, 'SKILL.md'),
    `---\n${frontmatter}\n---\n\n${body}\n`,
    'utf8',
  );
  return { tmp, skillDir };
}

function runVerifyOnDir(dir) {
  return spawnSync(process.execPath, [VERIFY_SKILLS, '--dir', dir, '--json'], {
    encoding: 'utf8', timeout: 5000,
  });
}

describe('Tier 8: allowed-tools extension', () => {
  test('inline array format accepted', () => {
    const { skillDir } = tmpSkillDir('inline-array', 'demo',
      'name: demo\ndescription: A demo skill that does demo things and uses allowed-tools properly.\nallowed-tools: [Bash, Edit, Read]',
    );
    const result = runVerifyOnDir(skillDir);
    const parsed = JSON.parse(result.stdout);
    const allowedToolsCheck = parsed.checks.find((c) => c.id === 'skills/demo.allowed-tools');
    assert.ok(allowedToolsCheck);
    assert.equal(allowedToolsCheck.status, 'pass');
    assert.match(allowedToolsCheck.message, /Bash, Edit, Read/);
  });

  test('block-list (dash) format accepted', () => {
    const { skillDir } = tmpSkillDir('dash-list', 'demo',
      'name: demo\ndescription: A demo skill that does demo things and uses allowed-tools properly.\nallowed-tools:\n  - Bash\n  - Edit',
    );
    const result = runVerifyOnDir(skillDir);
    const parsed = JSON.parse(result.stdout);
    const check = parsed.checks.find((c) => c.id === 'skills/demo.allowed-tools');
    assert.ok(check);
    assert.equal(check.status, 'pass');
    assert.match(check.message, /Bash, Edit/);
  });

  test('empty array warns', () => {
    const { skillDir } = tmpSkillDir('empty-array', 'demo',
      'name: demo\ndescription: A demo skill that does demo things and uses allowed-tools properly.\nallowed-tools: []',
    );
    const result = runVerifyOnDir(skillDir);
    const parsed = JSON.parse(result.stdout);
    const check = parsed.checks.find((c) => c.id === 'skills/demo.allowed-tools.empty');
    assert.ok(check);
    assert.equal(check.status, 'fail');
  });
});

describe('Tier 8: disable-model-invocation extension', () => {
  test('true accepted', () => {
    const { skillDir } = tmpSkillDir('disable-true', 'demo',
      'name: demo\ndescription: A demo skill that does demo things and disables model invocation as needed.\ndisable-model-invocation: true',
    );
    const result = runVerifyOnDir(skillDir);
    const parsed = JSON.parse(result.stdout);
    const check = parsed.checks.find((c) => c.id === 'skills/demo.disable-model-invocation');
    assert.ok(check);
    assert.equal(check.status, 'pass');
    assert.match(check.message, /true/);
  });

  test('false accepted', () => {
    const { skillDir } = tmpSkillDir('disable-false', 'demo',
      'name: demo\ndescription: A demo skill that does demo things with normal model invocation behavior.\ndisable-model-invocation: false',
    );
    const result = runVerifyOnDir(skillDir);
    const parsed = JSON.parse(result.stdout);
    const check = parsed.checks.find((c) => c.id === 'skills/demo.disable-model-invocation');
    assert.equal(check.status, 'pass');
  });

  test('non-boolean rejected', () => {
    const { skillDir } = tmpSkillDir('disable-bad', 'demo',
      'name: demo\ndescription: A demo skill that does demo things with weird disable-model-invocation values.\ndisable-model-invocation: maybe',
    );
    const result = runVerifyOnDir(skillDir);
    const parsed = JSON.parse(result.stdout);
    const check = parsed.checks.find((c) => c.id === 'skills/demo.disable-model-invocation.shape');
    assert.ok(check);
    assert.equal(check.status, 'fail');
  });
});

describe('Tier 8: model extension', () => {
  test('valid kebab-case identifier accepted', () => {
    const { skillDir } = tmpSkillDir('model-good', 'demo',
      'name: demo\ndescription: A demo skill that does demo things and prefers a specific Claude model.\nmodel: claude-sonnet-4-6',
    );
    const result = runVerifyOnDir(skillDir);
    const parsed = JSON.parse(result.stdout);
    const check = parsed.checks.find((c) => c.id === 'skills/demo.model');
    assert.ok(check);
    assert.equal(check.status, 'pass');
  });

  test('invalid identifier rejected', () => {
    const { skillDir } = tmpSkillDir('model-bad', 'demo',
      'name: demo\ndescription: A demo skill that does demo things and tries to set a malformed model id.\nmodel: !!!invalid!!!',
    );
    const result = runVerifyOnDir(skillDir);
    const parsed = JSON.parse(result.stdout);
    const check = parsed.checks.find((c) => c.id === 'skills/demo.model.shape');
    assert.ok(check);
    assert.equal(check.status, 'fail');
  });
});

describe('Tier 8: metadata extension', () => {
  test('nested map accepted', () => {
    const { skillDir } = tmpSkillDir('metadata-good', 'demo',
      'name: demo\ndescription: A demo skill that does demo things and ships with a nice metadata block.\nmetadata:\n  category: testing\n  version: "1.0"',
    );
    const result = runVerifyOnDir(skillDir);
    const parsed = JSON.parse(result.stdout);
    // No metadata.shape failure should be emitted
    const failure = parsed.checks.find((c) => c.id === 'skills/demo.metadata.shape' && c.status === 'fail');
    assert.equal(failure, undefined);
  });
});

describe('Tier 8: license extension', () => {
  test('short SPDX-ish identifier accepted', () => {
    const { skillDir } = tmpSkillDir('license-good', 'demo',
      'name: demo\ndescription: A demo skill that does demo things and ships with a license declaration.\nlicense: MIT',
    );
    const result = runVerifyOnDir(skillDir);
    const parsed = JSON.parse(result.stdout);
    const failure = parsed.checks.find((c) => c.id === 'skills/demo.license.shape' && c.status === 'fail');
    assert.equal(failure, undefined);
  });

  test('overly long license string warns', () => {
    const longLicense = 'A'.repeat(150);
    const { skillDir } = tmpSkillDir('license-long', 'demo',
      `name: demo\ndescription: A demo skill that does demo things and ships with a comically long license string.\nlicense: ${longLicense}`,
    );
    const result = runVerifyOnDir(skillDir);
    const parsed = JSON.parse(result.stdout);
    const check = parsed.checks.find((c) => c.id === 'skills/demo.license.shape');
    assert.ok(check);
    assert.equal(check.status, 'fail');
  });
});

describe('Tier 8: real shipped skills still validate', () => {
  test('real shared/skills/ pass --strict', () => {
    const result = spawnSync(process.execPath, [VERIFY_SKILLS, '--strict'], {
      encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, `verify-skills --strict should pass on real skills:\n${result.stdout}\n${result.stderr}`);
  });
});
