#!/usr/bin/env node
// cortex-claude-md-augment — opt-in append of cortex-x discipline block to
// the user's global ~/.claude/CLAUDE.md.
//
// Why this exists: skills only kick in inside /cortex-init, /audit, /start,
// /designer flows. For ad-hoc work ("make me a feature") the operator's
// Claude model has no instruction to dispatch parallel research agents,
// follow R1 (research-before-implement), or auto-spawn the R2 review
// pipeline. The global CLAUDE.md is the lever that biases EVERY session
// toward cortex discipline — but cortex install never auto-edits it
// (Principle 1). This helper is the bridge: explicit user consent →
// idempotent BEGIN/END-marked append.
//
// Identity rule: the cortex-managed block lives between two literal markers
// (see CORTEX_BLOCK_START / CORTEX_BLOCK_END below). Everything outside
// the markers is the user's content and is never touched.
//
// Modes:
//   --apply        append cortex discipline block (default)
//   --remove       strip the block between BEGIN/END markers
//   --status       print whether block is present + version
//   --dry-run      print planned diff, no mutation
//
// Flags:
//   --yes / -y     skip interactive confirmation
//   --json         machine-readable output
//   --help / -h
//
// Exit codes:
//   0   success / nothing-to-do
//   1   user-visible failure
//   2   internal bug

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const CLAUDE_MD_PATH = path.join(HOME, '.claude', 'CLAUDE.md');

// Block version — bump when content changes so we can detect outdated blocks
// and offer to refresh them.
const BLOCK_VERSION = '2';
const CORTEX_BLOCK_START = '<!-- BEGIN cortex-x discipline (v' + BLOCK_VERSION + ') — managed by cortex-claude-md-augment -->';
const CORTEX_BLOCK_END = '<!-- END cortex-x discipline -->';
// Match any version of the block (for removal + version-drift detection).
const CORTEX_BLOCK_RE = /<!-- BEGIN cortex-x discipline \(v(\d+)\) — managed by cortex-claude-md-augment -->[\s\S]*?<!-- END cortex-x discipline -->/g;

