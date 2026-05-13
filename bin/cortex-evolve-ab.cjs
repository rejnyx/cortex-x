#!/usr/bin/env node
// bin/cortex-evolve-ab.cjs — Sprint 3.0 v0 operator-facing A/B harness
//
// Champion-vs-challenger prompt A/B harness:
//   1. cortex-evolve-ab run --variant=champion --executor=mock
//   2. cortex-evolve-ab run --variant=challenger-v2 --executor=mock
//   3. cortex-evolve-ab compare \
//        --champion=evals/results/<date>-champion.json \
//        --challenger=evals/results/<date>-challenger-v2.json
//
// v0 ships with the deterministic mockExecutor for harness validation.
// Real LLM execution is operator-paced and plugs in a custom executor
// via a future `--executor=...` registry. See Sprint 3.0 v1 backlog.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const runner = require('./steward/_lib/eval-runner.cjs');
const scorer = require('./steward/_lib/eval-scorer.cjs');

function flag(name, args) {
  const idx = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return undefined;
  const eq = args[idx].indexOf('=');
  if (eq >= 0) return args[idx].slice(eq + 1);
  return args[idx + 1];
}

function isFlag(name, args) {
  return args.includes(`--${name}`);
}

function showHelp() {
  process.stdout.write(`Usage: cortex-evolve-ab <command> [options]

Commands:
  run                    execute one prompt variant against the eval suite
  compare                champion-vs-challenger decision rule + bootstrap CI

Options (run):
  --variant=<id>             (required) variant label (champion / challenger-v2 …)
  --evals-dir=<path>         (default: ./evals)
  --results-dir=<path>       (default: <evals-dir>/results)
  --trials=<n>               N trials per task (default: 5)
  --task-ids=<csv>           filter to subset (e.g. eval-001,eval-005)
  --executor=mock|openrouter (default mock; openrouter requires
                             OPENROUTER_API_KEY in env)
  --variant-prompt-file=<p>  for openrouter — path to prompt template
                             read as system message (default: empty)
  --model=<id>               openrouter model (default deepseek/deepseek-v4-flash)
  --max-tokens=<n>           openrouter max_tokens per call (default 2048)
  --max-cost-usd=<f>         abort run when cumulative cost exceeds
                             (default 1.0 USD)
  --json                     emit JSON summary

Options (compare):
  --champion=<file>      path to champion variant result.json
  --challenger=<file>    path to challenger variant result.json
  --min-delta=<f>        required point-estimate delta to promote (default 0.05)
  --seed=<n>             bootstrap seed (default 42, deterministic)
  --json                 emit JSON decision

Sprint 3.0 v0 disclaimer: 10-task eval suite (N=10) is well below the
published threshold of N≈400-600 for 5% delta detection at 95% confidence.
Results are DIRECTIONAL signal only, not statistical verdict. See
docs/research/sprint-3.0-r1-...md for evidence-base details.
`);
}

