# Retrospective — Post-Sprint Reflection → cortex library

> **How to use:** Paste at end of sprint/milestone/release. Claude guides reflection and captures lessons into `cortex-x/projects/<slug>.md` Lessons Learned section.

---

## Your task

Facilitate a structured retrospective that captures TRANSFERABLE lessons. Not just "sprint went OK" — but "what would I do differently / what must I remember for other projects".

## Step 1 — Establish context

```bash
git log --oneline --since="<sprint start>" --until="<now>"
cat PROGRESS.md  # completed sprint section
```

Identify:
- Completed sprint name
- Stories done/dropped/added mid-sprint
- Major commits
- Any incidents or fire-fighting

## Step 2 — Ask 4 questions (not 5 — fatigue)

**Q1 — What worked well?**
> "Co fungovalo líp, než jsi čekal? Technical choice, workflow, nebo jen štěstí?"

Goal: identify REINFORCEABLE patterns. Don't let survivorship bias hide luck.

**Q2 — What didn't work?**
> "Co tě zdrželo, frustrovalo, nebo by bylo lepší udělat jinak? Konkrétní příklady, ne obecně."

Goal: capture NEGATIVE knowledge (research validates this is most valuable).

**Q3 — What surprised you?**
> "Čeho sis všiml, co jsi předem nečekal? Pozitivní i negativní."

Goal: capture INSIGHTS that inform future scope/estimates.

**Q4 — What's transferable?**
> "Která z těchto věcí by stála za to přenést do jiných tvých projektů?
> Mark each answer [TRANSFERABLE] — bude se propagovat do cortex library."

Goal: force explicit cross-project thinking.

## Step 3 — Distill into Lessons Learned entries

For each [TRANSFERABLE] insight, draft in the project's `$CORTEX_DATA_HOME/projects/<slug>.md` format:

```markdown
### [TRANSFERABLE] <Short title> — <YYYY-MM-DD>
**What happened:** <1-2 sentences, concrete>

**Lesson:** <the insight>

**Why it matters:** <which future projects / situations>

**Evidence:** <commit SHA / PR / test file reference>
```

## Step 4 — Key Decisions check

Ask:
> "Udělali jsme v tomto sprintu nějaké architektural decision, co přetrvá (ne jen implementation detail)?"

If yes, format as ADR-lite for Key Decisions section:

```
- <decision> — <reason> — <date> — active
```

## Step 5 — Cross-project dependency check

Ask:
> "Objevili jsme pattern, co existuje v jiném tvém projektu? Nebo co bychom měli přenést?"

If yes, update Cross-Project Dependencies section of relevant project(s).

## Step 6 — Glossary growth check

Ask:
> "Přibyly nové domain terms, co by měly být v Glossary?"

If yes, append to Glossary.

## Step 7 — Write + commit

1. Read current `$CORTEX_DATA_HOME/projects/<slug>.md`
2. Append new Lessons (preserve existing — this is the institutional memory)
3. Update Key Decisions + Cross-Project Deps + Glossary if anything changed
4. Commit:
   ```
   cd ~/cortex-x
   git add projects/<slug>.md
   git commit -m "retro: <slug> sprint <N> — <short summary>"
   git push
   ```

## Step 8 — Forward-look

Ask:
> "Na co se příští sprint soustředíme? Co z těchto lessons aplikovat hned?"

Suggest updating PROGRESS.md with next sprint structure, referencing learned patterns.

## Output format

After retrospective, give the user:

```markdown
# Retrospective — <project> — Sprint <N>

## What worked ✨
- <insight 1>
- <insight 2>

## What didn't ⚠️
- <insight 1>
- <insight 2>

## Surprises 🎯
- <insight 1>
- <insight 2>

## Captured to cortex library

**Lessons Learned** (3 new):
- [TRANSFERABLE] <title> — <short>
- [TRANSFERABLE] <title> — <short>
- <title> (project-specific)

**Key Decisions** (1 new):
- <decision>

**Cross-Project Dependencies** (updated):
- Added: shares `<pattern>` with `<other project>`

## Next sprint planning suggestions

1. <concrete recommendation based on lessons>
2. <concrete recommendation>
```

## Rules

- **4 questions only.** Retrospective fatigue is real. More than 4 = the user disengages.
- **Force concreteness.** "Things went OK" = useless. "Migration 024 broke prod because we didn't test against real DB" = gold.
- **Mark TRANSFERABLE explicitly.** Without this label, insights die in the sprint.
- **Preserve history.** Don't overwrite Lessons Learned — append with dates.
- **Commit to cortex-x.** Without commit + push, insights don't survive machine change.

## Anti-patterns

- ❌ Long-form essay retrospectives (nobody re-reads)
- ❌ Generic "communication could be better" (not transferable)
- ❌ Focus only on positives (survivorship bias)
- ❌ Focus only on negatives (demoralizing + misses what worked)
- ❌ Skipping Q4 (transferable check) — this is the cortex-x unique value

## Time budget

- Questions: ~5-10 min the user typing
- Distillation + commit: ~2 min Claude
- Total: ~10-15 min

That's a 15-minute investment per sprint for institutional memory that compounds across 6+ projects.

## Integration points

- **Triggered by:** end of sprint (sprint-status detects 90%+ completion)
- **Outputs to:** `$CORTEX_DATA_HOME/projects/<slug>.md` Lessons Learned + Key Decisions + Cross-Project Deps + Glossary
- **Informs:** next `new-project.md` for similar projects (the user starts ahead because lessons exist)

## Philosophy

Sprints without retrospectives = work without learning.
Retrospectives without capture = learning that evaporates.
Capture without TRANSFERABLE filter = noise in cortex library.

4 questions. 10 minutes. Compound over 20 sprints across 6 projects = senior-level institutional memory.
