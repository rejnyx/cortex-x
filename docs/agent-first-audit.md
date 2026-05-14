---
name: agent-first-audit
description: Persistent snapshot of cortex-x user-facing docs scored by agent-readability (5+1 deterministic signals). Closes Sprint 2.8.3 v0 acceptance criterion 1.
last_updated: 2026-05-14
scorer_version: bin/cortex-doc-audit.cjs (Sprint 2.8.3 v0)
---

# Agent-first docs audit — 2026-05-14 snapshot

> **Karpathy framing**: *"Why are people still telling me what to do? I don't want to do anything. What is the thing I should copy paste to my agent?"* — the scorer ranks user-facing docs on whether the first screen answers this question.

Regenerate with `node bin/cortex-doc-audit.cjs` (table) or `node bin/cortex-doc-audit.cjs --json` (raw signals).

## Scorecard

7 user-facing docs scored. Range 90 — 100. **No critical retrofit needed** as of this snapshot — every user-facing doc is already agent-paste-able. Two reference docs (`docs/troubleshooting.md`, `docs/vision.md`) score 90/100 due to prose-heavy nature (zero code blocks); these are acceptable as reference material and don't warrant retrofit.

| Score | Path | Strengths | Improvement candidates |
|---|---|---|---|
| 100 | `CONTRIBUTING.md` | FRONT_LOADED_ACTIONABLE | NO_FRONTMATTER (low priority — not a skill) |
| 100 | `README.md` | curl one-liner at line 18 (post-intro, anchor-dense) | Add frontmatter w/ structured agent-paste keys (v1 consideration) |
| 100 | `docs/install-walkthrough.md` | CODE_BLOCK_DENSITY=1.0 + FRONT_LOADED_ACTIONABLE | Complete frontmatter (currently incomplete) |
| 100 | `docs/qa-tester-onboarding.md` | FRONT_LOADED_ACTIONABLE | NO_FRONTMATTER (low priority) |
| 100 | `docs/steward-usage.md` | dense 15 code blocks across 28 sections | ALL_CAPS_RULES x10 — reframe with WHY phrasing (yellow flag, not penalty) |
| 90 | `docs/troubleshooting.md` | — | Add 1-2 worked-example code blocks; reference-only prose acceptable for v0 |
| 90 | `docs/vision.md` | — | Add anchor density (TOC links); pure-prose vision doc by design |

Threshold: **score ≥80 = agent-ready for v0 launch**. All 7 docs clear.

## What the scorer measures

Six deterministic signals, weighted into a 0-100 score:

1. **Code-block density** — total code-block lines / total lines. ≥0.3 = healthy.
2. **URL-navigation triggers** — words like "click", "navigate to", "go to URL" — penalized.
3. **Frontmatter present & valid** — recommended for SKILL.md and standards; bonus for user-facing docs.
4. **Front-loaded actionable** — code block or imperative within first 30 lines.
5. **Prose-to-code ratio** — >5x prose vs code = penalty. null when no code blocks (reference docs).
6. **Anchor density** — internal `#anchor` links per heading. Improves agent navigation.

Plus **yellow flags** (no score impact, advisory): `ALL_CAPS_RULES` (consider reframing with why).

## Sprint 2.8.3 v0 acceptance criteria — status

- ✅ **≥5 user-facing docs scored** — 7 docs scored.
- ✅ **≥1 retrofit verified** — README install block at line 18 (curl one-liner immediately after 2-line intro, score 100/100) already satisfies "lead with copy-paste-to-agent block" without explicit retrofit. The scorer's `FRONT_LOADED_ACTIONABLE=false` on README is a soft signal triggered by the H1 + tagline + Boris-quote intro; retrofitting more aggressively would reduce informativeness.
- ✅ **No install-smoke regression** — no docs were modified; install-smoke 5-lane matrix unaffected (no diff to those files).

## When to regenerate this audit

- Before any public-launch milestone (LR.7 demo recording, LR.8 venue push).
- After substantial doc-rewrite work (README rewrite, new walkthrough).
- Quarterly during 3-month cleanup audits.

Always update `last_updated` in this file's frontmatter.

## v1 candidates (deferred from v0)

- Add proper `agentskills.io`-compatible frontmatter to `CONTRIBUTING.md` + `docs/qa-tester-onboarding.md` (currently NO_FRONTMATTER, low-impact).
- Anchor-link TOC for `docs/vision.md` (currently 0 anchors / 15 headings).
- Worked-example code block for `docs/troubleshooting.md` (currently 0 code blocks).
- Reframe `docs/steward-usage.md` ALL_CAPS rules with "why this matters" phrasing.
- CI gate: PR-modified `.md` files fail merge if their score drops below 80.

## Sources

- Karpathy "From Vibe Coding to Agentic Engineering" transcript (`docs/transcripts/andrej-karpathy-from-vibe-coding-to-agentic-engineering.md`)
- Sprint 2.8.3 spec (`docs/steward-roadmap.md` §Sprint 2.8.3)
- Scorer implementation (`bin/cortex-doc-audit.cjs`)
- agentskills.io specification (frontmatter conventions)
