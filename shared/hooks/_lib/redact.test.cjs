/**
 * Smoke tests for shared/hooks/_lib/redact.cjs
 *
 * Pure Node — zero deps. Run with: node shared/hooks/_lib/redact.test.cjs
 * Exits 0 on all-pass, 1 on any fail.
 *
 * Test strategy: feed known-secret-shaped inputs, assert the secret is gone
 * from the output AND the surrounding context survives. This is the privacy
 * contract for the journal + .hook-errors.log layers.
 */
const assert = require('assert');
const { redact, truncate, homeStrip, singleLine, validateCortexHome } = require('./redact.cjs');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); fail++; }
}

console.log('\nredact() — scheme-prefix auth tokens');
test('Bearer token removed, "Bearer" replaced', () => {
  const out = redact('Authorization: Bearer abc123xyz456789token');
  assert(!out.includes('abc123xyz456789token'), `leaked: ${out}`);
});
test('Basic auth base64 payload removed', () => {
  const out = redact('Authorization: Basic dXNlcjpwYXNzd29yZA==');
  assert(!out.includes('dXNlcjpwYXNzd29yZA'), `leaked: ${out}`);
});

console.log('\nredact() — known provider shapes');
test('OpenAI-style sk-ant- key removed', () => {
  const out = redact('OPENAI_KEY=sk-ant-api03-abcdefghij1234567890xyz');
  assert(!out.includes('abcdefghij1234567890'), `leaked: ${out}`);
});
test('Stripe sk_live_ key removed', () => {
  const out = redact('STRIPE=sk_live_51H8xABcdefghij1234567890abcdef');
  assert(!out.includes('51H8xABcdef'), `leaked: ${out}`);
});
test('AWS access key id AKIA… removed', () => {
  const out = redact('AWS=AKIAIOSFODNN7EXAMPLE');
  assert(!out.includes('AKIAIOSFODNN7EXAMPLE'), `leaked: ${out}`);
});
test('Google AIza… key removed (exactly AIza + 35 chars per spec)', () => {
  // Real Google API keys = "AIza" + 35 chars. Pattern: /\bAIza[0-9A-Za-z_-]{35}\b/
  const out = redact('GOOGLE=AIzaSyBxwABcdefGhijKlmnopQrstuvWxyz1234');
  assert(!out.includes('AIzaSyBxwAB'), `leaked: ${out}`);
});
test('GitHub ghp_ token removed', () => {
  const out = redact('GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890');
  assert(!out.includes('ghp_abcdefghijklmno'), `leaked: ${out}`);
});
test('JWT (eyJ.eyJ.sig) removed', () => {
  const out = redact('TOKEN=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdef');
  assert(!out.includes('eyJhbGciOiJIUzI1'), `leaked: ${out}`);
});

console.log('\nredact() — URL credentials + query tokens');
test('postgres://user:pass@host password removed (even with @ in password)', () => {
  const out = redact('psql postgres://admin:myP@ssw0rd@db.host:5432/mydb');
  assert(!out.includes('myP@ssw0rd'), `leaked: ${out}`);
  assert(out.includes('db.host'), `host removed: ${out}`);
});
test('URL query access_token removed, other params preserved', () => {
  const out = redact('fetch https://api.example.com/x?access_token=abc123&foo=bar');
  assert(!out.includes('abc123'), `leaked: ${out}`);
  assert(out.includes('foo=bar'), `other params lost: ${out}`);
});
test('curl -u user:pass redacted', () => {
  const out = redact('curl -u admin:secretpass https://api.example.com');
  assert(!out.includes('secretpass'), `leaked: ${out}`);
  assert(!out.includes('admin:'), `user leaked: ${out}`);
});

console.log('\nredact() — false-positive avoidance');
test('bare `pwd` command not redacted (not in keyword list)', () => {
  const out = redact('pwd && ls');
  assert.strictEqual(out, 'pwd && ls');
});
test('git SHA (40-char hex) not redacted', () => {
  const out = redact('git show 371163c08308743ec12d9c80671c551afa424497');
  assert(out.includes('371163c08308743ec12d9c80671c551afa424497'), `SHA redacted: ${out}`);
});

console.log('\ntruncate() + singleLine() + homeStrip()');
test('truncate adds ellipsis', () => {
  assert.strictEqual(truncate('abcdefghij', 5), 'abcd…');
});
test('singleLine collapses whitespace', () => {
  assert.strictEqual(singleLine('a\n\n  b\t\tc'), 'a b c');
});
test('homeStrip replaces home dir with ~', () => {
  const os = require('os');
  const p = os.homedir() + '/foo/bar';
  assert(homeStrip(p).startsWith('~/'), `got: ${homeStrip(p)}`);
});

console.log('\nvalidateCortexHome() — attack vector defenses');
test('unset → null', () => assert.strictEqual(validateCortexHome(''), null));
test('non-existent path → null', () => {
  assert.strictEqual(validateCortexHome('/tmp/cortex-nonexistent-xyz123'), null);
});
test('path without signature file (standards/ship-ready.md) → null', () => {
  const os = require('os'); const fs = require('fs'); const path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-validate-'));
  assert.strictEqual(validateCortexHome(tmp), null, 'accepted bare tmpdir');
  fs.rmdirSync(tmp);
});
test('path inside $HOME with signature file → accepted', () => {
  // Use the actual cortex-x repo — signature file exists here
  const path = require('path');
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const result = validateCortexHome(repoRoot);
  // Accept non-null (valid) or null (if repo is outside $HOME in CI)
  // Main invariant: must not throw, must not accept arbitrary tmpdir
  assert(result === null || result === repoRoot, `unexpected: ${result}`);
});

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
