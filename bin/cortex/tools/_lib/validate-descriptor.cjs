'use strict';

// Sprint 2.9 — cortex-x tool descriptor validator.
// Pure logic; zero deps; spec at bin/cortex/tools/_spec.md.

const NAME_REGEX = /^[a-z0-9_-]{1,32}$/;
const MIN_DESCRIPTION_LENGTH = 10;

const REQUIRED_ANNOTATION_KEYS = Object.freeze([
  'readOnlyHint',
  'destructiveHint',
  'idempotentHint',
  'openWorldHint',
]);

// Tools with these name patterns SHOULD have destructiveHint=true.
// Validator emits warning (not error) if mismatch — allows escape hatch
// for read-only `read-write-permissions` style tools that defy convention.
const DESTRUCTIVE_NAME_PATTERN = /(write|edit|delete|remove|drop|truncate|destroy)/;

// Field codes for { ok: false, code, message, field } returns.
const CODES = Object.freeze({
  TOOL_DESCRIPTOR_MALFORMED: 'TOOL_DESCRIPTOR_MALFORMED',
  TOOL_NAME_INVALID: 'TOOL_NAME_INVALID',
  TOOL_DESCRIPTION_TOO_SHORT: 'TOOL_DESCRIPTION_TOO_SHORT',
  TOOL_INPUT_SCHEMA_INVALID: 'TOOL_INPUT_SCHEMA_INVALID',
  TOOL_PROPERTY_MISSING_DESCRIPTION: 'TOOL_PROPERTY_MISSING_DESCRIPTION',
  TOOL_ANNOTATIONS_MISSING: 'TOOL_ANNOTATIONS_MISSING',
  TOOL_ANNOTATION_INCONSISTENT: 'TOOL_ANNOTATION_INCONSISTENT',
  TOOL_HANDLER_MISSING: 'TOOL_HANDLER_MISSING',
  TOOL_HANDLER_NOT_ASYNC: 'TOOL_HANDLER_NOT_ASYNC',
  TOOL_FILENAME_MISMATCH: 'TOOL_FILENAME_MISMATCH',
});

function fail(code, message, field) {
  return { ok: false, code, message, field };
}

function ok(warnings) {
  if (warnings && warnings.length > 0) return { ok: true, warnings };
  return { ok: true };
}

// Sprint 2.9 R2 fix (blind HIGH + correctness LOW): strict check.
// Previous v0 was a tautology — accepted any function. Now: reject sync
// functions explicitly. Plain functions returning Promise are still accepted
// because the wrapper-pattern (fn that builds + returns a Promise) is common,
// but the function MUST be marked async OR pass a runtime probe.
function isAsyncFunction(fn) {
  if (typeof fn !== 'function') return false;
  if (fn.constructor && fn.constructor.name === 'AsyncFunction') return true;
  return false;
}

// Recursively look for any KEY named '$ref' anywhere in the schema.
// Sprint 2.9 R2 fix (blind HIGH): JSON.stringify-includes was false-positive
// on values that happened to contain the literal "$ref" (e.g. enum entries).
function containsRefKey(value) {
  if (Array.isArray(value)) {
    for (const v of value) if (containsRefKey(v)) return true;
    return false;
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      if (k === '$ref') return true;
      if (containsRefKey(value[k])) return true;
    }
  }
  return false;
}

