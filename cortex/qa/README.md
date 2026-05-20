# cortex/qa/

This directory is populated by the `qa-tester` profile retrofit (`/test-audit` skill) and by Steward's `senior_tester_review` action_kind. On fresh install it's empty — content appears after you run a test audit on your project.

## Expected files after `/test-audit`

| File | Owner | When written |
|---|---|---|
| `AUDIT.md` | qa-tester retrofit | One-shot, on first `/test-audit` invocation |
| `testing-gaps.md` | qa-tester retrofit | Same as AUDIT.md — gap analysis output |
| `testing-strategy.md` | qa-tester retrofit | Same — proposed strategy |
| `senior-tester-YYYY-MM.md` | `senior_tester_review` cron | Monthly, written into `journal/` not here |

## Worked example (cortex-x dogfooding itself)

For reference content showing what a real `AUDIT.md` + `testing-gaps.md` + `testing-strategy.md` look like, see:

- `docs/dogfood-examples/qa-audit-cortex-x.md`
- `docs/dogfood-examples/qa-testing-gaps-cortex-x.md`
- `docs/dogfood-examples/qa-testing-strategy-cortex-x.md`

Those examples are cortex-x auditing **itself**, not a template for your project. Your audit will reference your code, your test layout, your stack.

## How to invoke

```bash
claude
/test-audit
```

The skill walks your repo, applies ISO 25010:2023 + OWASP ASVS 5.0 + Bach HTSM grounding, and writes the three files listed above.
