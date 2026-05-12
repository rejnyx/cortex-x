# docs/dogfood-examples/

Real artifacts from cortex-x using its own tooling on itself. These are **examples**, not templates — your equivalents will reference your code, your stack, your sprints.

## What's here

| File | What it shows |
|---|---|
| [`recommendations-cortex-x-2026-05-09.md`](./recommendations-cortex-x-2026-05-09.md) | A real `cortex/recommendations.md` mid-sprint, with `[HUMAN-ONLY]` markers, citation footers, and DO-this-week / DO-this-sprint splits. |
| [`qa-audit-cortex-x.md`](./qa-audit-cortex-x.md) | A real `/test-audit` output (ISO 25010 + OWASP ASVS + Bach HTSM grounded), auditing cortex-x's own test suite. |
| [`qa-testing-gaps-cortex-x.md`](./qa-testing-gaps-cortex-x.md) | Gap analysis paired with the audit. |
| [`qa-testing-strategy-cortex-x.md`](./qa-testing-strategy-cortex-x.md) | Proposed test strategy paired with the audit. |

## Why public

Two reasons:

1. **Trust signal.** "Framework that audits itself" is easier to verify than "framework that claims to audit your repo."
2. **Learning material.** Reading a real `recommendations.md` mid-flight is more useful than reading a stub template — the citation discipline, scope hygiene, and `[HUMAN-ONLY]` boundary are visible in practice.

## Not a template

If you're starting your own project, do NOT copy these files into `cortex/` — they reference cortex-x's own commits and history. Instead:

- Start from the template at [`cortex/recommendations.md`](../../cortex/recommendations.md)
- Run `/test-audit` on YOUR repo to generate YOUR `cortex/qa/AUDIT.md` etc.

These files snapshot cortex-x at 2026-05-09 / 2026-05-12. They may drift from the current code; that's fine — they're historical examples.
