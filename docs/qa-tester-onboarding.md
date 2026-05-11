# QA tester onboarding — day-1 walkthrough

> **Language status:** the full walkthrough currently exists in Czech only at [`qa-tester-onboarding.cs.md`](./qa-tester-onboarding.cs.md). An English translation is roadmapped (see [steward-roadmap.md](./steward-roadmap.md) → Sprint LR).

## TL;DR (English)

When you install cortex-x with the `qa-tester` profile, the framework primes a single skill — `/test-audit` — that turns Claude Code into a **senior-QA-consultant-as-a-service**. The day-1 deliverable is a 30-minute audit of a target repo: gaps prioritised P0/P1/P2, each gap backed by a 200-word web-fetched memo with implementation patterns + cited URLs.

## Install (English)

```bash
# Option 1 — env var
CORTEX_PROFILE=qa-tester curl -fsSL https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.sh | bash

# Option 2 — CLI flag
./install.sh --profile=qa-tester

# Option 3 — interactive
./install.sh        # picker: select 'qa-tester'
```

After install:

```bash
cd ~/repo-to-audit
claude              # `/test-audit` is pre-armed; type `/test-audit` to start
```

## What the audit produces

- `cortex/qa/AUDIT.md` — 12-dimension audit (test pyramid, mutation score, eval coverage, contract tests, property tests, etc.)
- `cortex/qa/recommendations.md` — P0/P1/P2 gap list, each item with linked research memo
- `cortex/qa/research/<slug>-<date>.md` — per-gap web-fetched memos with 3-hop citation traceability (claim → finding → URL)

## Full walkthrough

The complete day-1 walkthrough (Czech, ~160 lines) lives at [`qa-tester-onboarding.cs.md`](./qa-tester-onboarding.cs.md). It covers:

- The 12 audit dimensions
- How to interpret the recommendations
- When to re-run the audit (after major refactors, framework upgrades)
- How to chain `/test-audit` → `/cortex-init` for full project bootstrap
- Common gaps and their canonical fixes

If you'd like to contribute an English translation, see [`CONTRIBUTING.md`](../CONTRIBUTING.md).
