---
name: designer
description: Senior front-end designer flow — Phase 0 DS bootstrap from repo, Phase 1 intake (image/sketch/vibe inputs), Phase 1.5 plan gate, Phase 2 library + image-gen MCP, Phase 3 parallel worktree exploration with DS-conformance gate, Phase 4 live dev server iteration, Phase 5 handoff via Stitch DESIGN.md + STYLE.md SSOT split. Opt-in Award mode (`--award`) overrides phases with Awwwards-SOTD discipline from reverse-engineering 25 winners. Auto-invokes proactively when user signals UI/UX intent BEFORE writing markup — natural triggers (CZ+EN): "design this/me a landing/dashboard/hero/signup", "navrhni mi web/landing/dashboard/komponentu", "udělej mi web/stránku", "vytvoř hero/landing/sekci/UI", "potřebuju UI/UX/design", "build me a landing/website/homepage", "make it look premium/playful/brutalist", "redesign this", "redesignuj X", or explicit `/designer`. User doesn't need to know the skill exists — cortex offers it. Add `--award` for portfolio/agency/SOTD-targeted work.
disable-model-invocation: false
---

# /designer — Senior front-end designer flow

You are running cortex-x's designer flow. Output is **real code in a real branch**, not a throwaway prototype. Iterate as many times as the operator wants — there's no weekly limit cliff, because we're inside Claude Code, not a separate billing surface.

Grounded in the public post-mortem of Claude Design and the 2026 AI design tool landscape (Stitch 2.0, Lovable, v0, Onlook, Magic Patterns): the magic is Opus 4.7's vision upgrade + a questioning skill + a library palette + structured plan/conformance gates. All reproducible here.

## When to invoke

- "/designer" explicit invocation
- "navrhni mi <X>" / "design me <X>"
- "vytvoř landing page / dashboard / hero section / pricing block / signup flow"
- After `/start` or `/audit` finishes and the operator wants to design the front-end layer specifically

If the operator is already mid-implementation and just asks for one small visual tweak, **don't run the full flow** — that's a 1-line CSS edit, not a design session. Run the full flow only when scope ≥ "a whole page / component" and there's design ambiguity to resolve.

## Phase 0 — Design system bootstrap (brownfield only)

Before any intake questioning, peek at the repo. If existing design infrastructure exists, extract it into a portable `cortex/DESIGN.md` (Stitch DESIGN.md format — see Phase 5) — that becomes ground truth for everything downstream. Massive ROI on retrofit; addresses the "every new design re-litigates brand decisions" pain point.

### Detection signals (run quick read passes)

| Signal | Extract |
|---|---|
| `tailwind.config.{ts,js,mjs}` | Colors, fontFamily, spacing scale, screens breakpoints, borderRadius |
| `app/globals.css`, `styles/globals.css`, `src/index.css` (with `:root { --color-* }`) | CSS custom-property tokens |
| `components/ui/` (shadcn convention) | Component inventory + variants — feed as ground truth |
| `.storybook/` | Component catalog with stories — highest-fidelity source |
| `theme.json`, `tokens.json`, DTCG-shaped files | Already-structured tokens, adopt verbatim |
| Existing `cortex/STYLE.md` or `cortex/DESIGN.md` | Trust it — only re-derive if explicitly asked |

### Output

- Emit `cortex/DESIGN.md` in Stitch DESIGN.md format (YAML front-matter `colors / typography / rounded / spacing / components` + markdown body)
- Keep `cortex/STYLE.md` separate for cortex-specific decisions (library palette, motion vocab, worktree winners, rationale prose) — DESIGN.md covers ~40% of that
- Run `npx @google/design.md lint` if it can be added zero-friction — flags WCAG AA contrast violations + broken token references before any generation

### Skip Phase 0 when

- Empty folder / pure greenfield (proceed to Phase 1)
- Operator explicitly says "clean slate, ignore what's here"
- Zero detection signals fire

## Phase 1 — Intake (Claude Design-style questioning + vibe inputs)

Before any code, run a short structured intake. Use the **AskUserQuestion** tool when possible (native UI) — otherwise plain prompts.

### Accept any of these as primary input

| Input form | Handling |
|---|---|
| Structured prompt ("B2B SaaS landing, lean editorial, brand colors #...") | Go straight to Phase 1.5 plan |
| Reference URL | WebFetch the page, analyze with Opus 4.7 vision, extract palette + layout patterns into `cortex/DESIGN.md` before Phase 2 |
| Screenshot or sketch (image) | Opus 4.7 reads at 3.75 MP — extract palette + layout/density signals (Galileo sketch-to-UI pattern) |
| Vibe-only ("premium, calm, trustworthy, fintech-but-warm") | Generate 2–3 distinct directional palette options + 1-line layout summaries, let operator pick (Stitch Vibe Design pattern) |

