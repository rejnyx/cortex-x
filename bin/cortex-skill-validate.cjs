#!/usr/bin/env node
// bin/cortex-skill-validate.cjs — Sprint 2.22 v0 skill-quality validator
//
// 3-tier model:
//   Tier A (FAIL) — agentskills.io spec violations: name regex, length caps,
//                   missing required fields, ≤500 lines body, no Windows paths.
//   Tier B (WARN) — Claude-Code-only constraints (only with --target claude-code):
//                   combined description+when_to_use ≤1536 chars, no reserved
//                   words 'anthropic'/'claude' in name, no XML tags, MCP refs
//                   use ServerName:tool form, 3rd-person description heuristic.
//   Tier C (SCORE) — cortex-opinion: description verb-first + trigger-last,
//                    no cortex-internal jargon, imperative body density.
//
// Plus --security mode: regex-scan SKILL.md + bundled scripts for ToxicSkills
// payload classes (credential env vars, base64-decode-exec, password archives,
// outbound curl/wget with $(...) interpolations). Warn-only; user decides.
//
// Rationale + citations per rule per R1 memo
// docs/research/sprint-2.22-skill-quality-2026-05-14.md. cortex-x deliberately
// does NOT reimplement spec-conformance lint — agnix (414 rules, npm) covers
// that. cortex-skill-validate runs AFTER agnix as the cortex-opinion layer.
//
// Usage:
//   cortex-skill-validate                                  # validate cortex's own skills
//   cortex-skill-validate --dir=/path/to/skill            # single skill
//   cortex-skill-validate --skills-root=/path/to/skills   # all SKILL.md in tree
//   cortex-skill-validate --target=agentskills            # spec-only (skip Tier B)
//   cortex-skill-validate --target=claude-code            # default
//   cortex-skill-validate --security                      # ToxicSkills regex scan
//   cortex-skill-validate --json                          # machine-readable
//   cortex-skill-validate --min-score=80                  # exit 1 if any below
//
// Exit codes:
//   0  all skills clean (Tier A + B clean; Tier C above --min-score)
//   1  at least one Tier A FAIL or below --min-score
//   2  internal error

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE_BYTES = 256 * 1024;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;                   // agentskills.io spec
const MAX_DESC_PLUS_WHEN = 1536;                // Claude Code combined listing budget
const MAX_BODY_LINES = 500;                     // agentskills.io spec body cap
const NAME_REGEX = /^[a-z0-9](?:-?[a-z0-9]+)*$/;
const RESERVED_NAME_TOKENS = ['anthropic', 'claude'];

