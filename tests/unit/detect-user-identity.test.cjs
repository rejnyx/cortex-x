// detect-user-identity.test.cjs — Sprint 1.7.4 user-identity detector.
//
// Tests shape + null-safety + user.yaml parse, NOT specific git config values
// (those are environment-dependent and would make tests host-coupled).
// The detector is fail-open by contract: every signal is allowed to be null.

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const detector = require('../../detectors/detect-user-identity.cjs');

describe('detect-user-identity: shape + null-safety', () => {
  test('detect() returns object with all required keys', () => {
    const r = detector.detect();
    const requiredKeys = ['name', 'email', 'username', 'platform', 'locale', 'gh_login', 'confirmed', 'source_signals'];
    for (const k of requiredKeys) {
      assert.ok(k in r, `missing key: ${k}`);
    }
  });

  test('platform is always one of valid Node values', () => {
    const r = detector.detect();
    assert.ok(['win32', 'darwin', 'linux', 'aix', 'freebsd', 'openbsd', 'sunos'].includes(r.platform),
      `unexpected platform: ${r.platform}`);
  });

  test('confirmed is boolean (never undefined)', () => {
    const r = detector.detect();
    assert.equal(typeof r.confirmed, 'boolean');
  });

  test('source_signals contains provenance for each detected field', () => {
    const r = detector.detect();
    const expectedSignals = ['git_name', 'git_email', 'username', 'platform', 'locale', 'gh_login', 'user_yaml'];
    for (const k of expectedSignals) {
      assert.ok(k in r.source_signals, `missing source signal: ${k}`);
    }
  });

  test('null fields stay null (no "undefined" or "" string leaks)', () => {
    const r = detector.detect();
    for (const field of ['name', 'email', 'username', 'locale', 'gh_login']) {
      // Either a non-empty string or null — never empty string, never undefined.
      assert.ok(r[field] === null || (typeof r[field] === 'string' && r[field].length > 0),
        `field ${field} has invalid value: ${JSON.stringify(r[field])}`);
    }
  });
});

describe('detect-user-identity: readExistingUserYaml', () => {
  let tmpHome;
  let originalHome;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-user-test-'));
    originalHome = process.env.HOME;
    // Override both HOME (Unix) and USERPROFILE (Windows) — os.homedir() respects these.
    process.env.HOME = tmpHome;
    if (process.platform === 'win32') {
      process.env.USERPROFILE = tmpHome;
    }
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
  });

  test('returns null when user.yaml does not exist', () => {
    const r = detector.readExistingUserYaml();
    assert.equal(r, null);
  });

  test('parses flat-yaml when user.yaml exists', () => {
    const userYamlDir = path.join(tmpHome, '.claude', 'cortex');
    fs.mkdirSync(userYamlDir, { recursive: true });
    fs.writeFileSync(path.join(userYamlDir, 'user.yaml'),
      'name: Test User\nemail: test@example.com\nlocale: en-US\nconfirmed: true\n', 'utf8');

    const r = detector.readExistingUserYaml();
    assert.ok(r, 'expected non-null result');
    assert.equal(r.name, 'Test User');
    assert.equal(r.email, 'test@example.com');
    assert.equal(r.locale, 'en-US');
    assert.equal(r.confirmed, 'true');
  });

  test('strips quoted values', () => {
    const userYamlDir = path.join(tmpHome, '.claude', 'cortex');
    fs.mkdirSync(userYamlDir, { recursive: true });
    fs.writeFileSync(path.join(userYamlDir, 'user.yaml'),
      'name: "Quoted Name"\nemail: "x@y.z"\n', 'utf8');

    const r = detector.readExistingUserYaml();
    assert.equal(r.name, 'Quoted Name');
    assert.equal(r.email, 'x@y.z');
  });

  test('treats empty string values as null', () => {
    const userYamlDir = path.join(tmpHome, '.claude', 'cortex');
    fs.mkdirSync(userYamlDir, { recursive: true });
    fs.writeFileSync(path.join(userYamlDir, 'user.yaml'),
      'name: David\nemail:\nlocale: cs-CZ\n', 'utf8');

    const r = detector.readExistingUserYaml();
    assert.equal(r.name, 'David');
    assert.equal(r.email, null);
    assert.equal(r.locale, 'cs-CZ');
  });

  test('confirmed user.yaml beats fresh detection', () => {
    const userYamlDir = path.join(tmpHome, '.claude', 'cortex');
    fs.mkdirSync(userYamlDir, { recursive: true });
    fs.writeFileSync(path.join(userYamlDir, 'user.yaml'),
      'name: Override Name\nemail: override@example.com\nlocale: de-DE\nconfirmed: true\n', 'utf8');

    const r = detector.detect();
    // user.yaml values override git config detection
    assert.equal(r.name, 'Override Name');
    assert.equal(r.email, 'override@example.com');
    assert.equal(r.locale, 'de-DE');
    assert.equal(r.confirmed, true);
  });
});