### Question matrix — pick gaps that apply, skip what's already obvious

Ask 4–7 questions across these gap-areas:

| Gap | Example question | Why it matters |
|---|---|---|
| Audience | "Who lands on this page — B2B prospect, end consumer, returning user, developer?" | Drives copy register + density |
| Goal | "What's the single primary action? (Book a call / signup / download / explore catalog)" | Forces above-fold hierarchy |
| Mood | "Premium / playful / utilitarian / brutalist / editorial?" | Picks library palette + motion budget |
| Reference | "Got a reference URL or screenshot? (Opus 4.7 reads images at 3.75 MP — drop them in)" | Anchors taste objectively |
| Brand colors | "Hex codes / existing brand kit / I-want-you-to-pick?" | Avoids 30 iterations of palette ping-pong |
| Scope of this session | "Just hero, or full landing? Just dashboard shell, or all views? Multi-page flow (signup + login + dashboard)?" | Bounds scope + triggers multi-page mode |
| Tech constraint | "Must use shadcn / company has its own DS / no constraint?" | Library decision |

**Default-Czech / default-English:** read the language signal from prior turns. If operator wrote Czech, ask Czech.

Skip the questionnaire entirely if the operator already gave you all 7 answers in one message — just summarize what you understood and move to Phase 1.5.

## Phase 1.5 — Plan gate (Lovable Plan Mode)

After Phase 1 intake AND before Phase 2 library decision, write a one-screen plan and **pause for operator approval**. Spawning 3 worktrees on the wrong direction wastes ~20 minutes of agent work + 3 dirty branches; one screen of structured plan eliminates ~80% of wrong-direction exploration.

```
## Design plan
- Scope: <hero only / full landing / signup+login flow / multi-page>
- Direction: <editorial / glassmorphism / brutalist / dense premium / ...>
- Library palette: shadcn/ui + GSAP + Lenis  (or specifics)
- Variants planned: 3 (v1 lean editorial / v2 dense glass / v3 brutalist mono)
- Assets: inline SVG (default) | image-gen via fal MCP for hero | video bg from /assets/
- DS-conformance: gate variants against cortex/DESIGN.md before reporting
- Estimated worktree cost: ~5–8 minutes per variant

Proceed? (y / adjust direction / change variant count / cancel)
```

Skip the gate ONLY for very small scopes (single isolated component, ≤ 1 variant) where the round-trip cost exceeds the protection value.

## Phase 2 — Library palette decision

Don't generate UI from scratch unless the operator explicitly said "from scratch, no libraries." Pick a palette grounded in the project's tech stack and the intake mood.

### Component libraries (pick ONE primary)

| Library | When | Notes |
|---|---|---|
| **shadcn/ui** | Default for any Next.js / React project | Owned-in-repo components; we can edit them. MCP available |
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

### Asset patterns — pick by use case

| Pattern | When | Notes |
|---|---|---|
| **Inline SVG (Claude-generated)** | Default. Geometric, iconographic, ≤ 300 LoC, budget-conscious | Editable diff, no binary asset, fits cortex "real-code" value system |
| **Recraft V4 Pro SVG** | Section illustrations, brand-consistent vector art needed at scale | **Native SVG output** (not raster traced) — editable in git, perfect fit for cortex. Via fal or Recraft REST. Pro plan ($33/mo) or per-call. |
| **FLUX 1.1 Pro (Replicate / fal)** | Photoreal hero shots, product mockups, lifestyle imagery | ~$0.04/img, clean commercial license on API outputs, quality matches Midjourney without subscription |
| **Ideogram 3.0 Quality** | Assets with embedded text (CTA badges, mockup labels, hero with headline burned in) | 90–95% text accuracy — FLUX/Imagen still hallucinate letters |
| **Video hero backgrounds** | Real video asset exists AND serves the message | Single most overused trick on X demos — filler unless justified |
| **Lottie** | Engineering-grade animated icons | |
| **3D / WebGL** | Brief explicitly demands it | Otherwise vanity bandwidth tax |
| **Adobe Firefly 3** | Enterprise client with IP indemnification clause | $1K/mo enterprise floor — only for RELO-class clients |

### MCP servers worth wiring

