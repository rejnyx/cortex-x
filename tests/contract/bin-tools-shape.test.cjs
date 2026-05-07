'use strict';

// Tier 6 — bin/ tools contract tests.
// Black-box invocations of cortex-bootstrap and cortex-gap-report verifying:
//   - exit codes per Unix convention
//   - env-var-driven non-interactive modes
//   - --json output is parseable JSON
//   - graceful behavior on empty / missing inputs
//   - help flags work

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BOOTSTRAP_CLI = path.resolve(__dirname, '..', '..', 'bin', 'cortex-bootstrap.cjs');
const GAP_CLI = path.resolve(__dirname, '..', '..', 'bin', 'cortex-gap-report.cjs');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `bin-tools-${prefix}-`));
}

describe('cortex-bootstrap: env-driven modes', () => {
  test('CORTEX_BOOTSTRAP_MODE=new writes marker and exits 0', () => {
    const cwd = tmpDir('boot-new');
    const result = spawnSync(process.execPath, [BOOTSTRAP_CLI], {
      env: { ...process.env, CORTEX_BOOTSTRAP_MODE: 'new' },
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0);
    const markerPath = path.join(cwd, '.cortex-bootstrap-pending');
    assert.ok(fs.existsSync(markerPath), 'marker file should exist');
    const marker = fs.readFileSync(markerPath, 'utf8');
    assert.match(marker, /mode=new/);
    assert.match(marker, /at=/);
  });

  test('CORTEX_BOOTSTRAP_MODE=existing writes existing marker', () => {
    const cwd = tmpDir('boot-existing');
    const result = spawnSync(process.execPath, [BOOTSTRAP_CLI], {
      env: { ...process.env, CORTEX_BOOTSTRAP_MODE: 'existing' },
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0);
    const marker = fs.readFileSync(path.join(cwd, '.cortex-bootstrap-pending'), 'utf8');
    assert.match(marker, /mode=existing/);
  });

  test('CORTEX_BOOTSTRAP_MODE=framework does NOT write marker', () => {
    const cwd = tmpDir('boot-framework');
    const result = spawnSync(process.execPath, [BOOTSTRAP_CLI], {
      env: { ...process.env, CORTEX_BOOTSTRAP_MODE: 'framework' },
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(path.join(cwd, '.cortex-bootstrap-pending')), false);
    assert.match(result.stdout, /framework-only mode/);
  });

  test('invalid CORTEX_BOOTSTRAP_MODE exits 2 with error', () => {
    const cwd = tmpDir('boot-invalid');
    const result = spawnSync(process.execPath, [BOOTSTRAP_CLI], {
      env: { ...process.env, CORTEX_BOOTSTRAP_MODE: 'unknown' },
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown CORTEX_BOOTSTRAP_MODE/);
  });

  test('non-interactive without env exits 2', () => {
    const cwd = tmpDir('boot-no-tty');
    // We pipe stdin so isTTY=false → non-interactive path
    const result = spawnSync(process.execPath, [BOOTSTRAP_CLI], {
      env: { ...process.env, CORTEX_BOOTSTRAP_MODE: '' },
      input: '',
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Non-interactive shell/);
  });
});

describe('cortex-bootstrap: marker file shape', () => {
  test('marker contains mode and timestamp fields', () => {
    const cwd = tmpDir('marker-shape');
    spawnSync(process.execPath, [BOOTSTRAP_CLI], {
      env: { ...process.env, CORTEX_BOOTSTRAP_MODE: 'new' },
      cwd,
      timeout: 5000,
    });
    const marker = fs.readFileSync(path.join(cwd, '.cortex-bootstrap-pending'), 'utf8');
    const lines = marker.split('\n').filter(Boolean);
    const fields = Object.fromEntries(lines.map((l) => l.split('=')));
    assert.equal(fields.mode, 'new');
    assert.match(fields.at, /^\d{4}-\d{2}-\d{2}T/);
  });

  test('overwrites existing marker on re-run', () => {
    const cwd = tmpDir('marker-overwrite');
    spawnSync(process.execPath, [BOOTSTRAP_CLI], {
      env: { ...process.env, CORTEX_BOOTSTRAP_MODE: 'new' },
      cwd, timeout: 5000,
    });
    spawnSync(process.execPath, [BOOTSTRAP_CLI], {
      env: { ...process.env, CORTEX_BOOTSTRAP_MODE: 'existing' },
      cwd, timeout: 5000,
    });
    const marker = fs.readFileSync(path.join(cwd, '.cortex-bootstrap-pending'), 'utf8');
    assert.match(marker, /mode=existing/);
    assert.equal(marker.includes('mode=new'), false);
  });
});

describe('cortex-gap-report: empty + missing log', () => {
  test('graceful message when log file missing', () => {
    const dataHome = tmpDir('gap-missing');
    const result = spawnSync(process.execPath, [GAP_CLI], {
      env: { ...process.env, CORTEX_DATA_HOME: dataHome },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /no entries/);
  });

  test('--json on empty log emits valid JSON with total=0', () => {
    const dataHome = tmpDir('gap-empty-json');
    const result = spawnSync(process.execPath, [GAP_CLI, '--json'], {
      env: { ...process.env, CORTEX_DATA_HOME: dataHome },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.total, 0);
    assert.deepEqual(parsed.by_best_match, []);
  });

  test('--help exits 0 with usage', () => {
    const result = spawnSync(process.execPath, [GAP_CLI, '--help'], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /cortex-gap-report/);
    assert.match(result.stdout, /--since/);
  });
});

describe('cortex-gap-report: with seeded entries', () => {
  function seedLog(dataHome, entries) {
    const logDir = path.join(dataHome, 'insights');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'gap-log.jsonl');
    const lines = entries.map((e) => JSON.stringify(e)).join('\n');
    fs.writeFileSync(logPath, lines + '\n', 'utf8');
    return logPath;
  }

  test('--json aggregates seeded entries by best_match', () => {
    const dataHome = tmpDir('gap-seeded');
    const today = new Date().toISOString().slice(0, 10);
    seedLog(dataHome, [
      { date: today, slug: 'a', best_match: 'minimal', missing_signals: ['rust'] },
      { date: today, slug: 'b', best_match: 'minimal', missing_signals: ['rust', 'wasm'] },
      { date: today, slug: 'c', best_match: 'astro-static', missing_signals: ['python'] },
    ]);

    const result = spawnSync(process.execPath, [GAP_CLI, '--json'], {
      env: { ...process.env, CORTEX_DATA_HOME: dataHome },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.total, 3);
    // by_best_match is array of [name, count] tuples sorted desc
    const minimal = parsed.by_best_match.find((x) => x[0] === 'minimal');
    assert.equal(minimal[1], 2);
    const astro = parsed.by_best_match.find((x) => x[0] === 'astro-static');
    assert.equal(astro[1], 1);
    // missing signals: rust appears twice
    const rust = parsed.top_missing_signals.find((x) => x[0] === 'rust');
    assert.equal(rust[1], 2);
  });

  test('--raw emits one JSON object per line', () => {
    const dataHome = tmpDir('gap-raw');
    const today = new Date().toISOString().slice(0, 10);
    seedLog(dataHome, [
      { date: today, slug: 'a', best_match: 'minimal' },
      { date: today, slug: 'b', best_match: 'astro-static' },
    ]);

    const result = spawnSync(process.execPath, [GAP_CLI, '--raw'], {
      env: { ...process.env, CORTEX_DATA_HOME: dataHome },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 0);
    const lines = result.stdout.trim().split('\n');
    assert.equal(lines.length, 2);
    const parsed0 = JSON.parse(lines[0]);
    const parsed1 = JSON.parse(lines[1]);
    assert.ok([parsed0.slug, parsed1.slug].includes('a'));
  });

  test('--since filter excludes older entries', () => {
    const dataHome = tmpDir('gap-since');
    const recent = new Date().toISOString().slice(0, 10);
    const oldDate = '2020-01-01';
    seedLog(dataHome, [
      { date: oldDate, slug: 'old', best_match: 'minimal' },
      { date: recent, slug: 'new', best_match: 'astro-static' },
    ]);

    const result = spawnSync(process.execPath, [GAP_CLI, '--since', '2026-01-01', '--json'], {
      env: { ...process.env, CORTEX_DATA_HOME: dataHome },
      encoding: 'utf8', timeout: 5000,
    });
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.total, 1);
    const found = parsed.by_best_match.find((x) => x[0] === 'astro-static');
    assert.ok(found);
  });
});
