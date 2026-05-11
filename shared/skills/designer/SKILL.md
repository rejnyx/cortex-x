---
name: designer
description: Senior front-end designer flow — intake (Claude Design-style questioning), library-palette decision (shadcn / Aceternity / Hero UI / GSAP / Lenis), and parallel worktree exploration (3-4 design variations, operator picks winner, rest discarded). Replicates the "Claude Design" experience inside Claude Code without the weekly-limit cliff and without the design-to-code handoff. Auto-discovered from ~/.claude/skills/designer/SKILL.md after install.{sh,ps1} sync. Invoke as "/designer" or after the user says "design this", "navrhni mi web", "pojďme designovat landing page".
disable-model-invocation: false
---

# /designer — Senior front-end designer flow

You are running cortex-x's designer flow. Output is **real code in a real branch**, not a throwaway prototype. Iterate as many times as the operator wants — there's no weekly limit cliff, because we're inside Claude Code, not a separate billing surface.

Grounded in the public post-mortem of Claude Design: the magic was Opus 4.7's vision upgrade (1.15 → 3.75 MP) plus a questioning skill + a library palette. Both are reproducible here.

## When to invoke

- "/designer" explicit invocation
- "navrhni mi <X>" / "design me <X>"
- "vytvoř landing page / dashboard / hero section / pricing block / signup flow"
- After `/start` or `/audit` finishes and the operator wants to design the front-end layer specifically

If the operator is already mid-implementation and just asks for one small visual tweak, **don't run the full flow** — that's a 1-line CSS edit, not a design session. Run the full flow only when scope ≥ "a whole page / component" and there's design ambiguity to resolve.

## Phase 1 — Intake (Claude Design-style questioning)

Before any code, run a short structured intake. Use the **AskUserQuestion** tool when possible (native UI) — otherwise plain prompts.

Ask 4–7 questions across these gap-areas. Pick the gaps that apply; skip what's already obvious from context.

| Gap | Example question | Why it matters |
|---|---|---|
| Audience | "Who lands on this page — B2B prospect, end consumer, returning user, developer?" | Drives copy register + density |
| Goal | "What's the single primary action? (Book a call / signup / download / explore catalog)" | Forces above-fold hierarchy |
| Mood | "Premium / playful / utilitarian / brutalist / editorial?" | Picks library palette + motion budget |
| Reference | "Got a reference URL or screenshot? (Opus 4.7 reads images at 3.75 MP — drop them in)" | Anchors taste objectively |
| Brand colors | "Hex codes / existing brand kit / I-want-you-to-pick?" | Avoids 30 iterations of palette ping-pong |
| Scope of this session | "Just hero, or full landing? Just dashboard shell, or all views?" | Bounds scope so iteration doesn't blow up |
| Tech constraint | "Must use shadcn / company has its own DS / no constraint?" | Library decision |

**Default-Czech / default-English**: read the language signal from prior turns. If operator wrote Czech, ask Czech.

Skip the questionnaire entirely if the operator already gave you all 7 answers in one message — just summarize what you understood and ask "OK to proceed?"

## Phase 2 — Library palette decision

Don't generate UI from scratch unless the operator explicitly said "from scratch, no libraries." Pick a palette grounded in the project's tech stack and the intake mood.

### Component libraries (pick ONE primary)

| Library | When | Notes |
|---|---|---|
| **shadcn/ui** | Default for any Next.js / React project | Owned-in-repo components; we can edit them. MCP available — see Phase 3.5 |
| **Aceternity UI** | Mood = premium / motion-rich landing pages | Pre-built animated heroes, glassmorphism, scroll-driven sections |
| **Hero UI** (NextUI rebrand) | Mood = playful / consumer-facing app | More opinionated styling than shadcn |
| **Tailwind UI** | When operator has a paid license | Most "professional B2B" out-of-the-box |
| **Magic UI** / **Origin UI** | Specific micro-interactions / form components | Cherry-pick individual components, don't adopt as primary |

### Animation libraries (pick what you need, layered)

| Library | Use for |
|---|---|
| **GSAP** | Production-grade timeline animations, scroll-triggered storytelling. Industry standard. |
| **Lenis** | Smooth scroll — almost mandatory if the mood demands "premium scroll feel" |
| **Framer Motion** | React-native motion for component-level animations (modals, page transitions, drag) |
| **Motion One** | Lightweight alternative when bundle size matters |
| **Spring** (react-spring) | Physics-based motion for organic UI |

### Asset patterns

- **Video hero backgrounds** — single most overused trick on X demos. Use ONLY when (a) you have a real video asset and (b) it serves the message. Otherwise it's filler.
- **SVG illustrations** — generate inline (Opus 4.7 is good at this) when you don't have brand illustrations
- **Lottie** — for engineering-grade animated icons
- **3D / WebGL** — only when the brief explicitly demands it; otherwise it's a vanity bandwidth tax

### MCP servers worth wiring

If the project has Claude Code with MCP support, suggest enabling:
- **shadcn MCP** — agent installs the right component directly, no "what does Button accept again?" friction
- **figma MCP** — if operator has Figma designs to import

## Phase 3 — Parallel worktree exploration