const DISCIPLINE_BLOCK = `## cortex-x discipline (auto-loaded — see standards/ for full rules)

You are working in an environment where cortex-x is installed (~/.claude/shared/). Apply these defaults to **every** session, not just inside cortex slash commands:

### Research, review, parallelism

**R1 — research before implementing.** Whenever a task depends on external state (framework versions, library APIs, design trends, CVEs, a11y standards, best practices that change yearly), dispatch parallel web research subagents FIRST. Cite findings with URLs. Cache under \`$CORTEX_DATA_HOME/research/\`. SSOT: \`~/.claude/shared/standards/web-research.md\`. Don't guess from training data on anything dated past your cutoff.

**R2 — review pipeline.** For non-trivial diffs (≥3 files, public API change, security-adjacent, agentic code paths), dispatch the 6-agent parallel review pipeline (\`security-auditor\`, \`correctness-auditor\`, \`acceptance-auditor\`, \`ssot-enforcer\`, \`blind-hunter\`, \`edge-case-hunter\`) BEFORE the user merges. Apply consensus HIGH findings in-commit.

**Parallel by default.** When multiple agent calls are independent (research topics, audit dimensions, file scans), dispatch them in a single message with multiple Agent tool blocks. Sequential calls only when later calls depend on earlier output.

### Execution discipline

**TodoWrite proactively for multi-step work.** Any task with 3+ distinct steps gets a TodoWrite list at start. Exactly ONE task \`in_progress\` at a time. Mark \`completed\` IMMEDIATELY when finished — never batch completions. New discoveries during execution → add as new todos. This is load-bearing for hackathons + sprints — without it long tasks drift.

**Think before code.** State the plan in 1-2 sentences before the first edit. State assumptions you're making. If the plan is wrong, the operator catches it in seconds; if you start coding, the cost is rework.

**Surgical changes.** A bug fix doesn't need surrounding cleanup. A one-shot operation doesn't need a helper. Three similar lines beats a premature abstraction. Don't add features, refactor, or introduce abstractions beyond what the task requires. Don't add error handling, fallbacks, or validation for scenarios that can't happen.

**Counts not praise (voice charter).** No greetings, no emoji, no emotion words ("perfect!", "great!"). State results and decisions directly. End-of-turn summary: one or two sentences. What changed and what's next. SSOT: \`~/.claude/shared/standards/voice.md\`.

### Where things live

**Standards order** (when budgets conflict): Rule 0 Ship-Ready → Rule 1 SSOT/Modular/Scalable → Rule 1.5 Coding Behavior → Rule 2 Security/Testing/Observability/Correctness → Rule 3 process. Browse: \`~/.claude/shared/standards/\` (28 files).

**Memory.** Per-project \`MEMORY.md\` (this project). Cross-project library: \`$CORTEX_DATA_HOME/projects/<slug>.md\` (populate via paste \`prompts/cortex-sync.md\` at end of session). Sprint state: \`PROGRESS.md\` (pending/in-progress/done/blocked). Check memory before assumptions; recall, then verify the file/symbol still exists before acting on it.

**Discoverability.** Type \`/cortex-help\` to see the slash command menu. \`/cortex-init\` (new project) · \`/audit\` (existing) · \`/test-audit\` (QA lens) · \`/designer\` (UI) · \`/cortex-doctor\` (health check). For nightly autonomous work: \`steward-setup.md\`.

**Safety hooks** are registered in \`~/.claude/settings.json\` if you ran \`cortex-hooks-register\` post-install. Verify: \`cortex-doctor --json\`. Without hooks: no block-destructive guard, no SessionStart context, no auto-orchestrate parallel-agent nudge.

**Out-of-date?** This block is auto-generated. Refresh: \`cortex-claude-md-augment --apply\` (upgrades stale versions in place). Remove: \`cortex-claude-md-augment --remove\`. Health audit any time: \`cortex-doctor\`.`;

function parseArgs(argv) {
  const args = { mode: 'apply', yes: false, json: false, help: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.mode = 'apply';
    else if (a === '--remove') args.mode = 'remove';
    else if (a === '--status') args.mode = 'status';
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      console.error(`cortex-claude-md-augment: unknown flag '${a}'. Use --help for usage.`);
      process.exit(1);
    }
  }
  return args;
}

function printHelp() {
  console.log('cortex-claude-md-augment — opt-in append of cortex-x discipline block to ~/.claude/CLAUDE.md');
  console.log('');
  console.log('Usage:');
  console.log('  cortex-claude-md-augment             append discipline block (default)');
  console.log('  cortex-claude-md-augment --remove    strip the cortex block, leave user content');
  console.log('  cortex-claude-md-augment --status    print current state, no mutation');
  console.log('  cortex-claude-md-augment --dry-run   print planned diff, no mutation');
  console.log('  cortex-claude-md-augment --yes       skip interactive confirmation');
  console.log('  cortex-claude-md-augment --json      machine-readable output');
  console.log('');
  console.log('Identity rule: only the content between');
  console.log(`  ${CORTEX_BLOCK_START}`);
  console.log(`  ${CORTEX_BLOCK_END}`);
  console.log('is touched. User content outside the markers is preserved verbatim.');
}

