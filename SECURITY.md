# Security Policy

## Supported versions

cortex-x is pre-v1.0 (public preview under Apache License 2.0). **Only the latest `main` and the most recent tagged release are supported.** Older tags are frozen snapshots for reproducibility; no security backports until v1.0 cut.

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

## Platform notes

### Windows installations

cortex-x writes a hook error log at `~/.claude/shared/.hook-errors.log` and creates the error file with mode `0o600`. **POSIX permission bits are honored on Linux/macOS but are a no-op on Windows** — on Windows the file inherits the parent directory's ACL.

**Do not install cortex-x under a world-readable shared path** such as `C:\Users\Public\`, a shared OneDrive folder, a network share, or any directory whose ACL grants read access to other accounts on the host. The error log can capture tool-call metadata that, while redaction-protected, you still don't want exposed cross-account.

**Recommended install location on Windows:** under your own profile (typically `C:\Users\<you>\`), where the default ACL restricts access to your account + administrators. If you need to verify, run:

```powershell
Get-Acl ~/.claude/shared/.hook-errors.log | Format-List
```

The `Access` list should show only your user (or the `Users` SID inheriting from `%USERPROFILE%`) and built-in administrators — not `Everyone` or `Authenticated Users`.

This is advisory, not enforced by the install scripts. A future release may add a path-ACL probe to `install.ps1` that refuses to install under world-readable directories.
