#!/usr/bin/env node
// bin/cortex-propose-skill.cjs — Sprint 3.1 v0 operator-facing CLI
//
// Operator workflow:
//   1. `cortex-propose-skill list --slug=<slug>` — show surfaced
//      candidates from the journal mining detector
//   2. `cortex-propose-skill scaffold --slug=<slug> --candidate=<id>` —
//      dispatch the LLM scaffolder for ONE flagged candidate, write
//      bundle to skill-experiments/<slug>/, journal the proposal
//
// Hard rate limit: ≤1 successful scaffold per rolling 7 days, per
// Sprint 3.1 v0 R1 §5 operator-fatigue mitigation. Override via
// STEWARD_SKILL_PROPOSAL_RATE=N (max N scaffolds per 7 days).
//
// Promotion path remains operator-only. The CLI does NOT register the
// proposed action_kind, does NOT open the PR, does NOT touch
// bin/steward/_lib/action-kinds.cjs. Operator runs `gh pr create` and
// merges manually.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const detector = require('../detectors/skill-proposal-mining.cjs');
const scaffolder = require('./steward/_lib/skill-scaffolder.cjs');

const RATE_LIMIT_DAYS = 7;
const DEFAULT_MAX_PER_WINDOW = 1;

function flag(name, args) {
  const idx = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return undefined;
  const eq = args[idx].indexOf('=');
  if (eq >= 0) return args[idx].slice(eq + 1);
  return args[idx + 1];
}

function resolveDataHome() {
  return process.env.CORTEX_DATA_HOME || path.join(os.homedir(), '.cortex');
}

function journalDirFor(slug) {
  return path.join(resolveDataHome(), 'journal', slug);
}

function readProposalsInWindow(slug, now) {
  const dir = journalDirFor(slug);
  if (!fs.existsSync(dir)) return 0;
  const cutoff = now.getTime() - RATE_LIMIT_DAYS * 24 * 60 * 60 * 1000;
  let count = 0;
  for (const f of fs.readdirSync(dir)) {
    if (f === 'lessons.jsonl') continue;
    let content;
    try { content = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line);
        if (e.event === 'skill_proposal_emitted') {
          const t = Date.parse(e.ts || '');
          if (Number.isFinite(t) && t >= cutoff) count += 1;
        }
      } catch { /* skip malformed */ }
    }
  }
  return count;
}

function appendJournal(slug, entry) {
  const dir = journalDirFor(slug);
  fs.mkdirSync(dir, { recursive: true });
  const fname = `${new Date().toISOString().slice(0, 10)}-${slug}.jsonl`;
  fs.appendFileSync(path.join(dir, fname), JSON.stringify(entry) + '\n', 'utf8');
}

function showHelp() {
  process.stdout.write(`Usage: cortex-propose-skill <command> --slug=<slug> [options]

Commands:
  list                      list surfaced candidates from journal mining
  scaffold                  dispatch LLM scaffolder for one candidate;
                            writes skill-experiments/<slug>/ bundle

Options (list):
  --slug=<slug>             (required) project slug
  --json                    emit JSON

Options (scaffold):
  --slug=<slug>             (required) project slug
  --candidate=<id>          (required) candidate id from \`list\`
  --repo-root=<path>        (default: cwd)
  --model=<id>              override scaffolder model
  --json                    emit JSON

Sprint 3.1 v0 hard rate limit: \${STEWARD_SKILL_PROPOSAL_RATE} successful
scaffolds per 7 rolling days (default 1). Promotion to action-kinds.cjs
remains operator-only — this CLI never modifies it.
`);
}

function cmdList(args) {
  const slug = flag('slug', args);
  if (!slug) {
    process.stderr.write('Error: --slug=<slug> is required\n');
    return 2;
  }
  const repoRoot = flag('repo-root', args) || process.cwd();
  const wantJson = args.includes('--json');
  const mined = detector.mineSkillProposals({ repoRoot });
  if (wantJson) {
    console.log(JSON.stringify({ ok: true, slug, ...mined }, null, 2));
    return 0;
  }
  if (mined.candidates.length === 0) {
    console.log(`No surfaced candidates (${mined.window_files} journal files scanned, thresholds ${JSON.stringify(mined.thresholds)})`);
    return 0;
  }
  console.log(`${mined.candidates.length} candidate(s) surfaced:`);
  for (const c of mined.candidates) {
    const flag = c.human_flagged ? ' [FLAGGED]' : '';
    console.log(`  ${c.id} — ${c.root_cause} (${c.original_action_kind}) — ${c.events} events / ${c.projects.length} projects / ${c.days_span}d${flag}`);
  }
  return 0;
}

