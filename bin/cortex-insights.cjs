#!/usr/bin/env node
// bin/cortex-insights.cjs — Sprint 2.25 v0 usage-report CLI
//
// Local-only, zero-auth, zero-network telemetry rollup. Parses two on-disk
// sources to produce a weekly usage report:
//
//   1. ~/.claude/projects/*.jsonl  — Claude Code's own session telemetry
//      (plaintext, 30-day retention via cleanupPeriodDays). Contains token
//      counts, models, sessions, projects per session message.
//   2. cortex-x journal/*.jsonl    — Steward action ledger with per-action
//      USD cost, action_kind, success/failure, rollbacks.
//
// Output: ~/.cortex/insights/<YYYY-MM-DD>.md (or stdout with --stdout).
//
// 6 report sections:
//   1. Skills fired (from JSONL skill invocation events)
//   2. Prompts run (from JSONL prompt events if discoverable)
//   3. Steward actions (from journal/)
//   4. $ spent by dimension (model × action_kind × project)
//   5. What WASN'T used (unused skills + profiles + action_kinds)
//   6. Anomalies (failed runs, rollbacks, halts, breaker trips)
//
// Privacy: never leaves local disk unless operator shares. No telemetry-of-
// telemetry. Match Claude Code DISABLE_TELEMETRY semantics.
//
// Usage:
//   cortex-insights                  # last 7 days, write to ~/.cortex/insights/
//   cortex-insights --since=30d      # last 30 days
//   cortex-insights --since=2026-05-01  # since absolute date
//   cortex-insights --stdout         # print to stdout instead of writing file
//   cortex-insights --json           # JSON output
//
// Exit codes: 0 ok, 1 no-data, 2 internal error.

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const CORTEX_DATA_HOME = process.env.CORTEX_DATA_HOME || path.join(os.homedir(), '.cortex');
const CORTEX_INSIGHTS_DIR = path.join(CORTEX_DATA_HOME, 'insights');
const CORTEX_JOURNAL_DIR = path.join(CORTEX_DATA_HOME, 'journal');
const MAX_JSONL_BYTES = 64 * 1024 * 1024;  // skip files >64MB to avoid OOM

function flag(name, args) {
  const matches = args.filter((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (matches.length === 0) return undefined;
  const last = matches[matches.length - 1];
  const eq = last.indexOf('=');
  if (eq >= 0) {
    const v = last.slice(eq + 1);
    return v === '' ? null : v;
  }
  const idx = args.lastIndexOf(last);
  const next = args[idx + 1];
  if (next === undefined || next.startsWith('--')) return undefined;
  return next;
}

function parseSince(raw, nowMs) {
  if (!raw) {
    const d = new Date(nowMs - 7 * 24 * 3600 * 1000);
    return { ok: true, sinceMs: d.getTime(), label: '7d' };
  }
  if (/^\d+d$/.test(raw)) {
    const days = parseInt(raw, 10);
    if (days <= 0 || days > 3650) return { ok: false, error: 'INVALID_DAYS' };
    return { ok: true, sinceMs: nowMs - days * 24 * 3600 * 1000, label: `${days}d` };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const parsed = Date.parse(`${raw}T00:00:00Z`);
    if (!Number.isFinite(parsed)) return { ok: false, error: 'INVALID_DATE' };
    return { ok: true, sinceMs: parsed, label: raw };
  }
  return { ok: false, error: 'UNRECOGNIZED_SINCE' };
}

function readJsonlSafe(filePath) {
  // Returns array of parsed JSON objects. Skips malformed lines (one of
  // Claude Code's known quirks — log lines can have non-JSON debug prefix).
  let stat;
  try { stat = fs.statSync(filePath); } catch { return []; }
  if (!stat.isFile()) return [];
  if (stat.size > MAX_JSONL_BYTES) return [];
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); } catch { return []; }
  const out = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/\r$/, '').trim();
    if (line.length === 0) continue;
    if (!line.startsWith('{')) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return out;
}

