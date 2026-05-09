'use strict';

// Sprint 2.9 R2 fix (ssot HIGH): single source of truth for resource limits
// shared across read/write/edit/glob/grep tools. Avoids drift when limits
// change.

module.exports = Object.freeze({
  // File-size cap for read/write/edit/grep operations.
  MAX_FILE_BYTES: 5 * 1024 * 1024, // 5 MiB

  // Result-count caps for glob/grep.
  MAX_RESULTS: 5000,

  // Recursion depth cap for tree walks (glob, grep).
  MAX_DEPTH: 12,

  // Pattern length caps.
  GLOB_PATTERN_MAX_LENGTH: 256,
  GREP_PATTERN_MAX_LENGTH: 1024,

  // Bash command + output caps.
  BASH_MAX_COMMAND_LENGTH: 2048,
  BASH_MAX_OUTPUT_BYTES: 1024 * 1024, // 1 MiB stdout/stderr each
  BASH_DEFAULT_TIMEOUT_MS: 30 * 1000,
  BASH_MAX_TIMEOUT_MS: 120 * 1000,

  // Per-line regex execution budget for grep ReDoS defense.
  GREP_PER_LINE_REGEX_DEADLINE_MS: 50,

  // MCP server limits.
  MCP_MAX_LINE_BYTES: 10 * 1024 * 1024, // 10 MiB JSON-RPC request cap
});
