---
id: eval-003
name: project-scan-existing
category: scan
version: 1.0
---

# Eval 003 — Project-scan on existing project

## Input

Open Claude Code session at the **cortex-x repo itself** (`$CORTEX_HOME`, default `~/cortex-x`). Paste `~/.claude/shared/prompts/project-scan.md`.

Cortex-x is a known existing project with: package.json (no, this is markdown framework), CLAUDE.md, MEMORY.md, standards/, prompts/, profiles/, agents/, hooks/, ~30 commits. Realistic surface for scanner.

## Expected properties

### Must have

- [ ] Output is a 5-section summary mapping to `~/.claude/shared/templates/projects/<slug>.md` slim schema:
  1. **Identity** (1 paragraph: what this project IS)
  2. **Active Decisions** (current architectural choices)
  3. **Open Questions** (unresolved tradeoffs, current debates)
  4. **Cross-Project Dependencies** (links to relo / chatbot-platform / waas / kiosek if relevant)
  5. **Glossary** (domain terms specific to this project)
- [ ] Each section has actual content from project (not placeholder)
- [ ] Output written to `~/.claude/shared/projects/cortex-x.md` (or proposes diff if file exists)
- [ ] Git commit (or proposed commit) message follows convention: `knowledge: cortex-x — <date>` or similar

### Must NOT have

- [ ] **No Tech Stack section** — that lives in CLAUDE.md, would create SSOT drift
- [ ] **No Directory Structure section** — that lives in CLAUDE.md too
- [ ] **No Recent Changes section** — git log is the source of truth, not a stale capture
- [ ] No Lessons Learned auto-extraction without retrospective trigger (that's `retrospective.md`'s job)
- [ ] No more than 5 sections total (slim schema is non-negotiable)

### Should have

- [ ] Identity ≤2 sentences (not a marketing paragraph)
- [ ] Active Decisions cite commit SHAs or file paths (grounded, not paraphrased)
- [ ] Cross-Project Dependencies actually link to existing `cortex-x/projects/*.md` files where applicable
- [ ] Glossary entries are project-specific (e.g., "3-fronta rule", "Rule 1.5", "BAIL flow") — not generic dev terms
- [ ] If cortex-x.md already exists, output is a diff/append proposal, never a full overwrite

## Scoring rubric

- **1.0** — Exactly 5 sections, all must-have content present, no SSOT-drift sections, all should-have nice-to-haves landed
- **0.9** — Exactly 5 sections, content correct, 1 should-have missed
- **0.8** — Exactly 5 sections but 1 minor inaccuracy in content
- **0.6** — 6 sections (Tech Stack snuck back in — SSOT drift, the eval's whole point)
- **0.4** — Identity good but other sections shallow / generic
- **0.0** — Less than 5 sections, OR overwrote existing file without diff, OR generated content not grounded in project files

## Adversarial probes

- **Did Tech Stack get duplicated?** Expected: NO. The slim schema explicitly excludes it.
- **Did Recent Changes section appear?** Expected: NO. Use git log instead.
- **Did Lessons Learned get auto-populated?** Expected: NO. That's retrospective.md's job (4-question driven).
- **Was an existing cortex-x.md overwritten silently?** Expected: NO. Diff or stop.
- **Were Cross-Project Dependencies invented?** Expected: NO. Only cite if grep finds explicit cross-references in code/docs.

## Notes for evaluator

The whole point of the slim 5-section schema is **anti-duplication**. If a scanner tries to be helpful by including Tech Stack + Directory Structure + Recent Changes, it CREATES the drift problem cortex-x is built to prevent. The schema's restraint is the load-bearing design choice.

This eval is the canary for "scan prompt forgot why it's slim." Catching a 6-section regression is the entire reason this eval exists.
