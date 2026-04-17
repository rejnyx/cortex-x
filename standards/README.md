# cortex-x Standards

> The **9 principles** every cortex-x-scaffolded project inherits. Read these once — they're what separates senior-level output from hobby code.

## The 9 pillars

| # | Standard | What it enforces |
|---|----------|------------------|
| 1 | [SSOT](./ssot.md) | One source of truth per piece of knowledge |
| 2 | [Modular](./modular.md) | Isolated subsystems with clean interfaces |
| 3 | [Scalable](./scalable.md) | Patterns that survive 10x growth |
| 4 | [Security](./security.md) | Layered defense, 8-layer model |
| 5 | [Testing](./testing.md) | Layered coverage, 5 pillars per test |
| 6 | [Observability](./observability.md) | See what's happening in production |
| 7 | [Performance](./performance.md) | Core Web Vitals, DB indexes, streaming |
| 8 | [Accessibility](./accessibility.md) | WCAG 2.2 AA, keyboard, screen reader |
| 9 | [Error handling](./error-handling.md) | Classify, recover, user-friendly |
| 10 | [Git workflow](./git-workflow.md) | Clean history, atomic commits, safety |
| 11 | [Documentation](./documentation.md) | Knowledge that outlives memory |
| 12 | [AI Patterns](./ai-patterns.md) | Agentic-ready architecture as 2026 default |

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
