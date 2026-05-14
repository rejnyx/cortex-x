// confirm.cjs — Sprint 2.28.3 SSOT extract.
//
// Shared interactive-confirm helpers for cortex-x settings-mutating CLIs
// (cortex-hooks-register, cortex-claude-md-augment, cortex-permissions-register).
// Sprint 2.28.1 + 2.28.2 hardened cortex-permissions-register; Sprint 2.28.3
// backports the same semantics to the sister CLIs via this single source.
//
// Semantics:
//   - empty / whitespace / non-y reply → false (abort)
//   - literal "y" / "yes" (case-insensitive, trimmed) → true (proceed)
//
// This is the explicit-confirm-only contract from Sprint 2.28.1 edge HIGH #11:
// closed stdin (Ctrl-D, EOF, piped /dev/null) must NOT auto-confirm a mutation
// of user globals. Safer default when input is exhausted is abort.

'use strict';

const fs = require('node:fs');

// Pure decision helper. Tested in isolation without subprocess spawning.
function parseConfirmReply(rawReply) {
  if (typeof rawReply !== 'string') return false;
  const trimmed = rawReply.trim().toLowerCase();
  return trimmed === 'y' || trimmed === 'yes';
}

// Cross-platform interactive prompt with Windows /dev/tty fallback.
// Returns false on:
//   - non-TTY stdin (require --yes for unattended use)
//   - empty / whitespace reply (Sprint 2.28.1 edge HIGH #11)
//   - read failure on both /dev/tty and fd 0
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
      return parseConfirmReply(buf.slice(0, n).toString('utf8'));
    } catch {
      /* fall through to stdin path */
    }
  }
  // Path 2 — Windows (no /dev/tty) or POSIX fallback: read directly from fd 0.
  try {
    const buf = Buffer.alloc(64);
    let n = 0;
    try { n = fs.readSync(0, buf, 0, 64, null); } catch { /* fall through */ }
    return parseConfirmReply(buf.slice(0, n).toString('utf8'));
  } catch {
    return false;
  }
}

module.exports = { parseConfirmReply, confirmInteractive };
