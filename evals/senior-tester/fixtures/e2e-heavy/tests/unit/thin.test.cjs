'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe('thin unit layer', () => {
  test('only one unit test exists in this fixture', () => {
    assert.equal(1 + 1, 2, 'sanity arithmetic');
  });
});
