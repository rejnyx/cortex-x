# Skill validation — 3-tier model + ToxicSkills baseline

> **Tier:** Rule 3 (Process). Sprint 2.22 v0 — companion to [`standards/skills.md`](./skills.md). Backs the `bin/cortex-skill-validate.cjs` CLI. Reviewer pipeline flag = warning when Tier A surfaces violations; HIGH when ToxicSkills regex match surfaces.

cortex does NOT reimplement broad spec-conformance lint. `agnix` (npm, 414 rules) already covers that surface well. `cortex-skill-validate` runs AFTER `agnix` and adds three cortex-opinionated layers — spec-driven failure mode, Claude-Code-only warnings, cortex-flavor scoring — plus an optional security regex pass.

Full R1 memo: [`docs/research/sprint-2.22-skill-quality-2026-05-14.md`](../docs/research/sprint-2.22-skill-quality-2026-05-14.md) (16 cited URLs, 2026-05-14).

## Why a 3-tier model

| Tier | Severity | Source-of-truth | Rationale |
|---|---|---|---|
| **A** | FAIL | [agentskills.io spec](https://agentskills.io/specification) | Anything in this tier breaks the skill registration contract. Skill won't trigger reliably (or at all). Hard fail. |
| **B** | WARN | [Claude Code authoring guide](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | Claude-Code-specific runtime constraints (listing budget, reserved tokens). Only enforced when `--target claude-code` (default). Skill still works at the spec level but loses listing surface in CC. |
| **C** | SCORE | cortex opinion ([R1 memo](../docs/research/sprint-2.22-skill-quality-2026-05-14.md)) | "Will this skill trigger when the operator says…?" — quality heuristics: verb-first description, trigger-last surface, no internal jargon, sufficient density. Scored, not blocked. |

## Tier A — spec violations (FAIL)

Per [agentskills.io spec](https://agentskills.io/specification):

- **`SPEC_FRONTMATTER_INVALID`** — frontmatter must open with `---` and close with `---` on its own line.
- **`SPEC_NAME_MISSING`** — `name:` is a required scalar string field.
- **`SPEC_NAME_TOO_LONG`** — `name` length ≤ **64** chars.
- **`SPEC_NAME_PATTERN`** — `name` must match the cortex `NAME_REGEX` (lowercase alphanumeric only, single hyphens between alphanumerics, no leading/trailing hyphens, no consecutive hyphens). Source-of-truth pattern is exported from [`bin/cortex-skill-validate.cjs`](../bin/cortex-skill-validate.cjs).
- **`SPEC_NAME_DIR_MISMATCH`** — `name` must equal the parent directory name. Anthropic's loader matches on dir; mismatched name → silent no-trigger.
- **`SPEC_DESCRIPTION_MISSING`** — `description:` is a required scalar string field.
- **`SPEC_DESCRIPTION_TOO_LONG`** — `description` length ≤ **1024** chars.
- **`SPEC_BODY_TOO_LONG`** — SKILL.md body line count ≤ **500**.
- **`SPEC_WINDOWS_PATH`** — body must not contain `path\to\file`-style backslash paths. Always forward slashes (Linux + macOS + Windows agree).

## Tier B — Claude Code-only warnings

Per [Anthropic skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices):

- **`CC_DESCRIPTION_COMBINED_TOO_LONG`** — `description.length + when_to_use.length` ≤ **1536** chars. Beyond this, Claude Code truncates the listing tooltip (defaults to 1% of model context budget; configurable via `skillListingBudgetFraction`).
- **`CC_NAME_RESERVED_TOKEN`** — `name` must not contain reserved tokens `anthropic` or `claude`. Anthropic guide bans these (cosplay risk).
- **`CC_DESCRIPTION_XML`** — `description` must not contain XML/HTML tags. Anthropic guide bans them in frontmatter scalar strings.
- **`CC_DESCRIPTION_PERSON`** — `description` should be in 3rd person ("Validates X…", "Scores Y…") not 1st/2nd person ("I validate X…", "You validate X…"). Heuristic check on leading words.

Why warn-only: a skill with these issues still loads; it just degrades in CC's listing experience. Operators may have legitimate reasons to ignore (e.g., a skill that's never listed to end users, only invoked programmatically).

## Tier C — cortex opinion (SCORE, not block)

cortex-x-specific heuristics that improve fuzzy-match trigger reliability + operator UX. Each issue subtracts from a baseline of 100. Default minimum score is 0; CI can `--min-score=80` to enforce.

- **`CORTEX_DESC_NOT_VERB_FIRST`** (-10) — description should start with a 3rd-person verb (`Validates`, `Scores`, `Audits`, …). Read-out-loud test: "If it does not start with a clear verb, rewrite it." Source: [Nick Babich (UXPlanet, April 2026)](https://uxplanet.org/7-rules-for-creating-an-effective-claude-code-skill-2d81f61fc7cd).
- **`CORTEX_DESC_NO_TRIGGER`** (-15) — description should list at least one natural-language trigger phrase ("Triggers `/cortex-doctor`", "ask 'is cortex healthy'", "type 'doctor'"). Without explicit trigger surface, fuzzy-match has nothing to anchor on.
- **`CORTEX_DESC_INTERNAL_JARGON`** (-10/match) — description must not surface cortex-internal jargon (`action_kind`, `spec-verifier`, `STEWARD_HALT`, `edit_ops`, `EX_TEMPFAIL`, …). Per the operator's standing rule "slug/kebab-case/profile names stay agent-internal" — operator-facing surfaces must speak operator language.
- **`CORTEX_DESC_TOO_TERSE`** (-5) — description < 60 chars. Fuzzy-match triggering needs richer language; one-sentence descriptions miss most trigger phrases.

## Security mode (`--security`)

Off by default. When enabled, regex-scans SKILL.md body for **ToxicSkills** payload classes (Snyk Feb 2026 + agensi May 2026 advisories). **Warn-only — false positives are high.** The operator decides.

Patterns matched (all carry the Snyk citation in output):

- `TOXIC_CREDENTIAL_EXFIL` — `$ANTHROPIC_API_KEY` / `$AWS_ACCESS_KEY_ID` / `$AWS_SECRET_ACCESS_KEY` / `$OPENAI_API_KEY` references in body
- `TOXIC_CRED_PATH` — paths to `~/.aws/credentials`, `~/.ssh/id_*`, `~/.config/gcloud`
- `TOXIC_BASE64_EXEC` — `base64 -d | sh` / `echo … | base64 -d | bash`
- `TOXIC_EVAL_CURL` — `eval $(curl …)` remote code exec
- `TOXIC_OUTBOUND_EXFIL` — `curl https://x?data=$(…)` command-substituted exfiltration
- `TOXIC_PASSWORD_ARCHIVE` — `unzip -P` / `7z x -p` (evades scanners)
- `TOXIC_SETTINGS_TAMPER` — `rm -rf ~/.claude/` / `sed -i ~/.claude/settings.json` (security-mechanism disablement)

ToxicSkills numbers (Snyk Feb 2026, [audit](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/)): 3,984 skills scanned, 1,467 with security flaws, 76 confirmed malicious payloads, 8 still live at publication. ClawHavoc (Feb 2026): 341 malicious skills in ClawHub specifically. Mobb.ai (March 2026): 22,511 skills across 4 registries, 140,963 issues.

## Usage

```bash
# Validate all skills under shared/skills/ (default)
cortex-skill-validate

# Validate one skill directory
cortex-skill-validate --dir=shared/skills/cortex-doctor

# Spec-only mode (skip Claude-Code-only warnings)
cortex-skill-validate --target=agentskills

# CI gate
cortex-skill-validate --json --min-score=80

# Include ToxicSkills security scan
cortex-skill-validate --security
```

Exit codes:

- `0` — all skills pass Tier A and meet `--min-score` for Tier C
- `1` — at least one Tier A FAIL or Tier C below minimum
- `2` — internal error (bad flag, file read error)

## Composes with

- [`standards/skills.md`](./skills.md) — agentskills.io spec adoption + portability rules
- [`bin/cortex-skill-validate.cjs`](../bin/cortex-skill-validate.cjs) — the CLI
- [`bin/cortex-doctor.cjs`](../bin/cortex-doctor.cjs) — calls `cortex-skill-validate` in health-check flow (Sprint 2.22.1 planned)
- [agnix](https://github.com/agent-sh/agnix) — runs first for broad spec lint; cortex-skill-validate runs AFTER

## What's out of scope (v0)

- **LLM-as-judge content quality** — agent-ecosystem/skill-validator already does it; cost + nondeterminism. Defer to v1.1.
- **Anthropic Skill Creator eval loop** (`--eval` mode) — 20-query trigger-eval against a candidate description with 60/40 train/test split + 3 runs/query + 5 iter description-rewrite. Designed; deferred to Sprint 2.22.1 when Claude SDK seam is wired into bin/.
- **Autofix** — agnix does this. cortex-skill-validate surfaces issues, doesn't rewrite.
- **CI workflow integration** — manual today; `steward-skill-quality.yml` cron in Sprint 2.22.2.

## References

- agentskills.io spec — https://agentskills.io/specification
- Anthropic skill authoring — https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- agnix (npm, broad lint) — https://github.com/agent-sh/agnix
- agent-ecosystem/skill-validator (Go, LLM-judge) — https://github.com/agent-ecosystem/skill-validator
- Anthropic Skill Creator — https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
- Snyk ToxicSkills (Feb 2026) — https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/
- agensi crisis briefing (May 2026) — https://www.agensi.io/learn/toxicskills-clawhavoc-agent-skills-security-crisis-2026
- OWASP Agentic Skills Top 10 — https://owasp.org/www-project-agentic-skills-top-10/
- Sprint 2.22 R1 memo — `docs/research/sprint-2.22-skill-quality-2026-05-14.md`
