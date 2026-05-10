'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

function capitalize(s) {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

describe('capitalize', () => {
  test('capitalizes first letter of lowercase word', () => {
    assert.equal(capitalize('hello'), 'Hello', 'capitalize("hello") should equal "Hello"');
  });

  test('preserves already-capitalized first letter', () => {
    assert.equal(capitalize('Hello'), 'Hello', 'capitalize("Hello") should be unchanged');
  });

  test('returns empty string unchanged', () => {
    assert.equal(capitalize(''), '', 'empty input should be unchanged');
  });
});