If the project has Claude Code with MCP support, suggest enabling:

| MCP | Friction | Use |
|---|---|---|
| **shadcn MCP** | Zero-config | Agent installs the right component directly, no "what does Button accept again?" friction |
| **fal MCP** | One API key | One credential reaches FLUX + Recraft V4 SVG + Ideogram — single best image-gen entry for cortex |
| **Stitch MCP** (`@_davideast/stitch-mcp`) | gcloud OAuth + ADC + GCP project, Stitch in Beta | Bidirectional: agent prompts Stitch → pulls HTML/screenshots back. Apache-2.0, Google-maintained. Pin `@google/stitch-sdk@~0.3` (pre-1.0 risk) |
| **figma MCP** | Paid Figma plan + PAT | Only if operator has existing Figma designs to import |
| **imagegen-mcp** | Multi-provider fallback | GPT-Image / Imagen 4 / FLUX / Recraft / Nano Banana in one server |

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
1. Reads `cortex/DESIGN.md` (Phase 0 output — token ground truth) + `cortex/STYLE.md` (rationale + library decisions)
2. Reads `cortex/MEMORY/repo-map.md` if it exists (project shape)
3. Implements its variation as real code on its branch — must use tokens from `DESIGN.md`, no raw hex literals outside the theme
4. Starts a **live dev server on a unique port** (`PORT=5174 npm run dev`, etc.) so Playwright-MCP can hit it for screenshots + computed-style inspection
5. Runs the **DS-conformance gate** before reporting (Magic Patterns pattern)
6. Reports: branch name + one-line description + screenshot path + dev-server URL + LoC delta + conformance verdict

Use the **Agent** tool with `subagent_type: Plan` (for design plan) then `subagent_type: general-purpose` for implementation. Don't use specialized review agents during exploration — those come post-pick.

### DS-conformance gate (per variant, before reporting)

Automated check that generated components match `cortex/DESIGN.md` tokens:

| Check | How |
|---|---|
| No hex literals outside theme | `grep -rE "#[0-9a-fA-F]{6}\b"` on changed files, exclude `cortex/DESIGN.md` + tailwind.config — fail on hits |
| Spacing values use scale | `grep -rE "\b(padding|margin|gap):\s*\d+(\.\d+)?px"` — flag off-scale values |
| Font families from theme | font-family in CSS/className must reference `theme.fontFamily.*` |
| WCAG AA contrast | `npx @google/design.md lint` on the emitted DESIGN.md — must exit 0 |

Variants failing DS-conformance still get reported but are marked `[OFF-SPEC]` — operator can override.

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

### Live dev server loop (Onlook + Bolt pattern)

Keep `npm run dev` running through the entire iteration. After each commit:

- Playwright-MCP screenshots the affected page at desktop (1440), tablet (768), mobile (375) widths
- Computed-style inspection on any element the operator points at ("the CTA button feels too small" → MCP reads actual rendered px + font-size + color and proposes a delta)
- Diff screenshots vs previous commit — surfaces unintended regressions

(Gated on Sprint 4.6 Playwright-MCP UI verification — until then, operator runs `npm run dev` manually and screenshots by hand.)

Each iteration is a **separate commit** so reverting is one command. Use `git stash` aggressively when trying something risky.

## Phase 5 — Handoff

When the operator says "this is good," do the handoff:

1. **Emit `cortex/DESIGN.md`** (Stitch DESIGN.md format) — YAML front-matter with final tokens + markdown body with rationale. Run `npx @google/design.md lint` and ensure 0 errors. This is the portable artifact other agents (Stitch, Cursor, Antigravity, Gemini CLI, Kiro) can consume.
2. **Update `cortex/STYLE.md`** (create if missing) with the cortex-specific decisions DESIGN.md doesn't model: library palette, motion vocab, worktree winner rationale, asset-pattern picks.
3. **Optional: emit `cortex/decisions/DESIGN-<date>.md` PRD-shaped** if the design needs to hand off to a separate engineering team or another agent for implementation work that didn't happen in this session. Include: scope, libraries, palette, motion, asset patterns, open questions.
4. If `package.json` gained dependencies, list them in the commit message.
5. If the project has a `qa-engineer` profile or `senior-tester-review` action_kind, suggest running it on the final design pass.
6. **Optional DTCG export** — `npx @google/design.md export --format dtcg > cortex/tokens.dtcg.json` for downstream Style Dictionary / Tokens Studio interop.

## Anti-patterns (don't)

