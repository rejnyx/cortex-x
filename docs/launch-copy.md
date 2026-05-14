---
title: Launch copy — cross-venue SSOT for taglines, pull-quotes, body drafts
audience: maintainer (use during launch week) + future launch-iteration contributors
date: 2026-05-14
status: living — Story C tagline locked; Story B Show HN body in progress
upstream_ssot: docs/positioning-evolution.md (wisdom-over-harness frame)
---

# Launch copy — cross-venue SSOT

Single source of truth for cortex-x launch copy across Product Hunt, Show HN, awesome-list entries, Twitter/X threads, and conference talk one-liners. Every artifact derives from [`docs/positioning-evolution.md`](./positioning-evolution.md) § The value split + the three Boris Cherny quotes captured in [`docs/transcripts/boris-black-vibecoding.md`](./transcripts/boris-black-vibecoding.md).

**Voice constraints** (per [`standards/voice.md`](../standards/voice.md)): no emotion words, no greetings, no forced enthusiasm. Boris quotes are citations not cortex's own voice — they keep the energy without violating the charter.

## Cross-venue anchor — three load-bearing assets

These three appear in nearly every launch surface; lock them once, reuse everywhere.

### Anchor 1 — Hero blockquote (already on README, commit `5fe74d3`)

> **Persistent memory across all your projects + an overnight maintenance agent that opens draft PRs while you sleep.** A Claude Code framework. Every new session reads what your last one ended with — your decisions, your lessons, your project history — so your next agent starts from where you actually are, not from zero.

### Anchor 2 — Boris Cherny pull-quote

> *"I sort of feel like loops are the future at this point. If you haven't experimented with it, highly highly recommend it."*

— Boris Cherny, creator of Claude Code, Sequoia "Why Coding Is Solved" May 2026 ([transcript excerpt](./transcripts/boris-black-vibecoding.md))

### Anchor 3 — Tagline (Product Hunt + meta tags + repo description)

**Locked at 51 chars (≤60 char Product Hunt cap):**

> Persistent memory + overnight autopilot for Claude Code.

**Rejected alternates** (kept here as drift-protection):

| Candidate | Why rejected |
|---|---|
| "The only framework you need for Claude Code." | Defensive pitch; invites comparison shopping; reads AI-slop generated |
| "Claude Code minus the amnesia." | Funny and viral on X but too cute for Product Hunt's serious-tooling audience |
| "26 standards · 2697 tests · Apache 2.0" feature list | Per positioning memo § "Pitching with metrics that age out" — feature counts depreciate |
| "Loops are the future. cortex-x is your loops + memory for Claude Code." | Strong only if Boris attribution is preserved; PH tagline format strips citation |

## Product Hunt launch packet

### PH tagline (60 char max)

> Persistent memory + overnight autopilot for Claude Code.

(51 chars — 9-char buffer for emoji/punctuation if PH submission strips formatting.)

### PH description (260 char max)

> A Claude Code framework. Persistent memory across all your projects + an overnight Steward agent that opens draft PRs while you sleep. Every new session reads what the last one ended with — your decisions, your lessons, your project history. Apache-2.0, zero runtime deps.

(259 chars — at the cap intentionally; cut "zero runtime deps" if PH adds trailing space.)

### PH first comment (maintainer voice, 1500 char target)

> I'm a full-stack developer and designer — not an ML researcher — and I built cortex-x because the model didn't know what my projects were about.
>
> Boris Cherny (creator of Claude Code) said something at Sequoia last week that captures it better than I can: *"The best person to write accounting software is a really good accountant... because they know the domain really well and coding is the easy part. It's knowing the domain that's the hard part."*
>
> Cortex-x is the markdown layer that holds the domain knowledge models still can't grow on their own: persistent memory across all my projects, the lessons I learned the hard way last quarter, the architectural decisions I made when I was fresh, the cross-project patterns I rediscover every time I open a new repo. Every new Claude Code session reads it automatically.
>
> Plus an overnight maintenance agent ("Steward") — Boris said *"loops are the future."* This is what I built before he said it. Steward reads my `cortex/recommendations.md`, picks the next item, runs the LLM, gates on `npm test`, opens a draft PR. I wake up with reviewable changes. Costs ~$0.001 per autonomous PR via OpenRouter, $0 via my Max plan's Agent SDK credit after 2026-06-15.
>
> v0.3-pre, public preview, Apache 2.0. Built solo over 6 months across my 6 active projects. Honest rough edges — see GitHub issues prefixed `[beta]`. Feedback is the most useful thing right now; PRs gated until v0.3 tag.

