'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { add } = require('../src/index.js');

test('add(2, 3) === 5', () => {
  assert.equal(add(2, 3), 5);
});

test('add is commutative', () => {
  assert.equal(add(2, 3), add(3, 2));
});
