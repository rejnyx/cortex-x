#!/usr/bin/env node
// verify-skills.cjs — agentskills.io spec validator for cortex-x SKILL.md files.
//
// Validates each shared/skills/<name>/SKILL.md against the canonical
// agentskills.io v1 spec (https://agentskills.io/specification, May 2026).
//
// Required frontmatter fields:
//   - name: 1-64 chars, lowercase [a-z0-9-], no leading/trailing/consecutive
//     hyphens, MUST equal parent dir name
//   - description: 1-1024 chars, non-empty
//
// Optional fields (validated when present):
//   - license, compatibility (max 500 chars), metadata (object), allowed-tools
//   - disable-model-invocation (Anthropic Claude Code extension)
//
// Body content has no required headings per the spec.
//
// Mirrors tools/verify-prompts.cjs structure: --json / --tap / --strict modes,
// exit 0 / 1 / 2 codes. Zero deps.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { stripDenylistExamples } = require('./lib/denylist-examples.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(REPO_ROOT, 'shared', 'skills');

// ── argv parsing ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { json: false, tap: false, strict: false, quiet: false, dir: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--tap') args.tap = true;
    else if (a === '--strict') args.strict = true;
    else if (a === '--quiet') args.quiet = true;
    else if (a === '--dir') args.dir = argv[++i];
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  return args;
}

function printHelp() {
  process.stdout.write(`verify-skills — validate cortex-x shared/skills/*/SKILL.md against agentskills.io spec

USAGE
  verify-skills [--strict] [--json | --tap] [--quiet]
  verify-skills --dir shared/skills/cortex-init

EXIT CODES
  0  all checks pass
  1  validation failures
  2  verifier crashed

CHECKS PERFORMED (per SKILL.md)
  1. SKILL.md present in skill dir
  2. YAML frontmatter parseable
  3. 'name:' field present, lowercase kebab, 1-64 chars
  4. 'name:' equals parent dir name (cortex-init/SKILL.md → name: cortex-init)
  5. 'description:' field present, 1-1024 chars
  6. 'compatibility:' if present, max 500 chars
  7. 'metadata:' if present, must be a YAML map (1-level nested)
  8. Body non-empty after frontmatter
  9. No PII / maintainer-specific paths in body
`);
}