async function cmdRun(args) {
  const variantId = flag('variant', args);
  if (!variantId) {
    process.stderr.write('Error: --variant=<id> is required for `run`\n');
    return 2;
  }
  const evalsDir = path.resolve(flag('evals-dir', args) || 'evals');
  const resultsDir = path.resolve(flag('results-dir', args) || path.join(evalsDir, 'results'));
  const trials = flag('trials', args) ? Number(flag('trials', args)) : 5;
  const taskIdsCsv = flag('task-ids', args);
  const taskIds = taskIdsCsv ? taskIdsCsv.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const executorName = flag('executor', args) || 'mock';
  const wantJson = isFlag('json', args);

  let executor;
  if (executorName === 'mock') {
    executor = runner.mockExecutor;
  } else if (executorName === 'openrouter') {
    // Sprint 3.0 v1 — real-LLM executor with cost guard.
    const variantPromptFile = flag('variant-prompt-file', args);
    let variantPromptText = '';
    if (variantPromptFile) {
      try { variantPromptText = require('node:fs').readFileSync(variantPromptFile, 'utf8'); }
      catch (err) {
        process.stderr.write(`Error: cannot read --variant-prompt-file=${variantPromptFile}: ${err.message}\n`);
        return 2;
      }
    }
    try {
      executor = runner.makeOpenRouterExecutor({
        model: flag('model', args),
        maxTokens: flag('max-tokens', args) ? Number(flag('max-tokens', args)) : undefined,
        maxCostUsd: flag('max-cost-usd', args) ? Number(flag('max-cost-usd', args)) : 1.0,
        variantPromptText,
      });
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      return 2;
    }
  } else {
    process.stderr.write(`Error: --executor must be "mock" or "openrouter" (got "${executorName}")\n`);
    return 2;
  }

  const result = await runner.runVariant({
    variantId,
    evalsDir,
    trials,
    taskIds,
    executor,
  });
  const written = runner.writeVariantResult(result, resultsDir);

  if (wantJson) {
    console.log(JSON.stringify({ ok: true, variant_id: variantId, written, summary: {
      tasks: result.tasks_count,
      trials_total: result.trials_total,
      spec_pass_rate_train: result.specPassRateTrain,
      spec_pass_rate_validation: result.specPassRateValidation,
      cost_usd_total: result.cost_usd_total,
    } }, null, 2));
  } else {
    console.log(`Wrote ${written}`);
    console.log(`  variant=${variantId}  tasks=${result.tasks_count}  trials=${result.trials_total}`);
    console.log(`  spec_pass_rate train=${result.specPassRateTrain.toFixed(3)}  validation=${result.specPassRateValidation.toFixed(3)}`);
    console.log(`  cost_usd_total=${result.cost_usd_total}`);
    console.log('  ⚠ Sprint 3.0 v0: mock executor produces deterministic harness-validation data, NOT real scores.');
  }
  return 0;
}

function cmdCompare(args) {
  const champPath = flag('champion', args);
  const challPath = flag('challenger', args);
  if (!champPath || !challPath) {
    process.stderr.write('Error: --champion=<file> AND --challenger=<file> required for `compare`\n');
    return 2;
  }
  const minDelta = flag('min-delta', args) ? Number(flag('min-delta', args)) : 0.05;
  const seed = flag('seed', args) ? Number(flag('seed', args)) : 42;
  const wantJson = isFlag('json', args);

  const champ = JSON.parse(fs.readFileSync(champPath, 'utf8'));
  const chall = JSON.parse(fs.readFileSync(challPath, 'utf8'));

  const decision = scorer.decideAB(champ, chall, { minDelta, seed });

  if (wantJson) {
    console.log(JSON.stringify({
      ok: true,
      champion: { variant_id: champ.variant_id, file: champPath },
      challenger: { variant_id: chall.variant_id, file: challPath },
      min_delta: minDelta,
      seed,
      decision,
    }, null, 2));
  } else {
    console.log(`Champion:   ${champ.variant_id}  (${champPath})`);
    console.log(`Challenger: ${chall.variant_id}  (${challPath})`);
    console.log('');
    console.log(`Decision: ${decision.promote ? '✓ PROMOTE' : '✗ KEEP CHAMPION'}`);
    console.log(`Reason:   ${decision.reason}`);
    console.log('');
    const e = decision.evidence;
    if (e.champion_ci) {
      console.log(`Champion mean=${e.champion_ci.mean.toFixed(3)}  95% CI=[${e.champion_ci.lower.toFixed(3)}, ${e.champion_ci.upper.toFixed(3)}]  n=${e.champion_ci.n}`);
      console.log(`Challenger mean=${e.challenger_ci.mean.toFixed(3)}  95% CI=[${e.challenger_ci.lower.toFixed(3)}, ${e.challenger_ci.upper.toFixed(3)}]  n=${e.challenger_ci.n}`);
      if (typeof e.delta === 'number') console.log(`Delta:      ${e.delta.toFixed(3)}  (required ≥ ${minDelta})`);
    }
    if (e.directional_only_warning) {
      console.log('');
      console.log(`⚠ ${e.directional_only_warning}`);
    }
  }
  return decision.promote ? 0 : 1;
}

async function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return 0;
  }
  const command = args[0];
  if (command === 'run') return await cmdRun(args);
  if (command === 'compare') return cmdCompare(args);
  process.stderr.write(`Error: unknown command "${command}"\n`);
  showHelp();
  return 2;
}

if (require.main === module) {
  main(process.argv).then((code) => process.exit(code)).catch((e) => {
    process.stderr.write(`Error: ${e && e.message}\n`);
    process.exit(1);
  });
}

module.exports = { main };