// Walk inputSchema.properties and verify each has a description.
function checkPropertyDescriptions(properties, parentField) {
  if (!properties || typeof properties !== 'object') return null;
  const missing = [];
  for (const [name, def] of Object.entries(properties)) {
    if (!def || typeof def !== 'object') {
      missing.push(name);
      continue;
    }
    if (typeof def.description !== 'string' || def.description.length === 0) {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    return fail(
      CODES.TOOL_PROPERTY_MISSING_DESCRIPTION,
      `inputSchema property missing description: ${missing.join(', ')}`,
      `${parentField}.properties`,
    );
  }
  return null;
}

// validateDescriptor — main entry. Returns { ok: true } | { ok: true, warnings: [...] }
// | { ok: false, code, message, field }.
//
// expectedFilename (optional): if provided, validates `name` matches filename
// without `.cjs` extension. Skip for in-memory descriptor tests.
function validateDescriptor(descriptor, options) {
  options = options || {};
  const expectedFilename = options.expectedFilename;

  // 1. Top-level shape.
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    return fail(CODES.TOOL_DESCRIPTOR_MALFORMED, 'descriptor must be an object', '<root>');
  }

  // 2. Name.
  if (typeof descriptor.name !== 'string' || !NAME_REGEX.test(descriptor.name)) {
    return fail(
      CODES.TOOL_NAME_INVALID,
      `name must match /^[a-z0-9_-]{1,32}$/, got: ${JSON.stringify(descriptor.name)}`,
      'name',
    );
  }

  // 3. Filename match (if expectedFilename provided).
  if (expectedFilename) {
    const stripped = expectedFilename.replace(/\.cjs$/, '');
    if (stripped !== descriptor.name) {
      return fail(
        CODES.TOOL_FILENAME_MISMATCH,
        `filename "${expectedFilename}" does not match name "${descriptor.name}"`,
        'name',
      );
    }
  }

  // 4. Description.
  if (typeof descriptor.description !== 'string' || descriptor.description.length < MIN_DESCRIPTION_LENGTH) {
    return fail(
      CODES.TOOL_DESCRIPTION_TOO_SHORT,
      `description must be string of length >= ${MIN_DESCRIPTION_LENGTH}`,
      'description',
    );
  }

  // 5. inputSchema.
  const schema = descriptor.inputSchema;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return fail(CODES.TOOL_INPUT_SCHEMA_INVALID, 'inputSchema must be an object', 'inputSchema');
  }
  if (schema.type !== 'object') {
    return fail(
      CODES.TOOL_INPUT_SCHEMA_INVALID,
      `inputSchema.type must be "object", got ${JSON.stringify(schema.type)}`,
      'inputSchema.type',
    );
  }
  if (schema.additionalProperties !== false) {
    return fail(
      CODES.TOOL_INPUT_SCHEMA_INVALID,
      'inputSchema.additionalProperties must be false (prevents arg smuggling)',
      'inputSchema.additionalProperties',
    );
  }
  if (!Array.isArray(schema.required)) {
    return fail(
      CODES.TOOL_INPUT_SCHEMA_INVALID,
      'inputSchema.required must be an array (use [] if no required fields)',
      'inputSchema.required',
    );
  }
  // Properties must be present (can be empty object).
  if (!schema.properties || typeof schema.properties !== 'object') {
    return fail(
      CODES.TOOL_INPUT_SCHEMA_INVALID,
      'inputSchema.properties must be an object',
      'inputSchema.properties',
    );
  }
  // Every property has description.
  const propCheck = checkPropertyDescriptions(schema.properties, 'inputSchema');
  if (propCheck) return propCheck;
  // Sprint 2.9 R2 fix (blind HIGH-$ref-false-positive): walk the schema
  // looking for any KEY named '$ref'; ignore values like enum: ["$ref"].
  if (containsRefKey(schema)) {
    return fail(
      CODES.TOOL_INPUT_SCHEMA_INVALID,
      'inputSchema must not use $ref keys (validator is shallow); inline the schema',
      'inputSchema',
    );
  }

  // 6. Annotations — all 4 required, all booleans.
  const ann = descriptor.annotations;
  if (!ann || typeof ann !== 'object' || Array.isArray(ann)) {
    return fail(
      CODES.TOOL_ANNOTATIONS_MISSING,
      'annotations object required',
      'annotations',
    );
  }
  for (const key of REQUIRED_ANNOTATION_KEYS) {
    if (typeof ann[key] !== 'boolean') {
      return fail(
        CODES.TOOL_ANNOTATIONS_MISSING,
        `annotations.${key} must be boolean (got ${JSON.stringify(ann[key])})`,
        `annotations.${key}`,
      );
    }
  }
  // Cross-check: readOnlyHint=true && destructiveHint=true is contradictory.
  if (ann.readOnlyHint === true && ann.destructiveHint === true) {
    return fail(
      CODES.TOOL_ANNOTATION_INCONSISTENT,
      'annotations.readOnlyHint and annotations.destructiveHint cannot both be true',
      'annotations',
    );
  }

  // 7. Handler.
  if (descriptor.handler === undefined || descriptor.handler === null) {
    return fail(CODES.TOOL_HANDLER_MISSING, 'handler function required', 'handler');
  }
  if (!isAsyncFunction(descriptor.handler)) {
    return fail(
      CODES.TOOL_HANDLER_NOT_ASYNC,
      'handler must be async function (constructor.name === "AsyncFunction")',
      'handler',
    );
  }

  // 8. Soft warnings — destructive name pattern vs. annotation.
  const warnings = [];
  if (DESTRUCTIVE_NAME_PATTERN.test(descriptor.name) && ann.destructiveHint === false) {
    warnings.push({
      kind: 'name_annotation_mismatch',
      message: `name "${descriptor.name}" matches destructive pattern but destructiveHint=false`,
    });
  }

  return ok(warnings);
}

// Validate an array of descriptors (e.g. when loading the whole palette).
// Returns { ok: true, warnings? } | { ok: false, errors: [...] } where each
// error includes which descriptor failed.
function validateAll(descriptors) {
  if (!Array.isArray(descriptors)) {
    return { ok: false, errors: [{ code: CODES.TOOL_DESCRIPTOR_MALFORMED, message: 'expected array' }] };
  }
  const errors = [];
  const warnings = [];
  const seenNames = new Set();
  for (const d of descriptors) {
    const result = validateDescriptor(d);
    if (!result.ok) {
      errors.push({ ...result, descriptorName: d && d.name });
    } else {
      // Duplicate-name detection.
      if (seenNames.has(d.name)) {
        errors.push({
          code: CODES.TOOL_DESCRIPTOR_MALFORMED,
          message: `duplicate descriptor name: ${d.name}`,
          field: 'name',
          descriptorName: d.name,
        });
      } else {
        seenNames.add(d.name);
      }
      if (result.warnings) {
        for (const w of result.warnings) warnings.push({ ...w, descriptorName: d.name });
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  if (warnings.length > 0) return { ok: true, warnings };
  return { ok: true };
}

module.exports = {
  validateDescriptor,
  validateAll,
  CODES,
  NAME_REGEX,
  MIN_DESCRIPTION_LENGTH,
  REQUIRED_ANNOTATION_KEYS,
};