The single biggest leverage Claude Code gives you over Claude Design is **git worktrees + parallel subagents**. Use them.

### When to parallelize

- Phase 1 surfaced genuine ambiguity on direction (mood, layout, palette)
- The operator said "show me a few options"
- It's a hero section / landing page (high-variance — variation is cheap, comparison is fast)

### When NOT to parallelize

- The operator gave a clear reference and wants "exactly like this"
- Scope is a tiny isolated tweak (button color, copy edit)
- Cost ceiling is tight (autonomous sessions inside Steward — sequential is cheaper)

### Worktree recipe

```bash
# Create N worktrees (N ∈ [2, 4] — never more, comparison fatigue)
git worktree add ../<project>-design-v1 -b design/hero-v1
git worktree add ../<project>-design-v2 -b design/hero-v2
git worktree add ../<project>-design-v3 -b design/hero-v3
```

Dispatch one subagent per worktree with **distinct creative directions**, not just rephrased prompts:

- v1: "lean editorial, white space dominant, single hero image, type-driven"
- v2: "dense premium glassmorphism, video background, scroll-driven sections"
- v3: "brutalist mono palette, sharp grid, motion-on-hover only"

Each subagent:
1. Reads `cortex/MEMORY/repo-map.md` if it exists (project shape)
2. Reads `cortex/STYLE.md` if it exists (any past brand decisions)
3. Implements its variation as real code on its branch
4. Runs `npm run dev` + screenshots to a known path (or operator views locally)
5. Reports: branch name + one-line description + screenshot path + LoC delta

Use the **Agent** tool with `subagent_type: Plan` (for design plan) then `subagent_type: general-purpose` for implementation. Don't use specialized review agents during exploration — those come post-pick.

### Operator pick + cleanup

After the operator picks the winner:

```bash
git checkout main
git merge design/hero-v2  # the winner
git worktree remove ../<project>-design-v1
git worktree remove ../<project>-design-v3
git branch -D design/hero-v1 design/hero-v3
```

Then run the review pipeline on the winner (`acceptance-auditor` + `blind-hunter` if it touches anything sensitive).

## Phase 4 — Iteration loop

Once a direction is picked, iterate on it in-place. NO more worktrees — that was for exploration. Now it's tightening.

Standard iteration moves:

1. **Reference replay** — operator drops a reference URL/screenshot; you re-analyze with Opus 4.7's vision and refine the existing page toward it
2. **Section swap** — replace one section (pricing, testimonials, CTA) with a fresh variation while keeping the rest
3. **Motion pass** — once layout is locked, add GSAP/Lenis touches in one focused commit
4. **Polish pass** — typography rhythm, color contrast, spacing scale, micro-copy

Each iteration is a **separate commit** so reverting is one command. Use `git stash` aggressively when trying something risky.

## Phase 5 — Handoff

When the operator says "this is good," do the handoff:

1. Write a one-paragraph `cortex/decisions/DESIGN-<date>.md` with: the chosen direction, the libraries used, the palette decisions (hex codes), the motion vocabulary
2. Update `cortex/STYLE.md` (create if missing) with the brand decisions so future Steward / cortex-x sessions don't re-litigate them
3. If `package.json` gained dependencies, list them in the commit message
4. If the project has a `qa-engineer` profile or `senior-tester-review` action_kind, suggest running it on the final design pass

## Anti-patterns (don't)

- **Don't run the full intake for one-button changes.** Use judgment.
- **Don't spawn 6 worktrees.** Comparison fatigue kills the win. Cap at 4.
- **Don't auto-merge a worktree winner.** Operator must explicitly pick.
- **Don't import 12 libraries.** Pick one primary + one animation + one smooth-scroll, max.
- **Don't generate "designer-coded" CSS variables as opaque tokens.** Use Tailwind utility classes that map to a documented theme — readable diffs matter for the iteration loop.
- **Don't skip screenshots in worktree reports.** Operator can't compare 3 variations by reading three diffs.
- **Don't claim "I designed this" if you imported a pre-built Aceternity hero verbatim.** Cite the source in the commit message.

## Composes with

- `/start` (cortex-x new-project) — designer flow naturally runs after Phase 4 scaffold
- `/audit` (cortex-x existing-project) — designer flow runs after AUDIT.md identifies "front-end needs work" recommendation
- `senior_tester_review` action_kind — run on the design pass to catch a11y / motion-overuse / contrast issues
- Sprint 4.6 Playwright-MCP UI verification (roadmapped) — once landed, the winner gets automatic visual-regression coverage

## References

- Sprint 2.16 — designer skill landing (this file, see [docs/steward-roadmap.md](../../../docs/steward-roadmap.md))
- Standards: [ai-patterns.md](../../../standards/ai-patterns.md), [ai-sdks.md](../../../standards/ai-sdks.md)
- Source recipe analysis: [docs/transcripts/Claude Design Is Actually A Trap.txt](../../../docs/transcripts/Claude%20Design%20Is%20Actually%20A%20Trap.txt) (transcript of public Claude Design post-mortem; Opus 4.7 vision + skill + library palette = full reproduction inside Claude Code)