// ── output helpers ──────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY === true;
const useUnicode = (isTTY && process.platform !== 'win32') || process.env.WT_SESSION;
const useColor = isTTY && !process.env.NO_COLOR;
const sym = useUnicode ? { pass: '✓', fail: '✗', warn: '⚠' } : { pass: '[OK]', fail: '[FAIL]', warn: '[WARN]' };
const color = useColor
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m` }
  : { red: (s) => s, yellow: (s) => s, green: (s) => s, dim: (s) => s };

// ── frontmatter parser (same as verify-audit-output) ────────────────────────
function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: src, hasFrontmatter: false };
  const data = {};
  let parent = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.match(/^(\s*)/)[1].length;
    const kv = raw.trim().match(/^([\w.-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, val] = kv;
    const trimmedVal = val.trim().replace(/^["']|["']$/g, '');
    if (indent === 0) {
      parent = null;
      if (val === '' || val === undefined) {
        data[key] = {};
        parent = key;
      } else {
        data[key] = trimmedVal;
      }
    } else if (parent) {
      data[parent][key] = trimmedVal;
    }
  }
  return { data, body: src.slice(m[0].length), hasFrontmatter: true };
}

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PII_DENY = [
  /\/c\/Users\/david\b/i,
  /C:\\Users\\david\b/i,
  /davidrajnoha@/i,
];

// ── validator core ──────────────────────────────────────────────────────────
class Validator {
  constructor(args) {
    this.args = args;
    this.checks = [];
  }

  push(id, severity, status, message) {
    this.checks.push({ id, severity, status, message });
  }
  pass(id, message) { this.push(id, 'blocker', 'pass', message); }
  fail(id, severity, message) { this.push(id, severity, 'fail', message); }

  listSkillDirs() {
    if (this.args.dir) return [path.resolve(this.args.dir)];
    if (!fs.existsSync(SKILLS_DIR)) return [];
    return fs
      .readdirSync(SKILLS_DIR)
      .map((name) => path.join(SKILLS_DIR, name))
      .filter((p) => fs.statSync(p).isDirectory());
  }

  validateSkill(skillDir) {
    const dirName = path.basename(skillDir);
    const skillFile = path.join(skillDir, 'SKILL.md');
    const id = `skills/${dirName}`;

    if (!fs.existsSync(skillFile)) {
      this.fail(`${id}.exists`, 'blocker', `${id}/SKILL.md: missing`);
      return;
    }
    this.pass(`${id}.exists`, `${id}/SKILL.md: present`);

    const src = fs.readFileSync(skillFile, 'utf8');
    const fm = parseFrontmatter(src);

    if (!fm.hasFrontmatter) {
      this.fail(`${id}.frontmatter`, 'blocker', `${id}/SKILL.md: no YAML frontmatter (--- block at top required)`);
      return;
    }

    // 3. name field
    if (!fm.data.name) {
      this.fail(`${id}.name`, 'blocker', `${id}/SKILL.md: missing required 'name:' field`);
    } else {
      const name = String(fm.data.name);
      if (!KEBAB_RE.test(name)) {
        this.fail(`${id}.name.format`, 'blocker', `${id}/SKILL.md: name '${name}' not kebab-case (lowercase [a-z0-9-], no leading/trailing/consecutive hyphens)`);
      } else if (name.length < 1 || name.length > 64) {
        this.fail(`${id}.name.length`, 'blocker', `${id}/SKILL.md: name length ${name.length} (must be 1-64)`);
      } else if (name !== dirName) {
        this.fail(`${id}.name.match`, 'blocker', `${id}/SKILL.md: name '${name}' must equal parent dir '${dirName}' per agentskills.io spec`);
      } else {
        this.pass(`${id}.name`, `${id}/SKILL.md: name '${name}' is valid kebab-case + matches dir`);
      }
    }

    // 5. description field
    if (!fm.data.description) {
      this.fail(`${id}.description`, 'blocker', `${id}/SKILL.md: missing required 'description:' field`);
    } else {
      const desc = String(fm.data.description);
      if (desc.length < 1) {
        this.fail(`${id}.description.empty`, 'blocker', `${id}/SKILL.md: description is empty`);
      } else if (desc.length > 1024) {
        this.fail(`${id}.description.length`, 'warning', `${id}/SKILL.md: description ${desc.length} chars exceeds 1024 limit`);
      } else if (desc.length < 30) {
        this.fail(`${id}.description.short`, 'warning', `${id}/SKILL.md: description only ${desc.length} chars — should describe both *what* and *when to use*`);
      } else {
        this.pass(`${id}.description`, `${id}/SKILL.md: description ${desc.length} chars`);
      }
    }

    // 6. compatibility (optional)
    if (fm.data.compatibility !== undefined) {
      const c = String(fm.data.compatibility);
      if (c.length > 500) {
        this.fail(`${id}.compatibility.length`, 'warning', `${id}/SKILL.md: compatibility ${c.length} chars exceeds 500 limit`);
      }
    }

    // 7. metadata (optional, Anthropic Claude Code extension)
    // parseFrontmatter returns metadata as an object if the YAML has nested
    // keys under it. Validate each value is a string scalar.
    if (fm.data.metadata !== undefined) {
      if (typeof fm.data.metadata !== 'object' || fm.data.metadata === null) {
        this.fail(`${id}.metadata.shape`, 'warning', `${id}/SKILL.md: metadata must be a YAML map (nested keys), got ${typeof fm.data.metadata}`);
      } else {
        for (const [k, v] of Object.entries(fm.data.metadata)) {
          if (typeof v !== 'string') {
            this.fail(`${id}.metadata.${k}`, 'warning', `${id}/SKILL.md: metadata.${k} must be a scalar string`);
          }
        }
      }
    }

    // Tier 8 — Anthropic Claude Code extensions (validated when present;
    // base spec stays SSOT, extensions are optional). Read the raw
    // frontmatter block directly for these because parseFrontmatter doesn't
    // know inline arrays / booleans. Trailing \n appended so multi-line
    // dash-list regex catches the final item.
    const rawFmMatch = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const rawFm = rawFmMatch ? rawFmMatch[1] + '\n' : '';

    // 7a. allowed-tools — inline array `[A, B, C]` or block-list (dash-prefixed).
    // Use [ \t]* (horizontal whitespace only) for the gap between `:` and value
    // so the regex doesn't inadvertently eat the line break.
    const allowedToolsLine = rawFm.match(/^allowed-tools:[ \t]*(.*)$/m);
    if (allowedToolsLine) {
      const val = allowedToolsLine[1].trim();
      let tools = null;
      if (val.startsWith('[') && val.endsWith(']')) {
        // inline array
        tools = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      } else if (val === '') {
        // multi-line dash list
        const block = rawFm.match(/^allowed-tools:[ \t]*\n((?:[ \t]+-[ \t]+\S+[ \t]*\n)+)/m);
        if (block) {
          tools = block[1].split('\n').map((l) => {
            const m = l.match(/^[ \t]+-[ \t]+(.+)$/);
            return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
          }).filter(Boolean);
        }
      }
      if (tools === null) {
        this.fail(`${id}.allowed-tools.shape`, 'warning', `${id}/SKILL.md: allowed-tools must be an array (inline [A, B] or dash-list)`);
      } else if (tools.length === 0) {
        this.fail(`${id}.allowed-tools.empty`, 'warning', `${id}/SKILL.md: allowed-tools is empty (omit the field instead of setting empty)`);
      } else {
        this.pass(`${id}.allowed-tools`, `${id}/SKILL.md: allowed-tools = [${tools.join(', ')}]`);
      }
    }

    // 7b. disable-model-invocation — boolean
    const disableLine = rawFm.match(/^disable-model-invocation:[ \t]*(true|false)[ \t]*$/mi);
    const disableLineUntyped = rawFm.match(/^disable-model-invocation:[ \t]*(.+?)[ \t]*$/m);
    if (disableLineUntyped && !disableLine) {
      this.fail(`${id}.disable-model-invocation.shape`, 'warning', `${id}/SKILL.md: disable-model-invocation must be 'true' or 'false', got '${disableLineUntyped[1]}'`);
    } else if (disableLine) {
      this.pass(`${id}.disable-model-invocation`, `${id}/SKILL.md: disable-model-invocation = ${disableLine[1].toLowerCase()}`);
    }

    // 7c. model — known Claude model identifier (warn-only on unknown; new
    // models ship periodically, so we don't gate on a hardcoded allowlist —
    // just check the value is a kebab-shape string)
    const modelLine = rawFm.match(/^model:[ \t]*(.+?)[ \t]*$/m);
    if (modelLine) {
      const m = modelLine[1].trim().replace(/^["']|["']$/g, '');
      if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i.test(m) || m.length > 80) {
        this.fail(`${id}.model.shape`, 'warning', `${id}/SKILL.md: model '${m}' should be a kebab-case identifier ≤80 chars (e.g. claude-sonnet-4-6, claude-haiku-4-5)`);
      } else {
        this.pass(`${id}.model`, `${id}/SKILL.md: model '${m}'`);
      }
    }

    // 7d. license — short string per agentskills.io spec (e.g. "MIT", "Apache-2.0")
    if (fm.data.license !== undefined) {
      const lic = String(fm.data.license);
      if (lic.length === 0 || lic.length > 100) {
        this.fail(`${id}.license.shape`, 'warning', `${id}/SKILL.md: license should be a short SPDX-ish identifier (1-100 chars), got ${lic.length} chars`);
      }
    }

    // 8. body non-empty
    const body = fm.body.trim();
    if (body.length < 50) {
      this.fail(`${id}.body`, 'warning', `${id}/SKILL.md: body suspiciously short (${body.length} chars after frontmatter)`);
    } else {
      this.pass(`${id}.body`, `${id}/SKILL.md: body ${body.length} chars`);
    }

    // 9. PII / the operator-path leak (skipping <!-- denylist-example --> lines)
    const srcForPii = stripDenylistExamples(src);
    let piiHits = [];
    for (const re of PII_DENY) {
      const matches = srcForPii.match(re);
      if (matches) piiHits.push(matches[0]);
    }
    if (piiHits.length > 0) {
      this.fail(`${id}.pii`, 'blocker', `${id}/SKILL.md: PII / maintainer-specific path leak: ${[...new Set(piiHits)].join(', ')}`);
    } else {
      this.pass(`${id}.pii`, `${id}/SKILL.md: no PII leak`);
    }
  }

  run() {
    const dirs = this.listSkillDirs();
    if (dirs.length === 0) {
      this.fail('inventory', 'blocker', 'no skill directories found in shared/skills/');
      return;
    }
    this.pass('inventory', `found ${dirs.length} skill directories`);
    for (const d of dirs) this.validateSkill(d);
  }

  exitCode() {
    const blockers = this.checks.filter((c) => c.severity === 'blocker' && c.status === 'fail');
    const warnings = this.checks.filter((c) => c.severity === 'warning' && c.status === 'fail');
    if (blockers.length > 0) return 1;
    if (this.args.strict && warnings.length > 0) return 1;
    return 0;
  }
}

// ── reporters (same shape as verify-prompts.cjs) ────────────────────────────
function reportPlain(v) {
  if (v.args.quiet && v.exitCode() === 0) return;
  if (!v.args.quiet) {
    process.stdout.write(`verify-skills — ${SKILLS_DIR}\n\n`);
  }
  for (const c of v.checks) {
    if (v.args.quiet && c.status === 'pass') continue;
    const symbol =
      c.status === 'pass' ? color.green(sym.pass)
      : c.severity === 'warning' ? color.yellow(sym.warn)
      : color.red(sym.fail);
    process.stdout.write(`  ${symbol} ${c.message}\n`);
  }
  const blockers = v.checks.filter((c) => c.severity === 'blocker' && c.status === 'fail').length;
  const warnings = v.checks.filter((c) => c.severity === 'warning' && c.status === 'fail').length;
  const passes = v.checks.filter((c) => c.status === 'pass').length;
  process.stdout.write(`\n`);
  if (v.exitCode() === 0) {
    process.stdout.write(color.green(`  ${sym.pass} Skills PASSED`));
    process.stdout.write(`  (${passes} pass, ${warnings} warn)\n`);
  } else {
    process.stderr.write(color.red(`  ${sym.fail} Skills FAILED`));
    process.stderr.write(`  (${blockers} blocker, ${warnings} warn)\n`);
  }
}

function reportJson(v) {
  const blockers = v.checks.filter((c) => c.severity === 'blocker' && c.status === 'fail').length;
  const warnings = v.checks.filter((c) => c.severity === 'warning' && c.status === 'fail').length;
  const passes = v.checks.filter((c) => c.status === 'pass').length;
  process.stdout.write(JSON.stringify({
    status: v.exitCode() === 0 ? 'pass' : 'fail',
    counts: { pass: passes, blocker: blockers, warning: warnings },
    checks: v.checks,
  }, null, 2) + '\n');
}

function reportTap(v) {
  process.stdout.write(`TAP version 14\n`);
  process.stdout.write(`1..${v.checks.length}\n`);
  v.checks.forEach((c, i) => {
    const ok = c.status === 'pass' ? 'ok' : 'not ok';
    process.stdout.write(`${ok} ${i + 1} - ${c.id}: ${c.message}\n`);
  });
}

// ── main ────────────────────────────────────────────────────────────────────
function main() {
  try {
    const args = parseArgs(process.argv);
    const v = new Validator(args);
    v.run();
    if (args.json) reportJson(v);
    else if (args.tap) reportTap(v);
    else reportPlain(v);
    process.exit(v.exitCode());
  } catch (e) {
    process.stderr.write(`verify-skills crashed: ${e.message}\n${e.stack}\n`);
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = { Validator, parseFrontmatter };
