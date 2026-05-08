'use strict';

/**
 * routing-table.cjs unit tests — Sprint 2.0b action-kind model routing.
 *
 * Covers:
 *   - profile validation + enum
 *   - selectModel precedence (CLI > kind-env > legacy STEWARD_MODEL > table)
 *   - ensemble shape vs string slot
 *   - profile-allowlist gate
 *   - deterministic kinds return model:null
 *   - malformed inputs surface clean error codes
 *   - snapshotTable returns clone (mutation-safe)
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const routing = require('../../../bin/steward/_lib/routing-table.cjs');

// Snapshot env keys we mutate so tests don't leak state between assertions.
const ENV_KEYS_TO_GUARD = [
  'STEWARD_ROUTING_PROFILE',
  'STEWARD_MODEL',
  'STEWARD_ROUTING_RECOMMENDATION',
  'STEWARD_ROUTING_ARCHITECTURE_REVIEW',
  'STEWARD_ROUTING_RELEASE_NOTES_DRAFTER',
  'STEWARD_ROUTING_SECURITY_REVIEW',
];

beforeEach(() => {
  for (const k of ENV_KEYS_TO_GUARD) delete process.env[k];
});

describe('routing-table: profile validation', () => {
  test('PROFILES exposes the canonical 4-tier list', () => {
    assert.deepEqual(routing.listProfiles(), ['cheap', 'balanced', 'premium', 'ensemble']);
  });

  test('isValidProfile accepts known values + rejects garbage', () => {
    for (const p of ['cheap', 'balanced', 'premium', 'ensemble']) {
      assert.ok(routing.isValidProfile(p));
    }
    assert.equal(routing.isValidProfile('foo'), false);
    assert.equal(routing.isValidProfile(''), false);
    assert.equal(routing.isValidProfile(null), false);
    assert.equal(routing.isValidProfile(undefined), false);
  });

  test('getDefaultProfile returns balanced when env unset', () => {
    assert.equal(routing.getDefaultProfile(), 'balanced');
  });

  test('getDefaultProfile honors STEWARD_ROUTING_PROFILE env', () => {
    process.env.STEWARD_ROUTING_PROFILE = 'premium';
    assert.equal(routing.getDefaultProfile(), 'premium');
  });

  test('getDefaultProfile falls back to balanced when env value is invalid', () => {
    process.env.STEWARD_ROUTING_PROFILE = 'gold-tier-bullshit';
    assert.equal(routing.getDefaultProfile(), 'balanced');
  });
});

describe('routing-table: selectModel precedence', () => {
  test('CLI override wins over everything', () => {
    process.env.STEWARD_MODEL = 'legacy-foo';
    process.env.STEWARD_ROUTING_RECOMMENDATION = 'env-kind-bar';
    const r = routing.selectModel({
      actionKind: 'recommendation',
      profile: 'balanced',
      override: 'cli-baz',
    });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'cli-baz');
    assert.equal(r.source, 'cli');
  });

  test('per-kind env override wins over legacy STEWARD_MODEL + table', () => {
    process.env.STEWARD_MODEL = 'legacy-foo';
    process.env.STEWARD_ROUTING_RECOMMENDATION = 'kind-specific';
    const r = routing.selectModel({ actionKind: 'recommendation', profile: 'balanced' });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'kind-specific');
    assert.equal(r.source, 'env-kind');
  });

  test('legacy STEWARD_MODEL wins over table when no per-kind override', () => {
    process.env.STEWARD_MODEL = 'legacy-foo';
    const r = routing.selectModel({ actionKind: 'recommendation', profile: 'balanced' });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'legacy-foo');
    assert.equal(r.source, 'env-legacy');
  });

  test('table lookup returns expected balanced default for recommendation', () => {
    const r = routing.selectModel({ actionKind: 'recommendation', profile: 'balanced' });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'deepseek/deepseek-v4-flash');
    assert.equal(r.source, 'table');
    assert.equal(r.profile, 'balanced');
  });

  test('table lookup returns expected premium for recommendation', () => {
    const r = routing.selectModel({ actionKind: 'recommendation', profile: 'premium' });
    assert.equal(r.model, 'anthropic/claude-sonnet-4.6');
  });

  test('table lookup returns expected cheap for recommendation', () => {
    const r = routing.selectModel({ actionKind: 'recommendation', profile: 'cheap' });
    assert.equal(r.model, 'google/gemini-3.1-flash-lite-preview');
  });

  test('default profile applied when not explicitly passed', () => {
    const r = routing.selectModel({ actionKind: 'recommendation' });
    assert.equal(r.profile, 'balanced');
    assert.equal(r.model, 'deepseek/deepseek-v4-flash');
  });
});

describe('routing-table: ensemble shape', () => {
  test('recommendation ensemble exposes workers + judge', () => {
    const r = routing.selectModel({ actionKind: 'recommendation', profile: 'ensemble' });
    assert.equal(r.ok, true);
    assert.ok(r.ensemble, 'ensemble shape must surface for ensemble profile');
    assert.ok(Array.isArray(r.ensemble.workers));
    assert.ok(r.ensemble.workers.length >= 2, 'ensemble needs at least 2 workers');
    // Cross-family diversity — at least 2 different vendor prefixes.
    const vendors = new Set(r.ensemble.workers.map((m) => m.split('/')[0]));
    assert.ok(vendors.size >= 2, `expected cross-family workers, got ${[...vendors].join(', ')}`);
    assert.ok(typeof r.ensemble.judge === 'string', 'ensemble judge must be a slug');
    // Primary model = first worker (caller convenience for non-ensemble dispatch).
    assert.equal(r.model, r.ensemble.workers[0]);
  });

  test('ensemble workers are returned as a copy (mutation-safe)', () => {
    const r = routing.selectModel({ actionKind: 'recommendation', profile: 'ensemble' });
    r.ensemble.workers.push('hostile-mutation');
    const r2 = routing.selectModel({ actionKind: 'recommendation', profile: 'ensemble' });
    assert.ok(!r2.ensemble.workers.includes('hostile-mutation'));
  });
});

describe('routing-table: profile allowlist', () => {
  test('release_notes_drafter cannot escalate to ensemble', () => {
    const r = routing.selectModel({ actionKind: 'release_notes_drafter', profile: 'ensemble' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'ROUTING_PROFILE_NOT_ALLOWED');
  });

  test('release_notes_drafter can use balanced', () => {
    const r = routing.selectModel({ actionKind: 'release_notes_drafter', profile: 'balanced' });
    assert.equal(r.ok, true);
    assert.equal(r.model, 'anthropic/claude-haiku-4.5');
  });

  test('isProfileAllowed default-permissive when kind not in allowlist map', () => {
    // recommendation has no entry in PROFILE_ALLOWLIST → all 4 allowed.
    for (const p of ['cheap', 'balanced', 'premium', 'ensemble']) {
      assert.ok(routing.isProfileAllowed('recommendation', p));
    }
  });

  test('isProfileAllowed rejects invalid profile string', () => {
    assert.equal(routing.isProfileAllowed('recommendation', 'gold'), false);
  });

  test('CLI override bypasses profile allowlist (operator escape hatch)', () => {
    // An operator with --model anthropic/claude-opus-4.6 should be able to
    // run release_notes_drafter on Opus despite the allowlist not exposing
    // ensemble. CLI override is documented as the "I know what I'm doing"
    // escape hatch. The allowlist gates only profile-table lookups.
    const r = routing.selectModel({
      actionKind: 'release_notes_drafter',
      profile: 'ensemble',
      override: 'anthropic/claude-opus-4.6',
    });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'cli');
    assert.equal(r.model, 'anthropic/claude-opus-4.6');
  });
});

describe('routing-table: deterministic kinds', () => {
  test('unregistered action_kind returns model:null with deterministic source', () => {
    const r = routing.selectModel({ actionKind: 'recommendation_harvest', profile: 'balanced' });
    assert.equal(r.ok, true);
    assert.equal(r.model, null);
    assert.equal(r.source, 'deterministic');
  });

  test('per-kind env override still works for deterministic kinds (escape hatch)', () => {
    // If an operator wants to force an LLM for a "deterministic" kind via
    // explicit env override, the table doesn't gate that. The execute.cjs
    // dispatch decides whether the kind even invokes the LLM path.
    process.env.STEWARD_ROUTING_RECOMMENDATION_HARVEST = 'forced-model';
    const r = routing.selectModel({ actionKind: 'recommendation_harvest', profile: 'balanced' });
    assert.equal(r.model, 'forced-model');
    assert.equal(r.source, 'env-kind');
    delete process.env.STEWARD_ROUTING_RECOMMENDATION_HARVEST;
  });
});

describe('routing-table: error paths', () => {
  test('unknown profile returns ROUTING_PROFILE_INVALID', () => {
    const r = routing.selectModel({ actionKind: 'recommendation', profile: 'gold' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'ROUTING_PROFILE_INVALID');
  });

  test('selectModel handles missing actionKind gracefully', () => {
    // No actionKind → readKindOverride returns undefined; lookup against
    // ROUTING_TABLE[undefined] returns null → deterministic.
    const r = routing.selectModel({ profile: 'balanced' });
    assert.equal(r.ok, true);
    assert.equal(r.model, null);
    assert.equal(r.source, 'deterministic');
  });
});

describe('routing-table: snapshot + immutability', () => {
  test('snapshotTable returns deep clone, mutations do not leak', () => {
    const snap = routing.snapshotTable();
    snap.recommendation.balanced = 'pwned';
    const fresh = routing.snapshotTable();
    assert.equal(fresh.recommendation.balanced, 'deepseek/deepseek-v4-flash');
    // And the live module still resolves to the canonical value.
    const r = routing.selectModel({ actionKind: 'recommendation', profile: 'balanced' });
    assert.equal(r.model, 'deepseek/deepseek-v4-flash');
  });

  test('readKindOverride normalizes non-alpha characters to underscores', () => {
    process.env.STEWARD_ROUTING_RECOMMENDATION_HARVEST = 'normalized-test';
    const v = routing.readKindOverride('recommendation-harvest');
    assert.equal(v, 'normalized-test');
    delete process.env.STEWARD_ROUTING_RECOMMENDATION_HARVEST;
  });
});

describe('routing-table: 2.0b R2 review fixes', () => {
  test('prototype-pollution guard rejects __proto__ as actionKind', () => {
    const r = routing.selectModel({ actionKind: '__proto__', profile: 'balanced' });
    // Pre-fix: `ROUTING_TABLE['__proto__']` returned Object.prototype (truthy);
    // selectModel walked entry.balanced (undefined) and emitted a confusing
    // ROUTING_TABLE_INCOMPLETE error. Post-fix: hasOwnProperty rules out
    // the prototype, so we land in the deterministic branch.
    assert.equal(r.ok, true);
    assert.equal(r.model, null);
    assert.equal(r.source, routing.ROUTING_SOURCES.DETERMINISTIC);
  });

  test('prototype-pollution guard rejects constructor / toString', () => {
    for (const k of ['constructor', 'toString', 'hasOwnProperty']) {
      const r = routing.selectModel({ actionKind: k, profile: 'balanced' });
      assert.equal(r.ok, true);
      assert.equal(r.model, null, `expected deterministic for ${k}`);
      assert.equal(r.source, 'deterministic');
    }
  });

  test('isLLMKind returns true only for routing-table-registered kinds', () => {
    assert.equal(routing.isLLMKind('recommendation'), true);
    assert.equal(routing.isLLMKind('architecture_review'), true);
    assert.equal(routing.isLLMKind('release_notes_drafter'), true);
    assert.equal(routing.isLLMKind('security_review'), true);
    // Deterministic kinds — must NOT be classified LLM.
    assert.equal(routing.isLLMKind('recommendation_harvest'), false);
    assert.equal(routing.isLLMKind('dep_update_patch'), false);
    assert.equal(routing.isLLMKind('todo_triage'), false);
    // Prototype-pollution: must NOT be classified LLM.
    assert.equal(routing.isLLMKind('__proto__'), false);
    assert.equal(routing.isLLMKind('constructor'), false);
    assert.equal(routing.isLLMKind('toString'), false);
    // Empty / null / undefined.
    assert.equal(routing.isLLMKind(''), false);
    assert.equal(routing.isLLMKind(null), false);
    assert.equal(routing.isLLMKind(undefined), false);
  });

  test('whitespace-only env values are trimmed and treated as unset', () => {
    process.env.STEWARD_ROUTING_RECOMMENDATION = '   ';
    const r = routing.selectModel({ actionKind: 'recommendation', profile: 'balanced' });
    // Pre-fix: shipped '   ' as model slug. Post-fix: falls through to table.
    assert.equal(r.source, 'table');
    assert.equal(r.model, 'deepseek/deepseek-v4-flash');
  });

  test('whitespace-only STEWARD_MODEL is trimmed and treated as unset', () => {
    process.env.STEWARD_MODEL = '   \t\n  ';
    const r = routing.selectModel({ actionKind: 'recommendation', profile: 'balanced' });
    assert.equal(r.source, 'table');
    assert.equal(r.model, 'deepseek/deepseek-v4-flash');
  });

  test('CLI override starting with -- is rejected (flag-eats-flag defense)', () => {
    const r = routing.selectModel({
      actionKind: 'recommendation',
      profile: 'balanced',
      override: '--skip-verify',
    });
    // Pre-fix: shipped '--skip-verify' as model. Post-fix: rejected → falls
    // through to table.
    assert.equal(r.source, 'table');
    assert.equal(r.model, 'deepseek/deepseek-v4-flash');
  });

  test('legacy STEWARD_MODEL is NOT honored for deterministic kinds', () => {
    // Pre-fix: STEWARD_MODEL returned a slug for unregistered kinds, breaking
    // the "no LLM call" contract. Post-fix: only honored when the kind is
    // registered in ROUTING_TABLE.
    process.env.STEWARD_MODEL = 'forced-foo';
    const r = routing.selectModel({ actionKind: 'recommendation_harvest', profile: 'balanced' });
    assert.equal(r.ok, true);
    assert.equal(r.model, null);
    assert.equal(r.source, 'deterministic');
  });

  test('legacy STEWARD_MODEL IS honored for registered LLM kinds', () => {
    process.env.STEWARD_MODEL = 'pinned-foo';
    const r = routing.selectModel({ actionKind: 'recommendation', profile: 'balanced' });
    assert.equal(r.model, 'pinned-foo');
    assert.equal(r.source, 'env-legacy');
  });

  test('model slug is clamped to 128 chars (CWE-117 log injection defense)', () => {
    const longSlug = 'a'.repeat(500);
    const r = routing.selectModel({ actionKind: 'recommendation', override: longSlug });
    assert.equal(r.ok, true);
    assert.equal(r.model.length, 128);
  });

  test('ROUTING_SOURCES is a frozen enum', () => {
    assert.equal(Object.isFrozen(routing.ROUTING_SOURCES), true);
    assert.equal(routing.ROUTING_SOURCES.CLI, 'cli');
    assert.equal(routing.ROUTING_SOURCES.ENV_KIND, 'env-kind');
    assert.equal(routing.ROUTING_SOURCES.ENV_LEGACY, 'env-legacy');
    assert.equal(routing.ROUTING_SOURCES.TABLE, 'table');
    assert.equal(routing.ROUTING_SOURCES.TABLE_FALLBACK_BALANCED, 'table-fallback-balanced');
    assert.equal(routing.ROUTING_SOURCES.DETERMINISTIC, 'deterministic');
  });

  test('selectModel with override="" falls through to env/table', () => {
    const r = routing.selectModel({
      actionKind: 'recommendation',
      profile: 'balanced',
      override: '',
    });
    assert.equal(r.source, 'table');
  });

  test('selectModel with non-string override (number, object) falls through', () => {
    for (const bad of [123, {}, [], true, null]) {
      const r = routing.selectModel({
        actionKind: 'recommendation',
        profile: 'balanced',
        override: bad,
      });
      assert.equal(r.source, 'table', `bad override ${typeof bad} should fall through`);
    }
  });
});

describe('routing-table: precedence property test', () => {
  // Property-based-style hand-rolled test (correctness-auditor MAJOR finding):
  // for every combination of CLI / kind-env / legacy-env / table-default
  // settings, the higher-priority source must win. Hand-rolled because we
  // don't depend on fast-check (zero-deps principle).

  function clear() {
    delete process.env.STEWARD_ROUTING_RECOMMENDATION;
    delete process.env.STEWARD_MODEL;
  }

  test('CLI > kind-env > legacy STEWARD_MODEL > table — exhaustive', () => {
    const setStates = [
      { cli: undefined, kind: undefined, legacy: undefined, expected: 'table' },
      { cli: undefined, kind: undefined, legacy: 'L', expected: 'env-legacy' },
      { cli: undefined, kind: 'K', legacy: undefined, expected: 'env-kind' },
      { cli: undefined, kind: 'K', legacy: 'L', expected: 'env-kind' },
      { cli: 'C', kind: undefined, legacy: undefined, expected: 'cli' },
      { cli: 'C', kind: undefined, legacy: 'L', expected: 'cli' },
      { cli: 'C', kind: 'K', legacy: undefined, expected: 'cli' },
      { cli: 'C', kind: 'K', legacy: 'L', expected: 'cli' },
    ];
    for (const state of setStates) {
      clear();
      if (state.kind !== undefined) process.env.STEWARD_ROUTING_RECOMMENDATION = state.kind;
      if (state.legacy !== undefined) process.env.STEWARD_MODEL = state.legacy;
      const r = routing.selectModel({
        actionKind: 'recommendation',
        profile: 'balanced',
        override: state.cli,
      });
      assert.equal(r.source, state.expected,
        `with cli=${state.cli} kind=${state.kind} legacy=${state.legacy}, expected source=${state.expected} got ${r.source}`);
    }
    clear();
  });

  test('precedence holds across all 4 profiles', () => {
    // Sample: CLI override wins regardless of profile.
    for (const profile of routing.listProfiles()) {
      const r = routing.selectModel({
        actionKind: 'recommendation',
        profile,
        override: 'pinned-cli',
      });
      assert.equal(r.source, 'cli');
      assert.equal(r.model, 'pinned-cli');
    }
  });
});

describe('routing-table: SSOT contract', () => {
  test('ROUTING_TABLE.recommendation has all 4 profile slots populated', () => {
    const t = routing.ROUTING_TABLE;
    assert.ok(t.recommendation.cheap);
    assert.ok(t.recommendation.balanced);
    assert.ok(t.recommendation.premium);
    assert.ok(t.recommendation.ensemble);
  });

  test('ROUTING_TABLE.recommendation.balanced matches DEFAULT_MODEL contract', () => {
    // Sprint 2.0b — routing-table is the new SSOT for the recommendation kind's
    // default model under balanced profile. The action-engine.cjs DEFAULT_MODEL
    // is a fallback when routing returns model:null (deterministic kind, but
    // engine still gets called via mock path). They MUST stay in sync — drift
    // produces silent model-substitution between routed runs and direct engine
    // calls (e.g. tests that bypass routing).
    const { DEFAULT_MODEL } = require('../../../bin/steward/_lib/action-engine.cjs');
    assert.equal(routing.ROUTING_TABLE.recommendation.balanced, DEFAULT_MODEL);
  });

  test('every premium slot avoids Opus 4.7 (tokenizer-overhead caveat)', () => {
    // R1 memo §1.3 caveat: Opus 4.7 adds ~35% input tokens per request. Use
    // 4.6 in premium until Anthropic ships parity. This test guards against
    // a future operator forgetting and pinning 4.7.
    const t = routing.ROUTING_TABLE;
    for (const kind of Object.keys(t)) {
      const slot = t[kind].premium;
      const slugs = typeof slot === 'string'
        ? [slot]
        : (slot && Array.isArray(slot.workers) ? slot.workers : []);
      for (const slug of slugs) {
        assert.ok(
          !slug.includes('opus-4.7'),
          `premium tier for ${kind} pinned Opus 4.7 — use 4.6 until tokenizer-overhead parity ships`,
        );
      }
    }
  });
});