describe('detect-user-identity: shell output (formatShell)', () => {
  test('emits CORTEX_USER_* prefixed assignments', () => {
    const r = detector.detect();
    const shell = detector.formatShell(r);
    assert.match(shell, /^CORTEX_USER_NAME=/m);
    assert.match(shell, /^CORTEX_USER_EMAIL=/m);
    assert.match(shell, /^CORTEX_USER_USERNAME=/m);
    assert.match(shell, /^CORTEX_USER_PLATFORM=/m);
    assert.match(shell, /^CORTEX_USER_LOCALE=/m);
    assert.match(shell, /^CORTEX_USER_GH_LOGIN=/m);
    assert.match(shell, /^CORTEX_USER_CONFIRMED=/m);
  });

  test('shellQuote handles null → empty quoted string', () => {
    assert.equal(detector.shellQuote(null), "''");
    assert.equal(detector.shellQuote(undefined), "''");
  });

  test('shellQuote escapes embedded single quotes', () => {
    // O'Brien → 'O'\''Brien'  (standard bash trick: close, escape, reopen)
    assert.equal(detector.shellQuote("O'Brien"), "'O'\\''Brien'");
  });

  test('shellQuote prevents command injection ($(...) cannot eval)', () => {
    const malicious = '$(rm -rf /)';
    const quoted = detector.shellQuote(malicious);
    // Wrapped in single quotes — bash treats '$(...)' as literal, not subshell.
    assert.ok(quoted.startsWith("'"));
    assert.ok(quoted.endsWith("'"));
    assert.ok(quoted.includes('$(rm -rf /)'));
  });
});

describe('detect-user-identity: locale fallback', () => {
  test('readLocale returns a string or null (never undefined)', () => {
    const v = detector.readLocale();
    assert.ok(v === null || typeof v === 'string', `unexpected locale type: ${typeof v}`);
  });

  test('readLocale returns BCP-47-shaped value when available (xx or xx-XX)', () => {
    const v = detector.readLocale();
    if (v !== null) {
      assert.match(v, /^[a-z]{2,3}(-[A-Z]{2})?$/i,
        `locale ${v} does not match BCP-47 shape`);
    }
  });

  test('readLocale filters POSIX/C placeholder values to null', () => {
    // GitHub Actions Linux runners + minimal Docker images often set LANG=C.
    // C/POSIX mean "no real locale" — must return null, not literal "C".
    const originalLang = process.env.LANG;
    const originalLcAll = process.env.LC_ALL;
    const originalLcMessages = process.env.LC_MESSAGES;
    const originalLanguage = process.env.LANGUAGE;
    try {
      delete process.env.LC_ALL;
      delete process.env.LC_MESSAGES;
      delete process.env.LANGUAGE;
      process.env.LANG = 'C';
      const v = detector.readLocale();
      // Either null (env filtered) or a real BCP-47 from Intl/Windows fallback —
      // never the literal string "C" or "POSIX".
      assert.notEqual(v, 'C');
      assert.notEqual(v, 'POSIX');
      assert.notEqual(v, 'c');
    } finally {
      if (originalLang === undefined) delete process.env.LANG; else process.env.LANG = originalLang;
      if (originalLcAll !== undefined) process.env.LC_ALL = originalLcAll;
      if (originalLcMessages !== undefined) process.env.LC_MESSAGES = originalLcMessages;
      if (originalLanguage !== undefined) process.env.LANGUAGE = originalLanguage;
    }
  });
});
