---
name: cortex-x (Personal Claude Code Framework)
slug: cortex-x
status: active-dev
last_scanned: 2026-04-17
scan_version: 1
scanned_by: Claude Opus 4.7
claude_md_reference: $CORTEX_HOME/CLAUDE.md
---

# cortex-x — AI-Agentic-First Claude Code Framework

## 1. Identity

- **One-liner:** Personal Claude Code framework by Rejnyx — bootstraps new projects with agentic-ready architecture + standards + self-improvement loop in under 3 minutes
- **Repo:** https://github.com/Rejnyx/cortex-x (private)
- **Live:** distributed via `install.sh`/`install.ps1` to `~/.claude/shared/`
- **Owner / Stakeholders:** Dave (David Rajnoha). Single-user today; architected to scale to team/community without rewrite
- **Status context:** Phase 1 foundation + Phase 5 self-improvement loop v1 shipped. Journal substrate just landed (2026-04-17) — first data flowing

For Tech Stack / Architecture / Commands / Repo Structure → **read `$CORTEX_HOME/CLAUDE.md` live**.

## 2. Key Decisions (ADR-lite)

- **SSOT between framework and project** — cortex holds institutional wisdom (stable), project CLAUDE.md holds current state (rots in weeks). Zero overlap. — 2026-04 — active
- **Rule 1 as tier-1 inviolable contract** — SSOT + Modular + Scalable are blockers, not warnings. Enforced at scaffold + hook + review + evolve — 2026-04-17 — active (commit 793dbe5)
- **Self-improvement loop = PR-only, never auto-merge source of truth** — framework proposes, Dave disposes. Standards/prompts/profiles human-only; insights/proposals/ auto-writeable — 2026-04-17 — active (commit 58fcd1c)
- **Hard anti-hallucination gates on insight mining** — min 3 events, ≥2 projects, >7-day spread, ≥3 citations, Bonferroni correction. Silence > noise. — 2026-04-17 — active
- **Auto-research as cortex primitive, not just new-project** — triggered by unknown domain / security-sensitive / major decision. Budget: 1 batch/session, 10/week. — 2026-04-17 — active (commit 1ac7be5)
- **Journal captures metadata, never content** — file contents, user prompts, API responses, secrets NEVER logged. PreToolUse + PostToolUse hook pair with tmpdir correlation for duration_ms — 2026-04-17 — active (this session)
- **Declarative tone, never inferred** — pending proposal in `insights/proposals/2026-04-17-tone-profiles.md`, research-grounded in arXiv 2509.12517 (sycophancy drift). — 2026-04-17 — proposed

## 3. Lessons Learned

### [TRANSFERABLE] Framework self-modification needs PR gate, not direct write — 2026-04-17

**What happened:** While designing the evolve loop, early drafts had the LLM directly editing `standards/*.md` when it detected patterns. Research (Anthropic constitutional AI, DGM post-mortem) showed this drifts within 3 iterations.

**Lesson:** Any self-improving system on soft artifacts (prompts, docs, scaffolds) MUST split `auto_improves` (append-only, sandboxed) from `human_only` (PR-reviewed). Applies to any Dave project that adds LLM-driven content generation: RELO agent memory, Chatbot Platform knowledge base, WaaS template generator. **Carbon-copy the `config/evolve.yaml` `auto_improves`/`human_only` split.**

### [TRANSFERABLE] Anti-hallucination gates must be hard, not heuristic — 2026-04-17

**What happened:** Initial evolve design had "high confidence" as a soft threshold. Would have generated 20+ insights/week from small-N patterns.

**Lesson:** Gates = numerical hard-deny (min_events=3, min_projects=2, min_days_span=7, ≥3 citations, Bonferroni). Anything else = hallucination-prone. Same principle applies to: RELO autoDream promotion, Chatbot Platform feedback ingestion, any pattern-mining pipeline. **Quantify the gate, don't vibe-check it.**

### [PROJECT-SPECIFIC] Windows + Unix line-ending enforcement via `.gitattributes` — 2026-04