(1389 chars — under cap; remove the cost paragraph if PH wants shorter.)

### PH gallery image briefs (3 images, gallery does the explanation)

1. **Terminal screencast** — `curl install.sh | bash` → `claude` → `/cortex-init` → resulting `CLAUDE.md` content. Voiceover-free GIF, 30 seconds.
2. **`cortex-doctor` output** — full health-check table on a clean install, showing the 10 checks all green.
3. **Steward draft PR screenshot** — PR #X opened overnight, diff visible, journal cost line shown in PR description. Real PR from this repo's history (anonymize project name if needed).

## Show HN packet — DRAFT (Story B, to be finalized)

### Show HN title

> Show HN: cortex-x – persistent memory + nightly autopilot for Claude Code

(72 chars — HN title cap is 80, well under.)

### Show HN body — TO BE WRITTEN IN STORY B

Sections to cover per Sprint LR.9 Story B scope:

1. What it is — anchor on Boris quote #1 (loops are the future), cortex is the loops + memory stack
2. Why I built it — 6 operator projects across 6 months, frustration with re-explaining context every session
3. Honest limitations — v0.3-pre, research preview, single-operator dogfooded, Steward LLM occasionally over-eager (PR #10 closed 2026-05-14 because LLM duplicated existing content — surfacing this real failure mode is more credible than a marketing pitch)
4. Link to repo + demo asset (LR.7) + this transcript

DO NOT write the body until Story B explicitly fires. Placeholder kept here so the file shape is complete.

## Awesome-list entry copy (per Sprint LR.8 V4)

### One-line entry (for `awesome-claude-code` / `awesome-ai-agents-2026`)

> **[cortex-x](https://github.com/Rejnyx/cortex-x)** — Persistent memory across projects + overnight maintenance agent for Claude Code. Cross-session context, lessons journal, draft-PR pipeline. Apache 2.0.

### Two-line entry (for lists that allow context)

> **[cortex-x](https://github.com/Rejnyx/cortex-x)** — Persistent memory across projects + overnight maintenance agent for Claude Code. Apache 2.0.
> Every new session reads your decisions, lessons, project history. Overnight Steward reads `cortex/recommendations.md`, opens draft PRs gated on `npm test`. Cost: ~$0.001 per autonomous PR.

## Twitter / X thread skeleton (post-launch, week 2)

**Tweet 1 (anchor)**: Boris Cherny quote #1 with attribution + 1-line cortex framing + repo link.

**Tweet 2**: Concrete example of what persists across sessions — paste an actual `~/.cortex/projects/<slug>.md` snippet (anonymized) showing Tech Stack + Architecture + Key Decisions.

**Tweet 3**: Steward demo — a real journal entry showing $0.001 cost + tokens + branch name + draft PR URL. Screenshot of PR diff.

**Tweet 4**: The "wisdom over harness" thesis from `docs/positioning-evolution.md` — one diagram showing the value-split table.

**Tweet 5**: Install command + "what to expect" 60-second video link.

Author thread when Product Hunt + Show HN have both run AND demo asset (LR.7) exists.

## Conference talk one-liner (for "stand up briefly")

> *"I built a Claude Code framework that does two things: it remembers everything across all my projects, and it ships small overnight PRs while I sleep. Boris from Anthropic Labs said loops are the future. I just wanted my agent to know what my last six months taught it."*

(38 seconds spoken, useful for conference Q&A or podcast intros.)

## Cross-references

- [`docs/positioning-evolution.md`](./positioning-evolution.md) — upstream SSOT for value split + Boris quote derivation
- [`docs/steward-roadmap.md` § Sprint LR.9](./steward-roadmap.md) — sprint scope for Stories A/B/C/D
- [`docs/steward-roadmap.md` § Sprint LR.8](./steward-roadmap.md) — launch venue strategy that consumes these copy artifacts
- [`docs/transcripts/boris-black-vibecoding.md`](./transcripts/boris-black-vibecoding.md) — canonical Boris quote source
- [`README.md`](../README.md) hero — Anchor 1 ships here (commit `5fe74d3`)
- [`standards/voice.md`](../standards/voice.md) — voice charter all copy must respect
