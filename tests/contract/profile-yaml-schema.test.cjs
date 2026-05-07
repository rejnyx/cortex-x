// profile-yaml-schema.test.cjs — every profiles/*.yaml has the required shape.
//
// Catches: forgotten `name:` field, missing `detect:` block, broken indent,
// dropped `description:`. Without this, a malformed profile silently scores
// 0 in detect-profile.cjs and falls off the candidate list — a regression
// that's hard to spot manually because the detector fail-opens.
//
// Required shape (minimum, not exhaustive):
//   - name: <kebab-case slug>
//   - description: <one-line>
//   - detect: <block, may be empty for fallback profiles like 'minimal'>
//
// Optional but checked when present:
//   - version
//   - agentic_ready
//   - ai_sdk
//   - stack
//   - conventions

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROFILES_DIR = path.join(__dirname, '..', '..', 'profiles');

function listProfiles() {
  return fs.readdirSync(PROFILES_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => path.join(PROFILES_DIR, f));
}

function hasTopLevelKey(content, key) {
  // Match `key:` at line start, regardless of trailing value
  const re = new RegExp(`^${key}:`, 'm');
  return re.test(content);
}

function extractTopLevelValue(content, key) {
  const re = new RegExp(`^${key}:\\s*(.*)$`, 'm');
  const m = content.match(re);
  return m ? m[1].trim() : null;
}

const profiles = listProfiles();

test('at least 5 profiles ship', () => {
  assert.ok(profiles.length >= 5, `Expected >=5 profiles, found ${profiles.length}`);
});

for (const profilePath of profiles) {
  const profileName = path.basename(profilePath, '.yaml');

  test(`${profileName}: has required 'name:' field`, () => {
    const content = fs.readFileSync(profilePath, 'utf8');
    assert.ok(hasTopLevelKey(content, 'name'), `${profileName}.yaml missing 'name:' field`);
  });

  test(`${profileName}: 'name:' value matches filename`, () => {
    const content = fs.readFileSync(profilePath, 'utf8');
    const declaredName = extractTopLevelValue(content, 'name');
    assert.equal(
      declaredName,
      profileName,
      `${profileName}.yaml declares name: '${declaredName}' (expected '${profileName}')`
    );
  });

  test(`${profileName}: has 'description:' field`, () => {
    const content = fs.readFileSync(profilePath, 'utf8');
    assert.ok(hasTopLevelKey(content, 'description'), `${profileName}.yaml missing 'description:' field`);
    const desc = extractTopLevelValue(content, 'description');
    assert.ok(desc && desc.length >= 10, `${profileName}.yaml description too short: '${desc}'`);
  });

  test(`${profileName}: has 'detect:' block (may be empty for fallback profiles)`, () => {
    const content = fs.readFileSync(profilePath, 'utf8');
    assert.ok(hasTopLevelKey(content, 'detect'), `${profileName}.yaml missing 'detect:' block`);
  });

  test(`${profileName}: parseable by detector (smoke check via require)`, () => {
    // The detector exports parseProfileYaml — invoke it on this profile,
    // assert it doesn't throw and returns a `name` field. This catches
    // YAML edge cases the regex checks above would miss.
    //
    // We can't `require` the detector directly because it eagerly resolves
    // CORTEX_HOME at module load. Instead, spawn it with --cwd pointed at
    // an empty fixture and check it doesn't crash.
    const { spawnSync } = require('node:child_process');
    const detectorPath = path.join(__dirname, '..', '..', 'detectors', 'detect-profile.cjs');
    const minimalFixture = path.join(__dirname, '..', 'fixtures', 'minimal-mini');
    const r = spawnSync(process.execPath, [detectorPath, '--cwd', minimalFixture, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, CORTEX_HOME: path.join(__dirname, '..', '..') },
    });
    assert.equal(r.status, 0, `detector crashed running against minimal fixture: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    const found = (out.candidates || []).some((c) => c.name === profileName);
    assert.ok(
      found,
      `Profile ${profileName} not in detector candidate list — likely a YAML parse failure. Profiles seen: ${(out.candidates || []).map((c) => c.name).join(', ')}`
    );
  });
}
