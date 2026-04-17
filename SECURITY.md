# Security Policy

## Supported versions

During closed beta, **only the latest `main` and the most recent tagged release are supported.** Older tags are frozen snapshots for reproducibility; no security backports.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately via:
- **GitHub Private Vulnerability Reporting** on the [cortex-x repository](https://github.com/Rejnyx/cortex-x/security/advisories/new) (preferred)
- A direct message to the repository owner on GitHub

Expected acknowledgement window: **5 business days**. Full triage within **14 days**.

## What counts as in-scope

- Secret leakage in hooks (journal, state files, logs) — the privacy redaction contract in [journal/README.md](./journal/README.md) is load-bearing
- Hook command injection or privilege escalation via `install.sh`/`install.ps1`
- Path traversal in cortex_root resolution or project-slug derivation
- Supply-chain concerns (dependencies, install-script fetches)

## What's out of scope

- DoS via malicious tool-input payloads — hooks are failure-isolated and size-capped; crashing a hook never blocks the user's Claude session
- Theoretical attacks on single-user local install (shared-system / multi-user concerns remain in scope)
- Issues in upstream Claude Code or Anthropic SDKs — report those to Anthropic directly

## Disclosure timeline

Coordinated disclosure preferred. After triage:
- **Fix within 30 days** for high/critical
- **Public advisory** published only after fix is tagged + released, or after 90 days (whichever comes first)