- **Don't skip Phase 0 on a brownfield repo.** Re-deriving brand decisions from scratch when `tailwind.config.ts` already encodes them = SSOT violation, hours wasted.
- **Don't skip Phase 1.5 on multi-variant runs.** Plan-gate is cheap; wrong-direction parallelism is expensive.
- **Don't run the full intake for one-button changes.** Use judgment.
- **Don't spawn 6 worktrees.** Comparison fatigue kills the win. Cap at 4.
- **Don't auto-merge a worktree winner.** Operator must explicitly pick.
- **Don't import 12 libraries.** Pick one primary + one animation + one smooth-scroll, max.
- **Don't generate "designer-coded" CSS variables as opaque tokens.** Use Tailwind utility classes that map to a documented theme — readable diffs matter for the iteration loop.
- **Don't skip screenshots in worktree reports.** Operator can't compare 3 variations by reading three diffs.
- **Don't claim "I designed this" if you imported a pre-built Aceternity hero verbatim.** Cite the source in the commit message.
- **Don't rename `cortex/STYLE.md` → `cortex/DESIGN.md`.** Both coexist — DESIGN.md is portable tokens (Stitch schema, ~40% coverage), STYLE.md is cortex rationale (the other 60%).
- **Don't use Stitch MCP for greenfield without justification.** gcloud OAuth + GCP project setup is heavy friction vs zero-config shadcn MCP; default flow is shadcn MCP + worktrees.

## Composes with

- `/start` (cortex-x new-project) — designer flow naturally runs after Phase 4 scaffold
- `/audit` (cortex-x existing-project) — designer flow runs after AUDIT.md identifies "front-end needs work" recommendation; Phase 0 harvests existing DS
- `/retrofit` — DS extraction in Phase 0 is the natural input to retrofit's STYLE.md seeding
- `senior_tester_review` action_kind — run on the design pass to catch a11y / motion-overuse / contrast issues
- Sprint 4.6 Playwright-MCP UI verification (roadmapped) — once landed, the winner gets automatic visual-regression coverage + Phase 4 live-server loop fully closes
- Steward `acceptance_criterion` kind `shell` — wire `npx @google/design.md lint` as a per-PR gate

## Award mode (`--award` / `--awwwards`)

Opt-in override applied when operator invokes `/designer --award`, says "this is for Awwwards / SOTD / portfolio piece / agency-tier work", or scope is explicitly an award submission. **Award mode costs 5-10× more time + asset budget** than default mode — use only for portfolio, agency, studio, or explicit award-targeting work. Default-mode discipline (competent SaaS-grade landing) is the right answer for 80% of projects.

Empirical basis: reverse-engineering 25 Awwwards SOTD/SOTM/SOTY winners (May 2026 sample, mix of Webflow + Next.js + custom stacks). All frequencies cited below are over that sample unless noted. Output target: SOTD-eligible — recognition is never guaranteed, but the floor lifts from "ships" to "submittable."

### Award Phase 1 override — Strategic brief (replaces functional intake)

Replace the 7 functional intake questions with the 7 strategic-brief questions. Each is chosen because it forces a decision the AI default skips. Output: emit `cortex/AWARD-BRIEF.md` containing operator's answers; that file becomes Phase 1.5 plan input and is archived for the eventual submission "About this site" / colophon.

1. **Concept metaphor (one sentence).** "If this site were a physical place, object, or ritual, what is it?" — forces commitment to a singular idea (Resn: "narrative as the core driver"; Unseen: "surreal digital home"). AI default = generic SaaS layout.
2. **Narrative arc (4-6 acts).** "Name sections as story acts with one-line emotional intent each — NOT Hero/Features/Pricing." Forces sectional intentionality (Locomotive: "each section is a chapter").
3. **3 refs + 3 anti-refs + 1 bridge.** "3 sites you admire + 3 you must NOT resemble (with the gravitational-pull-rationale) + 1 reference outside the category (film, magazine, physical product)." Anti-refs force trap awareness. AI default = average of training corpus.
4. **Tone pillars (3 × 5 adjectives + 3 anti-adjectives each).** No "premium", "modern", "clean", "minimal" allowed — too cheap. Forces vocabulary precision (Off-Brand "vocabulary cards" pattern).
5. **Motion + sound ethos (one sentence each).** "How does everything move (weight, decay, rhythm)?" / "Silent / ambient / event-cued / signature score?" Forces commitment up front (Resn + Active Theory pattern).
6. **Type behaviour + color tension.** "Does type LEAD or SUPPORT? Hero color + tension color (not a palette of 5) + why those two fight well together." Forces principle over palette.
7. **3-5 prohibitions phrased as rules.** "Write 3-5 rules starting with 'Never' or 'Only' that any reviewer can use to reject work." AI default = add more; this layer subtracts.

