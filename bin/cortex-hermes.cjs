#!/usr/bin/env node
// cortex-hermes.cjs — unified entrypoint for the Hermes runtime CLI.
//
// Dispatches subcommands to bin/hermes/<subcommand>.cjs. Single CLI surface
// for users; underlying scripts remain individually invocable.
//
// Subcommands:
//   dry-run    — produce a structured plan (no Claude SDK call yet)
//   status     — report halt + lock + journal + recommendations health
//   help       — print this help
//   version    — print version (reads package.json)
//
// All flags after the subcommand are passed through verbatim.
//
// Usage:
//   cortex-hermes dry-run --slug=cortex-x
//   cortex-hermes status --slug=cortex-x --json
//   cortex-hermes help

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HERMES_DIR = path.join(__dirname, 'hermes');

const SUBCOMMANDS = {
  'dry-run': 'dry-run.cjs',
  'status': 'status.cjs',
};

function readVersion() {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.version || '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
}

function printHelp() {
  console.log('cortex-hermes — autonomous runtime CLI for cortex-x projects');
  console.log('');
  console.log('Usage:');
  console.log('  cortex-hermes <subcommand> [options]');
  console.log('');
  console.log('Subcommands:');
  console.log('  dry-run    Build a structured plan (no Claude SDK call yet)');
  console.log('  status     Report halt + lock + journal + recommendations');
  console.log('  help       Print this help');
  console.log('  version    Print version');
  console.log('');
  console.log('Examples:');
  console.log('  cortex-hermes dry-run --slug=cortex-x');
  console.log('  cortex-hermes status --slug=cortex-x --json');
  console.log('');
  console.log('See docs/hermes-runtime.md for the design doc.');
}

function dispatch(subcommand, args) {
  const target = SUBCOMMANDS[subcommand];
  if (!target) {
    process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
    process.stderr.write('Run `cortex-hermes help` for available subcommands.\n');
    return 1;
  }

  const scriptPath = path.join(HERMES_DIR, target);
  if (!fs.existsSync(scriptPath)) {
    process.stderr.write(`Internal error: ${scriptPath} not found.\n`);
    return 2;
  }

  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: 'inherit',
    encoding: 'utf8',
  });
  return result.status === null ? 1 : result.status;
}

function main(argv) {
  const args = argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    printHelp();
    return 0;
  }

  if (args[0] === '--version' || args[0] === '-v' || args[0] === 'version') {
    console.log(`cortex-hermes ${readVersion()}`);
    return 0;
  }

  const subcommand = args[0];
  const rest = args.slice(1);
  return dispatch(subcommand, rest);
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = { main, dispatch, readVersion, SUBCOMMANDS };
