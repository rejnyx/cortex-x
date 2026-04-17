# Research Protocol — cortex primitive

> **Jeden zdroj pravdy** pro "kdy a jak dělá cortex-x web research". Referenced z každého promptu který research potřebuje. Config v [`config/research.yaml`](../config/research.yaml).

---

## TL;DR

Před velkými rozhodnutími cortex **automaticky** spouští 2-5 paralelních research agentů, cachuje výsledky do `research/`, a čerpá z cache když je fresh. Dave se nemusí ptát. Budget + anti-trigger chrání před noise a cost.

---

## When to invoke

Spusť research pokud **aspoň jeden trigger z `config/research.yaml`** sedí:

| Trigger | Kdy se spustí | Default agenti |
|---|---|---|
| `new_project_bootstrap` | `prompts/new-project.md` Phase 2 | 4 |
| `unknown_domain` | Project není v `projects/` library | 2 |
| `stale_cache` | Existing research >180 dní | 3 (refresh) |
| `major_decision` | User says "rozhodnutí / should we use X" | 2 (opt-in) |
| `security_sensitive` | Auth / PII / RLS / injection | 1 (security focus) |
| `explicit_flag` | User types `--research` | 3 |

## When to SKIP

**Nespustit** pokud aspoň jeden anti-trigger sedí:
- Trivial task (typo, rename, single-file edit)
- Cache hit < 7 dní
- User explicit: `--no-research` nebo "skip research"
- Env `CORTEX_OFFLINE=1`

## Protocol — jak to spustit

### 1. Check cache first

```
glob `{cortex_root}/research/<project-slug>-*.md`
→ najdi nejnovější
→ if age < topic_ttl[topic] → LOAD & use, don't spawn
→ if age < max_age_days → LOAD + optionally refresh
→ if age >= max_age_days → FORCE refresh
```

### 2. Spawn parallel research agents

Pro každou potřebnou roli (viz `config/research.yaml` → `agents.roles`):

```
Use Agent tool:
  subagent_type: general-purpose  (má WebSearch + WebFetch)
  description: "Research <role> for <project>"
  prompt: see template below
```

**Spawn paralelně v jednom tool_use bloku** — maximalizuje throughput.

### 3. Research agent template

```
You are researching <role> for <project description>.

**Goal:** <specific research question — not generic "tell me about X">

**Context:**
- Project: <one-liner>
- Stack: <from Phase 3 proposal or CLAUDE.md>
- User: <target user>
- MVP: <what's being built>

**Output requirements (cortex-x protocol):**
- Max <max_words_per_agent_report> words
- ≥2 sources per claim
- Prefer domains: anthropic.com, openai.com, vercel.com, supabase.com, github.com, official docs
- Structure: TL;DR (3 bullets) → Key findings (5 bullets) → Cited sources → Recommended action

**Budget:** max <max_websearch_per_agent> WebSearch, <max_webfetch_per_agent> WebFetch.

**Anti-patterns:**
- ❌ Generic overview ("AI is changing everything")
- ❌ No URLs ("research says...")
- ❌ Blog posts over official docs
- ❌ Content older than <topic_ttl[topic]> days
```

### 4. Cache results

Write to `{cortex_root}/research/<project-slug>-<YYYY-MM-DD>.md`:

```markdown
---
project: <slug>
date: <YYYY-MM-DD>
trigger: <which trigger fired>
agents: [<list of roles>]
cache_ttl_days: <from config>
cost_estimate: "~$0.20"  # rough WebSearch + LLM cost
---

# Research: <project name>

## Trigger
<why this was invoked>

## Agent outputs

### <role 1>
<agent report — 500 words max>

### <role 2>
...

## Synthesis
<2-3 bullets: what does this mean for the current decision>

## Recommended actions
- <concrete action 1 for current project>
- <concrete action 2>
```

### 5. Use in current prompt

Inject synthesis into the current prompt's decision flow:
- `new-project.md` Phase 3 proposal — "Co říká research" section
- `cortex-reflect.md` — grounding for surfaced insights
- `code-review.md` — security-auditor cites CVE research
- `retrospective.md` — pattern validation

---

## Budget enforcement

Per `config/research.yaml`:
- Max **1 research batch per session** (no spamming)
- Max **10 batches per week across all projects**
- Over-budget action: **warn + ask** Dave, don't silently execute

Check budget:
```
count research/ files from last 7 days
if >= 10:
  say: "Research budget exceeded (10/week). Use cache or wait. Override with --force-research."
```

---

## Output discipline (enforce)

**Every research report MUST:**
1. Have ≥2 citations per claim
2. Cite URLs (not "paper says")
3. Prefer official docs over blogs
4. Include recommended action for current project
5. Stay under word limit

**If a research report violates these:**
- Log to `insights/META-research-quality.md`
- Re-run with stricter prompt on next invocation
- After 3 violations → flag prompt template bug, ask Dave

---

## Anti-patterns (hard rules)

- ❌ Research on every prompt — noise + cost
- ❌ Research without caching — rework
- ❌ Single-agent research — always ≥2 for cross-validation
- ❌ Blog-post-heavy research — prefer docs
- ❌ Research cached forever — use TTL by topic
- ❌ Research results without cited URLs — worthless
- ❌ Research to "confirm" a decision Dave already made — rationalization

---

## Integration checklist (per prompt)

If a prompt needs research, add this snippet near the top:

```markdown
## Research (cortex primitive)

This prompt auto-invokes research protocol when trigger matches.
See [`config/research.yaml`](../config/research.yaml) for triggers.
Protocol: [`shared/research-protocol.md`](../shared/research-protocol.md).

Cached results land in `research/<slug>-<date>.md`.
User can skip with `--no-research` in the input.
```

---

## Evolution

Research protocol's own effectiveness gets audited quarterly:
- Hit rate (how often cache saves a call)
- Dismissal rate (how often Dave ignores research findings)
- Staleness (how often outdated cache leads to bad decision)

Log to `insights/META-research-<quarter>.md`. If dismissal rate >40%, research prompt template has bug → revisit.