Optional 8th: "What is the one thing a visitor must FEEL within 4 seconds?" — single-emotion gate.

### Award Phase 2 override — Narrower library palette (verified by data)

Award winners use **less, not more**. Hard data overrules speculation:

#### Required stack

| Layer | Pick | Award winner frequency |
|---|---|---|
| **Meta-stack** | Next.js OR Webflow | Next.js 28% (7/25), Webflow 16% (4/25 + SOTY 2025 — Lando Norris on Webflow) |
| **Motion runtime** | GSAP 3.15 (free since Webflow acquisition 2025) | 36% (9/25) + both SOTYs |
| **GSAP plugins** | Observer + ScrollTrigger + SplitText + CustomEase | Observer 32%, ScrollTrigger 24%, SplitText 20% |
| **Smooth scroll** | Lenis 1.3 | 32% (8/25); Locomotive Scroll on Webflow legacy only |
| **3D when justified** | **Raw Three.js r184** (NOT R3F) | Three.js 16% (4/25) + Developer SOTY 2025 (Messenger). R3F: **0/25** |
| **Page transition** | Barba.js OR hand-rolled curtain | 8% explicit, more in feel — table stakes craft |
| **Custom cursor** | Cuberto mouse-follower OR pure GSAP recipe | 16%+ explicit |
| **Sound** | Howler.js + mandatory mute toggle (top-right) | Studio sites yes, B2B SaaS no |

#### Forbidden in award mode (0/25 winners)

- **Component libraries shipped unmodified:** shadcn/ui, Aceternity UI, Hero UI, Tailwind UI as primary palette. **0 of 25** winners use them. Hand-build buttons, nav, cards. (Cherry-picking single components is OK; adopting as system is the AI tell.)
- **React motion libraries:** Framer Motion / Motion v12 / react-spring / Motion One. **0/25 winners.** Switch to GSAP Observer + ScrollTrigger.
- **`@react-three/fiber` + drei + postprocessing.** **0/25 winners** in this sample — go raw Three.js when 3D is justified, or skip 3D.
- **Rive (@rive-app/canvas).** **0/25 winners confirmed** ("Rive is hype, not winning"). Lottie acceptable only when client supplies the .lottie asset.
- **Theatre.js.** **0/25 winners.** Pure GSAP ScrollTrigger is cleaner; Theatre is overkill outside cinematic camera work.
- **View Transitions API / CSS scroll-timeline.** **0/25 winners** as of May 2026 — winners distrust bleeding-edge browser APIs. Revisit when adoption > 20%.
- **Generic Spline scene with default lighting.** Spline appears in 8% but always with custom material + lighting. Default-lit floating-blob = AI tell.
- **Default Tailwind palette utilities** (`purple-600`, `indigo-500`, `slate-50`) as brand color. Zero winners use Tailwind utility colors as the brand.

#### Optional studio-cinematic tier (scope > landing)

Only when budget supports it: Theatre.js for camera choreography, OGL for lightweight WebGL (Active Theory style), Lygia shader library, Tone.js for generative audio, Cuberto mouse-follower (gated on `pointer: fine` — never on touch-primary audiences).

### Award Phase 2.5 — Type + color craft gate (HARD)

Applied mid-generation and re-checked at Phase 3 DS-conformance gate.

#### Type discipline

Bundle from **Fontshare / Pangram Pangram free-tier ONLY** (all .woff2 variable, all OFL/commercial-free, all SOTD-grade):

| Preset | Display | Text | Mono |
|---|---|---|---|
| **Editorial premium** | PP Editorial New | Switzer | JetBrains Mono |
| **Brutalist colorful** | Clash Display | Cabinet Grotesk | Recursive (CASL=1) |
| **Quiet luxury** | PP Editorial New Italic | Satoshi | — |
| **Tech / agentic** | Switzer (huge) | Recursive (MONO axis) | JetBrains Mono |

Rules (every winner enforces these):