// ToxicSkills payload regexes — sources: Snyk ToxicSkills Feb 2026 +
// agensi crisis briefing. False positives expected; warn-only.
const TOXIC_PATTERNS = [
  {
    id: 'TOXIC_CREDENTIAL_EXFIL',
    re: /\$(ANTHROPIC_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY)/,
    why: 'References credential env var. Skills must never echo or transmit secrets.',
    cite: 'https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/',
  },
  {
    id: 'TOXIC_CRED_PATH',
    re: /~\/(\.aws\/credentials|\.ssh\/id_[a-z]+|\.config\/gcloud)/,
    why: 'Reads cloud/SSH credentials path. ToxicSkills attack class #2.',
    cite: 'https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/',
  },
  {
    id: 'TOXIC_BASE64_EXEC',
    re: /base64\s+-d\s*\|\s*(sh|bash)|echo\s+[^\s]+\s*\|\s*base64\s+-d\s*\|\s*(sh|bash)/,
    why: 'Decode-and-execute pattern. Common obfuscation in malicious skills.',
    cite: 'https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/',
  },
  {
    id: 'TOXIC_EVAL_CURL',
    re: /eval\s+\$\(\s*curl\s+/,
    why: 'eval $(curl ...) — remote code execution pattern.',
    cite: 'https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/',
  },
  {
    id: 'TOXIC_OUTBOUND_EXFIL',
    re: /curl\s+[^\n]*\?(data|token|secret|key|cred)=\$\(/,
    why: 'Outbound curl with command-substituted query-string exfiltration.',
    cite: 'https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/',
  },
  {
    id: 'TOXIC_PASSWORD_ARCHIVE',
    re: /(unzip\s+-P|7z\s+x\s+-p)/,
    why: 'Password-protected archive extraction. Evades static scanners.',
    cite: 'https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/',
  },
  {
    id: 'TOXIC_SETTINGS_TAMPER',
    re: /(rm\s+(-rf?\s+)?~\/\.claude\/|sed\s+-i[^\n]*~\/\.claude\/settings\.json)/,
    why: 'Modifies or removes Claude Code settings. Security-mechanism disablement.',
    cite: 'https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/',
  },
];

// Cortex-internal jargon that should not appear in user-facing skill descriptions
// (per memory feedback_no_internal_jargon_in_user_prompts)
const CORTEX_JARGON = ['action_kind', 'spec-verifier', 'STEWARD_HALT', 'edit_ops', 'EX_TEMPFAIL'];

// Reserved frontmatter keys that must remain strings — never coerce to bool.
const STRING_ONLY_KEYS = new Set(['name', 'description', 'when_to_use']);

// R2 security HIGH-1: per-line length guard for ToxicSkills scan to prevent
// ReDoS on pathological inputs. Lines beyond this are skipped (security scan
// is warn-only by design; missing a payload buried in a 5KB single line is
// acceptable vs stalling the validator on adversarial input).
const SCAN_LINE_BYTES = 4096;

// R2 edge-case HIGH-2: distinguish absent (undefined) from empty value (null).
// Lets main() reject `--min-score=` (empty) as a typo instead of silently 0.
// Also warns on duplicate flags so an operator typing `--target=spec --target=cc` knows the second wins.
function flag(name, args) {
  const matches = [];
  args.forEach((a, i) => {
    if (a === `--${name}` || a.startsWith(`--${name}=`)) matches.push(i);
  });
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    process.stderr.write(`Warning: --${name} specified ${matches.length} times; using last\n`);
  }
  const idx = matches[matches.length - 1];
  const eq = args[idx].indexOf('=');
  if (eq >= 0) {
    const value = args[idx].slice(eq + 1);
    return value === '' ? null : value;
  }
  const next = args[idx + 1];
  if (next === undefined || next.startsWith('--')) return undefined;
  return next;
}

function parseFrontmatter(content) {
  // Minimal YAML-block parser — only top-level scalar key: value pairs.
  // SKILL.md frontmatter never needs nested structures per agentskills.io spec.
  // R2 HIGH-2 (correctness): normalize BOM + CRLF first so Windows-authored
  // skills aren't silently rejected. R2 MED-2 (security): require fence
  // terminator on its own line via `\n---\n` lookup (still tolerate the
  // file-end form).
  if (typeof content !== 'string') return { ok: false, error: 'CONTENT_NOT_STRING' };
  const normalized = content.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n') && normalized !== '---') return { ok: false, error: 'NO_FRONTMATTER_FENCE' };
  // Find closing fence: must be on its own line (start of string after a \n,
  // followed by either \n or end-of-content).
  let endIdx = -1;
  let bodyStart = -1;
  const fenceRe = /\n---(?=\n|$)/g;
  fenceRe.lastIndex = 4;
  const m = fenceRe.exec(normalized);
  if (m) {
    endIdx = m.index;
    bodyStart = m.index + 4;
  }
  if (endIdx === -1) return { ok: false, error: 'UNCLOSED_FRONTMATTER' };
  const block = normalized.slice(4, endIdx);
  const fields = {};
  const seenKeys = new Set();
  for (const rawLine of block.split('\n')) {
    const line = rawLine;
    if (line.trim().length === 0) continue;
    if (line.startsWith('#')) continue;
    const km = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/);
    if (!km) continue;
    let value = km[2].trim();
    // R2 correctness MED: reject YAML block-scalar markers we can't parse.
    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      return { ok: false, error: 'BLOCK_SCALAR_UNSUPPORTED' };
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // R2 edge-case HIGH-1: skip boolean coercion for reserved string keys.
    // `description: true` was crashing `validateTierC` via `.trim()` on boolean.
    if (!STRING_ONLY_KEYS.has(km[1])) {
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
    }
    if (seenKeys.has(km[1])) {
      return { ok: false, error: 'DUPLICATE_KEY' };
    }
    seenKeys.add(km[1]);
    fields[km[1]] = value;
  }
  return { ok: true, fields, body: normalized.slice(bodyStart).replace(/^\n/, '') };
}

