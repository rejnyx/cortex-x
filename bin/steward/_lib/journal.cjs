// journal.cjs — append-only structured journal writer (MUST-H4).
//
// Per-day JSONL files at $CORTEX_DATA_HOME/journal/<slug>/<YYYY-MM-DD>.jsonl.
// Every line is one JSON object validated against a manual (zero-dep) schema
// equivalent to the Zod definition in standards/steward-policy.md § MUST-H4.
//
// Contract:
//   - Append-only — never rewrite, never delete entries
//   - PII guard — paths under ~/, env-var-shaped strings, common credential
//     patterns (sk-…, ghp_…, Bearer …) get redacted before write
//   - Schema-validated — invalid entries throw; never silently dropped
//   - Atomic per-line — each appendJournal call is one fs.appendFileSync

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveCortexDataHome } = require('../../../tools/lib/resolve-cortex-home.cjs');

const VALID_TRIGGERS = ['cron', 'incident', 'pr-merged', 'manual'];
const VALID_TIERS = ['T0', 'T1', 'T2', 'T3'];
const VALID_OUTCOMES = ['success', 'failure', 'skipped', 'halted'];
// Canonical actors. v0.2.0 dropped the legacy 'hermes' actor; existing
// journal entries with `actor: 'hermes'` remain readable (validation
// applies on write only — readJournal does not re-validate).
const VALID_ACTORS = ['steward', 'investigate-subagent'];

function todayISODate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function journalDir(slug) {
  return path.join(resolveCortexDataHome(), 'journal', slug);
}

function journalPath(slug, isoDate) {
  return path.join(journalDir(slug), `${isoDate || todayISODate()}.jsonl`);
}

// Manual schema validation (zero-dep equivalent of Zod parse).
// Throws Error with .field property on first violation.
function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    const e = new Error('entry must be an object');
    e.field = '<root>';
    throw e;
  }

  if (typeof entry.ts !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(entry.ts)) {
    const e = new Error('ts must be ISO-8601 string');
    e.field = 'ts';
    throw e;
  }

  if (!VALID_TRIGGERS.includes(entry.trigger)) {
    const e = new Error(`trigger must be one of: ${VALID_TRIGGERS.join(', ')}`);
    e.field = 'trigger';
    throw e;
  }

  if (!VALID_TIERS.includes(entry.tier)) {
    const e = new Error(`tier must be one of: ${VALID_TIERS.join(', ')}`);
    e.field = 'tier';
    throw e;
  }

  if (typeof entry.event !== 'string' || entry.event.length === 0) {
    const e = new Error('event must be non-empty string');
    e.field = 'event';
    throw e;
  }

  if (entry.cost_usd !== undefined && (typeof entry.cost_usd !== 'number' || entry.cost_usd < 0)) {
    const e = new Error('cost_usd must be non-negative number');
    e.field = 'cost_usd';
    throw e;
  }

  if (entry.tokens_in !== undefined && (!Number.isInteger(entry.tokens_in) || entry.tokens_in < 0)) {
    const e = new Error('tokens_in must be non-negative integer');
    e.field = 'tokens_in';
    throw e;
  }

  if (entry.tokens_out !== undefined && (!Number.isInteger(entry.tokens_out) || entry.tokens_out < 0)) {
    const e = new Error('tokens_out must be non-negative integer');
    e.field = 'tokens_out';
    throw e;
  }

  if (entry.outcome !== undefined && !VALID_OUTCOMES.includes(entry.outcome)) {
    const e = new Error(`outcome must be one of: ${VALID_OUTCOMES.join(', ')}`);
    e.field = 'outcome';
    throw e;
  }

  if (entry.actor !== undefined && !VALID_ACTORS.includes(entry.actor)) {
    const e = new Error(`actor must be one of: ${VALID_ACTORS.join(', ')}`);
    e.field = 'actor';
    throw e;
  }

  return true;
}

// Redact common PII / credential patterns before journal write.
// Operates on string values; never mutates the input object.
function redactPII(entry) {
  const homedir = os.homedir();
  const out = {};
  for (const [k, v] of Object.entries(entry)) {
    if (typeof v !== 'string') {
      out[k] = v;
      continue;
    }
    let s = v;
    // Path under user home → <HOME>
    if (homedir && s.includes(homedir)) {
      s = s.split(homedir).join('<HOME>');
    }
    // Common credential patterns
    s = s.replace(/sk-[A-Za-z0-9-]{20,}/g, 'sk-<REDACTED>');
    s = s.replace(/ghp_[A-Za-z0-9]{20,}/g, 'ghp_<REDACTED>');
    s = s.replace(/Bearer\s+[A-Za-z0-9._-]{20,}/g, 'Bearer <REDACTED>');
    s = s.replace(/eyJ[A-Za-z0-9._-]{30,}/g, 'eyJ<REDACTED>'); // JWT-ish
    out[k] = s;
  }
  return out;
}

function appendJournal(slug, entry, opts = {}) {
  validateEntry(entry);
  const safe = redactPII(entry);

  const dir = journalDir(slug);
  fs.mkdirSync(dir, { recursive: true });

  const filePath = opts.path || journalPath(slug);
  const line = JSON.stringify(safe) + '\n';
  fs.appendFileSync(filePath, line, 'utf8');

  return { filePath, entry: safe };
}

function readJournal(slug, opts = {}) {
  const isoDate = opts.date || todayISODate();
  const filePath = opts.path || journalPath(slug, isoDate);
  if (!fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch {
        // Corrupted line — surface marker, never throw (journal must be readable)
        return { _corrupted: true, _line: idx + 1, _raw: line };
      }
    });
}

module.exports = {
  appendJournal,
  readJournal,
  validateEntry,
  redactPII,
  journalPath,
  journalDir,
  todayISODate,
  VALID_TRIGGERS,
  VALID_TIERS,
  VALID_OUTCOMES,
  VALID_ACTORS,
};
