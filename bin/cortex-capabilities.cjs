#!/usr/bin/env node
// cortex-capabilities.cjs — Sprint 2.15 auto-generated capability registry.
//
// Operator-facing answer to "I don't even know what we have anymore."
// Steward-facing answer to "what tools do I know about?" (Sprint 3.X may
// inject this into system prompt).
//
// Walks the repo filesystem and produces a single source of truth markdown
// + JSON listing every action_kind, primitive, hook, standard, profile,
// prompt, agent, workflow, and test count. Header comments are the SSOT —
// each module owns its own one-line description; this script just
// aggregates.
//
// CLI:
//   node bin/cortex-capabilities.cjs              # human markdown to stdout
//   node bin/cortex-capabilities.cjs --json       # machine JSON to stdout
//   node bin/cortex-capabilities.cjs --write      # writes both files to cortex/
//
// Zero-deps. Reads filesystem only. Side-effect-free unless --write.

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Extractors — one per category. Each returns array of { name, description, ... }.
// ---------------------------------------------------------------------------

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function safeList(dir, filter) {
  try {
    return fs.readdirSync(path.join(REPO_ROOT, dir))
      .filter(f => filter(f))
      .map(f => path.join(dir, f));
  } catch { return []; }
}

// Match `// filename.cjs — Some description.` returns "Some description"
function extractCjsTagline(filePath) {
  const txt = safeRead(path.join(REPO_ROOT, filePath));
  if (!txt) return null;
  const first = txt.split('\n').find(l => l.trim().startsWith('//'));
  if (!first) return null;
  const m = first.match(/^\/\/\s*[\w.\-]+\s+[—\-]\s*(.+?)\.?\s*$/);
  return m ? m[1].trim() : first.replace(/^\/\/\s*/, '').trim();
}

// Match `// Sprint X.Y` somewhere in first 5 lines
function extractSprintTag(filePath) {
  const txt = safeRead(path.join(REPO_ROOT, filePath));
  if (!txt) return null;
  const head = txt.split('\n').slice(0, 6).join('\n');
  const m = head.match(/Sprint\s+([\d.]+[a-z]?)/i);
  return m ? `Sprint ${m[1]}` : null;
}