- Every size uses `clamp(min, vw-based, max)` — **NEVER** static `text-6xl` Tailwind utilities. (floema.com declares clamp() 33 times.)
- Variable fonts via `@font-face` with controlled axes (`wght`, `opsz`, optionally `CASL`/`MONO`). NO static .woff2 sets.
- Display > 48px: negative tracking `letter-spacing: -0.02em` to `-0.04em`
- Body: `text-wrap: pretty`, `hanging-punctuation: first last`, `font-optical-sizing: auto`
- Headlines: `text-wrap: balance`
- Modular type scale ratio 1.25 (UI) or 1.333 (editorial) or 1.618 (poster-hero)
- Type-as-section-divider — single word at 200px+ acts as chapter break (floema.com, mors.design, brets.fr)

Forbidden type defaults: Inter / Roboto / Open Sans / Poppins / Geist as primary brand voice. (Inter fine as fallback in font stack only.) Static text sizes. System font stack.

#### Color discipline

- **≤ 7 hex literals site-wide** (verified rule: 0-3 on portfolio winners, e-commerce up to 22 with content imagery). Force CSS custom properties: `var(--brand)`, `var(--bg)`, `var(--fg)`, `var(--accent)`, `var(--muted)`.
- **OKLCH tokens, not hex.** Tailwind v4 native; Cortex differentiator since **0/25 sampled winners use OKLCH in raw HTML** — we lead on perceptual uniformity + P3 gamut:
  ```css
  --brand:    oklch(0.62 0.19 27);   /* ONE saturated hue, ONE accent */
  --bg:       oklch(0.99 0.005 90);  /* warm-white, NEVER #fff */
  --fg:       oklch(0.18 0.02 270);  /* hinted-blue near-black, NEVER #000 */
  --muted:    oklch(0.55 0.02 270);
  ```
- **1 brand + 1 accent + 2 neutrals max.** Anything more requires explicit brand justification.
- **Off-black + off-white + ONE saturated accent.** Never pure `#000` or `#fff`.
- **Wide-gamut P3 accent** on a single hue: `color(display-p3 1 0.42 0.21)` for colors literally impossible in sRGB.
- **`mix-blend-mode: difference` on text-over-image collisions** — 32% of winners (simonholm.studio uses it 4 times). Craft signal AI rarely reaches for.
- **Background-color-as-section-divider** — flat color blocks between sections instead of imagery (recurring SOTD pattern).

Forbidden color defaults:
- **Purple→pink gradient** (`#6366f1 → #ec4899` / any indigo-violet ramp) — canonical AI-slop signature
- Tailwind `indigo-500` / `violet-500` / `purple-600` as primary
- Generic charcoal `#1a1a1a` / `#0a0a0a` — use `oklch(0.16 0.01 270)` instead
- Neon mint `#00ffa3`, "AI startup" cyan/blue, "trustworthy" navy + orange Stripe-cliché
- Conic-gradient mesh as background (**0/25 winners** use them)
- 5+ color brand palettes, rainbow-chip hero illustrations

### Award Phase 3 override — Worktree variants with signature interactions

Worktree subagents (still 2-4 variants) commit to DISTINCT signature interactions, not just rephrased prompts. Each variant must implement:

1. **Preloader concept** — hand-built, NOT library-imported. Count-up / logo-reveal / brand-specific sequence. 32% of winners ship one. Without preloader = no SOTD.
2. **Custom cursor behavior** — magnetic + contextual (link / drag / video states). Gated on `pointer: fine`, feature-detected; harmless on touch.
3. **Page-transition curtain** — wipe / mask / dissolve. Default Next.js route changes never win.
4. **Signature interaction** — the brand-specific moment that justifies the award. ONE distinctive thing the variant becomes known for.

#### Award DS-conformance gate (extends default Phase 3 gate)

Each variant must pass before reporting:

