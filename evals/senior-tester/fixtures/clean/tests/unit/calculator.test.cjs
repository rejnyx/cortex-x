'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

function add(a, b) { return a + b; }
function multiply(a, b) { return a * b; }

describe('calculator add', () => {
  test('adds two positive integers and returns their sum', () => {
    const result = add(2, 3);
    assert.equal(result, 5, 'add(2, 3) should equal 5');
  });

  test('adds zero as identity element', () => {
    const result = add(7, 0);
    assert.equal(result, 7, 'add(x, 0) should equal x');
  });

  test('adds negative numbers correctly', () => {
    const result = add(-3, -4);
    assert.equal(result, -7, 'add(-3, -4) should equal -7');
  });
});

describe('calculator multiply', () => {
  test('multiplies two positive integers and returns the product', () => {
    const result = multiply(4, 5);
    assert.equal(result, 20, 'multiply(4, 5) should equal 20');
  });

  test('multiplies by zero and returns zero', () => {
    const result = multiply(7, 0);
    assert.equal(result, 0, 'multiply(x, 0) should equal 0');
  });
});
