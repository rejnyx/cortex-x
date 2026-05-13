#!/usr/bin/env node
// bin/cortex-export-lessons.cjs — Sprint 2.8.1 operator-facing CLI
//
// Reads $CORTEX_DATA_HOME/journal/<slug>/lessons.jsonl, scores entries
// via memory-decay.cjs, writes top-K per action_kind as Claude Code
// auto-memory topic files in ~/.claude/projects/<slug>/memory/.
//
// Usage:
//   cortex-export-lessons --slug=<slug> [--memory-dir=<path>]
//                          [--data-home=<path>] [--top-k=<n>] [--min-score=<f>]
//                          [--json] [--dry-run]

'use strict';

const path = require('node:path');
const os = require('node:os');
const exporter = require('./steward/_lib/lessons-exporter.cjs');

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

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`Usage: cortex-export-lessons --slug=<slug> [options]

Options:
  --slug=<slug>          (required) project slug, matches lessons.jsonl path
                         constraint: /^[A-Za-z0-9_-]+$/, 1-64 chars
  --memory-dir=<path>    target dir (default: ~/.claude/projects/<slug>/memory/)
                         must resolve inside operator home unless
                         --allow-outside-home is set
  --allow-outside-home   permit --memory-dir outside operator home dir
  --data-home=<path>     CORTEX_DATA_HOME override (default: env or ~/.cortex)
  --top-k=<n>            max lessons per action_kind (default: 10)
  --min-score=<f>        skip entries below this importance score (default: 0.01)
  --json                 emit JSON summary on stdout
  --dry-run              compute the plan but do not write files
  --help, -h             show this help
`);
    return 0;
  }

  const slug = flag('slug', args);
  if (!slug) {
    process.stderr.write('Error: --slug=<slug> is required\n');
    return 2;
  }
  const memoryDir = flag('memory-dir', args);
  const dataHome = flag('data-home', args);
  const topK = flag('top-k', args);
  const minScore = flag('min-score', args);
  const wantJson = isFlag('json', args);
  const dryRun = isFlag('dry-run', args);

  if (dryRun) {
    // In dry-run mode, point the exporter at a tmp memoryDir we discard.
    const tmp = path.join(os.tmpdir(), `cortex-export-lessons-dryrun-${Date.now()}-${process.pid}`);
    const summary = exporter.exportLessons({
      slug,
      memoryDir: tmp,
      dataHome,
      topKPerKind: topK ? Number(topK) : undefined,
      minScore: minScore ? Number(minScore) : undefined,
      allowOutsideHome: true, // dry-run uses os.tmpdir(), always outside home
    });
    summary.dry_run = true;
    summary.memoryDir = memoryDir || path.join(os.homedir(), '.claude', 'projects', slug, 'memory');
    summary.summary = `[dry-run] would export ${summary.lessons_exported} lessons across ${summary.topic_files.length} action_kinds to ${summary.memoryDir}`;
    if (wantJson) console.log(JSON.stringify(summary, null, 2));
    else console.log(summary.summary);
    return 0;
  }

  let result;
  try {
    result = exporter.exportLessons({
      slug,
      memoryDir,
      dataHome,
      topKPerKind: topK ? Number(topK) : undefined,
      minScore: minScore ? Number(minScore) : undefined,
      allowOutsideHome: isFlag('allow-outside-home', args),
    });
  } catch (err) {
    if (wantJson) console.log(JSON.stringify({ ok: false, error: err && err.message }, null, 2));
    else process.stderr.write(`Error: ${err && err.message}\n`);
    return 1;
  }

  if (wantJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(result.summary);
    if (result.topic_files.length > 0) {
      console.log('');
      console.log('Topic files written:');
      for (const tf of result.topic_files) {
        console.log(`  ${tf.path} — ${tf.kind} (${tf.count} lessons, top score ${tf.top_score.toFixed(2)})`);
      }
      if (result.index_path) console.log(`  ${result.index_path} — index`);
    }
  }
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { main };