function collectJsonlFiles(rootDir, sinceMs) {
  // Walk one level deep (Claude Code structure: <root>/<project-slug>/<file>.jsonl)
  // and cortex journal is flat (<root>/<file>.jsonl).
  const files = [];
  let entries;
  try { entries = fs.readdirSync(rootDir, { withFileTypes: true }); }
  catch { return files; }
  for (const e of entries) {
    const abs = path.join(rootDir, e.name);
    if (e.isFile() && e.name.endsWith('.jsonl')) {
      try {
        const st = fs.statSync(abs);
        // Cheap pre-filter: skip files whose mtime is older than our window.
        if (st.mtimeMs >= sinceMs - 24 * 3600 * 1000) files.push(abs);
      } catch { /* skip */ }
    } else if (e.isDirectory()) {
      let sub;
      try { sub = fs.readdirSync(abs, { withFileTypes: true }); }
      catch { continue; }
      for (const f of sub) {
        if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
        const fAbs = path.join(abs, f.name);
        try {
          const st = fs.statSync(fAbs);
          if (st.mtimeMs >= sinceMs - 24 * 3600 * 1000) files.push(fAbs);
        } catch { /* skip */ }
      }
    }
  }
  return files;
}

function extractRowTimestamp(row) {
  // Tries common timestamp keys. Claude Code uses 'timestamp' (ISO string)
  // or 'ts' (numeric ms). Cortex Steward journal uses 'started_at' (ISO).
  for (const k of ['timestamp', 'ts', 'started_at', 'finished_at', 'created_at']) {
    if (row[k]) {
      const v = row[k];
      if (typeof v === 'number') return v < 2e10 ? v * 1000 : v;
      const parsed = Date.parse(v);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function rollupClaudeJsonl(files, sinceMs) {
  // Returns: { skillsFired: Map, promptsRun: Map, modelCost: Map, anomalies: [] }
  const skillsFired = new Map();    // skill name -> { count, last_seen }
  const promptsRun = new Map();
  const modelCost = new Map();       // model -> { input_tokens, output_tokens, est_cost_usd }
  const anomalies = [];
  let totalMessages = 0;

  for (const file of files) {
    const rows = readJsonlSafe(file);
    for (const row of rows) {
      const tsMs = extractRowTimestamp(row);
      if (tsMs !== null && tsMs < sinceMs) continue;
      totalMessages += 1;
      // Skill invocation (claude-code emits 'skill' or 'tool_use' with name)
      const skillName = row.skill_name || (row.tool_use && row.tool_use.name === 'Skill' && row.tool_use.input && row.tool_use.input.skill) || row.skill;
      if (skillName && typeof skillName === 'string') {
        const cur = skillsFired.get(skillName) || { count: 0, last_seen: 0 };
        cur.count += 1;
        if (tsMs !== null) cur.last_seen = Math.max(cur.last_seen, tsMs);
        skillsFired.set(skillName, cur);
      }
      // Prompt invocation (slash-command). R2 edge-case HIGH-1: Claude Code's
      // message.content is frequently an ARRAY of content blocks, not a
      // string. Handle both shapes.
      let promptName = row.prompt_name || row.slash_command;
      if (!promptName && row.message) {
        const content = row.message.content;
        let text = '';
        if (typeof content === 'string') text = content;
        else if (Array.isArray(content)) {
          const firstText = content.find((b) => b && b.type === 'text' && typeof b.text === 'string');
          text = firstText ? firstText.text : '';
        }
        const m = text.match(/^\/(\w[\w-]*)/);
        if (m) promptName = m[1];
      }
      if (promptName && typeof promptName === 'string') {
        const cur = promptsRun.get(promptName) || { count: 0, last_seen: 0 };
        cur.count += 1;
        if (tsMs !== null) cur.last_seen = Math.max(cur.last_seen, tsMs);
        promptsRun.set(promptName, cur);
      }
      // Model usage + token counts (claude-code session messages carry usage)
      const model = row.model || (row.message && row.message.model);
      const usage = row.usage || (row.message && row.message.usage);
      if (model && usage) {
        const cur = modelCost.get(model) || { input_tokens: 0, output_tokens: 0, est_cost_usd: 0 };
        cur.input_tokens += Number(usage.input_tokens || 0);
        cur.output_tokens += Number(usage.output_tokens || 0);
        const est = estimateCostUsd(model, usage);
        cur.est_cost_usd += est;
        modelCost.set(model, cur);
        // R2 correctness HIGH-2: surface unknown models as anomalies so a
        // silently-launched new Claude model doesn't make cost reports
        // look like $0.00 against Sprint 1.9.1 multi-window cost safety.
        if (est === 0 && (Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0)) > 0) {
          if (!anomalies.find((a) => a.type === 'unknown_model_cost' && a.model === model)) {
            anomalies.push({ ts: tsMs, type: 'unknown_model_cost', model, message: `model "${model}" not in rate table; cost reports as $0.00 for this model` });
          }
        }
      }
      // Anomalies
      if (row.error || row.status === 'error') {
        anomalies.push({ ts: tsMs, type: 'claude_error', message: (row.error && (row.error.message || String(row.error))) || row.status, file });
      }
    }
  }
  return { skillsFired, promptsRun, modelCost, anomalies, totalMessages };
}

function estimateCostUsd(model, usage) {
  // Coarse cost estimator. cortex-insights v0 picks conservative public rates.
  // sonnet 4.5 / 4.6 ~ $3/Mtok input, $15/Mtok output. opus 4.7 ~ $15/$75.
  // haiku 4.5 ~ $1/$5. Returns 0 if model unknown — better undercount than
  // overcount.
  const rates = {
    'claude-opus-4-7': [15, 75],
    'claude-sonnet-4-6': [3, 15],
    'claude-sonnet-4-5': [3, 15],
    'claude-haiku-4-5-20251001': [1, 5],
    'claude-haiku-4-5': [1, 5],
  };
  for (const [key, [inRate, outRate]] of Object.entries(rates)) {
    if (model.startsWith(key)) {
      const inTok = Number(usage.input_tokens || 0);
      const outTok = Number(usage.output_tokens || 0);
      return (inTok / 1e6) * inRate + (outTok / 1e6) * outRate;
    }
  }
  return 0;
}

function rollupStewardJournal(files, sinceMs) {
  // Steward journal rows: { kind, action_key, status, cost_usd, model, ... }
  const actionsByKind = new Map();
  const stewardCost = { total_usd: 0, by_action_kind: new Map() };
  const anomalies = [];
  for (const file of files) {
    const rows = readJsonlSafe(file);
    for (const row of rows) {
      const tsMs = extractRowTimestamp(row);
      if (tsMs !== null && tsMs < sinceMs) continue;
      const kind = row.kind || row.action_kind;
      if (!kind) continue;
      const cur = actionsByKind.get(kind) || { count: 0, succeeded: 0, failed: 0, rollbacks: 0 };
      cur.count += 1;
      if (row.status === 'success' || row.status === 'commit') cur.succeeded += 1;
      else if (row.status === 'failure' || row.status === 'rollback') cur.failed += 1;
      if (row.rollback === true || row.status === 'rollback') cur.rollbacks += 1;
      actionsByKind.set(kind, cur);
      const cost = Number(row.cost_usd || 0);
      stewardCost.total_usd += cost;
      stewardCost.by_action_kind.set(kind, (stewardCost.by_action_kind.get(kind) || 0) + cost);
      if (row.halt || row.breaker_trip || (row.status === 'failure' && cost > 0)) {
        anomalies.push({ ts: tsMs, type: 'steward_anomaly', kind, status: row.status, halt: !!row.halt, breaker: !!row.breaker_trip, cost_usd: cost });
      }
    }
  }
  return { actionsByKind, stewardCost, anomalies };
}

function findUnused(repoRoot, usedSkills, usedActionKinds) {
  // Lists shared skills + action_kinds not exercised in the window.
  const unusedSkills = [];
  const unusedActionKinds = [];
  const skillsRoot = path.join(repoRoot, 'shared', 'skills');
  try {
    for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!usedSkills.has(entry.name)) unusedSkills.push(entry.name);
    }
  } catch { /* skip */ }
  // action_kinds registry path
  const akPath = path.join(repoRoot, 'bin', 'steward', '_lib', 'action-kinds.cjs');
  if (fs.existsSync(akPath)) {
    try {
      const akSrc = fs.readFileSync(akPath, 'utf8');
      // Discover registered action_kinds via regex (action-kinds.cjs has
      // entries like `dep_update_patch: { ... }`).
      const akRe = /^\s*([a-z][a-z0-9_]*)\s*:\s*\{/gm;
      let m;
      while ((m = akRe.exec(akSrc)) !== null) {
        const kind = m[1];
        if (kind === 'kinds' || kind === 'KINDS' || kind === 'module' || kind === 'exports') continue;
        if (!usedActionKinds.has(kind)) unusedActionKinds.push(kind);
      }
    } catch { /* skip */ }
  }
  return { unusedSkills: [...new Set(unusedSkills)].sort(), unusedActionKinds: [...new Set(unusedActionKinds)].sort() };
}

// R2 edge-case MED + security LOW: sanitize values interpolated into
// markdown table cells. Skill/prompt names from JSONL are partially
// attacker-controlled if telemetry was tampered. Strip | (table separator),
// backticks (code-fence escape), and newlines (row break).
function safeCell(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/`/g, "'").replace(/[\r\n]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '?');
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(`# cortex-insights — ${report.range_label} (${report.generated_at})`);
  lines.push('');
  lines.push(`> Local-only telemetry rollup. Sources: ~/.claude/projects/*.jsonl + cortex-x journal/. No network, no auth.`);
  lines.push('');

  // 1. Skills fired
  lines.push('## 1. Skills fired');
  if (report.skills.length === 0) {
    lines.push('_No skill invocations found in the window._');
  } else {
    lines.push('| Skill | Count | Last seen |');
    lines.push('|---|---|---|');
    for (const s of report.skills) lines.push(`| \`${safeCell(s.name)}\` | ${s.count} | ${safeCell(s.last_seen || '—')} |`);
  }
  lines.push('');

  // 2. Prompts run
  lines.push('## 2. Prompts run (slash-commands)');
  if (report.prompts.length === 0) {
    lines.push('_No slash-command invocations found._');
  } else {
    lines.push('| Prompt | Count | Last seen |');
    lines.push('|---|---|---|');
    for (const p of report.prompts) lines.push(`| \`/${safeCell(p.name)}\` | ${p.count} | ${safeCell(p.last_seen || '—')} |`);
  }
  lines.push('');

  // 3. Steward actions
  lines.push('## 3. Steward actions');
  if (report.steward_actions.length === 0) {
    lines.push('_No Steward runs in the window._');
  } else {
    lines.push('| action_kind | runs | succeeded | failed | rollbacks |');
    lines.push('|---|---|---|---|---|');
    for (const a of report.steward_actions) {
      lines.push(`| \`${safeCell(a.kind)}\` | ${a.count} | ${a.succeeded} | ${a.failed} | ${a.rollbacks} |`);
    }
  }
  lines.push('');

  // 4. $ spent
  lines.push('## 4. $ spent by dimension');
  lines.push(`**Total Steward cost (OpenRouter): $${report.cost.steward_total_usd.toFixed(4)}**`);
  lines.push(`**Est. Claude Code cost (subscription not metered, est. only): $${report.cost.claude_estimated_usd.toFixed(2)}**`);
  lines.push('');
  if (report.cost.by_model.length > 0) {
    lines.push('| Model | Input tok | Output tok | Est. $USD |');
    lines.push('|---|---|---|---|');
    for (const m of report.cost.by_model) {
      lines.push(`| ${safeCell(m.model)} | ${m.input_tokens.toLocaleString()} | ${m.output_tokens.toLocaleString()} | $${m.est_cost_usd.toFixed(4)} |`);
    }
  }
  lines.push('');
  if (report.cost.by_action_kind.length > 0) {
    lines.push('### Steward cost by action_kind');
    lines.push('| action_kind | $USD |');
    lines.push('|---|---|');
    for (const a of report.cost.by_action_kind) lines.push(`| \`${safeCell(a.kind)}\` | $${a.usd.toFixed(4)} |`);
  }
  lines.push('');

  // 5. What WASN'T used
  lines.push("## 5. What wasn't used (pruning candidates)");
  lines.push(`_Feeds the 2026-07-17 usage-driven audit._`);
  lines.push('');
  lines.push('### Unused skills');
  if (report.unused_skills.length === 0) {
    lines.push('_All shipped skills fired at least once in the window._');
  } else {
    for (const s of report.unused_skills) lines.push(`- \`${safeCell(s)}\``);
  }
  lines.push('');
  lines.push('### Unused action_kinds');
  if (report.unused_action_kinds.length === 0) {
    lines.push('_All registered action_kinds ran at least once in the window._');
  } else {
    for (const k of report.unused_action_kinds) lines.push(`- \`${safeCell(k)}\``);
  }
  lines.push('');

  // 6. Anomalies
  lines.push('## 6. Anomalies');
  if (report.anomalies.length === 0) {
    lines.push('_No errors, halts, or breaker trips._');
  } else {
    lines.push('| Time | Source | Detail |');
    lines.push('|---|---|---|');
    for (const a of report.anomalies.slice(0, 50)) {
      const ts = a.ts ? new Date(a.ts).toISOString() : '—';
      const detail = (a.message || `${a.kind || ''} ${a.status || ''} halt=${a.halt} breaker=${a.breaker}`).slice(0, 80);
      lines.push(`| ${ts} | ${a.type} | ${detail} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

function buildReport(opts) {
  const now = opts.nowMs || Date.now();
  const since = parseSince(opts.since, now);
  if (!since.ok) return { ok: false, error: since.error };

  const claudeFiles = collectJsonlFiles(opts.claudeProjectsDir || CLAUDE_PROJECTS_DIR, since.sinceMs);
  const journalFiles = collectJsonlFiles(opts.cortexJournalDir || CORTEX_JOURNAL_DIR, since.sinceMs);
  const claudeRoll = rollupClaudeJsonl(claudeFiles, since.sinceMs);
  const stewardRoll = rollupStewardJournal(journalFiles, since.sinceMs);

  const usedSkills = new Set([...claudeRoll.skillsFired.keys()]);
  const usedActionKinds = new Set([...stewardRoll.actionsByKind.keys()]);
  const repoRoot = opts.repoRoot || process.cwd();
  const unused = findUnused(repoRoot, usedSkills, usedActionKinds);

  const skills = [...claudeRoll.skillsFired.entries()].map(([name, v]) => ({
    name,
    count: v.count,
    last_seen: v.last_seen ? new Date(v.last_seen).toISOString() : '',
  })).sort((a, b) => b.count - a.count);

  const prompts = [...claudeRoll.promptsRun.entries()].map(([name, v]) => ({
    name,
    count: v.count,
    last_seen: v.last_seen ? new Date(v.last_seen).toISOString() : '',
  })).sort((a, b) => b.count - a.count);

  const stewardActions = [...stewardRoll.actionsByKind.entries()].map(([kind, v]) => ({
    kind, count: v.count, succeeded: v.succeeded, failed: v.failed, rollbacks: v.rollbacks,
  })).sort((a, b) => b.count - a.count);

  const cost = {
    steward_total_usd: stewardRoll.stewardCost.total_usd,
    claude_estimated_usd: [...claudeRoll.modelCost.values()].reduce((s, v) => s + v.est_cost_usd, 0),
    by_model: [...claudeRoll.modelCost.entries()].map(([model, v]) => ({ model, ...v })).sort((a, b) => b.est_cost_usd - a.est_cost_usd),
    by_action_kind: [...stewardRoll.stewardCost.by_action_kind.entries()].map(([kind, usd]) => ({ kind, usd })).sort((a, b) => b.usd - a.usd),
  };

  const anomalies = [...claudeRoll.anomalies, ...stewardRoll.anomalies].sort((a, b) => (b.ts || 0) - (a.ts || 0));

  return {
    ok: true,
    range_label: `${since.label}`,
    generated_at: new Date(now).toISOString().slice(0, 10),
    since_ms: since.sinceMs,
    skills,
    prompts,
    steward_actions: stewardActions,
    cost,
    unused_skills: unused.unusedSkills,
    unused_action_kinds: unused.unusedActionKinds,
    anomalies,
    sources: {
      claude_projects_files: claudeFiles.length,
      cortex_journal_files: journalFiles.length,
      total_messages: claudeRoll.totalMessages,
    },
  };
}

function showHelp() {
  process.stdout.write(`Usage: cortex-insights [options]

Options:
  --since=<window>    7d (default) | 30d | YYYY-MM-DD absolute
  --stdout            print to stdout (default: write to ~/.cortex/insights/<date>.md)
  --json              emit JSON instead of markdown
  --help, -h          show this help

Sources (local-only, zero-auth):
  ~/.claude/projects/*.jsonl   Claude Code session telemetry (30-day retention)
  $CORTEX_DATA_HOME/journal/   Steward action ledger

Output: 6-section markdown report
  1. Skills fired
  2. Prompts run (slash-commands)
  3. Steward actions
  4. $ spent by dimension
  5. What wasn't used (pruning candidates)
  6. Anomalies
`);
}

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) { showHelp(); return 0; }
  const since = flag('since', args);
  if (since === null) {
    process.stderr.write('Error: --since requires a value (7d / 30d / YYYY-MM-DD)\n');
    return 2;
  }
  const wantStdout = args.includes('--stdout');
  const wantJson = args.includes('--json');
  const report = buildReport({ since });
  if (!report.ok) {
    process.stderr.write(`Error: ${report.error}\n`);
    return 2;
  }
  const md = renderMarkdown(report);
  if (wantJson) {
    if (wantStdout) console.log(JSON.stringify(report, null, 2));
    else {
      try { fs.mkdirSync(CORTEX_INSIGHTS_DIR, { recursive: true, mode: 0o700 }); } catch { /* */ }
      const out = path.join(CORTEX_INSIGHTS_DIR, `${report.generated_at}.json`);
      fs.writeFileSync(out, JSON.stringify(report, null, 2));
      console.log(`Wrote ${out}`);
    }
  } else if (wantStdout) {
    process.stdout.write(md);
  } else {
    try { fs.mkdirSync(CORTEX_INSIGHTS_DIR, { recursive: true, mode: 0o700 }); } catch { /* */ }
    const out = path.join(CORTEX_INSIGHTS_DIR, `${report.generated_at}.md`);
    fs.writeFileSync(out, md);
    console.log(`Wrote ${out}`);
  }
  return 0;
}

if (require.main === module) {
  try { process.exit(main(process.argv)); }
  catch (err) { process.stderr.write(`Error: ${err && err.message}\n`); process.exit(2); }
}

module.exports = {
  main,
  parseSince,
  readJsonlSafe,
  rollupClaudeJsonl,
  rollupStewardJournal,
  findUnused,
  estimateCostUsd,
  buildReport,
  renderMarkdown,
  CLAUDE_PROJECTS_DIR,
  CORTEX_INSIGHTS_DIR,
};
