// select.cjs — minimal zero-dep arrow-key select prompt for cortex-x CLIs.
//
// Inspired by @clack/prompts and @inquirer/prompts but no npm install required.
// Uses Node's built-in readline + raw-mode stdin + ANSI escape codes.
//
// Usage:
//   const { select } = require('./_lib/select.cjs');
//   const choice = await select({
//     message: 'What now?',
//     options: [
//       { value: 'new',      label: 'New project',     hint: 'empty folder' },
//       { value: 'existing', label: 'Existing project', hint: 'has source' },
//     ],
//     initial: 0,
//   });
//
// Cross-platform: works on Windows Terminal, PowerShell, macOS Terminal, Linux.
// Requires a TTY; throws if stdin is piped.

const readline = require('readline');

const ESC = '\x1b[';
const CYAN = ESC + '36m';
const DIM = ESC + '2m';
const BOLD = ESC + '1m';
const RESET = ESC + '0m';
const CLEAR_LINE = ESC + '2K';
const CURSOR_UP = ESC + '1A';
const HIDE_CURSOR = ESC + '?25l';
const SHOW_CURSOR = ESC + '?25h';

function clearLines(n, stdout) {
  for (let i = 0; i < n; i++) {
    stdout.write(CURSOR_UP + CLEAR_LINE);
  }
}

function renderOptions(options, idx, stdout, message, footer) {
  stdout.write(BOLD + message + RESET + '\n');
  options.forEach((opt, i) => {
    const isActive = i === idx;
    const cursor = isActive ? CYAN + '› ' : '  ';
    const label = isActive ? CYAN + opt.label + RESET : opt.label;
    const hint = opt.hint ? '  ' + DIM + opt.hint + RESET : '';
    stdout.write(cursor + label + hint + '\n');
  });
  if (footer) {
    stdout.write(DIM + footer + RESET + '\n');
  }
}

function select({ message, options, initial = 0, footer = '↑/↓ navigate · enter select · esc cancel' }) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      const err = new Error('select: stdin is not a TTY (cannot prompt interactively)');
      err.code = 'ENOTTY';
      reject(err);
      return;
    }

    let idx = Math.max(0, Math.min(initial, options.length - 1));
    const lineCount = options.length + 1 + (footer ? 1 : 0);
    let firstRender = true;

    function render() {
      if (!firstRender) clearLines(lineCount, stdout);
      firstRender = false;
      renderOptions(options, idx, stdout, message, footer);
    }

    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write(HIDE_CURSOR);

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('keypress', onKey);
      stdout.write(SHOW_CURSOR);
    }

    function onKey(_str, key) {
      if (!key) return;
      if (key.name === 'up' || key.name === 'k') {
        idx = (idx - 1 + options.length) % options.length;
        render();
      } else if (key.name === 'down' || key.name === 'j') {
        idx = (idx + 1) % options.length;
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        // Re-render the chosen line in green to confirm.
        clearLines(lineCount, stdout);
        stdout.write(BOLD + message + RESET + '  ' + CYAN + '✓ ' + options[idx].label + RESET + '\n');
        resolve(options[idx].value);
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup();
        clearLines(lineCount, stdout);
        stdout.write(DIM + 'cancelled\n' + RESET);
        reject(Object.assign(new Error('cancelled'), { code: 'ECANCELLED' }));
      } else if (key.sequence && /^[a-zA-Z]$/.test(key.sequence)) {
        // Letter shortcut: jump to first option whose label/value matches.
        const ch = key.sequence.toLowerCase();
        const found = options.findIndex((o) => {
          const lbl = (o.label || '').toLowerCase();
          const val = (o.value || '').toLowerCase();
          return lbl.startsWith(ch) || val.startsWith(ch) || lbl.includes(`[${ch}]`);
        });
        if (found >= 0) {
          idx = found;
          render();
        }
      }
    }

    stdin.on('keypress', onKey);
    render();
  });
}

function confirm({ message, initial = false }) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      resolve(initial);
      return;
    }

    let value = initial;
    const yesLabel = '[Y]es';
    const noLabel = '[N]o';

    function render(first = false) {
      if (!first) clearLines(1, stdout);
      const yes = value ? CYAN + yesLabel + RESET : DIM + yesLabel + RESET;
      const no = !value ? CYAN + noLabel + RESET : DIM + noLabel + RESET;
      stdout.write(BOLD + message + RESET + '  ' + yes + ' / ' + no + '\n');
    }

    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write(HIDE_CURSOR);

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('keypress', onKey);
      stdout.write(SHOW_CURSOR);
    }

    function onKey(_str, key) {
      if (!key) return;
      if (key.name === 'left' || key.name === 'right' || key.name === 'tab' || key.name === 'h' || key.name === 'l') {
        value = !value;
        render();
      } else if (key.sequence === 'y' || key.sequence === 'Y') {
        value = true;
        render();
      } else if (key.sequence === 'n' || key.sequence === 'N') {
        value = false;
        render();
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        clearLines(1, stdout);
        const chosen = value ? yesLabel : noLabel;
        stdout.write(BOLD + message + RESET + '  ' + CYAN + '✓ ' + chosen + RESET + '\n');
        resolve(value);
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup();
        reject(Object.assign(new Error('cancelled'), { code: 'ECANCELLED' }));
      }
    }

    stdin.on('keypress', onKey);
    render(true);
  });
}

module.exports = { select, confirm };