function isSafeRel(root, rel) {
  if (typeof rel !== 'string' || rel.length === 0) return false;
  if (rel.includes('\0')) return false;
  const abs = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  return abs === rootResolved || abs.startsWith(rootResolved + path.sep);
}

function findSkillFiles(skillsRoot) {
  // Each skill lives at <skillsRoot>/<name>/SKILL.md
  const out = [];
  let entries;
  try { entries = fs.readdirSync(skillsRoot, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const candidate = path.join(skillsRoot, e.name, 'SKILL.md');
    if (fs.existsSync(candidate)) out.push(candidate);
  }
  return out;
}

function validateTierA(skillFile, parsed, dirName) {
  // Tier A — agentskills.io spec, FAIL on violation.
  const findings = [];
  const cite = 'https://agentskills.io/specification';
  if (!parsed.ok) {
    findings.push({ tier: 'A', severity: 'fail', id: 'SPEC_FRONTMATTER_INVALID', msg: parsed.error, cite });
    return findings;
  }
  const { fields, body } = parsed;
  if (!fields.name || typeof fields.name !== 'string') {
    findings.push({ tier: 'A', severity: 'fail', id: 'SPEC_NAME_MISSING', msg: 'frontmatter.name is required (string)', cite });
  } else {
    if (fields.name.length > MAX_NAME) {
      findings.push({ tier: 'A', severity: 'fail', id: 'SPEC_NAME_TOO_LONG', msg: `name length ${fields.name.length} > ${MAX_NAME}`, cite });
    }
    if (!NAME_REGEX.test(fields.name)) {
      findings.push({ tier: 'A', severity: 'fail', id: 'SPEC_NAME_PATTERN', msg: `name "${fields.name}" must match ${NAME_REGEX.source} (lowercase alphanumeric, single hyphens, no leading/trailing/consecutive hyphens)`, cite });
    }
    if (fields.name !== dirName) {
      findings.push({ tier: 'A', severity: 'fail', id: 'SPEC_NAME_DIR_MISMATCH', msg: `frontmatter.name "${fields.name}" does not match parent dir "${dirName}"`, cite });
    }
  }
  if (!fields.description || typeof fields.description !== 'string') {
    findings.push({ tier: 'A', severity: 'fail', id: 'SPEC_DESCRIPTION_MISSING', msg: 'frontmatter.description is required (string)', cite });
  } else if (fields.description.length > MAX_DESCRIPTION) {
    findings.push({ tier: 'A', severity: 'fail', id: 'SPEC_DESCRIPTION_TOO_LONG', msg: `description length ${fields.description.length} > ${MAX_DESCRIPTION}`, cite });
  }
  if (body) {
    const lineCount = body.split('\n').length;
    if (lineCount > MAX_BODY_LINES) {
      findings.push({ tier: 'A', severity: 'fail', id: 'SPEC_BODY_TOO_LONG', msg: `body line count ${lineCount} > ${MAX_BODY_LINES}`, cite });
    }
    // R2 blind-hunter HIGH: prior regex matched markdown escapes (\*, \_, \`, \[).
    // Replace with TWO disjoint shapes that markdown escapes cannot satisfy:
    //   A) Drive letter form `C:\path\segments`
    //   B) Path-with-file-extension form `word\(word\)+file.ext` — requires
    //      at least one `word\` segment leading to a `name.ext` tail.
    // Markdown escapes like `\*`, `\_` lack a preceding word char before the
    // backslash, so they cannot match the `(?:[A-Za-z0-9._-]+\\)+` prefix.
    const winPathRe = /(?:[A-Za-z]:\\[A-Za-z0-9_.\\-]+|(?:[A-Za-z0-9._-]+\\)+[A-Za-z0-9._-]+\.[A-Za-z]{1,8}\b)/m;
    if (winPathRe.test(body)) {
      findings.push({ tier: 'A', severity: 'fail', id: 'SPEC_WINDOWS_PATH', msg: 'body contains Windows-style backslash path (use forward slashes only)', cite });
    }
  }
  return findings;
}

function validateTierB(parsed, target) {
  // Tier B — Claude-Code-only constraints, WARN. Only enforced when target=claude-code.
  if (target !== 'claude-code' || !parsed.ok) return [];
  const findings = [];
  const cite = 'https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices';
  const { fields, body } = parsed;
  const desc = fields.description || '';
  const whenToUse = fields.when_to_use || '';
  const combined = desc.length + whenToUse.length;
  if (combined > MAX_DESC_PLUS_WHEN) {
    findings.push({ tier: 'B', severity: 'warn', id: 'CC_DESCRIPTION_COMBINED_TOO_LONG', msg: `description + when_to_use = ${combined} chars > ${MAX_DESC_PLUS_WHEN} (Claude Code listing budget)`, cite });
  }
  if (typeof fields.name === 'string') {
    const lower = fields.name.toLowerCase();
    for (const tok of RESERVED_NAME_TOKENS) {
      if (lower.includes(tok)) {
        findings.push({ tier: 'B', severity: 'warn', id: 'CC_NAME_RESERVED_TOKEN', msg: `name "${fields.name}" contains reserved token "${tok}" — Anthropic authoring guide forbids it`, cite });
      }
    }
  }
  if (typeof desc === 'string' && /<[a-zA-Z][^>]*>/.test(desc)) {
    findings.push({ tier: 'B', severity: 'warn', id: 'CC_DESCRIPTION_XML', msg: 'description contains XML/HTML tags; Anthropic guide bans them in frontmatter strings', cite });
  }
  if (typeof desc === 'string' && /^(I\s|i\s|my\s|You\s|you\s|your\s)/.test(desc)) {
    findings.push({ tier: 'B', severity: 'warn', id: 'CC_DESCRIPTION_PERSON', msg: 'description should be 3rd-person ("Validates X..." not "I validate X..." or "You validate X...")', cite });
  }
  return findings;
}

function validateTierC(parsed) {
  // Tier C — cortex-opinion, scored. Each issue subtracts from baseline 100.
  // R2 correctness HIGH-1: score=null on parse failure to disambiguate from
  // genuine low-quality skills. Caller treats null as "not scored", excludes
  // from --min-score gate.
  if (!parsed.ok) return { score: null, issues: [] };
  const issues = [];
  const cite = 'docs/research/sprint-2.22-skill-quality-2026-05-14.md';
  const { fields } = parsed;
  const desc = fields.description || '';

  // Verb-first heuristic: description should start with a present-tense verb in 3rd person.
  // Allow common verbs from cortex skills.
  const verbStart = /^(Validates?|Scores?|Audits?|Bootstraps?|Health|Surfaces?|Plans?|Produces?|Runs?|Checks?|Detects?|Generates?|Reads?|Writes?|Inspects?|Reviews?|Schedules?|Wraps?|Renders?|Translates?|Captures?|Skill|Skill-)/i;
  if (!verbStart.test(desc.trim())) {
    issues.push({ id: 'CORTEX_DESC_NOT_VERB_FIRST', msg: 'description should start with a 3rd-person verb (e.g. "Validates...", "Scores...", "Audits..."); read-out-loud test recommended.', cite, weight: 10 });
  }

  // Trigger-last heuristic: description should contain at least one example trigger phrase
  const hasTrigger = /(Triggers?|trigger|"\/)/.test(desc);
  if (!hasTrigger) {
    issues.push({ id: 'CORTEX_DESC_NO_TRIGGER', msg: 'description should list at least one natural-language trigger phrase the operator might say.', cite, weight: 15 });
  }

  for (const jargon of CORTEX_JARGON) {
    if (desc.includes(jargon)) {
      issues.push({ id: 'CORTEX_DESC_INTERNAL_JARGON', msg: `description contains cortex-internal jargon "${jargon}" — operator-facing skills must speak operator language`, cite, weight: 10 });
    }
  }

  if (desc.length > 0 && desc.length < 60) {
    issues.push({ id: 'CORTEX_DESC_TOO_TERSE', msg: `description is only ${desc.length} chars; fuzzy-match triggering needs richer language`, cite, weight: 5 });
  }

  let score = 100;
  for (const i of issues) score -= i.weight || 5;
  if (score < 0) score = 0;
  return { score, issues };
}

function scanSecurity(content) {
  // ToxicSkills payload scan. Warn-only — false positives high.
  // R2 security HIGH-1: split on \n + per-line length cap to prevent ReDoS
  // on adversarial inputs (the `[^\n]*` quantifiers in TOXIC_OUTBOUND_EXFIL +
  // TOXIC_SETTINGS_TAMPER could stall on a 256KB single line).
  const findings = [];
  const lines = String(content || '').split('\n');
  const seen = new Set();
  for (const line of lines) {
    if (line.length > SCAN_LINE_BYTES) continue;
    for (const pattern of TOXIC_PATTERNS) {
      if (seen.has(pattern.id)) continue;
      const m = line.match(pattern.re);
      if (m) {
        seen.add(pattern.id);
        // Strip ANSI/control chars from echoed match (R2 security LOW-1).
        const safe = m[0].slice(0, 80).replace(/[\x00-\x1f\x7f]/g, '?');
        findings.push({
          severity: 'warn',
          id: pattern.id,
          msg: pattern.why,
          match: safe,
          cite: pattern.cite,
        });
      }
    }
  }
  return findings;
}

function validateSkill(skillFile, opts) {
  const dirName = path.basename(path.dirname(skillFile));
  let stat;
  try { stat = fs.statSync(skillFile); }
  catch (e) {
    // R2 edge-case HIGH-3: preserve e.code so EACCES/EBUSY/EMFILE/ELOOP aren't
    // misreported as ENOENT/FILE_MISSING.
    const id = e && e.code === 'ENOENT' ? 'FILE_MISSING' : `FILE_${(e && e.code) || 'UNKNOWN'}`;
    return {
      path: skillFile,
      ok: false,
      dir: dirName,
      error: id,
      score: null,
      findings: [{ tier: 'A', severity: 'fail', id, msg: (e && e.message) || 'stat failed', cite: 'https://agentskills.io/specification' }],
      security: [],
    };
  }
  if (stat.size > MAX_FILE_BYTES) {
    return {
      path: skillFile,
      ok: false,
      dir: dirName,
      error: 'TOO_LARGE',
      score: null,
      findings: [{ tier: 'A', severity: 'fail', id: 'FILE_OVERSIZE', msg: `${stat.size} bytes > ${MAX_FILE_BYTES}`, cite: 'https://agentskills.io/specification' }],
      security: [],
    };
  }
  let content;
  try { content = fs.readFileSync(skillFile, 'utf8'); }
  catch (e) {
    const id = `FILE_${(e && e.code) || 'READ_FAIL'}`;
    return {
      path: skillFile,
      ok: false,
      dir: dirName,
      error: id,
      score: null,
      findings: [{ tier: 'A', severity: 'fail', id, msg: (e && e.message) || 'read failed', cite: 'https://agentskills.io/specification' }],
      security: [],
    };
  }
  const parsed = parseFrontmatter(content);
  const tierA = validateTierA(skillFile, parsed, dirName);
  const tierB = validateTierB(parsed, opts.target);
  const tierC = validateTierC(parsed);
  const securityFindings = opts.security ? scanSecurity(content) : [];

  const findings = [...tierA, ...tierB, ...tierC.issues.map((i) => ({ tier: 'C', severity: 'info', ...i }))];
  const failing = tierA.length > 0;
  return {
    path: skillFile,
    ok: !failing,
    dir: dirName,
    name: parsed.ok ? parsed.fields.name : undefined,
    score: tierC.score,
    findings,
    security: securityFindings,
  };
}

function showHelp() {
  process.stdout.write(`Usage: cortex-skill-validate [options]

Options:
  --dir=<path>            single skill directory (must contain SKILL.md)
  --skills-root=<path>    scan all skills under this root (default: shared/skills/ in cwd)
  --target=<mode>         agentskills | claude-code (default: claude-code)
  --security              run ToxicSkills payload regex scan (warn-only)
  --min-score=<n>         exit 1 if any skill score < n (default: 0)
  --json                  emit JSON
  --help, -h              show this help

3-tier model:
  Tier A (FAIL)   agentskills.io spec violations
  Tier B (WARN)   Claude-Code-only constraints (target=claude-code)
  Tier C (SCORE)  cortex-opinion: verb-first description, trigger phrases, no
                  internal jargon, sufficient density

Citations:
  Spec   https://agentskills.io/specification
  Claude https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
  Memo   docs/research/sprint-2.22-skill-quality-2026-05-14.md
  Snyk   https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/
`);
}

function emitHuman(results, minScore) {
  // R2 correctness MED: sort by failing-first, then score asc. NaN/null handled.
  results.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? 1 : -1;
    const as = typeof a.score === 'number' ? a.score : 101;
    const bs = typeof b.score === 'number' ? b.score : 101;
    return as - bs;
  });
  console.log(`cortex-skill-validate — ${results.length} skill(s) checked\n`);
  console.log('  score  status  skill');
  console.log('  ─────  ──────  ─────');
  for (const r of results) {
    const failing = !r.ok;
    const scoreNull = r.score === null || r.score === undefined;
    const lowScore = !scoreNull && r.score < minScore;
    const marker = failing ? 'FAIL' : (lowScore ? 'low ' : ' ok ');
    const scoreStr = scoreNull ? '  —' : String(r.score).padStart(3);
    // Strip ANSI/control chars from dir name (R2 security LOW-1).
    const skillLabel = String(r.dir || r.path).replace(/[\x00-\x1f\x7f]/g, '?');
    console.log(`  ${scoreStr}    ${marker}    ${skillLabel}`);
  }
  console.log('');
  for (const r of results) {
    if (r.findings.length === 0 && r.security.length === 0) continue;
    const scoreLabel = r.score === null || r.score === undefined ? '—' : r.score;
    console.log(`  ${r.dir || r.path} (score=${scoreLabel}):`);
    for (const f of r.findings) {
      const tag = `[${f.tier}/${f.severity}/${f.id}]`;
      console.log(`    ${tag} ${f.msg}`);
      if (f.cite) console.log(`      cite: ${f.cite}`);
    }
    for (const s of r.security) {
      console.log(`    [SEC/${s.severity}/${s.id}] ${s.msg}`);
      console.log(`      match: ${s.match}`);
      console.log(`      cite: ${s.cite}`);
    }
  }
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    return 0;
  }
  const dirOnly = flag('dir', args);
  const skillsRoot = flag('skills-root', args) || path.resolve(process.cwd(), 'shared/skills');
  const target = (flag('target', args) || 'claude-code').toLowerCase();
  if (target !== 'agentskills' && target !== 'claude-code') {
    process.stderr.write(`Error: --target must be "agentskills" or "claude-code" (got "${target}")\n`);
    return 2;
  }
  const security = args.includes('--security');
  const wantJson = args.includes('--json');
  const minScoreRaw = flag('min-score', args);
  // R2 edge-case HIGH-2: distinguish absent (undefined) from empty (null).
  // Reject `--min-score=` with no value rather than silently 0.
  if (minScoreRaw === null) {
    process.stderr.write('Error: --min-score requires a value (e.g. --min-score=80)\n');
    return 2;
  }
  const minScoreNum = Number(minScoreRaw);
  if (minScoreRaw !== undefined && !Number.isFinite(minScoreNum)) {
    process.stderr.write(`Error: --min-score must be numeric (got "${minScoreRaw}")\n`);
    return 2;
  }
  const minScoreRequested = Math.max(0, Math.min(100, Math.floor(minScoreNum || 0)));
  if (minScoreNum > 100) {
    process.stderr.write(`Note: --min-score capped at 100 (you passed ${minScoreNum})\n`);
  }
  const minScore = minScoreRequested;

  const opts = { target, security };
  const skillFiles = [];
  if (dirOnly) {
    // R2 security MED-1: reject NUL-injected paths; absolute paths are
    // operator-trusted (this is a local CLI), so we don't sandbox to cwd.
    if (typeof dirOnly !== 'string' || dirOnly.includes('\0')) {
      process.stderr.write('Error: --dir contains invalid characters\n');
      return 2;
    }
    const candidate = path.resolve(dirOnly, 'SKILL.md');
    if (!fs.existsSync(candidate)) {
      if (wantJson) console.log(JSON.stringify({ ok: false, error: 'SKILL_NOT_FOUND', path: candidate }));
      else process.stderr.write(`No SKILL.md at ${candidate}\n`);
      return 1;
    }
    skillFiles.push(candidate);
  } else {
    const found = findSkillFiles(skillsRoot);
    if (found.length === 0) {
      if (wantJson) console.log(JSON.stringify({ ok: false, error: 'NO_SKILLS_FOUND', root: skillsRoot }));
      else process.stderr.write(`No SKILL.md files found under ${skillsRoot}\n`);
      return 1;
    }
    skillFiles.push(...found);
  }

  const results = skillFiles.map((f) => validateSkill(f, opts));

  if (wantJson) {
    console.log(JSON.stringify({ ok: results.every((r) => r.ok && r.score >= minScore), target, security, results, min_score: minScore }, null, 2));
  } else {
    emitHuman(results, minScore);
  }

  // R2 correctness HIGH-1: null score (parse failure) is already a Tier A FAIL
  // and `r.ok === false`; don't double-fail it on min-score gate.
  const anyFailing = results.some((r) => !r.ok || (typeof r.score === 'number' && r.score < minScore));
  return anyFailing ? 1 : 0;
}

if (require.main === module) {
  try { process.exit(main(process.argv)); }
  catch (err) {
    process.stderr.write(`Error: ${err && err.message}\n`);
    process.exit(2);
  }
}

module.exports = {
  main,
  parseFrontmatter,
  validateTierA,
  validateTierB,
  validateTierC,
  scanSecurity,
  validateSkill,
  NAME_REGEX,
  MAX_NAME,
  MAX_DESCRIPTION,
  MAX_DESC_PLUS_WHEN,
  MAX_BODY_LINES,
  RESERVED_NAME_TOKENS,
  TOXIC_PATTERNS,
  CORTEX_JARGON,
};
