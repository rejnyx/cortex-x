# Universal Project Scan Prompt

> **How to use:** Paste this prompt into any Claude Code session at the root of a project. Claude will scan the project thoroughly and produce a structured summary for the cortex-x knowledge library.

---

## Your task

Scan this entire project thoroughly and produce a **comprehensive structured summary** that will be stored in `~/cortex-x/projects/<project-slug>.md` as Dave's institutional knowledge about this codebase.

This summary is how future Claude sessions — in THIS project and in OTHER Dave's projects — will understand what this project is and what can be learned from it.

## Step 1 — Scan (read these files, in order)

Work methodically. Read:

1. **Root meta** — `README.md`, `CLAUDE.md`, `PROGRESS.md`, `LICENSE`, `package.json` / `pyproject.toml` / `Cargo.toml`, `.env.example`
2. **Config** — `next.config.*`, `tailwind.config.*`, `tsconfig.json`, `vite.config.*`, any framework config
3. **Architecture docs** — everything in `_bmad-output/`, `docs/`, `architecture*.md`, `ARCHITECTURE.md`
4. **Directory structure** — use Glob to map top 3 levels of `src/` (or equivalent)
5. **Database schema** — `supabase/migrations/*.sql`, `prisma/schema.prisma`, `db/*.sql`
6. **API surface** — files in `app/api/`, `pages/api/`, `routes/`
7. **Key business logic** — read 3-5 most important files identified from CLAUDE.md or README
8. **Tests** — count test files, note test frameworks in use, sample 1-2 test files
9. **Git context** — `git log --oneline -20`, `git status`, `git remote -v`
10. **TODOs / FIXMEs** — grep for `TODO|FIXME|HACK|XXX` across src
11. **Integrations** — detect by checking dependencies: Supabase, OpenAI, Anthropic, Stripe, Google APIs, Telegram, Twilio, etc.
12. **CI/CD** — `.github/workflows/`, `vercel.json`, deployment configs

## Step 2 — Write summary to `~/cortex-x/projects/<slug>.md`

Use **exactly this structure** (it matches the index format — don't improvise):

```markdown
---
name: <Human-readable project name>
slug: <kebab-case-slug>
status: production | active-dev | paused | archived
last_scanned: <YYYY-MM-DD>
scan_version: 1
scanned_by: Claude Opus 4.7
---

# <Project name>

## Identity
- **One-liner:** <what this project does in exactly 1 sentence>
- **Owner:** Dave (or specify)
- **Repo path:** <absolute path on this machine>
- **Remote:** <git remote URL if exists>
- **Live URL:** <production deployment URL if known>
- **Stakeholders:** <clients, users, team members>

## Tech Stack
- **Framework:** <Next.js 16, Astro 5, Tauri 2, etc. with version>
- **Language:** <TypeScript strict / Python / Rust>
- **Database:** <Supabase/Postgres, Prisma, etc. with migrations count>
- **AI/LLM:** <OpenAI/Anthropic, models, SDK version if applicable>
- **Styling:** <Tailwind 4, shadcn/ui, etc.>
- **Testing:** <Vitest count, Playwright specs count, k6 if applicable>
- **Deploy:** <Vercel, Cloudflare, etc.>
- **Monitoring:** <Sentry, PostHog, etc.>

## Architecture

<ASCII diagram or short prose, under 20 lines, showing end-to-end flow>

### Key modules
- `src/lib/ai/`: <1-line purpose>
- `src/app/api/`: <1-line purpose>
- ...

## Integrations
- **External APIs:** <list with purpose>
- **Auth:** <Google OAuth, Supabase Auth, etc.>
- **Payments:** <Stripe, etc. if applicable>
- **Channels:** <Telegram, WhatsApp, email, etc.>

## Key Decisions (ADR-lite)

Format: `<decision> — <reason> — <date> — <status>`

- Chat Completions over Responses API — gpt-5.x tool-calling bug — 2026-01 — active
- ...

## Conventions
- **UI language:** <Czech/English>
- **Code language:** <English>
- **Color system:** <OKLCH / hex / HSL>
- **Component library:** <shadcn/ui / Radix / custom>
- **Form validation:** <Zod / Yup / custom>
- **Commit style:** <Conventional Commits / free-form>

## Known Issues / Tech Debt

- <bug or limitation with 1-line context>
- ...

## Lessons Learned (NEGATIVE KNOWLEDGE — most valuable)

What was tried and failed. What Dave would do differently. Transferable to other projects:

- <lesson with why>
- ...

## Cross-Project Dependencies

- **Shares patterns with:** <other project slugs>
- **Upstream from:** <shared libs if any>
- **Learned from:** <which project experiments informed decisions here>

## Commands Cheatsheet

```bash
npm run dev       # dev server
npm test          # unit tests
npm run build     # production build
# ...
```

## Environment Variables

List names only (no values), grouped by purpose:

**Database:**
- `NEXT_PUBLIC_SUPABASE_URL`
- ...

## Glossary

Domain-specific terms used in this codebase:

- **Client:** <what it means in THIS project>
- **Lead:** <what it means in THIS project>

## Key Files (top 10 for new developer)

1. `src/lib/ai/safe-tool.ts` — <1-line why>
2. ...

## Stats (as of <date>)

- Lines of TypeScript: <approx>
- Test files: <count>
- Test count: <count>
- DB migrations: <count>
- Deployed: <yes/no, where>
- Users: <count if known>

## Open Problems / Next Steps

From PROGRESS.md or current work:

- <active story/task>
- ...
```

## Step 3 — Update `~/cortex-x/projects/README.md`

After writing the project file, append/update the index with a one-line entry:

```markdown
| <name> | <slug> | <status> | <tech stack summary> | <last scanned> |
```

## Step 4 — Report

Reply to me with:
- ✅ What you wrote
- ⚠️ Gaps (fields you couldn't fill — missing docs, unclear decisions, etc.)
- 💡 Suggestions for improving this project's documentation

## Rules

- **Be thorough** — this is permanent knowledge, not a quick overview
- **Be honest** — if something is undocumented or messy, note it in "Known Issues"
- **Negative knowledge is gold** — capture what was TRIED and didn't work
- **No speculation** — if you don't find evidence, say "unknown" rather than guess
- **No marketing fluff** — this is internal knowledge, write like an engineer not a copywriter
- **Preserve Czech/English split** — Czech for domain context, English for technical terms

If `~/cortex-x/projects/<slug>.md` already exists and `scan_version: N` is older than current (check this file for `scan_version: N+1`), update only the auto-generated sections (Tech Stack, Commands, Stats, Architecture) and preserve hand-curated sections (Lessons Learned, Key Decisions, Cross-Project Dependencies). Increment `scan_version`.
