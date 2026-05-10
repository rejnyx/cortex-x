# DevOps Hygiene Cron — Research Brief for cortex-x Steward

**Date:** 2026-05-10
**Author:** research agent (autonomous)
**Question:** Should cortex-x add another scheduled action_kind for DevOps hygiene cleanup, or is current 9-kind palette sufficient?

## TL;DR

- **Add 1 new kind: `workflow_hardener`.** Pin `uses:` to SHAs, inject missing `permissions:`/`concurrency:`/`timeout-minutes:` blocks, audit branch-protection drift via `gh api`. This is the single biggest 2026 supply-chain gap not covered by `dep_update_patch`. GitHub's own 2026 roadmap mandates SHA pinning and workflow lockfiles — get ahead of it.
- **Add 1 narrow kind: `secret_history_sweep`.** Weekly TruffleHog full-history scan with verification. Pre-commit hooks (which Steward doesn't manage) and `no-pii.yml` (regex-only) leave a real gap: rotated keys, deep history, verified-active credentials.
- **Skip the rest.** SBOM/license/CODEOWNERS/dotfiles drift are either covered by Dependabot+Scorecard, too low-signal for a personal framework, or better as one-shot retrofit prompts rather than nightly crons.

## §1 Hygiene candidates ranked

| Candidate | Verdict | Rationale |
|---|---|---|
| GitHub Actions SHA pinning + version drift | **must-add** | GitHub's Aug 2025 policy enforces SHA pinning; 2026 roadmap adds workflow lockfiles. Renovate handles version drift, but SHA pinning + missing `permissions:`/`concurrency:`/`timeout-minutes:` is workflow-hardening, not dep-update. StepSecurity Secure-Repo is the reference implementation. |
| Workflow `permissions:`/`concurrency:`/`timeout-minutes:` injection | **must-add** | Same kind as above. OWASP/Wiz/StepSecurity treat absence as a finding; one-shot fix per workflow file. Bundle into `workflow_hardener`. |
| Branch protection / ruleset drift via `gh api` | **must-add** | Folds into `workflow_hardener`. No dominant OSS tool for this; trivial `gh api repos/:o/:r/branches/main/protection` diff against committed YAML. |
| Secret scanning on **history** (TruffleHog verified) | **must-add** | Weekly cron consensus pattern. cortex-x has no-pii.yml regex-only; verified TruffleHog catches rotated-but-leaked keys, encoded blobs, 800+ secret types. Distinct from `pre-commit` (which is per-developer, not enforced). |
| OpenSSF Scorecard cron | **should-add (as workflow, not action_kind)** | One-line `ossf/scorecard-action@<sha>` weekly with SARIF upload. Not a Steward concern — pure GHA workflow. Add to scaffolding template. |
| SBOM (CycloneDX/SPDX) periodic refresh | **skip for cortex-x, add to profile templates** | cortex-x has no shipped artifact (no Docker, no npm publish yet). For SaaS profiles (`nextjs-saas`), template a `cyclonedx-node-js` GHA. Not a Steward action_kind. |
| License compliance / FOSSA-style drift | **skip** | Dependabot + `npm audit --omit=dev` covers high-signal cases. Transitive license drift on a noncommercial PolyForm repo is low-impact. Reconsider at Tier 3 productization. |
| `.gitignore` drift (tracked-but-ignored files) | **skip** | One-shot `git ls-files -i -c --exclude-standard` is a 5-line lint, not worth a kind. Add to `lint_fix_shipper` if signal appears. |
| Dotfiles consistency (.editorconfig, .nvmrc, .prettierrc) | **skip** | Greenfield concern, fixed once at scaffold time. Already covered by `cortex-doctor` drift check. |
| README badge/link freshness | **skip** | Low signal, high false-positive (rate-limited link checks). `markdown-link-check` weekly GHA if anything, not a Steward kind. |
| CODEOWNERS sync | **skip** | Personal framework, single maintainer. Add only at Tier 3 when team scales. |
| Pre-commit hook drift | **skip** | Steward doesn't enforce dev-machine config. Out of scope. |
| Container image age | **skip** | cortex-x ships no images. |
| Test count ratchet (regression alarm) | **should-add (cheap)** | Fold into `tech_debt_audit` snapshot — already writes JSON, just add `test_count` field + delta alarm. Zero new infra. |
| LICENSE ↔ package.json `license` field validation | **skip** | One-time check; assertion in test suite is enough. |

## §2 2026 consensus on code-as-self-auditing-system

The 2026 industry direction is **"shift hygiene left of CI, run it on a cron, generate PRs, never bother humans for routine fixes"** — exactly cortex-x's Steward thesis. Concrete signals:

- **GitHub Actions 2026 security roadmap**: workflow lockfiles (go.sum-style), centralized rulesets, SHA pinning enforced not just warned. Source: [github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions](https://github.blog/changelog/2025-08-15-github-actions-policy-now-supports-blocking-and-sha-pinning-actions/) and [github.com/orgs/community/discussions/190621](https://github.com/orgs/community/discussions/190621).
- **OpenSSF Scorecard** runs weekly cron over thousands of repos via BigQuery dataset `openssf:scorecardcron.scorecard-v2`. The autonomous-cron-with-public-results pattern is itself the standard. Source: [github.com/ossf/scorecard](https://github.com/ossf/scorecard) and [scorecard.dev](https://scorecard.dev/).
- **StepSecurity Secure-Repo** automates pinning + perms-injection via PRs — direct precedent for `workflow_hardener` action_kind. Source: [github.com/step-security/secure-repo](https://github.com/step-security/secure-repo) and [stepsecurity.io/blog/pinning-github-actions-for-enhanced-security](https://www.stepsecurity.io/blog/pinning-github-actions-for-enhanced-security-a-complete-guide).
- **TruffleHog weekly verified history scans** is the documented best practice, distinct from pre-commit Gitleaks. Source: [github.com/trufflesecurity/trufflehog](https://github.com/trufflesecurity/trufflehog) and [appsecsanta.com/sast-tools/gitleaks-vs-trufflehog](https://appsecsanta.com/sast-tools/gitleaks-vs-trufflehog).
- **Wiz / AquilaX hardening guides** treat missing `permissions:` block as a P1 finding post the 2024-2025 tj-actions/changed-files compromise wave. Source: [wiz.io/blog/github-actions-security-guide](https://www.wiz.io/blog/github-actions-security-guide) and [aquilax.ai/blog/github-actions-security-hardening](https://aquilax.ai/blog/github-actions-security-hardening).
- **Renovate-Mend** owns dep-version drift (90+ ecosystems, GHA included), but explicitly does *not* do workflow security hardening — the hardening niche is open. Source: [docs.renovatebot.com](https://docs.renovatebot.com/) and [mend.io/renovate](https://www.mend.io/renovate/).

## §3 Competitor scan — autonomous repo hygiene 2025-2026

1. **StepSecurity Secure-Repo** (closed-core SaaS + OSS GHA). Closest competitor to a `workflow_hardener` action_kind. Generates PRs that pin SHAs, add `permissions:`, add Harden-Runner. Free tier for OSS. **cortex-x differentiator:** offline, single-binary, integrated into Steward's policy/journal/cost stack — no external SaaS dependency.
2. **OpenSSF Scorecard + scorecard-action + scorecard-monitor**. Reads-only audit, surfaces issues but does not fix. Complement, not competitor — wire as a scheduled GHA workflow in cortex-x scaffold templates and let Steward consume the SARIF.
3. **Renovate-bot (Mend.io)**. Solves `dep_update_patch` more comprehensively than cortex-x's `dep_update_patch` for non-npm ecosystems. **Decision:** keep Steward's dep_update_patch for npm-only zero-deps story; document Renovate as the "production scaling" upgrade in profile templates.
4. **Dependabot (GitHub built-in)**. Free, default, 30+ ecosystems. Already-on for cortex-x. Covers security-update-only and version-update PRs. No workflow hardening.
5. **GitGuardian / TruffleHog Enterprise**. SaaS secret scanners. cortex-x's `secret_history_sweep` should wrap OSS TruffleHog CLI (Apache-2.0) directly, not the SaaS tier.

Honorable mentions: **Octolint** (Octopus Deploy-specific, not relevant), **opensauced.pizza** (community/contributor analytics, not hygiene), **github-mcp-server** (transport, not hygiene logic).

## §4 Concrete recommendation

**Add 2 new action_kinds, extend 1 existing.**

1. **`workflow_hardener`** (deterministic, weekly cron). Scans `.github/workflows/*.yml`. Operations: (a) replace `uses: actions/checkout@v4` with `actions/checkout@<sha> # v4` via `gh api`; (b) inject missing `permissions: { contents: read }` at workflow root if absent; (c) inject `concurrency:` and `timeout-minutes:` defaults; (d) `gh api` diff branch-protection JSON against `.github/branch-protection.json` SSOT. PR-only output, all gated by spec-verifier. Reference impl: StepSecurity Secure-Repo logic, but in zero-dep CJS.

2. **`secret_history_sweep`** (deterministic, weekly cron). Wraps `trufflehog git file://. --only-verified --json`. On verified hit: open `gh issue` with severity-LABEL, no auto-PR (revocation requires human). Independent of pre-commit hooks. Replaces and extends `no-pii.yml` regex coverage.

3. **Extend `tech_debt_audit`** with a `test_count` field in `cortex/debt-snapshot.json` and alarm if month-over-month delta < -5%. Zero new kind, ~10 LoC.

**Defer / reject:** SBOM, license-drift, dotfiles, README freshness, CODEOWNERS, pre-commit drift. Either out-of-scope (no shipped artifact yet), low-signal for single-maintainer repo, or better delivered as scaffolded GHA workflows in profile templates rather than Steward action_kinds.

**Sequencing fit:** Both new kinds slot into Tier 1 alongside Sprint 2.5 `tech_debt_audit` and Sprint 2.7 `pattern_transfer`. Recommend Sprint 2.5b (workflow_hardener) and Sprint 2.6b (secret_history_sweep), so they precede the public-launch tag.

---
**Citations live in §2.** Total word count ~680.