function inventoryStewardPrimitives() {
  return safeList('bin/steward/_lib', f => f.endsWith('.cjs'))
    .map(p => ({
      name: path.basename(p, '.cjs'),
      path: p.replace(/\\/g, '/'),
      sprint: extractSprintTag(p),
      description: extractCjsTagline(p),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function inventoryHooks() {
  return safeList('shared/hooks', f => f.endsWith('.cjs'))
    .map(p => ({
      name: path.basename(p, '.cjs'),
      path: p.replace(/\\/g, '/'),
      description: extractCjsTagline(p),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function inventoryStandards() {
  return safeList('standards', f => f.endsWith('.md') && f !== 'README.md')
    .map(p => {
      const txt = safeRead(path.join(REPO_ROOT, p)) || '';
      const lines = txt.split('\n');
      const titleLine = lines.find(l => l.startsWith('# '));
      const title = titleLine ? titleLine.replace(/^#\s+/, '').trim() : path.basename(p, '.md');
      // First non-empty paragraph after title that is not a heading or frontmatter
      let firstPara = '';
      let pastTitle = false;
      for (const l of lines) {
        if (l.startsWith('# ')) { pastTitle = true; continue; }
        if (!pastTitle) continue;
        const t = l.trim();
        if (t && !t.startsWith('#') && !t.startsWith('>') && !t.startsWith('---')) {
          firstPara = t;
          break;
        }
      }
      return {
        name: path.basename(p, '.md'),
        path: p.replace(/\\/g, '/'),
        title,
        description: firstPara.slice(0, 240),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function inventoryProfiles() {
  return safeList('profiles', f => f.endsWith('.yaml'))
    .map(p => {
      const txt = safeRead(path.join(REPO_ROOT, p)) || '';
      const name = (txt.match(/^name:\s*(.+)$/m) || [])[1] || path.basename(p, '.yaml');
      const desc = (txt.match(/^description:\s*(.+)$/m) || [])[1] || '';
      const agentic = /agentic_ready:\s*true/.test(txt);
      const aiSdk = (txt.match(/^ai_sdk:\s*(.+)$/m) || [])[1] || null;
      return {
        name: name.trim(),
        path: p.replace(/\\/g, '/'),
        description: desc.trim().slice(0, 240),
        agentic_ready: agentic,
        ai_sdk: aiSdk ? aiSdk.trim() : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function inventoryPrompts() {
  return safeList('prompts', f => f.endsWith('.md'))
    .map(p => {
      const txt = safeRead(path.join(REPO_ROOT, p)) || '';
      const lines = txt.split('\n');
      const titleLine = lines.find(l => l.startsWith('# '));
      const title = titleLine ? titleLine.replace(/^#\s+/, '').trim() : path.basename(p, '.md');
      const purposeLine = lines.find(l => l.includes('Účel') || l.includes('Purpose'));
      let purpose = '';
      if (purposeLine) {
        purpose = purposeLine.replace(/^[>*\s]*\*\*\w+:\*\*\s*/, '').replace(/^[>*\s]+/, '').trim();
      }
      return {
        name: path.basename(p, '.md'),
        path: p.replace(/\\/g, '/'),
        title,
        purpose: purpose.slice(0, 280),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function inventoryAgents() {
  return safeList('agents', f => f.endsWith('.md'))
    .map(p => {
      const txt = safeRead(path.join(REPO_ROOT, p)) || '';
      // YAML frontmatter typical: name + description + tools
      const fm = txt.match(/^---\n([\s\S]*?)\n---/);
      let name = path.basename(p, '.md');
      let description = '';
      let tools = '';
      if (fm) {
        const nameMatch = fm[1].match(/^name:\s*(.+)$/m);
        const descMatch = fm[1].match(/^description:\s*(.+)$/m);
        const toolMatch = fm[1].match(/^tools:\s*(.+)$/m);
        if (nameMatch) name = nameMatch[1].trim();
        if (descMatch) description = descMatch[1].trim();
        if (toolMatch) tools = toolMatch[1].trim();
      }
      return {
        name,
        path: p.replace(/\\/g, '/'),
        description: description.slice(0, 240),
        tools,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function inventoryWorkflows() {
  return safeList('.github/workflows', f => f.endsWith('.yml') || f.endsWith('.yaml'))
    .filter(p => !p.includes('.example.'))
    .map(p => {
      const txt = safeRead(path.join(REPO_ROOT, p)) || '';
      const nameMatch = txt.match(/^name:\s*(.+)$/m);
      const name = nameMatch ? nameMatch[1].trim() : path.basename(p, path.extname(p));
      const cronMatches = [...txt.matchAll(/cron:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
      const hasManual = /workflow_dispatch:/.test(txt);
      const hasPush = /^\s*push:/m.test(txt);
      const hasPR = /^\s*pull_request:/m.test(txt);
      const triggers = [];
      if (cronMatches.length) triggers.push(...cronMatches.map(c => `cron(${c})`));
      if (hasManual) triggers.push('manual');
      if (hasPush) triggers.push('push');
      if (hasPR) triggers.push('pull_request');
      // Lead comment as description
      const firstComment = txt.split('\n').find(l => l.trim().startsWith('#'));
      const desc = firstComment ? firstComment.replace(/^#\s*/, '').trim() : '';
      return {
        name,
        path: p.replace(/\\/g, '/'),
        triggers,
        description: desc.slice(0, 200),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Inventory action_kinds by REQUIRING the module — single source of truth.
// Sprint 2.15.1 R2 fix: previous regex-parsing approach silently corrupted
// descriptions containing apostrophes (e.g. `pattern_transfer` description
// truncated mid-word at "CURRENT project's"), was brittle to Prettier
// indent changes (4-space tabWidth would empty the inventory), and had
// boundary-leak risk (2000-char lookahead could steal next kind's
// description). 5 of 6 R2 review agents flagged this as HIGH. Fix: load
// the module directly via require — it IS already a CJS module exporting
// ACTION_KINDS — and read structured fields. No regex.
function inventoryActionKinds() {
  try {
    const mod = require(path.join(REPO_ROOT, 'bin', 'steward', '_lib', 'action-kinds.cjs'));
    const kinds = mod && mod.ACTION_KINDS;
    if (!kinds || typeof kinds !== 'object') return [];
    return Object.entries(kinds)
      // Defense-in-depth against prototype-pollution lookups
      .filter(([name]) => Object.prototype.hasOwnProperty.call(kinds, name))
      .map(([name, def]) => ({
        name,
        description: (def && typeof def.description === 'string') ? def.description.slice(0, 320) : null,
        requires_llm: def ? !!def.requires_llm : false,
        shipped_in: (def && typeof def.shipped_in === 'string') ? def.shipped_in : null,
        effort: (def && typeof def.effort === 'string') ? def.effort : null,
        blast_radius: (def && typeof def.blast_radius === 'string') ? def.blast_radius : null,
        cost_envelope: (def && typeof def.cost_envelope === 'string') ? def.cost_envelope : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    // action-kinds.cjs missing or syntax-broken — fail-open with empty list.
    // Contract test `action_kinds inventory non-empty` will catch this.
    return [];
  }
}

function inventoryTests() {
  // Sprint LR.B+ (2026-05-12): count actual test cases (test/it invocations)
  // not just files. Previous file-count gave 110 in capabilities.md while
  // README + node:test reported 2339 — embarrassing self-contradiction.
  //
  // R2 hardening (correctness HIGH + edge HIGH): cover .each / .skip / .only /
  // .todo / .concurrent variants too. The regex matches either:
  //   - bare `test(` / `it(` at line start (with optional indent), or
  //   - `test.<verb>(` / `it.<verb>(` where verb is the documented suffix set.
  // This approximates what node --test sees (skip/todo are still cases). It
  // intentionally does NOT match commented-out block patterns inside multi-
  // line string literals or `*`-prefixed JSDoc; a small false-positive on
  // template literals is acceptable vs the prior 95% undercount.
  const buckets = ['unit', 'contract', 'integration', 'smoke'];
  const counts = {};
  let total = 0;
  let skippedLarge = 0;
  // Sprint 2.15.1 R2: regex compiled once, multiline.
  const TEST_CASE_RE = /^[ \t]*(?:test|it)(?:\.(?:each|skip|only|todo|concurrent))?\s*\(/gm;
  for (const b of buckets) {
    const dir = path.join(REPO_ROOT, 'tests', b);
    if (!fs.existsSync(dir)) { counts[b] = 0; continue; }
    let n = 0;
    const stack = [dir];
    // Sprint 2.15.1 R2 fix (security CWE-59 + CWE-400): symlink + cycle
    // protection. Dirent.isDirectory() follows symlinks, so a malicious
    // tests/loop → ../ would infinite-recurse. Track realpaths + skip
    // symlinks.
    const seen = new Set();
    while (stack.length) {
      const d = stack.pop();
      let real;
      try { real = fs.realpathSync(d); } catch { continue; }
      if (seen.has(real)) continue;
      seen.add(real);
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
      for (const ent of entries) {
        if (ent.isSymbolicLink()) continue;
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) {
          stack.push(full);
        } else if (ent.name.endsWith('.test.cjs')) {
          // Read + count test()/it() invocations. Cap file size to 1 MiB
          // so a runaway fixture can't OOM the inventory pass. Track skips
          // (edge audit MED — surface to stderr so operator sees stale count).
          try {
            const stat = fs.statSync(full);
            if (stat.size > 1024 * 1024) {
              skippedLarge += 1;
              continue;
            }
            const content = fs.readFileSync(full, 'utf8');
            const matches = content.match(TEST_CASE_RE);
            n += matches ? matches.length : 0;
          } catch { /* unreadable file, skip */ }
        }
      }
    }
    counts[b] = n;
    total += n;
  }
  if (skippedLarge > 0) {
    // R2 edge audit MED: surface skipped-files signal so capability counts
    // aren't silently bounded by the 1 MiB cap. Stderr only — stdout stays
    // machine-parseable for the JSON consumers.
    try { process.stderr.write(`[capabilities] inventoryTests: skipped ${skippedLarge} test file(s) over 1 MiB cap\n`); } catch {}
  }
  return { counts, total };
}

function inventoryCounts() {
  const stewardSrcLoC = countLines('bin');
  const testsLoC = countLines('tests');
  return {
    steward_runtime_loc: stewardSrcLoC,
    test_code_loc: testsLoC,
  };
}

// Sprint 2.15.1 R2 fix (security CWE-59 + CWE-400, blind hunter HIGH):
// symlink protection + cycle guard + expanded exclusion list. Previously
// Dirent.isDirectory() followed symlinks → loop risk; exclusion list was
// only ['node_modules', '.git'] → bundler / coverage / build artifacts
// would inflate counts.
const COUNT_LINES_EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'coverage', 'build', 'target',
  '.next', 'out', '.cache', 'tmp', '.turbo', '.parcel-cache',
]);

function countLines(rel) {
  const root = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(root)) return 0;
  let n = 0;
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const d = stack.pop();
    let real;
    try { real = fs.realpathSync(d); } catch { continue; }
    if (seen.has(real)) continue;
    seen.add(real);
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (ent.isSymbolicLink()) continue;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (COUNT_LINES_EXCLUDED_DIRS.has(ent.name)) continue;
        stack.push(full);
      } else if (ent.name.endsWith('.cjs') || ent.name.endsWith('.js')) {
        const txt = safeRead(full) || '';
        n += txt.split('\n').length;
      }
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function buildRegistry() {
  return {
    generated_at: new Date().toISOString(),
    generator: 'bin/cortex-capabilities.cjs',
    note: 'AUTO-GENERATED. Do not edit by hand. Re-run `npm run capabilities` to refresh.',
    action_kinds: inventoryActionKinds(),
    steward_primitives: inventoryStewardPrimitives(),
    hooks: inventoryHooks(),
    standards: inventoryStandards(),
    profiles: inventoryProfiles(),
    prompts: inventoryPrompts(),
    agents: inventoryAgents(),
    workflows: inventoryWorkflows(),
    tests: inventoryTests(),
    code_volume: inventoryCounts(),
  };
}

// Sprint 2.15.1 R2 fix (correctness + security MEDIUM): markdown table cell
// escaping. Previously only pipes were escaped; embedded newlines, control
// chars, or backticks could corrupt table rendering AND open prompt-
// injection surface when (future Sprint 3.X) the registry is fed into
// Steward's system prompt. Strip control chars, collapse whitespace, escape
// pipes. Cap length defensively.
function mdCell(text, maxLen = 280) {
  if (text == null) return '';
  let s = String(text);
  // Strip ASCII control chars (0x00-0x1F except space) + DEL (0x7F)
  s = s.replace(/[ -]/g, ' ');
  // Collapse all whitespace runs (incl. former newlines/tabs) to single space
  s = s.replace(/\s+/g, ' ').trim();
  // Escape table delimiter
  s = s.replace(/\|/g, '\\|');
  if (s.length > maxLen) s = s.slice(0, maxLen - 1) + '…';
  return s;
}

function renderMarkdown(r) {
  const lines = [];
  lines.push('# cortex-x — capability registry');
  lines.push('');
  lines.push(`> **AUTO-GENERATED** by [\`bin/cortex-capabilities.cjs\`](../bin/cortex-capabilities.cjs). Re-run \`npm run capabilities\` to refresh. Last generated: ${r.generated_at}`);
  lines.push('');
  lines.push('> Single source of truth for "what cortex-x can do today." Sprint 2.15 ships this as operator-facing answer to *"I do not even know what we have anymore"* and as future Steward system-prompt injection substrate.');
  lines.push('');
  lines.push('## TL;DR — counts');
  lines.push('');
  lines.push('| Category | Count |');
  lines.push('|---|---|');
  lines.push(`| Steward action_kinds | ${r.action_kinds.length} |`);
  lines.push(`| Steward primitives (\`bin/steward/_lib/\`) | ${r.steward_primitives.length} |`);
  lines.push(`| Universal hooks (\`shared/hooks/\`) | ${r.hooks.length} |`);
  lines.push(`| Standards (rule tiers 0-3) | ${r.standards.length} |`);
  lines.push(`| Profiles (\`profiles/\`) | ${r.profiles.length} |`);
  lines.push(`| Prompts (\`prompts/\`) | ${r.prompts.length} |`);
  lines.push(`| Review-pipeline agents (\`agents/\`) | ${r.agents.length} |`);
  lines.push(`| GitHub workflows | ${r.workflows.length} |`);
  lines.push(`| Tests total | ${r.tests.total} (unit ${r.tests.counts.unit} · contract ${r.tests.counts.contract} · integration ${r.tests.counts.integration} · smoke ${r.tests.counts.smoke}) |`);
  lines.push(`| Runtime LoC (\`bin/\`) | ${r.code_volume.steward_runtime_loc.toLocaleString()} |`);
  lines.push(`| Test LoC (\`tests/\`) | ${r.code_volume.test_code_loc.toLocaleString()} |`);
  lines.push('');
  lines.push(`> _Test count is computed via regex over \`test()\`/\`it()\` invocations across \`tests/{unit,contract,integration,smoke}/\`. The authoritative count for CI/release gating is whatever \`npm test\` reports (Node test runner) — currently slightly higher (~2339 at HEAD) because \`describe()\` blocks and some \`.skip\`/\`.todo\` variants resolve differently. Both numbers track the same suite; the regex is the discovery-surface estimate, \`npm test\` is the gate._`);
  lines.push('');

  // Action kinds
  lines.push(`## 1. Steward action_kinds (${r.action_kinds.length})`);
  lines.push('');
  lines.push('What the Steward autonomous runtime is allowed to DO. Dispatched via cron, manual, or recommendation harvester.');
  lines.push('');
  lines.push('| Action kind | Description |');
  lines.push('|---|---|');
  for (const k of r.action_kinds) {
    lines.push(`| \`${mdCell(k.name)}\` | ${mdCell(k.description) || '_(see action-kinds.cjs)_'} |`);
  }
  lines.push('');

  // Steward primitives
  lines.push(`## 2. Steward primitives (${r.steward_primitives.length})`);
  lines.push('');
  lines.push('Zero-deps CJS modules in `bin/steward/_lib/` implementing the safety + dispatch + memory layer.');
  lines.push('');
  lines.push('| Module | Sprint | Description |');
  lines.push('|---|---|---|');
  for (const p of r.steward_primitives) {
    lines.push(`| [\`${mdCell(p.name)}\`](../${p.path}) | ${mdCell(p.sprint) || '—'} | ${mdCell(p.description)} |`);
  }
  lines.push('');

  // Hooks
  lines.push(`## 3. Universal hooks (${r.hooks.length})`);
  lines.push('');
  lines.push('Claude Code session hooks shipped to `~/.claude/shared/hooks/` via install. Apply to every project.');
  lines.push('');
  lines.push('| Hook | Description |');
  lines.push('|---|---|');
  for (const h of r.hooks) {
    lines.push(`| [\`${mdCell(h.name)}\`](../${h.path}) | ${mdCell(h.description)} |`);
  }
  lines.push('');

  // Standards
  lines.push(`## 4. Standards (${r.standards.length})`);
  lines.push('');
  lines.push('Rule tiers — see [`standards/RULE-1.md`](../standards/RULE-1.md) for hierarchy (Rule 0 distribution / 1 invariants / 1.5 coding behavior / 2 critical / 3 process).');
  lines.push('');
  lines.push('| Standard | Title | Snippet |');
  lines.push('|---|---|---|');
  for (const s of r.standards) {
    lines.push(`| [\`${mdCell(s.name)}\`](../${s.path}) | ${mdCell(s.title)} | ${mdCell(s.description)} |`);
  }
  lines.push('');

  // Profiles
  lines.push(`## 5. Profiles (${r.profiles.length})`);
  lines.push('');
  lines.push('Project archetypes used by the scaffold. Each declares stack, ai_sdk, agentic posture.');
  lines.push('');
  lines.push('| Profile | Agentic-ready | AI SDK | Description |');
  lines.push('|---|---|---|---|');
  for (const p of r.profiles) {
    lines.push(`| [\`${mdCell(p.name)}\`](../${p.path}) | ${p.agentic_ready ? '✅' : '—'} | ${mdCell(p.ai_sdk) || '—'} | ${mdCell(p.description)} |`);
  }
  lines.push('');

  // Prompts
  lines.push(`## 6. Prompts (${r.prompts.length})`);
  lines.push('');
  lines.push('Reusable Claude Code prompts in `prompts/`. Invoke via `/`-commands or paste-into-session.');
  lines.push('');
  lines.push('| Prompt | Title | Purpose |');
  lines.push('|---|---|---|');
  for (const p of r.prompts) {
    lines.push(`| [\`${mdCell(p.name)}\`](../${p.path}) | ${mdCell(p.title)} | ${mdCell(p.purpose)} |`);
  }
  lines.push('');

  // Agents
  lines.push(`## 7. Review-pipeline agents (${r.agents.length})`);
  lines.push('');
  lines.push('Specialized review agents dispatched by R2 review pipeline. Each lives in `agents/` with its own tool allowlist.');
  lines.push('');
  lines.push('| Agent | Tools | Description |');
  lines.push('|---|---|---|');
  for (const a of r.agents) {
    lines.push(`| [\`${mdCell(a.name)}\`](../${a.path}) | ${mdCell(a.tools) || '—'} | ${mdCell(a.description)} |`);
  }
  lines.push('');

  // Workflows
  lines.push(`## 8. GitHub workflows (${r.workflows.length})`);
  lines.push('');
  lines.push('CI + Steward cron workflows in `.github/workflows/`.');
  lines.push('');
  lines.push('| Workflow | Triggers | Description |');
  lines.push('|---|---|---|');
  for (const w of r.workflows) {
    const triggers = (w.triggers || []).map(t => mdCell(t)).join(' · ') || '—';
    lines.push(`| [\`${mdCell(w.name)}\`](../${w.path}) | ${triggers} | ${mdCell(w.description)} |`);
  }
  lines.push('');

  // Footer
  lines.push('---');
  lines.push('');
  lines.push('## Regeneration');
  lines.push('');
  lines.push('```bash');
  lines.push('npm run capabilities          # writes cortex/capabilities.md + .json');
  lines.push('node bin/cortex-capabilities.cjs --json    # machine output');
  lines.push('node bin/cortex-capabilities.cjs           # human markdown to stdout');
  lines.push('```');
  lines.push('');
  lines.push('A GitHub Actions workflow (`capabilities-refresh.yml`) re-generates this file on every push to `main`. Manual runs are also OK.');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2);
  const isJson = args.includes('--json');
  const doWrite = args.includes('--write');
  const r = buildRegistry();

  if (doWrite) {
    // Sprint 2.15.1 R2 fix: try/catch + isDirectory() guard + reuse rendered
    // output instead of double-rendering. Surfaces ENOTDIR / EACCES with
    // non-zero exit instead of crashing with raw uncaught error.
    const cortexDir = path.join(REPO_ROOT, 'cortex');
    try {
      if (fs.existsSync(cortexDir)) {
        const st = fs.statSync(cortexDir);
        if (!st.isDirectory()) {
          process.stderr.write(`Error: ${cortexDir} exists but is not a directory.\n`);
          process.exitCode = 2;
          return;
        }
      } else {
        fs.mkdirSync(cortexDir, { recursive: true });
      }
      const md = renderMarkdown(r);
      const json = JSON.stringify(r, null, 2);
      fs.writeFileSync(path.join(cortexDir, 'capabilities.md'), md);
      fs.writeFileSync(path.join(cortexDir, 'capabilities.json'), json);
      process.stderr.write(`Wrote cortex/capabilities.md + cortex/capabilities.json\n`);
    } catch (err) {
      process.stderr.write(`Error writing cortex/capabilities: ${err && err.message}\n`);
      process.exitCode = 1;
    }
    return;
  }

  const output = isJson ? JSON.stringify(r, null, 2) : renderMarkdown(r);
  process.stdout.write(output + '\n');
}

if (require.main === module) main(process.argv);

module.exports = { buildRegistry, renderMarkdown, mdCell };