**What happened:** Early cortex-x distribution had `.cjs` hooks landing as CRLF on Windows, breaking `node shebang` interpretation.

**Lesson:** `.gitattributes` with `*.cjs text eol=lf` + `*.ps1 text eol=crlf` is non-negotiable for cross-platform framework distribution. Not transferable to single-platform projects (RELO, Chatbot Platform are Linux-only via Vercel).

## 4. Cross-Project Dependencies

- **Consumed by:** RELO, Chatbot Platform, WaaS, Kiosek, Portfolio — all Dave projects have `~/.claude/shared/hooks/*` linked via `settings.json`
- **Consumes:** none (framework sits above projects, doesn't reach into them). One-way influence.
- **Insight-transfer candidates:** RELO autoDream pattern → informed cortex-x evolve L1/L2/L3 memory architecture. Chatbot Platform's adapter pattern → informs `profiles/chatbot-platform.yaml` scaffold.

## 5. Glossary

- **Rule 1** — SSOT + Modular + Scalable as tier-1 inviolable contract ([standards/RULE-1.md](../standards/RULE-1.md))
- **Evolve loop** — 4-cadence self-improvement: daily ingestion, weekly insight mining, monthly eval refinement, quarterly audit ([docs/self-improvement-rfc.md](../docs/self-improvement-rfc.md))
- **Hard gates** — numerical evidence thresholds in [config/evolve.yaml](../config/evolve.yaml) that an insight must cross before surfacing (min_events, min_projects, min_days_span, Bonferroni, citations)
- **Auto-research** — cortex primitive that triggers parallel WebSearch+WebFetch agents before major decisions. Config: [config/research.yaml](../config/research.yaml). Protocol: [shared/research-protocol.md](../shared/research-protocol.md)
- **Journal** — append-only JSONL of tool-call metadata (never content). Substrate for evolve pattern mining. Populated by PreToolUse + PostToolUse hook pair
- **human_only paths** — `standards/`, `prompts/`, `profiles/`, `agents/`, `module.yaml`, `CLAUDE.md`, `README.md`. Framework never auto-edits these, even from its own proposals
- **auto_improves paths** — `insights/**`, `insights/proposals/**`, `projects/*.md` (via PR), `journal/**`, `MEMORY.md`. Framework can write these within gates
- **Máma-mode** — laicky-explaining tone (from Dave's AMD hackathon project). Candidate for `profiles/tone/mama.yaml` per pending proposal

## 6. Active initiatives

- **Journal pipeline end-to-end** — hooks landed 2026-04-17, settings.json registration pending Dave's manual add (guardrail blocked direct edit)
- **First weekly evolve run** — scheduled for Sun 2026-04-19 04:00 UTC (first real data batch)
- **Tone profiles system** — proposal at `insights/proposals/2026-04-17-tone-profiles.md`, pending Dave review
- **AMD retrofit learnings integration** — insight at `insights/2026-04-17-amd-retrofit-gaps.md` flags 4 gaps; will be folded into next evolve pass (rule-1-auditor, LLM-prompt-injection bullet for security-auditor)

## 7. Open questions

- **Multi-user federation** — if cortex-x ships to 2+ users, does journal data flow to a central evolve aggregator, or stay fully local? (Dave has async: considering, see 2026-04-17 chat)
- **Eval suite expansion** — currently 1 canonical task (eval-001-scaffold-nextjs-saas.md). RFC target is 10. Which 9 tasks to add?
- **Cortex-x entry in its own library** — this file. Meta-reference. Session-start hook's `no entry for 'cortex-x'` warning disappears after 2026-04-17.

## 8. Audit cadence

- **Next quarterly audit:** 2026-07-17 (per `module.yaml:audit.first_audit_date`). Checklist: [docs/3-month-audit.md](../docs/3-month-audit.md) (if exists; otherwise create from RFC checklist)
- **Meta-review trigger:** every 30 insights logged (per `config/evolve.yaml:meta_review`)