// Sprint 2.21.2 R2 hardening: read as Buffer, sniff for invalid UTF-8 BEFORE
// committing to a utf8 string view. fs.readFileSync(path, 'utf8') silently
// replaces invalid bytes with U+FFFD, which would round-trip back to disk on
// write and permanently corrupt non-UTF8 user content (rare but real for
// legacy latin1-edited globals). We refuse to mutate non-UTF8 files.
function isWellFormedUtf8(buffer) {
  // Node ≥18 has TextDecoder with `fatal: true` that throws on invalid bytes.
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function readCurrent() {
  if (!fs.existsSync(CLAUDE_MD_PATH)) return { exists: false, content: '', wellFormed: true };
  const buf = fs.readFileSync(CLAUDE_MD_PATH);
  if (!isWellFormedUtf8(buf)) {
    return { exists: true, content: null, wellFormed: false };
  }
  let raw = buf.toString('utf8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return { exists: true, content: raw, wellFormed: true };
}

// Sprint 2.21.2 R2 hardening: detect orphan markers (BEGIN without END or
// END without BEGIN) — these indicate the user manually edited the cortex
// block and removed a marker. If we proceed with --apply on an orphan, the
// next --apply matches the new END against the orphan BEGIN and DELETES all
// user content between them. Refuse loudly instead.
const CORTEX_BEGIN_RE = /<!-- BEGIN cortex-x discipline \(v\d+\) — managed by cortex-claude-md-augment -->/g;
const CORTEX_END_RE = /<!-- END cortex-x discipline -->/g;

function countMarkers(content) {
  // Reset both regexes (safe even if already 0 — defensive).
  CORTEX_BEGIN_RE.lastIndex = 0;
  CORTEX_END_RE.lastIndex = 0;
  const begins = (content.match(CORTEX_BEGIN_RE) || []).length;
  const ends = (content.match(CORTEX_END_RE) || []).length;
  return { begins, ends };
}

// Scan content for any existing cortex block(s) and return:
//   { present: bool, version: '1' | '2' | ..., count: number, orphan: 'begin'|'end'|null }
function detectBlock(content) {
  const { begins, ends } = countMarkers(content);
  // Reset the multi-pair regex too.
  CORTEX_BLOCK_RE.lastIndex = 0;
  const matches = [...content.matchAll(CORTEX_BLOCK_RE)];
  const orphan = begins > matches.length ? 'begin' : (ends > matches.length ? 'end' : null);
  if (matches.length === 0) return { present: false, version: null, count: 0, orphan };
  return { present: true, version: matches[0][1], count: matches.length, orphan };
}

function backupFile(rawContent) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupPath = `${CLAUDE_MD_PATH}.backup-${ts}`;
  // Mode 0o600 (owner read+write only) — CLAUDE.md may contain operator notes
  // about credentials, internal URLs, or other sensitive context; backup must
  // not leak them to other local users via umask default.
  fs.writeFileSync(backupPath, rawContent, { encoding: 'utf8', mode: 0o600 });
  return backupPath;
}

function writeContent(content) {
  const tmp = CLAUDE_MD_PATH + '.tmp';
  let renamed = false;
  try {
    fs.mkdirSync(path.dirname(CLAUDE_MD_PATH), { recursive: true });
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, CLAUDE_MD_PATH);
    renamed = true;
  } finally {
    if (!renamed) {
      try { fs.unlinkSync(tmp); } catch {}
    }
  }
}

// Compute the new content after applying mode. Pure function.
function computeNext(currentContent, mode) {
  const stripped = currentContent.replace(CORTEX_BLOCK_RE, '').replace(/\n{3,}/g, '\n\n');
  if (mode === 'remove') {
    return stripped.trimEnd() + '\n';
  }
  // apply: strip any existing block first, then append fresh.
  const fullBlock = `${CORTEX_BLOCK_START}\n${DISCIPLINE_BLOCK}\n${CORTEX_BLOCK_END}`;
  const base = stripped.trimEnd();
  return (base.length > 0 ? base + '\n\n' : '') + fullBlock + '\n';
}