| Check | Command |
|---|---|
| No purple/violet/indigo Tailwind utilities | `! grep -rE "(purple\|violet\|indigo)-(4\|5\|6\|7\|8)00"` |
| No static text size utilities | `! grep -rE "text-(4\|5\|6\|7\|8\|9)xl"` |
| `clamp(` present in type CSS | `grep -r "clamp("` must hit |
| No pure black/white | `! grep -rE "#(000\|fff)([^0-9a-f]\|$)"` |
| Variable font via @font-face | `grep -r "font-variation-settings\|@font-face" must hit |
| Preloader class present | `grep -r "preloader\|page-loader"` must hit |
| Custom cursor class present | `grep -r "custom-cursor\|cursor-follower"` must hit |
| WCAG AA contrast | `npx @google/design.md lint` exit 0 |

Variants failing this gate ship marked `[OFF-SPEC]` — operator can override. Default mode's gate is a subset of this.

### Award Phase 4 override — Required craft passes

Three sequential passes before "good enough":

1. **Preloader pass** — hand-build the loading sequence (30-90 sec of LoC). Brand-specific number/logo motion.
2. **Cursor pass** — Cuberto mouse-follower OR pure GSAP recipe. Feature-detect `(pointer: fine)`.
3. **Blend-mode pass** — apply `mix-blend-mode: difference` on 4-8 text-image crossings (simonholm.studio frequency).
4. **(Optional) Sound pass** — Howler one-tick on key interactions + mute toggle in top-right (mandatory if any sound).

### Award Phase 5 override — Submission-ready handoff

Beyond default handoff, additionally emit:

1. **`cortex/AWARD-BRIEF.md`** — the strategic brief itself (Phase 1 answers), archived for the submission "About this site" page.
2. **Lighthouse ≥ 90 Performance** — Awwwards juries penalize sub-90 explicitly. Run `npx lighthouse --only-categories=performance` in CI.
3. **WCAG AA mandatory, AAA preferred** — Awwwards Accessibility honor is a separate award.
4. **Custom 404 page** — table stakes for SOTD. Match concept metaphor from Phase 1.
5. **"About this site" / colophon page** — credit libraries + foundries + concept + acknowledgments. Awwwards jurors read this.
6. **Submission asset bundle** — 1920×1080 hero screenshot + 15-30 sec screen recording (Playwright-MCP can drive). Ship to `cortex/award-submission/`.

### Award mode anti-patterns

- **Don't enable award mode by default.** It's 5-10× the asset/time budget. Reserve for portfolio / agency / explicit award targets.
- **Don't apply award stack to a Steward autonomous run.** Award mode requires human craft pass at Phase 4; autonomous nightly runs lack the iteration capacity.
- **Don't mix shadcn award-mode-forbidden imports with award stack.** If award mode is on, removal of shadcn imports from the variant is part of Phase 3 conformance gate.
- **Don't pretend a competent SaaS landing is award-tier.** Calling default `/designer` output "Awwwards-ready" misleads the operator. Only `--award` runs claim that target.
- **Don't ship Spline default-lit scenes in award mode.** Always custom material + lighting; otherwise skip 3D.

### Award mode references — empirical basis

**Reverse-engineered winners (25-site sample, May 2026):**

- [Awwwards SOTD archive](https://www.awwwards.com/websites/)
- [SOTY 2025 — Lando Norris (OFF+BRAND / Webflow / GSAP)](https://www.itsoffbrand.com/our-work/lando-norris)
- [SOTY 2025 Developer — Messenger (raw Three.js)](https://www.webgpu.com/showcase/messenger/)
- Sample sites: obys.agency, floema.com, mors.design, studionamma.com, simonholm.studio, mina-massoud.com, pixila.net, paodao.fr, 375.studio, marvellco.com.au, brets.fr, ordrhealth.com, adcker.com, eclettica.bulgari.com, camperandnicholsons.com, sazabi.com, gethapply.com, idyllic.co.nz, itomdev.com, t11.com, thepush.com.au, xox.makemepulse.com, fourmula.ai, kvs.services, astrodither.robertborghesi.is

**Strategic brief frameworks:**

- [Resn case studies](https://www.awwwards.com/case-study-resn-presents-adventuring-the-fantastical.html)
- [Locomotive — "two typefaces, four styles"](https://www.awwwards.com/locomotive-by-locomotive-wins-site-of-the-month-june-a-case-study.html)
- [Pentagram Brand Strategy](https://www.pentagram.com/brand-strategy)
- [Black Frame Framework template](https://framenoir.com/framework/)
- [Off-Brand vocabulary cards pattern (the-brandidentity.com interview)](https://the-brandidentity.com/interview/presented-by-brandpad-how-to-systemise-a-brand-featuring-pentagram-how-how-and-studio-blackburn)

**Library landscape:**

- [GSAP 3.13 — premium plugins now free](https://gsap.com/blog/3-13/)
- [Lenis (darkroomengineering)](https://github.com/darkroomengineering/lenis)
- [Cuberto mouse-follower](https://github.com/Cuberto/mouse-follower)
- [Howler.js](https://github.com/goldfire/howler.js)

**Type + color craft:**

- [Fontshare (ITF free commercial tier)](https://fontshare.com/)
- [Pangram Pangram free-to-try](https://pangrampangram.com/)
- [Recursive variable font (5 axes)](https://www.recursive.design/)
- [Utopia fluid type calculator](https://utopia.fyi/type/calculator/)
- [MDN variable fonts](https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_fonts/Variable_fonts_guide)
- [MDN hanging-punctuation](https://developer.mozilla.org/en-US/docs/Web/CSS/hanging-punctuation)
- [Evil Martians — OKLCH](https://evilmartians.com/chronicles/oklch-in-css-why-quit-rgb-hsl)
- [Tailwind v4 P3 gamut discussion](https://github.com/tailwindlabs/tailwindcss/discussions/13628)
- [Radix Colors 12-step](https://www.radix-ui.com/colors)
- [Why AI keeps building purple gradients](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website)
- [AI Slop Web Design guide](https://www.925studios.co/blog/ai-slop-web-design-guide)
- [Creative Boom — top 50 fonts 2026](https://www.creativeboom.com/resources/top-50-fonts-in-2026/)

## References

### Source recipe transcripts (raw analysis)

- [Claude Design Is Actually A Trap.txt](../../../docs/transcripts/Claude%20Design%20Is%20Actually%20A%20Trap.txt) — Opus 4.7 vision + skill + library palette = full Claude Design reproduction inside Claude Code
- [google-stitch-vs-claude-design.md](../../../docs/transcripts/google-stitch-vs-claude-design.md) — Stitch 2.0 vs Claude Design feature comparison; source for Phase 0/1.5/DS-conformance additions

### Stitch DESIGN.md spec (Phase 0 + Phase 5)

- [google-labs-code/design.md](https://github.com/google-labs-code/design.md) — Apache-2.0, alpha spec
- [Spec page](https://stitch.withgoogle.com/docs/design-md/specification)
- [@google/design.md on npm](https://www.npmjs.com/package/@google/design.md)
- [stitch-skills Agent Skills bundle](https://github.com/google-labs-code/stitch-skills/tree/main/skills/design-md)
- [VoltAgent/awesome-design-md examples](https://github.com/voltagent/awesome-design-md)
- [Google announcement](https://blog.google/innovation-and-ai/models-and-research/google-labs/stitch-design-md/)

### Stitch MCP (Phase 2 MCP entry)

- [@_davideast/stitch-mcp](https://www.npmjs.com/package/@_davideast/stitch-mcp) — Claude Code installer (Google DevRel-blessed)
- [google-labs-code/stitch-sdk](https://github.com/google-labs-code/stitch-sdk) — Apache-2.0, v0.3.x
- [Stitch MCP docs](https://stitch.withgoogle.com/docs/mcp/setup)

### Image-gen models + MCPs (Phase 2 Asset patterns)

- [Recraft V4 native SVG (Replicate)](https://replicate.com/recraft-ai/recraft-v4-pro-svg)
- [FLUX 1.1 Pro (Replicate)](https://replicate.com/black-forest-labs/flux-1.1-pro) — [BFL licensing](https://bfl.ai/licensing)
- [Ideogram 3.0 (Segmind)](https://blog.segmind.com/ideogram-3-0-on-segmind-features-api-pricing-and-use-cases/)
- [fal MCP server (single auth for FLUX + Recraft + Ideogram)](https://blog.fal.ai/)
- [imagegen-mcp multi-provider](https://github.com/writingmate/imagegen-mcp)

### Competitive pattern sources (Phase 0 / 1 / 1.5 / 3 / 4)

- [Anthropic Claude Design announcement](https://www.anthropic.com/news/claude-design-anthropic-labs) — Phase 0 bootstrap-from-repo pattern
- [Lovable Plan Mode (Muz.li)](https://muz.li/blog/lovable-for-designers-the-complete-guide-to-building-apps-with-ai-2026/) — Phase 1.5 plan gate
- [Magic Patterns DS-conformance](https://www.magicpatterns.com/blog/ui-design-tools) — Phase 3 conformance gate
- [Onlook (open-source live-server)](https://github.com/onlook-dev/onlook) — Phase 4 live dev server loop
- [Stitch Vibe Design (NxCode)](https://www.nxcode.io/resources/news/google-stitch-complete-guide-vibe-design-2026) — Phase 1 vibe/image/sketch intake

### Cortex internal

- Standards: [ai-patterns.md](../../../standards/ai-patterns.md), [ai-sdks.md](../../../standards/ai-sdks.md), [ssot.md](../../../standards/ssot.md)
- Sprint 2.16 — designer skill landing; Sprint 2.16.x — research-driven expansion (this version)
- Steward roadmap: [docs/steward-roadmap.md](../../../docs/steward-roadmap.md)
