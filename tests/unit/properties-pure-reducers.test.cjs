// Sprint 2.21.3 MED #7 + Sprint 2.28.3 #9 — fast-check property tests on
// pure reducers per standards/correctness.md Practice 2.
//
// Targets:
//   - computePlan      (cortex-hooks-register)
//   - computePlan      (cortex-permissions-register)
//   - computeNext      (cortex-claude-md-augment)
//   - parseConfirmReply (bin/_lib/confirm.cjs — shared)
//   - normalizePermissionsField + normalizeKindList (permissions-register)
//
// Invariants asserted: idempotency, user-content preservation, roundtrip,
// no silent data loss, type guards fail closed.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fc = require('fast-check');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const hooksRegister = require(path.join(REPO_ROOT, 'bin', 'cortex-hooks-register.cjs'));
const permsRegister = require(path.join(REPO_ROOT, 'bin', 'cortex-permissions-register.cjs'));
const augment = require(path.join(REPO_ROOT, 'bin', 'cortex-claude-md-augment.cjs'));
const { parseConfirmReply } = require(path.join(REPO_ROOT, 'bin', '_lib', 'confirm.cjs'));

const RUNS = 100; // keep tests fast

describe('property: parseConfirmReply', () => {
  test('only y / yes (any case + whitespace) accept', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('y', 'yes', 'Y', 'YES', 'Yes', 'yEs'),
        fc.string({ maxLength: 10 }).filter((s) => /^[\s]*$/.test(s)),
        fc.string({ maxLength: 10 }).filter((s) => /^[\s]*$/.test(s)),
        (token, leading, trailing) => {
          assert.equal(parseConfirmReply(leading + token + trailing), true);
        }
      ),
      { numRuns: RUNS }
    );
  });

  test('non-y strings always abort', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !/^[\s]*(y|yes)[\s]*$/i.test(s)),
        (reply) => {
          assert.equal(parseConfirmReply(reply), false);
        }
      ),
      { numRuns: RUNS }
    );
  });

  test('type guard: non-string input always aborts', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer(), fc.boolean(), fc.constantFrom(null, undefined),
          fc.array(fc.integer()), fc.object()),
        (notAString) => {
          assert.equal(parseConfirmReply(notAString), false);
        }
      ),
      { numRuns: RUNS }
    );
  });
});

describe('property: normalizePermissionsField (permissions-register)', () => {
  const { normalizePermissionsField, normalizeKindList } = permsRegister;

  test('normalizePermissionsField always returns an object (never throws)', () => {
    fc.assert(
      fc.property(
        fc.anything(),
        (anything) => {
          const r = normalizePermissionsField(anything);
          assert.equal(typeof r, 'object');
          assert.ok(r !== null && !Array.isArray(r));
        }
      ),
      { numRuns: RUNS }
    );
  });

  test('normalizeKindList: only strings survive, no crash on garbage', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.string(), fc.integer(), fc.object(), fc.constantFrom(null, undefined))),
        (arr) => {
          const r = normalizeKindList(arr, { warn: false });
          assert.ok(Array.isArray(r));
          for (const v of r) {
            assert.equal(typeof v, 'string');
          }
        }
      ),
      { numRuns: RUNS }
    );
  });

  test('normalizeKindList: non-array input returns []', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.integer(), fc.object(), fc.constantFrom(null, undefined)),
        (notArray) => {
          const r = normalizeKindList(notArray, { warn: false });
          assert.deepEqual(r, []);
        }
      ),
      { numRuns: RUNS }
    );
  });
});