// Sprint 2.21.2 R2 hardening: cross-platform interactive prompt.
// /dev/tty is Unix-only; on Windows it throws ENOENT and the prompt silently
// auto-declines. Fall back to reading from process.stdin (works on Windows
// when stdin is a TTY) before giving up. If both fail, default to false so
// the caller knows to require --yes for unattended use.
function confirmInteractive(promptText) {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(promptText);
  // Path 1 — POSIX /dev/tty (preferred: works even when stdin is piped to
  // a TTY emulator like Git Bash on Windows).
  if (process.platform !== 'win32') {
    try {
      const buf = Buffer.alloc(64);
      const fd = fs.openSync('/dev/tty', 'r');
      let n = 0;
      try { n = fs.readSync(fd, buf, 0, 64, null); } catch { /* fall through */ }
      fs.closeSync(fd);
      const reply = buf.slice(0, n).toString('utf8').trim().toLowerCase();
      return reply === '' || reply === 'y' || reply === 'yes';
    } catch {
      /* fall through to stdin path */
    }
  }
  // Path 2 — Windows (no /dev/tty) or POSIX fallback: read directly from
  // stdin. Synchronous read via fs.readSync on fd 0. Works on Windows native
  // when launched from a console host.
  try {
    const buf = Buffer.alloc(64);
    let n = 0;
    try { n = fs.readSync(0, buf, 0, 64, null); } catch { /* fall through */ }
    const reply = buf.slice(0, n).toString('utf8').trim().toLowerCase();
    return reply === '' || reply === 'y' || reply === 'yes';
  } catch {
    return false;
  }
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return 0; }

  const current = readCurrent();

  // Sprint 2.21.2 R2 hardening: refuse to mutate a non-UTF8 CLAUDE.md.
  // readFileSync('utf8') would silently replace invalid bytes with U+FFFD,
  // and we'd write the corruption back permanently. Status mode can still
  // report (best-effort) but apply/remove abort cleanly.
  if (current.exists && !current.wellFormed) {
    const msg = `${CLAUDE_MD_PATH} is not valid UTF-8 — refusing to mutate to avoid corrupting your content`;
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: msg, code: 'NOT_UTF8' }, null, 2));
    } else {
      console.error(`cortex-claude-md-augment: ${msg}`);
      console.error('  Convert to UTF-8 (e.g. iconv -f latin1 -t utf-8 < file > tmp && mv tmp file) and retry.');
    }
    return 1;
  }

  const detected = detectBlock(current.content);

  if (args.mode === 'status') {
    const report = {
      claude_md_present: current.exists,
      cortex_block_present: detected.present,
      cortex_block_version: detected.version,
      cortex_block_current_version: BLOCK_VERSION,
      duplicate_blocks: detected.count > 1 ? detected.count : 0,
      orphan_marker: detected.orphan,
      claude_md_path: CLAUDE_MD_PATH,
      stale: detected.present && detected.version !== BLOCK_VERSION,
    };
    if (args.json) {
      console.log(JSON.stringify({ ok: true, ...report }, null, 2));
    } else {
      console.log('cortex-claude-md-augment status:');
      console.log(`  CLAUDE.md: ${current.exists ? CLAUDE_MD_PATH : '(not present)'}`);
      console.log(`  cortex block: ${detected.present ? `present (v${detected.version})` : '(absent)'}`);
      if (report.stale) console.log(`  ↳ STALE — current version is v${BLOCK_VERSION}, run --apply to refresh`);
      if (report.duplicate_blocks > 0) console.log(`  ↳ WARNING: ${report.duplicate_blocks} duplicate blocks — run --apply to dedupe`);
      if (detected.orphan) console.log(`  ↳ WARNING: orphan ${detected.orphan.toUpperCase()} marker — apply/remove will refuse until manually fixed`);
      if (!detected.present) console.log(`  → run \`cortex-claude-md-augment\` to add`);
    }
    return 0;
  }

  // Sprint 2.21.2 R2 hardening: orphan markers indicate manual edit that
  // removed one half of a BEGIN/END pair. Proceeding with --apply would
  // pair the new END with the orphan BEGIN on next run and delete user
  // content between them. Refuse loudly with manual-fix instructions.
  // --remove is also unsafe (would not cleanly strip the orphan).
  if (detected.orphan) {
    const msg = `${CLAUDE_MD_PATH} has an orphan ${detected.orphan.toUpperCase()} marker — manual edit required first`;
    if (args.json) {
      console.log(JSON.stringify({ ok: false, error: msg, code: 'ORPHAN_MARKER', orphan: detected.orphan }, null, 2));
    } else {
      console.error(`cortex-claude-md-augment: ${msg}`);
      console.error(`  Cause: a previous edit removed one side of the BEGIN/END pair.`);
      console.error(`  Fix: open ${CLAUDE_MD_PATH} and either complete the pair (re-add the missing`);
      console.error(`       marker) or delete the orphan, then re-run cortex-claude-md-augment.`);
      console.error(`  Refusing to mutate to avoid permanent data loss on your user content.`);
    }
    return 1;
  }

  const nextContent = computeNext(current.content, args.mode);
  const noChange = nextContent === current.content || (
    !current.exists && args.mode === 'remove'
  );

  if (noChange) {
    if (args.json) {
      console.log(JSON.stringify({ ok: true, mode: args.mode, no_change: true }, null, 2));
    } else {
      console.log(`cortex-claude-md-augment: nothing to do (already in desired state).`);
    }
    return 0;
  }

  if (args.dryRun) {
    if (args.json) {
      console.log(JSON.stringify({
        ok: true, mode: args.mode, dry_run: true,
        prev_length: current.content.length, next_length: nextContent.length,
        block_present_before: detected.present,
        block_version_before: detected.version,
      }, null, 2));
    } else {
      console.log('cortex-claude-md-augment dry-run:');
      console.log(`  CLAUDE.md: ${CLAUDE_MD_PATH}`);
      console.log(`  block currently: ${detected.present ? `v${detected.version}` : 'absent'}`);
      console.log(`  after ${args.mode}: ${args.mode === 'apply' ? `v${BLOCK_VERSION}` : 'absent'}`);
      console.log(`  size: ${current.content.length} → ${nextContent.length} bytes`);
    }
    return 0;
  }

  if (!args.yes) {
    const verb = args.mode === 'apply'
      ? (detected.present ? (detected.version === BLOCK_VERSION ? 'refresh' : `upgrade v${detected.version} → v${BLOCK_VERSION}`) : 'append')
      : 'remove';
    const prompt =
      `cortex-claude-md-augment will ${verb} the cortex discipline block in ${CLAUDE_MD_PATH}.\n` +
      `  (user content outside the markers is preserved.)\n` +
      `Proceed? [Y/n] `;
    if (!confirmInteractive(prompt)) {
      if (args.json) {
        console.log(JSON.stringify({ ok: true, aborted: true }, null, 2));
      } else {
        console.log('cortex-claude-md-augment: aborted.');
      }
      return 0;
    }
  }

  let backupPath = null;
  if (current.exists) {
    try {
      backupPath = backupFile(current.content);
    } catch (err) {
      console.error(`cortex-claude-md-augment: backup failed: ${err.message}`);
      return 1;
    }
  }

  try {
    writeContent(nextContent);
  } catch (err) {
    console.error(`cortex-claude-md-augment: write failed: ${err.message}`);
    if (backupPath) console.error(`  backup preserved at: ${backupPath}`);
    return 1;
  }

  if (args.json) {
    console.log(JSON.stringify({
      ok: true, mode: args.mode, backup_path: backupPath,
      claude_md_path: CLAUDE_MD_PATH, block_version: BLOCK_VERSION,
    }, null, 2));
  } else {
    console.log(`cortex-claude-md-augment: ${args.mode === 'apply' ? 'applied' : 'removed'}.`);
    if (backupPath) console.log(`  backup: ${backupPath}`);
    console.log(`  next Claude Code session will pick up the new global CLAUDE.md.`);
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error('cortex-claude-md-augment: internal error:', err && err.stack ? err.stack : err);
    process.exit(2);
  }
}

module.exports = {
  BLOCK_VERSION,
  CORTEX_BLOCK_START,
  CORTEX_BLOCK_END,
  CORTEX_BLOCK_RE,
  CORTEX_BEGIN_RE,
  CORTEX_END_RE,
  DISCIPLINE_BLOCK,
  parseArgs,
  detectBlock,
  computeNext,
  countMarkers,
  isWellFormedUtf8,
};
