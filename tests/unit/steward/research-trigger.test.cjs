// Sprint 2.14 — research-trigger rule unit tests.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fc = require('fast-check');

const trig = require('../../../bin/steward/_lib/research-trigger.cjs');

// Sprint 2.14 R2 fix (CI failure on commit 6b47188): cacheDir() validates
// the env override against HOME containment. os.tmpdir() (e.g. /tmp on
// Linux) is NOT under HOME, so the override gets rejected and tests fall
// through to the shared default cache dir, leaking state across tests.
// Use a HOME-based tmp dir for test isolation.
function tmpHomeDir(label) {
  const dir = fs.mkdtempSync(path.join(os.homedir(), `.cortex-research-test-${label}-`));
  return dir;
}

function withCacheDir(fn) {
  const dir = tmpHomeDir('cache');
  const before = process.env.STEWARD_RESEARCH_CACHE_DIR;
  process.env.STEWARD_RESEARCH_CACHE_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (before === undefined) delete process.env.STEWARD_RESEARCH_CACHE_DIR;
    else process.env.STEWARD_RESEARCH_CACHE_DIR = before;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) { /* best-effort */ }
  }
}

describe('Sprint 2.14 — detectVersionTriggers', () => {
  test('detects framework@major mention without known cache entry', () => {
    const triggers = trig.detectVersionTriggers('Use Next.js 16 with the new app router', {});
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0].category, 'api');
    assert.equal(triggers[0].framework, 'nextjs');
    assert.equal(triggers[0].major, 16);
  });

  test('does NOT trigger when major matches known cache', () => {
    const triggers = trig.detectVersionTriggers('Next.js 16 features', { nextjs: { major: 16 } });
    assert.equal(triggers.length, 0);
  });

  test('triggers when prompted major > known major', () => {
    const triggers = trig.detectVersionTriggers('moving to Next.js 17', { nextjs: { major: 16 } });
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0].major, 17);
  });

  test('empty / non-string input returns empty array', () => {
    assert.deepEqual(trig.detectVersionTriggers('', {}), []);
    assert.deepEqual(trig.detectVersionTriggers(null, {}), []);
    assert.deepEqual(trig.detectVersionTriggers(undefined, {}), []);
    assert.deepEqual(trig.detectVersionTriggers(42, {}), []);
  });

  test('caps at 5 triggers per call', () => {
    const text = 'next.js 16 react 19 vite 7 astro 4 tailwind 4 zod 4 prisma 6 supabase 3';
    const triggers = trig.detectVersionTriggers(text, {});
    assert.ok(triggers.length <= 5);
  });

  test('regex is case-insensitive + handles @ separator', () => {
    const triggers = trig.detectVersionTriggers('TAILWIND@4 vite@7', {});
    assert.equal(triggers.length, 2);
  });
});

describe('Sprint 2.14 — detectSecurityTriggers', () => {
  test('flags path with auth keyword', () => {
    const t = trig.detectSecurityTriggers([{ path: 'src/auth.ts', diff: '' }]);
    assert.equal(t.length, 1);
    assert.equal(t[0].category, 'security');
  });

  test('flags multiple sensitive paths', () => {
    const t = trig.detectSecurityTriggers([
      { path: 'src/auth.ts', diff: '' },
      { path: 'lib/jwt.js', diff: '' },
    ]);
    assert.equal(t.length, 2);
  });

  test('caps at 3 triggers', () => {
    const edits = Array.from({ length: 10 }, (_, i) => ({ path: `auth-${i}.ts` }));
    const t = trig.detectSecurityTriggers(edits);
    assert.ok(t.length <= 3);
  });

  test('does NOT flag innocuous paths', () => {
    const t = trig.detectSecurityTriggers([
      { path: 'src/index.ts', diff: '' },
      { path: 'lib/calc.ts', diff: '' },
    ]);
    assert.equal(t.length, 0);
  });

  test('non-array input returns empty', () => {
    assert.deepEqual(trig.detectSecurityTriggers(null), []);
    assert.deepEqual(trig.detectSecurityTriggers('not-array'), []);
  });

  test('matches on /auth/ directory segment', () => {
    const t = trig.detectSecurityTriggers([{ path: 'app/auth/route.ts' }]);
    assert.equal(t.length, 1);
  });
});

