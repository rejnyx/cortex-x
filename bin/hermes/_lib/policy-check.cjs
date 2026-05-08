// policy-check.cjs — Hermes Ring 1 denylist (over block-destructive Ring 2).
//
// Patterns from standards/hermes-policy.md § 3 Denylist. Runs BEFORE any tool
// call, on the args struct (not regex on argv). If the global block-destructive
// hook (Ring 2) has a bug, this catches it first.
//
// Contract:
//   - Pure function: isAllowed(toolName, args) → { allowed, reason?, code? }
//   - Zero deps, zero side effects
//   - Patterns mirror standards/hermes-policy.md authoritative list

'use strict';

// Each rule: { code, p (RegExp), reason }
// `p` is tested against the joined string of all string-valued args.
const HERMES_DENY = [
  // Sentinel preservation — Hermes cannot remove its own kill switch
  {
    code: 'HERMES_HALT_PRESERVE',
    p: /(\brm\b|\bunlink\b|\bRemove-Item\b)\s+.*\.cortex[/\\]HERMES_HALT/,
    reason: 'Hermes cannot remove its own kill switch (HERMES_HALT)',
  },

  // Source-of-truth protection — also enforced via tool-aware check below for
  // Edit/Write tools where args order is unpredictable
  {
    code: 'HUMAN_ONLY_PATH',
    p: /\b(rm|unlink|Remove-Item)\b.*\b(standards|prompts|profiles|agents)\/[^\s]*\.(md|ya?ml)\b/,
    reason: 'human_only path (standards/, prompts/, profiles/, agents/) — see config/evolve.yaml',
  },
  {
    code: 'HUMAN_ONLY_TOPLEVEL',
    p: /\b(rm|unlink|Remove-Item)\b.*\b(CLAUDE|README|module)\.(md|yaml)\b/,
    reason: 'human_only path (CLAUDE.md, README.md, module.yaml) — top-level SoT',
  },

  // Auto-merge prevention (Hermes opens PRs, humans merge)
  {
    code: 'NO_AUTO_MERGE',
    p: /\bgh\s+pr\s+merge\b/,
    reason: 'Hermes cannot merge PRs — humans merge',
  },
  {
    code: 'NO_INTEGRATION_MERGE',
    p: /\bgit\s+merge\s+(main|master)\b/,
    reason: 'Hermes cannot merge to integration branch',
  },

  // Production-mutation prevention
  {
    code: 'NO_PROD_DEPLOY',
    p: /\bvercel\s+deploy\s+--prod\b/,
    reason: 'No prod deploy from Hermes',
  },
  {
    code: 'NO_PROD_MIGRATION',
    p: /\bsupabase\s+db\s+push\b.*--linked/,
    reason: 'No prod migration push from Hermes',
  },
  {
    code: 'NO_PROD_KUBECTL',
    p: /\bkubectl\s+(apply|rollout)\b.*\bprod\b/i,
    reason: 'No prod kubectl from Hermes',
  },

  // Force-push (already in block-destructive but Ring 1 catches first)
  {
    code: 'NO_FORCE_PUSH',
    p: /\bgit\s+push\b.*(--force\b|--force-with-lease\b|\s-f\b)/,
    reason: 'Hermes cannot force-push',
  },

  // Hard reset on pushed branches
  {
    code: 'NO_HARD_RESET',
    p: /\bgit\s+reset\s+--hard\b/,
    reason: 'Hermes cannot hard-reset (use git revert)',
  },

  // Sprint pre-2.0 housekeeping: secrets + key-material exfiltration via
  // subprocess. The engine's HARD_DENYLIST blocks file-WRITES to these paths;
  // policy-check (Ring 1, this layer) must also block subprocess READS so a
  // future LLM-authored gh-issue body or shell command can't `cat ~/.ssh/id_rsa`
  // and round-trip the secret out via the issue body. Defense-in-depth over
  // block-destructive (Ring 2). Cross-checked against engine HARD_DENYLIST in
  // tests/contract/denylist-ssot.test.cjs.
  //
  // The patterns deliberately match "any token containing the secret marker"
  // (e.g. `.ssh/`) without anchoring to path-start. Slightly broader than
  // strictly necessary, but security posture: prefer false-positives that an
  // operator can opt out of via the kill switch over false-negatives that
  // exfiltrate live keys.
  {
    code: 'NO_SECRET_READ',
    p: /\b(cat|less|more|tail|head|type|Get-Content|gc)\b\s+\S*?(?:\.env(?:\.|\b)|\.pem\b|\.key\b|secrets?\/|\.ssh\/|\.gnupg\/)/i,
    reason: 'Hermes cannot read secret material (.env*, *.pem, *.key, secrets/, .ssh/, .gnupg/)',
  },
  {
    code: 'NO_SECRET_PIPE',
    p: /\S*?(?:\.env(?:\.|\b)|\.pem\b|\.key\b|secrets?\/|\.ssh\/|\.gnupg\/)\S*\s*\|/i,
    reason: 'Hermes cannot pipe secret material to other commands',
  },
];

// Concatenate all string-valued args into one string for pattern matching.
function flattenArgs(args) {
  if (typeof args === 'string') return args;
  if (!args || typeof args !== 'object') return '';

  const parts = [];
  for (const v of Object.values(args)) {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) {
      for (const x of v) if (typeof x === 'string') parts.push(x);
    } else if (v && typeof v === 'object') {
      parts.push(flattenArgs(v));
    }
  }
  return parts.join(' ');
}

// Tool-aware check for Edit / Write / NotebookEdit calls. The Bash regex layer
// can't reliably detect "Hermes is editing a human_only path" because args are
// structured (`file_path`, `content`) rather than command-line — and the order
// of fields when flattened is non-deterministic. So for write-shaped tools we
// match on the file_path / path argument directly.
function checkWriteTool(toolName, args) {
  const writeTools = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
  if (!writeTools.has(toolName)) return null;
  if (!args || typeof args !== 'object') return null;

  const filePath = args.file_path || args.path || args.notebook_path || '';
  if (!filePath || typeof filePath !== 'string') return null;

  // Normalize: strip leading ./, drop drive letter prefix on Windows for matching
  const normalized = filePath.replace(/^\.\//, '').replace(/^[A-Za-z]:[/\\]/, '');

  if (/(^|[/\\])(standards|prompts|profiles|agents)[/\\][^\s]*\.(md|ya?ml)$/i.test(normalized)) {
    return {
      allowed: false,
      code: 'HUMAN_ONLY_PATH',
      reason: 'human_only path (standards/, prompts/, profiles/, agents/) — see config/evolve.yaml',
      toolName,
    };
  }

  if (/(^|[/\\])(CLAUDE|README|module)\.(md|yaml)$/i.test(normalized)) {
    return {
      allowed: false,
      code: 'HUMAN_ONLY_TOPLEVEL',
      reason: 'human_only path (CLAUDE.md, README.md, module.yaml) — top-level SoT',
      toolName,
    };
  }

  return null;
}

function isAllowed(toolName, args) {
  // Tool-aware check first (catches Edit/Write/MultiEdit on human_only paths)
  const writeViolation = checkWriteTool(toolName, args);
  if (writeViolation) return writeViolation;

  // Pattern-based check (Bash commands, rm sequences, etc.)
  const flat = flattenArgs(args);
  for (const rule of HERMES_DENY) {
    if (rule.p.test(flat)) {
      return {
        allowed: false,
        reason: rule.reason,
        code: rule.code,
        toolName,
      };
    }
  }
  return { allowed: true };
}

module.exports = {
  isAllowed,
  flattenArgs,
  checkWriteTool,
  HERMES_DENY,
};
