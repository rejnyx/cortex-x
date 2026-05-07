---
phase: 5-synthesis
date: 2026-05-07
slug: cortex-x
based_on:
  audit: external senior review (2026-05-07) + Sprint 1.6.7 dogfood
  research: 3 parallel research briefs (topology, triggers/safety, git workflow) — see docs/hermes-research-synthesis.md
---

# Recommendations — cortex-x

This is cortex-x's own `recommendations.md`. Hermes v0 dogfood target.
Action items below derived from (a) external senior review 2026-05-07,
(b) Sprint 1.6.7 + 1.6.8 architectural decisions, (c) Sprint 1.6.9 isolation
discussion.

## DO this week (cited)

### 1. Pivot v1 trigger model from crontab to GitHub Actions
The current `docs/hermes-runtime.md` §1.2 default trigger is local crontab. After the 2026-05-07 isolation discussion: GitHub Actions is the natural fit for production projects (free per-project scheduling, ephemeral runner, built-in secrets, integrates with PR creation via `gh` CLI, mirrors project CI env). Local crontab stays as the cortex-x dogfood path only. Update `docs/hermes-runtime.md` §1.2 + `docs/hermes-rfc.md` "Architecture sketch" + add `.github/workflows/hermes.example.yml` template (commented-out, awaits v0.5 LLM seam to enable).
[audit: external review 2026-05-07] [src: hermes-research-synthesis.md § Trigger model]

### 2. Self-referential PII helper for verify-* validators
Three sightings this week of validators catching their own documentation: Tier 5 fixture README, Tier 7 `ship-ready.md`, cortex-doctor §13.7 — each documented a denylist by quoting the forbidden string, regex caught it. Pattern deserves a generic fix: introduce `<!-- denylist-example: ... -->` HTML-comment marker that all three validators (verify-prompts, verify-skills, verify-standards) skip during PII scan. Updates `tools/verify-prompts.cjs`, `tools/verify-skills.cjs`, `tools/verify-standards.cjs` + a contract test asserting marker is honored.
[audit: Sprint 1.6.8 commit 1b44be5 commit message] [src: third-occurrence-anti-pattern]

### 3. Tier 8 — agentskills.io v1 spec extensions
The last pre-launch tier gate. `tools/verify-skills.cjs` currently validates the agentskills.io v1 base spec (`name`, `description`, `compatibility`). Anthropic's Claude Code subagent extension adds optional `metadata:` block + `model:` field per skill (see `standards/skills.md`). Extend `verify-skills.cjs` to validate Anthropic extensions when present (don't require them — base spec stays SSOT) + add 3-5 contract tests covering both compliant-base + compliant-extended skills.
[audit: README.md "Phase 1 ✅ shipped" pre-launch tier gates] [src: agentskills.io/specification + docs.anthropic.com/en/docs/claude-code/skills]

## DO this sprint (cited)

### 4. v0.5 milestone — Claude Agent SDK integration
Wires the actual LLM seam: dry-run plan + `npm test` gate → `git commit -F -` → `gh pr create --draft`. **Crosses zero-deps invariant** (adds `@anthropic-ai/claude-agent-sdk`). Needs Dave's explicit decision before any imports land. See `docs/hermes-runtime.md` § "v0.5 milestone" for the exact seam point.
[audit: docs/hermes-runtime.md § v0 scope] [src: zero-deps-invariant-cross]

### 5. D-1 git history PII purge + v0.1.0 tag
1+ month ship-blocker. Per external review: "Phase 1 'in progress' už 1+ měsíc bez v0.1.0 tagu" + "D-1 (git history PII purge) je 🔴 Critical OPEN ship-blocker". Destructive force-push of git history → human-only operation. After D-1 closes: tag v0.1.0, flip repo public, soft-launch closed-beta.
[audit: external review 2026-05-07] [src: MIGRATIONS.md D-1 entry]

### 6. First production Hermes target — pick one of RELO / Kiosek / Chatbot Platform
After cortex-x dogfood proves stable for 3 weeks (per `docs/hermes-research-synthesis.md` v0 assumption #4), expand Hermes to one production project. RELO is the highest-value (most active, most tests, most patterns), Kiosek is the lowest-risk (smaller codebase, less customer impact). Decision deferred until cortex-x dogfood produces ≥3 successful weekly runs.
[audit: hermes-research-synthesis.md § v0 assumption #4] [src: 3-week-dogfood-window]