describe('Sprint 2.14 — detectPackageJsonTriggers', () => {
  test('flags new dependencies as security', () => {
    const t = trig.detectPackageJsonTriggers({ added: ['jsonwebtoken'] });
    assert.equal(t.length, 1);
    assert.equal(t[0].category, 'security');
  });

  test('major-bump fires api trigger when known < new', () => {
    withCacheDir((dir) => {
      fs.writeFileSync(
        path.join(dir, 'known-versions.json'),
        JSON.stringify({ nextjs: { major: 15 } }),
      );
      const t = trig.detectPackageJsonTriggers({
        upgraded: [{ name: 'nextjs', to: '^16.0.1' }],
      });
      const apiHits = t.filter((x) => x.category === 'api');
      assert.equal(apiHits.length, 1);
    });
  });

  test('non-major bump does not fire api trigger', () => {
    withCacheDir((dir) => {
      fs.writeFileSync(
        path.join(dir, 'known-versions.json'),
        JSON.stringify({ nextjs: { major: 16 } }),
      );
      const t = trig.detectPackageJsonTriggers({
        upgraded: [{ name: 'nextjs', to: '^16.1.0' }],
      });
      const apiHits = t.filter((x) => x.category === 'api');
      assert.equal(apiHits.length, 0);
    });
  });

  test('null input is no-op', () => {
    assert.deepEqual(trig.detectPackageJsonTriggers(null), []);
    assert.deepEqual(trig.detectPackageJsonTriggers({}), []);
  });
});

describe('Sprint 2.14 — cache I/O', () => {
  test('cache miss returns hit:false', () => {
    withCacheDir(() => {
      const r = trig.cacheGet('api', trig.queryKey('api', 'next.js@16'));
      assert.equal(r.hit, false);
    });
  });

  test('cachePut + cacheGet roundtrip within TTL', () => {
    withCacheDir(() => {
      const k = trig.queryKey('api', 'next.js@16');
      const put = trig.cachePut('api', k, { summary: 'Next 16 docs', ttlSeconds: 1000 });
      assert.equal(put.ok, true);
      const got = trig.cacheGet('api', k);
      assert.equal(got.hit, true);
      assert.equal(got.value.summary, 'Next 16 docs');
    });
  });

  test('expired entry returns hit:false expired:true', () => {
    withCacheDir((dir) => {
      const k = trig.queryKey('api', 'expired-test');
      const p = trig.entryPath('api', k);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const oldTs = new Date(Date.now() - 2_000_000_000).toISOString(); // far past
      fs.writeFileSync(p, JSON.stringify({
        key: k, category: 'api', fetchedAt: oldTs, ttlSeconds: 60,
      }));
      const got = trig.cacheGet('api', k);
      assert.equal(got.hit, false);
      assert.equal(got.expired, true);
    });
  });

  test('invalid category rejected by entryPath', () => {
    assert.throws(
      () => trig.entryPath('not-a-category', '0123456789abcdef'),
      /unknown category/,
    );
  });

  test('invalid query key rejected', () => {
    assert.throws(
      () => trig.entryPath('api', 'a'),
      /invalid query key/,
    );
    assert.throws(
      () => trig.entryPath('api', '../escape'),
      /invalid query key/,
    );
  });
});

describe('Sprint 2.14 — ledger + cost gate', () => {
  test('fresh ledger reads as today, $0', () => {
    withCacheDir(() => {
      const led = trig.readLedger();
      assert.equal(led.spentUsd, 0);
      assert.equal(led.calls, 0);
      assert.equal(led.circuit, 'closed');
    });
  });

  test('recordResearchCall increments spend + calls', () => {
    withCacheDir(() => {
      const led1 = trig.recordResearchCall({ category: 'api', costUsd: 0.005 });
      assert.ok(led1.spentUsd >= 0.005);
      const led2 = trig.recordResearchCall({ category: 'security', costUsd: 0.02 });
      assert.ok(led2.spentUsd >= 0.025);
      assert.equal(led2.calls, 2);
    });
  });

  test('circuit opens when spend exceeds cap', () => {
    withCacheDir(() => {
      // Default cap 0.50; record 0.55
      trig.recordResearchCall({ costUsd: 0.55 });
      const led = trig.readLedger();
      assert.equal(led.circuit, 'open');
    });
  });

  test('gateFor returns "deny" when circuit open', () => {
    withCacheDir(() => {
      trig.writeLedger({ day: new Date().toISOString().slice(0, 10), spentUsd: 1.0, calls: 99, circuit: 'open' });
      assert.equal(trig.gateFor('api'), 'deny');
      assert.equal(trig.gateFor('security'), 'deny');
    });
  });

  test('gateFor returns "throttle" for non-security at 80-100%', () => {
    withCacheDir(() => {
      // 85% of $0.50 = $0.425
      trig.writeLedger({ day: new Date().toISOString().slice(0, 10), spentUsd: 0.425, calls: 5, circuit: 'closed' });
      assert.equal(trig.gateFor('api'), 'throttle');
      assert.equal(trig.gateFor('security'), 'allow');
    });
  });

  test('gateFor returns "allow" below warn threshold', () => {
    withCacheDir(() => {
      trig.writeLedger({ day: new Date().toISOString().slice(0, 10), spentUsd: 0.05, calls: 1, circuit: 'closed' });
      assert.equal(trig.gateFor('api'), 'allow');
    });
  });

  test('cap = 0 means hard-deny (operator opt-out)', () => {
    const before = process.env.STEWARD_RESEARCH_DAILY_USD_CAP;
    process.env.STEWARD_RESEARCH_DAILY_USD_CAP = '0';
    try {
      withCacheDir(() => {
        assert.equal(trig.gateFor('security'), 'deny');
      });
    } finally {
      if (before === undefined) delete process.env.STEWARD_RESEARCH_DAILY_USD_CAP;
      else process.env.STEWARD_RESEARCH_DAILY_USD_CAP = before;
    }
  });

  test('UTC day rollover resets ledger', () => {
    withCacheDir(() => {
      // Write yesterday's ledger
      trig.writeLedger({ day: '2020-01-01', spentUsd: 999, calls: 999, circuit: 'open' });
      const led = trig.readLedger();
      assert.equal(led.spentUsd, 0);
      assert.equal(led.circuit, 'closed');
    });
  });
});

