#!/usr/bin/env node
// cortex-bootstrap.cjs — per-project mode selector for cortex-x onboarding.
//
// Run this in your TARGET project directory. It asks (interactively, with
// arrow keys) what you're doing here, writes a one-shot marker file
// (.cortex-bootstrap-pending), and tells you to launch claude. The cortex-x
// SessionStart hook reads the marker on the next claude session and primes
// the appropriate skill (/start, /audit, or none).
//
// Usage:
//   cd ~/my-new-project
//   cortex-bootstrap
//
// Non-interactive (CI / scripts):
//   CORTEX_BOOTSTRAP_MODE=new cortex-bootstrap

const fs = require('fs');
const path = require('path');
const { select } = require(path.join(__dirname, '_lib', 'select.cjs'));

const ESC = '\x1b[';
const CYAN = ESC + '36m';
const DIM = ESC + '2m';
const BOLD = ESC + '1m';
const GREEN = ESC + '32m';
const YELLOW = ESC + '33m';
const RESET = ESC + '0m';

function header() {
  console.log('');
  console.log(BOLD + '◆ cortex-bootstrap' + RESET + DIM + '   what are you doing in this directory?' + RESET);
  console.log(DIM + '  ' + path.resolve('.') + RESET);
  console.log('');
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

function writeMarker(mode, cwd) {
  const markerPath = path.join(cwd, '.cortex-bootstrap-pending');
  const at = nowIso();
  fs.writeFileSync(markerPath, `mode=${mode}\nat=${at}\n`, 'utf8');
  return { markerPath, at };
}

function nextSteps(mode, markerPath, at) {
  console.log('');
  if (mode === 'new') {
    console.log(GREEN + '✓ marker written' + RESET + DIM + '   ' + path.relative(process.cwd(), markerPath) + RESET);
    console.log(DIM + '  mode=new · at=' + at + ' · TTL 1h' + RESET);
    console.log('');
    console.log(BOLD + 'Next step:' + RESET);
    console.log('  ' + CYAN + 'claude' + RESET + DIM + '   (in this directory)' + RESET);
    console.log('');
    console.log(DIM + '  cortex-x will auto-prime the /start skill (Discover → Research → Architect → Scaffold → Adapt).' + RESET);
  } else if (mode === 'existing') {
    console.log(GREEN + '✓ marker written' + RESET + DIM + '   ' + path.relative(process.cwd(), markerPath) + RESET);
    console.log(DIM + '  mode=existing · at=' + at + ' · TTL 1h' + RESET);
    console.log('');
    console.log(BOLD + 'Next step:' + RESET);
    console.log('  ' + CYAN + 'claude' + RESET + DIM + '   (in this directory)' + RESET);
    console.log('');
    console.log(DIM + '  cortex-x will auto-prime the /audit skill (12-dimension existing-project audit).' + RESET);
  } else {
    console.log(YELLOW + 'framework-only mode' + RESET + DIM + '   no marker written' + RESET);
    console.log('');
    console.log(BOLD + 'Available prompts when you launch claude:' + RESET);
    console.log('  ' + CYAN + '/start' + RESET + DIM + '          new-project bootstrap (Discover → Research → Architect → Scaffold → Adapt)' + RESET);
    console.log('  ' + CYAN + '/audit' + RESET + DIM + '          existing-project deep audit (12 dimensions)' + RESET);
    console.log('  ' + CYAN + '/sync' + RESET + DIM + '           end-of-session knowledge capture' + RESET);
    console.log('  ' + CYAN + '/doctor' + RESET + DIM + '         healthcheck' + RESET);
    console.log('  ' + CYAN + '/retrofit' + RESET + DIM + '       apply cortex-x patterns to an existing project (after /audit)' + RESET);
  }
  console.log('');
}

function printHelp() {
  console.log(`cortex-bootstrap — per-project mode selector for cortex-x onboarding

Usage:
  cortex-bootstrap                                interactive mode (TTY)
  CORTEX_BOOTSTRAP_MODE=new cortex-bootstrap      non-interactive (new project)
  CORTEX_BOOTSTRAP_MODE=existing cortex-bootstrap non-interactive (existing project audit)
  CORTEX_BOOTSTRAP_MODE=framework cortex-bootstrap non-interactive (framework-only)
  cortex-bootstrap --help                         this message

What it does:
  Writes .cortex-bootstrap-pending into the current directory + prints next-step
  instructions. The cortex-x SessionStart hook reads the marker on the next
  claude session and primes the appropriate skill (/start, /audit, or none).

Recommended entry point is /cortex-init (skill) — this CLI is the shell-level
power-user alternative.`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const cwd = process.cwd();
  let mode = process.env.CORTEX_BOOTSTRAP_MODE;

  if (mode) {
    if (!['new', 'existing', 'framework'].includes(mode)) {
      console.error(`Unknown CORTEX_BOOTSTRAP_MODE='${mode}'. Use new|existing|framework.`);
      process.exit(2);
    }
  } else {
    if (!process.stdin.isTTY) {
      console.error('Non-interactive shell. Set CORTEX_BOOTSTRAP_MODE=new|existing|framework and re-run.');
      process.exit(2);
    }
    header();
    try {
      mode = await select({
        message: 'Pick a mode:',
        options: [
          { value: 'new',       label: '[N]  New project',        hint: 'empty / near-empty folder; brief → architect → scaffold' },
          { value: 'existing',  label: '[E]  Existing project',   hint: 'established codebase; deep audit + recommendations' },
          { value: 'framework', label: '[F]  Framework only',     hint: 'no marker; paste prompts manually' },
        ],
        initial: 0,
        footer: '↑/↓ navigate · enter select · n/e/f shortcut · esc cancel',
      });
    } catch (e) {
      if (e.code === 'ECANCELLED') {
        process.exit(130);
      }
      throw e;
    }
  }

  if (mode === 'framework') {
    nextSteps('framework');
    process.exit(0);
  }

  const { markerPath, at } = writeMarker(mode, cwd);
  nextSteps(mode, markerPath, at);
  process.exit(0);
}

main().catch((err) => {
  console.error('cortex-bootstrap error:', err.message);
  process.exit(1);
});
