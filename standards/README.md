# cortex-x Standards

> The **12 principles** organized in 3 tiers. **Rule 1 is inviolable.** Read [`RULE-1.md`](./RULE-1.md) first — it establishes the hierarchy + active enforcement.

## Tier hierarchy

| Tier | Standard | Status | Enforcement |
|---|---|---|---|
| **🔒 RULE 1** | [Rule 1 meta-standard](./RULE-1.md) | — | Contract + active enforcement |
| | &nbsp;&nbsp;[SSOT](./ssot.md) | Inviolable | Scaffold + ssot-enforcer always-on + PR block |
| | &nbsp;&nbsp;[Modular](./modular.md) | Inviolable | ssot-enforcer + architecture-guard patterns |
| | &nbsp;&nbsp;[Scalable](./scalable.md) | Inviolable | RLS + indexes + rate-limits from day 1 |
| **⚠️ RULE 2** | [Security](./security.md) | Must-have | Review pipeline flag = blocker |
| (Critical) | [Testing](./testing.md) | Must-have | Review pipeline flag = blocker |
| | [Observability](./observability.md) | Must-have | Review pipeline flag = blocker |
| **📋 RULE 3** | [Performance](./performance.md) | Should-have | Review pipeline flag = warning |
| (Process) | [Accessibility](./accessibility.md) | Should-have | Review pipeline flag = warning |
| | [Error handling](./error-handling.md) | Should-have | Review pipeline flag = warning |
| | [Git workflow](./git-workflow.md) | Should-have | Review pipeline flag = warning |
| | [Documentation](./documentation.md) | Should-have | Review pipeline flag = warning |
| | [AI Patterns](./ai-patterns.md) | Should-have | Should-have for non-static profiles |
| | [AI SDKs](./ai-sdks.md) | Should-have | Required `ai_sdk:` key in every profile YAML |

## Why tiered

Security can be added. Testing can be retrofitted. Observability can be layered on.

**But Rule 1 violations compound into rewrites.** SSOT drift in a 50-file codebase = architectural surgery. Modular violation = cross-feature coupling hell. Scalable violation = works at MVP, dies at PMF.

Tier 1 is the only tier you can't fix later.

## Why 11 (not "9")

The docs-as-code, git workflow, and error handling are process standards. The first 8 are technical quality. Together they cover the full surface of "professional software development" that most indie projects skip.

## How to use

- **Reading:** Skim all once. Deep-read when you hit the topic in practice.
- **In projects:** Linked from CLAUDE.md. Referenced by review agents (code-reviewer checks against these).
- **In PRs:** Reviewer uses standards as checklist.
- **In review pipeline:** Specialized agents enforce subset (security-checker reads security.md, test-writer reads testing.md).

## What's NOT here

- **Language-specific style** (TypeScript, Python idioms) — project CLAUDE.md handles
- **Framework-specific** (Next.js routing, React patterns) — profile YAMLs handle
- **Domain-specific** (medical compliance, financial reporting) — project CLAUDE.md handles

Standards are universal. Profiles are domain-specific. CLAUDE.md is project-specific.

## Evolving

If a new pattern is learned (from incident, from review, from research):
1. Update relevant standard
2. Commit to cortex-x
3. Re-install → all future projects inherit
4. Existing projects pull update via their CLAUDE.md reference

This is the **cortex-x update cycle** — learn once, apply everywhere.