describe('Sprint 2.14 — shouldResearch verdict', () => {
  test('no trigger → should:false', () => {
    withCacheDir(() => {
      const r = trig.shouldResearch({
        userPrompt: 'plain text without framework version mentions',
        recentEdits: [{ path: 'src/index.ts' }],
      });
      assert.equal(r.should, false);
      assert.equal(r.category, null);
    });
  });

  test('framework version trigger fires api category', () => {
    withCacheDir(() => {
      const r = trig.shouldResearch({
        userPrompt: 'Help me upgrade to Next.js 17',
        recentEdits: [],
      });
      assert.equal(r.should, true);
      assert.equal(r.category, 'api');
    });
  });

  test('sensitive path trigger fires security category (priority over api)', () => {
    withCacheDir(() => {
      const r = trig.shouldResearch({
        userPrompt: 'edit Next.js 17 routing',
        recentEdits: [{ path: 'src/auth.ts' }],
      });
      // Priority: security > api
      assert.equal(r.should, true);
      assert.equal(r.category, 'security');
    });
  });

  test('cache hit covers trigger → should:false', () => {
    withCacheDir(() => {
      // Pre-populate the cache for this exact reason
      const reason = 'next.js@17 ahead of cache (none)';
      trig.cachePut('api', trig.queryKey('api', reason), {
        summary: 'cached',
        ttlSeconds: 100000,
      });
      const r = trig.shouldResearch({
        userPrompt: 'Help me upgrade to Next.js 17',
        recentEdits: [],
      });
      // Cache hit → should:false
      assert.equal(r.should, false);
      assert.match(r.reason, /cache/);
    });
  });

  test('cost cap reached → should:false', () => {
    withCacheDir(() => {
      trig.writeLedger({ day: new Date().toISOString().slice(0, 10), spentUsd: 1.0, calls: 99, circuit: 'open' });
      const r = trig.shouldResearch({
        userPrompt: 'Help me upgrade to Next.js 17',
        recentEdits: [],
      });
      assert.equal(r.should, false);
      assert.match(r.reason, /cost-cap/);
    });
  });

  test('throttle: api category denied while security still allowed', () => {
    withCacheDir(() => {
      // 85% of cap → throttle
      trig.writeLedger({ day: new Date().toISOString().slice(0, 10), spentUsd: 0.425, calls: 5, circuit: 'closed' });
      const apiResult = trig.shouldResearch({
        userPrompt: 'Next.js 17 docs',
        recentEdits: [],
      });
      assert.equal(apiResult.should, false);
      assert.match(apiResult.reason, /throttled/);
      const secResult = trig.shouldResearch({
        userPrompt: '',
        recentEdits: [{ path: 'src/auth.ts' }],
      });
      assert.equal(secResult.should, true);
      assert.equal(secResult.category, 'security');
    });
  });
});

