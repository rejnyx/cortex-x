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

// Parse bin/steward/_lib/action-kinds.cjs for top-level kinds + descriptions.
function inventoryActionKinds() {
  const txt = safeRead(path.join(REPO_ROOT, 'bin/steward/_lib/action-kinds.cjs')) || '';
  // Find ACTION_KINDS object start, scan top-level keys at indent === 2.
  const idx = txt.indexOf('const ACTION_KINDS = {');
  if (idx < 0) return [];
  const body = txt.slice(idx);
  const kinds = [];
  // Match `  kindname: {` at exact 2-space indent.
  const re = /^ {2}([a-z_]+):\s*\{$/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    const name = m[1];
    // Find first `description: '...'` or `description: \n` block after match within ~30 lines.
    const after = body.slice(m.index, m.index + 2000);
    const descMatch = after.match(/description:\s*\n?\s*['"`]([^'"`]+)['"`]/);
    const description = descMatch ? descMatch[1].slice(0, 240) : null;
    kinds.push({ name, description });
  }
  return kinds;
}

function inventoryTests() {
  const buckets = ['unit', 'contract', 'integration', 'smoke'];
  const counts = {};
  let total = 0;
  for (const b of buckets) {
    const dir = path.join(REPO_ROOT, 'tests', b);
    if (!fs.existsSync(dir)) { counts[b] = 0; continue; }
    let n = 0;
    const stack = [dir];
    while (stack.length) {
      const d = stack.pop();
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) stack.push(full);
        else if (ent.name.endsWith('.test.cjs')) n++;
      }
    }
    counts[b] = n;
    total += n;
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

function countLines(rel) {
  const root = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(root)) return 0;
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
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

  // Action kinds
  lines.push(`## 1. Steward action_kinds (${r.action_kinds.length})`);
  lines.push('');
  lines.push('What the Steward autonomous runtime is allowed to DO. Dispatched via cron, manual, or recommendation harvester.');
  lines.push('');
  lines.push('| Action kind | Description |');
  lines.push('|---|---|');
  for (const k of r.action_kinds) {
    lines.push(`| \`${k.name}\` | ${(k.description || '_(see action-kinds.cjs)_').replace(/\|/g, '\\|')} |`);
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
    lines.push(`| [\`${p.name}\`](../${p.path}) | ${p.sprint || '—'} | ${(p.description || '').replace(/\|/g, '\\|')} |`);
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
    lines.push(`| [\`${h.name}\`](../${h.path}) | ${(h.description || '').replace(/\|/g, '\\|')} |`);
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
    lines.push(`| [\`${s.name}\`](../${s.path}) | ${s.title.replace(/\|/g, '\\|')} | ${(s.description || '').replace(/\|/g, '\\|')} |`);
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
    lines.push(`| [\`${p.name}\`](../${p.path}) | ${p.agentic_ready ? '✅' : '—'} | ${p.ai_sdk || '—'} | ${(p.description || '').replace(/\|/g, '\\|')} |`);
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
    lines.push(`| [\`${p.name}\`](../${p.path}) | ${p.title.replace(/\|/g, '\\|')} | ${(p.purpose || '').replace(/\|/g, '\\|')} |`);
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
    lines.push(`| [\`${a.name}\`](../${a.path}) | ${a.tools || '—'} | ${(a.description || '').replace(/\|/g, '\\|')} |`);
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
    lines.push(`| [\`${w.name}\`](../${w.path}) | ${w.triggers.join(' · ') || '—'} | ${(w.description || '').replace(/\|/g, '\\|')} |`);
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
  const output = isJson ? JSON.stringify(r, null, 2) : renderMarkdown(r);

  if (doWrite) {
    const cortexDir = path.join(REPO_ROOT, 'cortex');
    if (!fs.existsSync(cortexDir)) fs.mkdirSync(cortexDir, { recursive: true });
    fs.writeFileSync(path.join(cortexDir, 'capabilities.md'), renderMarkdown(r));
    fs.writeFileSync(path.join(cortexDir, 'capabilities.json'), JSON.stringify(r, null, 2));
    process.stderr.write(`Wrote cortex/capabilities.md + cortex/capabilities.json\n`);
    return;
  }
  process.stdout.write(output + '\n');
}

if (require.main === module) main(process.argv);

module.exports = { buildRegistry, renderMarkdown };
