# 3-Month Audit — 2026-07-17

> Usage-driven pruning checklist. Run this on or around 2026-07-17 (3 months after cortex-x init).

## Why

Research warning: personal frameworks that aren't pruned become bloat. Rule of Three says we shouldn't lock in abstractions from a sample of 1-2. At init (2026-04-17) we built 44 files based on speculation. In 3 months we have **usage data**.

## Method

For each file/directory below: **was it read, edited, or referenced in the past 3 months?**

- ✅ **Yes, 2+ times** → keep
- 🤔 **Yes, exactly once** → keep but mark for 6-month review
- ❌ **Never touched** → DELETE
- 📌 **Touched but by Claude, not by Dave** → review if it added real value

## Audit checklist

### Profiles (9 files)
- [ ] `profiles/nextjs-saas.yaml` — used for ? projects
- [ ] `profiles/minimal.yaml` — used for ? projects
- [ ] `profiles/ai-agent.yaml` — used for ? projects
- [ ] `profiles/chatbot-platform.yaml` — used for ? projects
- [ ] `profiles/waas-template.yaml` — used for ? projects
- [ ] `profiles/astro-static.yaml` — used for ? projects
- [ ] `profiles/cli-tool.yaml` — used for ? projects
- [ ] `profiles/tauri-desktop.yaml` — used for ? projects
- [ ] `profiles/kiosek.yaml` — used for ? projects

**Rule of Three:** a profile stays only if used for **at least 1 real project OR strongly planned in next 3 months**. Speculation = delete.

### Standards (11 files)
- [ ] `standards/ssot.md`
- [ ] `standards/modular.md`
- [ ] `standards/scalable.md`
- [ ] `standards/security.md`
- [ ] `standards/testing.md`
- [ ] `standards/observability.md`
- [ ] `standards/performance.md`
- [ ] `standards/accessibility.md`
- [ ] `standards/error-handling.md`
- [ ] `standards/git-workflow.md`
- [ ] `standards/documentation.md`

**Keep criterion:** referenced in a project's `CLAUDE.md` or actually used during code review. Never referenced = delete.

### Prompts (5 files)
- [ ] `prompts/new-project.md` — used to scaffold how many projects?
- [ ] `prompts/project-scan.md` — used to scan how many projects?
- [ ] `prompts/cortex-sync.md` — used at end of how many sessions?
- [ ] `prompts/cortex-reflect.md` — actually invoked? how many useful insights?
- [ ] `prompts/cortex-load.md` — referenced from any project CLAUDE.md?

**Delete criterion:** zero invocations in 3 months.

### Agents (1 file)
- [ ] `agents/cortex-thinker.md` — invoked how many times? surfaced how many actionable insights?

**Keep criterion:** at least 3 insights Dave acted on. Otherwise = AI setup porn, delete.

### Insights + Journal (2 directories)
- [ ] `insights/` — how many entries? Which acted on vs dismissed?
- [ ] `journal/` — any entries? Used for anything?

**Keep criterion:** journal only makes sense if PostToolUse hook is active. If not, delete.

### Templates (5 files)
- [ ] `templates/CLAUDE.md.hbs`
- [ ] `templates/PROGRESS.md.hbs`
- [ ] `templates/MEMORY.md.hbs`
- [ ] `templates/settings.json.hbs`
- [ ] `templates/README.md.hbs`

**Honest assessment:** Did Handlebars-style placeholders actually help? Or did Claude end up generating CLAUDE.md from scratch each time based on the profile + 3 questions?

### Projects (library)
- [ ] `projects/` — how many entries? Are they used via `@project:<slug>` mentions?

**Keep criterion:** library used in at least 2 work sessions. Otherwise = decorative.

## Decision rules

1. **If used ≥2x by Dave → keep**
2. **If used 1x → keep, re-audit at 6 months**
3. **If never used → delete**
4. **If only Claude used it → check if it added value. If not, delete.**

## Expected outcome

Based on research, 30-50% of current files should go. That's NORMAL and HEALTHY. Kept files will be the ones that proved their worth.

## After audit

- Commit with message: `refactor: 3-month audit — remove unused X, keep used Y`
- Write `docs/AUDIT-RESULTS-2026-07-17.md` with:
  - What was deleted and why
  - Total file count reduction
  - Usage patterns observed
  - Plan for next 3 months

## Philosophy

**Delete with confidence, not anxiety.** Git history preserves everything. If you miss a deleted file, restore it — but usage will show you don't miss it.

**Boring beats bloated.** Dan McKinley: "Choose boring technology." For cortex-x: choose boring frameworks. Fewer files, fewer decisions, more shipping.
