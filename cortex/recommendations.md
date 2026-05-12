---
phase: 1-scaffold
date: TODO
slug: TODO
based_on:
  audit: (paste your initial repo audit summary here)
  research: (paste related research memos here)
---

# Recommendations — <your project>

This is **your project's** `recommendations.md`. Steward (cortex-x autonomous
maintenance agent) reads this file on each nightly cron and works on items
under `## DO this week`.

**Each entry:**

- One `- [ ]` checkbox + a short title that fits in a Git commit subject
- 1-3 sentences of context describing what + why
- One or more `[audit: ...]` / `[src: ...]` citations grounding the claim
- Optional `[HUMAN-ONLY]` marker for items Steward should never autopatch

When Steward ships an item, it commits a `Steward-Action-Id` trailer
referencing this file's line; the next cron sees the marker and skips
the item.

For a worked example, see [`docs/dogfood-examples/recommendations-cortex-x-2026-05-09.md`](../docs/dogfood-examples/recommendations-cortex-x-2026-05-09.md)
— cortex-x's own historical recommendations queue.

## DO this week

(Add 3-7 small + specific items. Steward picks the first unchecked item
per cron unless `STEWARD_ACTION_ID` env pins a specific one.)

- [ ] _(example placeholder)_ Add a `## Troubleshooting` section to `README.md`
      explaining the three most common install failures.
      [audit: GitHub issues #X, #Y, #Z all asked variants of the same question]

## DO this sprint

(Larger items Steward should NOT autopatch — operator owns these.)

- [ ] [HUMAN-ONLY] _(example placeholder)_ Migrate database schema from v3 to v4.

## Backlog (someday)

(Capture wishes here; reorder up to `DO this week` when ready.)

- _(example placeholder)_ Add Playwright UI verification for the checkout flow.