describe('Sprint 2.14 R2 — HIGH fixes', () => {
  test('shouldResearch(null) does NOT crash (R2 HIGH)', () => {
    withCacheDir(() => {
      const r = trig.shouldResearch(null);
      assert.equal(typeof r, 'object');
      assert.equal(r.should, false);
    });
  });

  test('shouldResearch(undefined) does NOT crash', () => {
    withCacheDir(() => {
      const r = trig.shouldResearch(undefined);
      assert.equal(r.should, false);
    });
  });

  test('shouldResearch with non-object input (string/number) does NOT crash', () => {
    withCacheDir(() => {
      assert.equal(trig.shouldResearch('not an object').should, false);
      assert.equal(trig.shouldResearch(42).should, false);
    });
  });

  test('recordResearchCall clamps Infinity costUsd (R2 HIGH)', () => {
    withCacheDir(() => {
      const led = trig.recordResearchCall({ costUsd: Infinity });
      assert.ok(Number.isFinite(led.spentUsd), `spentUsd must stay finite: ${led.spentUsd}`);
      assert.equal(led.spentUsd, 0);
    });
  });

  test('recordResearchCall clamps negative costUsd (R2 HIGH)', () => {
    withCacheDir(() => {
      trig.recordResearchCall({ costUsd: 0.10 });
      const led = trig.recordResearchCall({ costUsd: -5 });
      assert.ok(led.spentUsd >= 0.10, `spentUsd must not decrease on negative input: ${led.spentUsd}`);
    });
  });

  test('gateFor returns deny on NaN cap (R2 HIGH)', () => {
    withCacheDir(() => {
      assert.equal(trig.gateFor('security', undefined, NaN), 'deny');
      assert.equal(trig.gateFor('api', undefined, NaN), 'deny');
    });
  });

  test('cacheGet rejects invalid key with rejected:true sentinel (R2 HIGH)', () => {
    withCacheDir(() => {
      const r = trig.cacheGet('api', '../escape');
      assert.equal(r.hit, false);
      assert.equal(r.rejected, true);
    });
  });

  test('STEWARD_RESEARCH_CACHE_DIR outside HOME is rejected (R2 HIGH)', () => {
    const before = process.env.STEWARD_RESEARCH_CACHE_DIR;
    // Use absolute path outside HOME — /etc on POSIX or C:\Windows on win32
    process.env.STEWARD_RESEARCH_CACHE_DIR = process.platform === 'win32' ? 'C:\\Windows' : '/etc';
    try {
      const dir = trig.cacheDir();
      // Override rejected — should fall back to HOME-based default
      assert.match(dir, /\.claude/, `expected fallback under HOME, got ${dir}`);
    } finally {
      if (before === undefined) delete process.env.STEWARD_RESEARCH_CACHE_DIR;
      else process.env.STEWARD_RESEARCH_CACHE_DIR = before;
    }
  });
});

describe('Sprint 2.14 R2 — SECURITY_PATH_RE coverage (LOW false-negatives fixed)', () => {
  test('flags authentication.ts (was false-negative)', () => {
    const t = trig.detectSecurityTriggers([{ path: 'src/authentication.ts' }]);
    assert.equal(t.length, 1);
    assert.equal(t[0].category, 'security');
  });

  test('flags loginHandler.ts (camelCase split)', () => {
    const t = trig.detectSecurityTriggers([{ path: 'src/loginHandler.ts' }]);
    assert.equal(t.length, 1);
  });

  test('flags .env file', () => {
    const t = trig.detectSecurityTriggers([{ path: '.env' }]);
    assert.equal(t.length, 1);
  });

  test('flags secrets.json', () => {
    const t = trig.detectSecurityTriggers([{ path: 'config/secrets.json' }]);
    assert.equal(t.length, 1);
  });

  test('flags new tokens (catalog extension)', () => {
    const t = trig.detectSecurityTriggers([{ path: 'src/apikey.ts' }]);
    assert.equal(t.length, 1);
  });

  test('still does NOT flag innocuous paths (no regression)', () => {
    const t = trig.detectSecurityTriggers([
      { path: 'src/index.ts' },
      { path: 'lib/calc.ts' },
      { path: 'utils/format.ts' },
    ]);
    assert.equal(t.length, 0);
  });
});

describe('Sprint 2.14 — property tests', () => {
  test('shouldResearch never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        withCacheDir(() => {
          const r = trig.shouldResearch(input || {});
          return typeof r === 'object' && r !== null && typeof r.should === 'boolean';
        });
        return true;
      }),
      { numRuns: 50 },
    );
  });

  test('detectVersionTriggers never throws on arbitrary string', () => {
    fc.assert(
      fc.property(fc.string(), fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.record({ major: fc.integer({ min: 0, max: 99 }) })), (text, known) => {
        const t = trig.detectVersionTriggers(text, known);
        return Array.isArray(t);
      }),
      { numRuns: 50 },
    );
  });
});