describe('property: computePlan idempotency (permissions-register)', () => {
  const { computePlan, CORTEX_PERMISSIONS } = permsRegister;

  test('apply is idempotent: apply(apply(x)) ⇒ same next-state', () => {
    fc.assert(
      fc.property(
        fc.record({
          allow: fc.array(fc.string({ minLength: 1, maxLength: 40 }), { maxLength: 10 }),
          deny: fc.array(fc.string({ minLength: 1, maxLength: 40 }), { maxLength: 10 }),
        }),
        (initial) => {
          const r1 = computePlan(initial, 'apply').next;
          const r2 = computePlan(r1, 'apply').next;
          // Same set of entries per kind (order may differ).
          for (const k of ['allow', 'deny']) {
            const a = (r1[k] || []).slice().sort();
            const b = (r2[k] || []).slice().sort();
            assert.deepEqual(b, a, `${k} kind not idempotent`);
          }
        }
      ),
      { numRuns: RUNS }
    );
  });

  test('user entries (not in CORTEX_PERMISSIONS) preserved across apply/remove cycle', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 40 })
          .filter((s) => !CORTEX_PERMISSIONS.allow.includes(s) && !CORTEX_PERMISSIONS.deny.includes(s)),
          { maxLength: 8 }),
        (userAllow) => {
          const initial = { allow: userAllow, deny: [] };
          const applied = computePlan(initial, 'apply').next;
          const removed = computePlan(applied, 'remove').next;
          // User entries survive both transitions (set equality, ignore order).
          const userSet = new Set(userAllow);
          for (const u of userSet) {
            assert.ok((applied.allow || []).includes(u), `user entry ${u} dropped on apply`);
            assert.ok((removed.allow || []).includes(u), `user entry ${u} dropped on remove`);
          }
        }
      ),
      { numRuns: RUNS }
    );
  });
});

describe('property: computeNext idempotency (claude-md-augment)', () => {
  const { computeNext, CORTEX_BLOCK_START, CORTEX_BLOCK_END } = augment;

  test('apply is idempotent: apply(apply(x)) byte-equal to apply(x)', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 200 }).filter((s) => !s.includes('<!--')),
        (userContent) => {
          const r1 = computeNext(userContent, 'apply');
          const r2 = computeNext(r1, 'apply');
          assert.equal(r2, r1, 'apply not idempotent');
        }
      ),
      { numRuns: RUNS }
    );
  });

  test('user content outside the block is preserved through apply/remove cycle', () => {
    fc.assert(
      fc.property(
        // Plain user text, ASCII only, no HTML comments (would tangle marker regex).
        fc.string({ maxLength: 100 })
          .filter((s) => !s.includes('<!--') && !s.includes('cortex-x'))
          .map((s) => s.trim()),
        (raw) => {
          if (raw.length === 0) return;
          const userText = raw + '\n';
          const applied = computeNext(userText, 'apply');
          const removed = computeNext(applied, 'remove');
          // Removed content must contain user's text (trimEnd handled separately).
          assert.ok(removed.includes(raw.trim()),
            `roundtrip lost user content. raw=${JSON.stringify(raw)} removed=${JSON.stringify(removed)}`);
        }
      ),
      { numRuns: RUNS }
    );
  });

  test('block markers from BEFORE the cycle survive if inside a code fence', () => {
    // Defensive: code fence content is bytes-preserved even when raw markers
    // appear inside. Sprint 2.21.3 MED #4.
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !s.includes('```')),
        (insideFence) => {
          const fenced = '```\n' + CORTEX_BLOCK_START + '\n' + insideFence + '\n' + CORTEX_BLOCK_END + '\n```\n';
          const after = computeNext(fenced, 'remove');
          assert.ok(after.includes(insideFence), 'fenced content stripped — fence safety regressed');
        }
      ),
      { numRuns: RUNS }
    );
  });
});

describe('property: hooks-register computePlan (event-set invariants)', () => {
  const { computePlan, HOOK_SPEC } = hooksRegister;

  test('apply preserves event-set: every HOOK_SPEC event present in next', () => {
    fc.assert(
      fc.property(
        // Arbitrary current hooks state with arbitrary event names.
        fc.dictionary(
          fc.constantFrom('PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'SessionStart',
            'PreCompact', 'Stop', 'SubagentStop', 'PreSubmit'),
          fc.array(fc.record({
            matcher: fc.option(fc.string({ maxLength: 10 })),
            hooks: fc.array(fc.record({
              type: fc.constant('command'),
              command: fc.string({ maxLength: 60 }),
              timeout: fc.option(fc.integer({ min: 1, max: 60 })),
            }), { maxLength: 3 }),
          }), { maxLength: 3 })
        ),
        (currentHooks) => {
          const r = computePlan(currentHooks, 'apply').next;
          for (const event of Object.keys(HOOK_SPEC)) {
            assert.ok(Array.isArray(r[event]),
              `event ${event} missing from apply result`);
          }
        }
      ),
      { numRuns: RUNS }
    );
  });
});
