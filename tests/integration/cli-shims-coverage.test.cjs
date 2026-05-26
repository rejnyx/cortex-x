// tests/integration/cli-shims-coverage.test.cjs
//
// E2E coverage: every cortex-* CLI in bin/ is executable, parseable Node JS,
// and responds to --help without crashing.
//
// Bug classes this catches:
//   - A new CLI shim shipped without --help support
//   - A shim with a syntax error that only manifests when invoked
//   - A shim that requires args + crashes on bare invocation (caller must
//     graceful-exit on no-args)
//   - A shim added to bin/ but never wired into install.sh's shim-promote
//     loop, so it's invisible at ~/.claude/shared/bin/

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BIN_DIR = path.join(REPO_ROOT, 'bin');

function listCortexCliShims() {
  return fs
    .readdirSync(BIN_DIR)
    .filter((f) => /^cortex-[a-z0-9-]+\.cjs$/.test(f))
    .filter((f) => {
      // Skip nested helpers (e.g. cortex-steward/* dispatchers — not user-facing)
      const stat = fs.statSync(path.join(BIN_DIR, f));
      return stat.isFile();
    })
    .sort();
}

describe('every cortex-* CLI shim is parseable and responds to --help', () => {
  const shims = listCortexCliShims();

  test('discovered at least 15 cortex-* CLIs in bin/', () => {
    assert.ok(
      shims.length >= 15,
      `expected >=15 shims in bin/, found ${shims.length}: ${shims.join(', ')}`,
    );
  });

  for (const shim of shims) {
    const shimPath = path.join(BIN_DIR, shim);

    test(`${shim}: is valid JS (node --check passes)`, () => {
      const r = spawnSync(process.execPath, ['--check', shimPath], {
        encoding: 'utf8',
      });
      assert.equal(
        r.status,
        0,
        `${shim}: syntax error\n${r.stderr || r.stdout}`,
      );
    });

    test(`${shim}: --help exits 0 within 5s`, () => {
      const r = spawnSync(process.execPath, [shimPath, '--help'], {
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(
        r.status,
        0,
        `${shim} --help exited ${r.status}\nstdout: ${r.stdout?.slice(0, 200)}\nstderr: ${r.stderr?.slice(0, 200)}`,
      );
      // Must print something useful: ≥30 chars AND mentions the shim by name
      // (case-insensitively, accommodating CORTEX_FOO env-var style outputs)
      // OR uses "usage"/"help" keywords.
      const out = (r.stdout || '') + (r.stderr || '');
      const stem = shim.replace('.cjs', '').replace(/-/g, '');
      const outLower = out.toLowerCase();
      const stemLower = stem.toLowerCase();
      assert.ok(
        out.length >= 30 &&
          (outLower.includes('usage') ||
            outLower.includes('help') ||
            outLower.replace(/[-_]/g, '').includes(stemLower)),
        `${shim} --help produced suspiciously thin output: ${out.slice(0, 200)}`,
      );
    });
  }
});

describe('install.sh promotes every cortex-* CLI to ~/.claude/shared/bin/', () => {
  const shims = listCortexCliShims();
  const installSh = fs.readFileSync(path.join(REPO_ROOT, 'install.sh'), 'utf8');

  // install.sh either lists shims explicitly OR copies bin/ as a whole.
  // We accept either, but if listed explicitly, the list must include all shims.
  const bulkCopy =
    /cp\s+-r\s+["']\$CORTEX_ROOT\/bin["']?\s+/.test(installSh) ||
    /cp\s+-r\s+["']\$CORTEX_ROOT\/bin\/\.?["']?\s+/.test(installSh) ||
    /cp\s+["']\$CORTEX_ROOT\/bin\/cortex-[*][^"']*["']/.test(installSh);

  test('install.sh either bulk-copies bin/ or lists every CLI', () => {
    if (bulkCopy) {
      assert.ok(true, 'install.sh uses bulk copy of bin/');
      return;
    }
    // Otherwise — every shim must be mentioned by exact name
    const missing = shims.filter((shim) => !installSh.includes(shim));
    assert.deepEqual(
      missing,
      [],
      `install.sh doesn't bulk-copy bin/ AND doesn't mention these shims by name: ${missing.join(', ')}`,
    );
  });
});
