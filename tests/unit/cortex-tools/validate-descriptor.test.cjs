'use strict';

// Sprint 2.9 — descriptor validator tests.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  validateDescriptor,
  validateAll,
  CODES,
} = require('../../../bin/cortex/tools/_lib/validate-descriptor.cjs');

function validDescriptor(overrides) {
  return Object.assign({
    name: 'sample',
    description: 'sample tool description (10+ chars)',
    inputSchema: {
      type: 'object',
      properties: { foo: { type: 'string', description: 'foo desc' } },
      required: ['foo'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async () => ({ ok: true }),
  }, overrides || {});
}

describe('validateDescriptor — happy path', () => {
  test('valid descriptor passes', () => {
    const r = validateDescriptor(validDescriptor());
    assert.equal(r.ok, true);
  });
});

describe('validateDescriptor — name', () => {
  test('rejects non-string name', () => {
    const r = validateDescriptor(validDescriptor({ name: 42 }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_NAME_INVALID);
  });
  test('rejects uppercase name', () => {
    const r = validateDescriptor(validDescriptor({ name: 'Read' }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_NAME_INVALID);
  });
  test('rejects name with spaces', () => {
    const r = validateDescriptor(validDescriptor({ name: 'my tool' }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_NAME_INVALID);
  });
  test('rejects name >32 chars', () => {
    const r = validateDescriptor(validDescriptor({ name: 'a'.repeat(33) }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_NAME_INVALID);
  });
  test('accepts kebab-case', () => {
    assert.equal(validateDescriptor(validDescriptor({ name: 'foo-bar' })).ok, true);
  });
  test('accepts underscore + digits', () => {
    assert.equal(validateDescriptor(validDescriptor({ name: 'tool_2' })).ok, true);
  });
  test('filename mismatch detected when expectedFilename passed', () => {
    const r = validateDescriptor(validDescriptor({ name: 'read' }), { expectedFilename: 'write.cjs' });
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_FILENAME_MISMATCH);
  });
  test('filename match accepted', () => {
    const r = validateDescriptor(validDescriptor({ name: 'read' }), { expectedFilename: 'read.cjs' });
    assert.equal(r.ok, true);
  });
});

describe('validateDescriptor — description', () => {
  test('rejects short description', () => {
    const r = validateDescriptor(validDescriptor({ description: 'too short' }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_DESCRIPTION_TOO_SHORT);
  });
  test('rejects non-string description', () => {
    const r = validateDescriptor(validDescriptor({ description: null }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_DESCRIPTION_TOO_SHORT);
  });
});

describe('validateDescriptor — inputSchema', () => {
  test('rejects missing additionalProperties:false', () => {
    const r = validateDescriptor(validDescriptor({
      inputSchema: { type: 'object', properties: { foo: { type: 'string', description: 'd' } }, required: [] },
    }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_INPUT_SCHEMA_INVALID);
  });
  test('rejects type not object', () => {
    const r = validateDescriptor(validDescriptor({
      inputSchema: { type: 'string', additionalProperties: false, properties: {}, required: [] },
    }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_INPUT_SCHEMA_INVALID);
  });
  test('rejects property missing description', () => {
    const r = validateDescriptor(validDescriptor({
      inputSchema: {
        type: 'object',
        properties: { foo: { type: 'string' } },
        required: [],
        additionalProperties: false,
      },
    }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_PROPERTY_MISSING_DESCRIPTION);
  });
  test('rejects $ref in schema', () => {
    const r = validateDescriptor(validDescriptor({
      inputSchema: {
        type: 'object',
        properties: { foo: { '$ref': '#/defs/Foo', description: 'd' } },
        required: [],
        additionalProperties: false,
      },
    }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_INPUT_SCHEMA_INVALID);
  });
  test('rejects required not array', () => {
    const r = validateDescriptor(validDescriptor({
      inputSchema: {
        type: 'object',
        properties: { foo: { type: 'string', description: 'd' } },
        required: 'foo',
        additionalProperties: false,
      },
    }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_INPUT_SCHEMA_INVALID);
  });
});

describe('validateDescriptor — annotations', () => {
  test('rejects missing annotation key', () => {
    const r = validateDescriptor(validDescriptor({
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true /* openWorldHint missing */ },
    }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_ANNOTATIONS_MISSING);
  });
  test('rejects non-boolean annotation', () => {
    const r = validateDescriptor(validDescriptor({
      annotations: { readOnlyHint: 'yes', destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_ANNOTATIONS_MISSING);
  });
  test('rejects readOnlyHint=true + destructiveHint=true (inconsistent)', () => {
    const r = validateDescriptor(validDescriptor({
      annotations: { readOnlyHint: true, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_ANNOTATION_INCONSISTENT);
  });
  test('warns on destructive name + destructiveHint=false', () => {
    const r = validateDescriptor(validDescriptor({
      name: 'delete-thing',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }));
    assert.equal(r.ok, true);
    assert.ok(r.warnings && r.warnings.length > 0);
    assert.equal(r.warnings[0].kind, 'name_annotation_mismatch');
  });
});

describe('validateDescriptor — handler', () => {
  test('rejects missing handler', () => {
    const desc = validDescriptor();
    delete desc.handler;
    const r = validateDescriptor(desc);
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_HANDLER_MISSING);
  });
  test('rejects non-function handler', () => {
    const r = validateDescriptor(validDescriptor({ handler: 'not a function' }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_HANDLER_NOT_ASYNC);
  });

  test('Sprint 2.9 R2 fix: rejects sync function handler (was tautology)', () => {
    const syncHandler = function syncFn() { return Promise.resolve({ ok: true }); };
    const r = validateDescriptor(validDescriptor({ handler: syncHandler }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_HANDLER_NOT_ASYNC);
  });

  test('Sprint 2.9 R2 fix: accepts AsyncFunction strictly', () => {
    const asyncHandler = async function asyncFn() { return { ok: true }; };
    const r = validateDescriptor(validDescriptor({ handler: asyncHandler }));
    assert.equal(r.ok, true);
  });
});

describe('validateDescriptor — $ref walker (Sprint 2.9 R2 fix blind HIGH)', () => {
  test('rejects $ref as a key in inputSchema property', () => {
    const r = validateDescriptor(validDescriptor({
      inputSchema: {
        type: 'object',
        properties: { foo: { '$ref': '#/defs/Foo', description: 'd' } },
        required: [],
        additionalProperties: false,
      },
    }));
    assert.equal(r.ok, false);
    assert.equal(r.code, CODES.TOOL_INPUT_SCHEMA_INVALID);
  });

  test('Sprint 2.9 R2 fix: does NOT false-positive on enum value containing "$ref" string', () => {
    const r = validateDescriptor(validDescriptor({
      inputSchema: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['$ref', 'inline'],
            description: 'inputSchema mode flag',
          },
        },
        required: ['mode'],
        additionalProperties: false,
      },
    }));
    assert.equal(r.ok, true, '$ref as enum value should not trip the walker');
  });
});

describe('validateAll', () => {
  test('detects duplicate names', () => {
    const a = validDescriptor({ name: 'dup' });
    const b = validDescriptor({ name: 'dup' });
    const r = validateAll([a, b]);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.message.includes('duplicate')));
  });
  test('aggregates per-descriptor errors', () => {
    const r = validateAll([
      validDescriptor({ name: 'OK1' }),  // invalid uppercase
      validDescriptor(),                  // valid
    ]);
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 1);
    assert.equal(r.errors[0].descriptorName, 'OK1');
  });
  test('rejects non-array input', () => {
    const r = validateAll('not array');
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
  });
});

describe('Sprint 2.9 palette — eager validation at index load', () => {
  test('all 6 shipped tools pass validation', () => {
    const palette = require('../../../bin/cortex/tools/index.cjs');
    assert.equal(palette.TOOLS.length, 6);
    const r = validateAll(palette.TOOLS);
    // May have warnings (write/edit/delete name patterns) but must be ok=true.
    assert.equal(r.ok, true);
  });

  test('Sprint 2.9 R2 fix: filename match check enforced for shipped palette', () => {
    // Each tool's name must match its module filename (validated eagerly
    // by index.cjs validatePaletteAtLoad — if this changed, that throws at require).
    const palette = require('../../../bin/cortex/tools/index.cjs');
    const expected = ['read', 'write', 'edit', 'glob', 'grep', 'bash'];
    for (const name of expected) {
      assert.ok(palette.TOOL_BY_NAME[name], `tool ${name} present in palette`);
      assert.equal(palette.TOOL_BY_NAME[name].name, name);
    }
  });
});
