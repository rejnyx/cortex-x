'use strict';

// Fixture for cortex-x senior_tester_review eval suite.
// Structure smells: conditional_test_logic + verbose_test + print_statement
// + ignored_test + generic_test_name + exception_catching_throwing +
// sensitive_equality. Expected baseline at:
// evals/senior-tester/fixtures/structure-decay/baseline.sarif.json.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

function divide(a, b) {
  if (b === 0) throw new Error('divide by zero');
  return a / b;
}

function build() {
  return { id: 1, name: 'sample', children: [{ id: 11 }, { id: 12 }] };
}

describe('structure smells', () => {
  // generic_test_name — "test1"
  test('test1', () => {
    assert.equal(divide(10, 2), 5);
  });

  // generic_test_name — "should work"
  test('should work', () => {
    assert.equal(divide(9, 3), 3);
  });

  // print_statement — console.log left in body
  test('print residue', () => {
    const obj = build();
    console.log('debug obj:', obj);
    assert.equal(obj.id, 1);
  });

  // ignored_test — .skip without reason
  test.skip('this one is broken', () => {
    assert.equal(divide(10, 0), Infinity);
  });

  // conditional_test_logic — if branching inside body
  test('branching inside test body', () => {
    const obj = build();
    if (obj.children.length > 0) {
      assert.equal(obj.children[0].id, 11);
    } else {
      assert.equal(obj.id, 1);
    }
  });

  // exception_catching_throwing — try/catch with manual fail instead of toThrow
  test('try/catch instead of toThrow', () => {
    let caught = null;
    try {
      divide(1, 0);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught);
  });

  // sensitive_equality — JSON.stringify equality
  test('compares via JSON.stringify', () => {
    const obj = build();
    assert.equal(JSON.stringify(obj), JSON.stringify({ id: 1, name: 'sample', children: [{ id: 11 }, { id: 12 }] }));
  });

  // verbose_test — body > 30 lines
  test('verbose body exceeds 30 lines threshold', () => {
    const obj = build();
    const a = obj.id;
    const b = obj.name;
    const c = obj.children;
    const d = c[0].id;
    const e = c[1].id;
    const f = a + d;
    const g = a + e;
    const h = a + d + e;
    const i = b.length;
    const j = b.toUpperCase();
    const k = b.toLowerCase();
    const l = b.split('').length;
    const m = b.indexOf('a');
    const n = b.indexOf('z');
    const o = c.length;
    const p = c.map((x) => x.id);
    const q = p.join(',');
    const r = p.reverse();
    const s = r.join('-');
    const t = c.filter((x) => x.id > 10);
    const u = t.length;
    const v = t.map((x) => x.id).join(',');
    const w = JSON.parse(JSON.stringify(obj));
    const x = Object.keys(w);
    const y = x.length;
    const z = Object.values(w);
    const aa = z.length;
    const bb = aa + y;
    assert.equal(a, 1);
    assert.equal(b, 'sample');
    assert.ok(c);
    assert.equal(d, 11);
    assert.equal(e, 12);
    assert.equal(o, 2);
    assert.equal(bb, 6);
    assert.ok(f && g && h && i && j && k && l !== undefined && m !== undefined && n !== undefined && q && s && u && v && w && x && y && z && aa);
  });
});
