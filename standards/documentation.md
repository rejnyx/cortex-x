# Documentation — Knowledge That Outlives Your Memory

> In 6 months, you won't remember why you made this choice. In 12 months, nobody will. Write things down that your future self (or teammate) will need.

## Philosophy

**Document decisions, not code.** Code explains itself (with good naming). Comments explain why.

**SSOT applies to docs too.** Same info in 3 places will drift. One canonical location per topic.

**Write for the reader, not yourself.** What do they need to know? What's their context?

## Hierarchy

### Project-level

| Doc | Purpose | Audience |
|-----|---------|----------|
| **README.md** | What is this, how to run it | New contributors, users |
| **CLAUDE.md** | Architecture, conventions, tech stack | AI agent + future self |
| **PROGRESS.md** | Sprint state, what's done, what's next | Team, self |
| **MEMORY.md** | Cross-session context for AI | AI agent |
| **LICENSE** | Legal terms | Users |
| **CHANGELOG.md** | Version history (for libraries) | Users |
| **CONTRIBUTING.md** | How to contribute | External contributors |

### Code-level

| Where | What |
|-------|------|
| **JSDoc on public APIs** | Functions exposed to other modules |
| **Inline comments** | Non-obvious WHY only (not WHAT) |
| **README in subdirs** | Folder-level context (e.g., `lib/ai/README.md`) |
| **Architecture Decision Records** | `docs/adr/` for major decisions |

## README.md — the front door

Must answer:

1. **What is this?** (1 sentence)
2. **Who is it for?** (1 sentence)
3. **Quick start** (install, run commands)
4. **Architecture overview** (link to CLAUDE.md for depth)
5. **Development** (common commands)
6. **Deployment** (where and how)
7. **License + contact**

Bad README:
- ❌ "My project" + nothing else
- ❌ Just install instructions
- ❌ No way to know what the project does
- ❌ Outdated (still says "coming soon" 6 months later)

## CLAUDE.md — the brain

For AI agent + senior-dev level onboarding:

1. **Project description** — what + why
2. **Tech stack** — concrete versions
3. **Architecture** — diagram or prose, how pieces connect
4. **Conventions** — TypeScript strict, Czech UI, OKLCH, etc.
5. **Directory structure** — ASCII tree
6. **Development commands**
7. **Environment variables**
8. **Key files** — top 10 files to understand the project
9. **Non-obvious decisions** — "we use X because Y, don't replace without reading Z"

## PROGRESS.md — sprint state

Format:

```markdown
### Fáze 1: Foundation ✅

| Story | Popis | Stav |
|-------|-------|------|
| 1.1 | Setup Next.js + Supabase | done |
| 1.2 | Auth flow | done |

### Fáze 2: Core Feature 🔄

| Story | Popis | Stav |
|-------|-------|------|
| 2.1 | API routes | in-progress |
| 2.2 | UI components | pending |
```

States: `pending` → `in-progress` → `done` → `blocked` (with reason)

## Comments — the WHY only

### Good comments

```ts
// Retry up to 3x — Supabase occasionally returns transient 503 under load
for (let i = 0; i < 3; i++) { ... }

// Strip $schema — OpenAI Chat Completions rejects JSON Schema with this field
delete schema.$schema
```

### Bad comments

```ts
// increment counter
counter++

// Get user from DB
const user = await getUser(id)

// Loop through items
for (const item of items) { ... }
```

These explain WHAT is already visible in the code. Delete them.

### Comment rot

Comments that contradict code are worse than no comments. Every time you change code:
- Update the comment
- Or delete the comment if no longer relevant

## JSDoc on public APIs

```ts
/**
 * Analyzes property photos using gpt-4o Vision.
 *
 * @param propertyId - UUID of the property
 * @param photoUrls - Public URLs of photos to analyze (max 10)
 * @returns Auto-tags, condition score, and defects found
 * @throws ValidationError if photoUrls is empty or > 10
 *
 * @example
 * const result = await analyzePhotos(propertyId, ['url1', 'url2'])
 */
export async function analyzePhotos(...) { }
```

Only on **public APIs** — functions exported and consumed by other modules. Internal functions don't need JSDoc if their name is clear.

## Architecture Decision Records (ADRs)

For major decisions that affect the codebase long-term:

```markdown
# ADR-001: Use Chat Completions API over Responses API

Date: 2026-03-15
Status: Accepted

## Context
OpenAI has two APIs: Chat Completions (stable) and Responses (newer).
We need tool calling with gpt-5.x models.

## Decision
Use Chat Completions (`openai.chat()`).

## Reason
Responses API has documented bug with gpt-5.x + tool calling that
causes tool_call_id mismatches. Chat Completions is stable.

## Consequences
- Slightly older API surface
- Need to monitor if Responses gets fixed
- Chat Completions has longer support track record
```

Store in `docs/adr/`. Number them sequentially. Never delete — add "Superseded by ADR-042" instead.

## Living documentation

### OpenAPI for APIs

- Generate from code (Zod → OpenAPI via `zod-openapi`)
- Serve `/docs` with Swagger UI or Scalar
- Stays in sync with actual API

### Storybook for components

- One story per variant
- Tests + docs + playground in one
- Design system SSOT

### TypeDoc for libraries

- Auto-generate API docs from TSDoc comments
- Deploy to GitHub Pages

## Rules

1. **Update docs in same PR as code.** Don't defer.
2. **Docs in version control.** Not in Notion/Confluence where they die.
3. **Docs close to code.** `lib/ai/README.md` > centralized wiki.
4. **Diagrams over prose** for complex systems. Mermaid in Markdown.
5. **Examples over specs.** Show, don't tell.
6. **Delete stale docs.** Wrong info is worse than missing info.

## Anti-patterns

- ❌ "TODO: document this" that sits for a year
- ❌ Wiki pages nobody reads or updates
- ❌ Comments explaining obvious code
- ❌ Docs that contradict current behavior
- ❌ "See the code" as documentation
- ❌ Massive docs nobody reads (SHORTER is better)
- ❌ Documentation in language no one on team speaks

## Verification

- New dev can run the project within 15 minutes of cloning — README works
- Can answer "why did we do X?" by reading docs (not asking team) — decisions captured
- CLAUDE.md makes AI agent productive within first prompt — architecture explained
- Docs are updated in every feature PR — living, not stagnant

## For Dave's projects

- **CLAUDE.md** — comprehensive (AI agent needs full context)
- **README.md** — proprietary banner + what-it-does + contact
- **PROGRESS.md** — Sprint table with states
- **MEMORY.md** — multi-layer (index + files)
- **LICENSE** — proprietary for client work, MIT for open framework
- **docs/** — ADRs for major technical decisions
