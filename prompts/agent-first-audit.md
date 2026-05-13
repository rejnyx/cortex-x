---
name: agent-first-audit
description: Score user-facing markdown docs on agent-readability (5+1 deterministic signals); flag candidates for agent-first retrofit
---

# Agent-first docs audit — Sprint 2.8.3 v0

Operator-paced skill that runs the deterministic agent-readability scorer over a project's user-facing docs and surfaces candidates for retrofit.

## When to invoke

- Before a launch / public preview — flag any user-facing doc that still has human-UI breadcrumbs ("click the button in the sidebar"), no frontmatter, prose-heavy intro.
- After a doc rewrite — verify the retrofit landed.
- As a CI Action on PR-modified `.md` files (future).

## Karpathy framing

> "Why are people still telling me what to do? I don't want to do anything. What is the thing I should copy paste to my agent?"

The scorer ranks docs on whether they answer Karpathy's question on the first screen.

## Usage

```bash
# Score the 7 default user-facing docs in CWD
node bin/cortex-doc-audit.cjs

# Score specific paths (file or dir)
node bin/cortex-doc-audit.cjs --paths=README.md,docs/

# JSON output with full signal breakdown
node bin/cortex-doc-audit.cjs --json

# CI gate: exit 1 if any doc scores below threshold
node bin/cortex-doc-audit.cjs --min-score=60
```

## The 5+1 signal rubric

| # | Signal | Weight | Direction |
|---|--------|-------:|-----------|
| 1 | Code-block density (`fenced blocks / H2-H3 headings`, target ≥1.0) | +30 | good |
| 2 | URL-nav-trigger phrases ("click the", "go to the", "visit the dashboard", ...) | −25 per hit, capped at 4 | bad |
| 3 | YAML frontmatter present + valid (`name`, `description` per agentskills.io) | +20 | good |
| 4 | First fenced code block within first 800 chars (front-loaded actionable) | +15 | good |
| 5 | Prose-to-code ratio > 5 (prose-heavy, token waste) | −10 | bad |
| 6 | Anchor-link density (deep-linkable subsections) | +5 | nice |

Optional **yellow flag**: ALL-CAPS rule words (`ALWAYS`, `NEVER`, `MUST`) >3× — Anthropic skill-creator best practice says "reframe with why." No score impact.

## Acceptance criteria (when run as Steward action_kind in the future)

- `shell`: `node bin/cortex-doc-audit.cjs --min-score=60` exits 0.
- `file_predicate`: every `*.md` in `--paths` is scored exactly once.
- `regex`: scored docs report a finite numeric score in `[0, 100]`.

## Differentiation

No published "agent-readability score" framework exists in May 2026 — Fern teased an "Agent Score" but nothing public. cortex-x ships the convention with **transparent weights** and a **zero-deps CJS implementation** that any project can adopt.

## Sources

R1 synthesis (`docs/research/sprint-2.8.3-r1-agent-readability-2026-05-13.md` — see commit message for inline summary):
- [agentskills.io SKILL.md specification](https://agentskills.io/specification)
- [Anthropic Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Cloudflare Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/)
- [llms.txt canonical spec](https://llmstxt.org/)
- [Dachary Carey — Agent-Friendly Docs](https://dacharycarey.com/2026/02/18/agent-friendly-docs/)
- [Fern — How to write LLM-friendly documentation](https://buildwithfern.com/post/how-to-write-llm-friendly-documentation)
- [Augment Code — How to Build Your AGENTS.md](https://www.augmentcode.com/guides/how-to-build-agents-md)