async function cmdScaffold(args) {
  const slug = flag('slug', args);
  const candidateId = flag('candidate', args);
  if (!slug || !candidateId) {
    process.stderr.write('Error: --slug=<slug> AND --candidate=<id> required\n');
    return 2;
  }
  const repoRoot = flag('repo-root', args) || process.cwd();
  const wantJson = args.includes('--json');
  const model = flag('model', args);
  const now = new Date();

  // Rate limit
  // Sprint 3.1 v0 R2 (security-auditor MED Q4): explicit-finite check
  // instead of `|| DEFAULT` so STEWARD_SKILL_PROPOSAL_RATE=0 actually
  // disables scaffolding. Clamp to [0, 10] to prevent run-away override.
  const envRaw = process.env.STEWARD_SKILL_PROPOSAL_RATE;
  const envParsed = envRaw === undefined ? NaN : Number(envRaw);
  const maxPerWindow = Number.isFinite(envParsed)
    ? Math.max(0, Math.min(10, Math.floor(envParsed)))
    : DEFAULT_MAX_PER_WINDOW;
  const already = readProposalsInWindow(slug, now);
  if (already >= maxPerWindow) {
    const msg = `Rate limit hit: ${already}/${maxPerWindow} proposals in past ${RATE_LIMIT_DAYS}d. Override via STEWARD_SKILL_PROPOSAL_RATE=N or wait.`;
    if (wantJson) console.log(JSON.stringify({ ok: false, code: 'RATE_LIMIT_HIT', error: msg }, null, 2));
    else process.stderr.write(`Error: ${msg}\n`);
    return 1;
  }

  // Find the candidate
  const mined = detector.mineSkillProposals({ repoRoot, now });
  const candidate = mined.candidates.find((c) => c.id === candidateId);
  if (!candidate) {
    const msg = `Candidate "${candidateId}" not found in current mining run`;
    if (wantJson) console.log(JSON.stringify({ ok: false, code: 'CANDIDATE_NOT_FOUND', error: msg }, null, 2));
    else process.stderr.write(`Error: ${msg}\n`);
    return 1;
  }

  // Dispatch scaffolder
  const result = await scaffolder.scaffoldFromCandidate(candidate, {
    repoRoot,
    now,
    model,
  });

  if (!result.ok) {
    if (wantJson) console.log(JSON.stringify({ ok: false, ...result }, null, 2));
    else process.stderr.write(`Error: ${result.code}: ${result.error || ''}\n`);
    // Always journal the attempt — even on failure — so rate-limit + cost
    // accounting reflect what happened.
    appendJournal(slug, {
      ts: now.toISOString(),
      event: 'skill_proposal_attempt_failed',
      actor: 'cortex-propose-skill',
      candidate_id: candidateId,
      error_code: result.code,
      cost_usd: result.cost_usd || 0,
    });
    return 1;
  }

  // Success — journal the proposal emission for rate-limit accounting.
  appendJournal(slug, {
    ts: now.toISOString(),
    event: 'skill_proposal_emitted',
    actor: 'cortex-propose-skill',
    candidate_id: candidateId,
    skill_slug: result.skill_slug,
    proposed_action_kind: result.proposed_action_kind,
    cost_usd: result.cost_usd,
    model_used: result.model_used,
    files_written: result.files_written,
  });

  if (wantJson) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } else {
    console.log(`✓ Scaffolded skill-experiments/${result.skill_slug}/`);
    for (const f of result.files_written) console.log(`  ${f}`);
    console.log(`  cost: $${result.cost_usd.toFixed(4)}  model: ${result.model_used}`);
    console.log('');
    console.log('Next steps (operator-manual, never auto):');
    console.log('  1. Review skill-experiments/<slug>/PROPOSAL.md');
    console.log('  2. If accepted: author handler + test + register in action-kinds.cjs manually');
    console.log('  3. Move SKILL.md from skill-experiments/ to shared/skills/<slug>/');
    console.log('  4. Open PR for human review');
  }
  return 0;
}

async function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return 0;
  }
  const command = args[0];
  if (command === 'list') return cmdList(args);
  if (command === 'scaffold') return await cmdScaffold(args);
  process.stderr.write(`Error: unknown command "${command}"\n`);
  showHelp();
  return 2;
}

if (require.main === module) {
  main(process.argv).then((code) => process.exit(code)).catch((err) => {
    process.stderr.write(`Error: ${err && err.message}\n`);
    process.exit(1);
  });
}

module.exports = { main };
