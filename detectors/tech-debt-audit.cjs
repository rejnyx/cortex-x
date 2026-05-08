// Sprint 2.5 — tech_debt_audit detector.
//
// Probes for qlty + knip CLI availability. Returns a status used by the
// dispatcher to decide whether to enqueue an audit action or skip cleanly.
//
// Status values:
//   - 'ready' — both qlty and knip resolvable; audit can proceed
//   - 'qlty-missing' — qlty not on PATH; audit should skip with warning
//   - 'knip-missing' — qlty present but knip not invokable; audit can still
//     run (knip metrics become null in the snapshot, qlty metrics still flow)
//   - 'opted-out' — operator disabled audit via profile flag
//
// Probe is fast: just `where qlty` / `which qlty` style PATH walk via
// fs.existsSync. No actual subprocess invocation here — keeps detector
// hot-path under 100ms per cortex-x detector contract.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

function probeBinary(name) {
  // Sprint 2.5 R2 fix (edge MINOR): reject empty/non-string name to prevent
  // directory-as-binary match (path.join(dir, '') returns dir which existsSync
  // returns true for).
  if (!name || typeof name !== 'string') return { ok: false };
  const isWin = process.platform === 'win32';
  // Sprint 2.5 R2 fix (blind MINOR): on POSIX skip .cmd/.exe candidates
  // (Unix wouldn't execute them anyway and they'd be wasted I/O).
  const candidates = isWin
    ? [`${name}.cmd`, `${name}.exe`, name]
    : [name];
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    for (const cand of candidates) {
      const full = path.join(dir, cand);
      try {
        // Sprint 2.5 R2 fix: ensure it's a regular file, not a directory.
        const st = fs.statSync(full);
        if (st.isFile()) return { ok: true, path: full };
      } catch { /* probe-only */ }
    }
  }
  return { ok: false };
}

// Check operator opt-out flag in cortex-x config (if present).
// Sentinel: `.cortex/audit-disabled` regular file. Sprint 2.5 R2 fix —
// reject directories and dangling symlinks via statSync().isFile() so a
// directory accidentally created with the same name doesn't silently
// disable the audit.
function isOptedOut(repoRoot) {
  if (!repoRoot || typeof repoRoot !== 'string') return false;
  try {
    const sentinel = path.join(repoRoot, '.cortex', 'audit-disabled');
    return fs.statSync(sentinel).isFile();
  } catch {
    return false;
  }
}

function detect(opts = {}) {
  const repoRoot = opts.repoRoot || process.cwd();
  if (isOptedOut(repoRoot)) {
    return { status: 'opted-out', reason: '.cortex/audit-disabled sentinel present' };
  }
  const qlty = probeBinary('qlty');
  if (!qlty.ok) {
    return {
      status: 'qlty-missing',
      reason: 'qlty CLI not on PATH; install via `curl https://qlty.sh | bash` (or PowerShell equivalent on Windows). Audit will be skipped.',
    };
  }
  const knip = probeBinary('knip');
  if (!knip.ok) {
    // knip is optional — qlty alone produces a useful snapshot.
    return {
      status: 'knip-missing',
      reason: 'knip not on PATH; audit will run with qlty-only metrics (knip_unused_* fields will be null).',
      qltyPath: qlty.path,
    };
  }
  return {
    status: 'ready',
    qltyPath: qlty.path,
    knipPath: knip.path,
  };
}

module.exports = { detect, probeBinary };
