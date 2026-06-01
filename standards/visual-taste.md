# Visual Taste

> Anti-slop heuristics for AI-built frontend interfaces. Cortex selectively
> vendors the **structural levers** of the MIT-licensed `taste-skill` project
> (Leon Lin / tasteskill.dev, [github.com/Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill))
> — the dials, the em-dash ban, the pre-flight check, the GSAP skeletons —
> and folds them into cortex's standards layer. The original 800-line skill
> stays a single external repo; cortex keeps only the parts the operator
> can't get from `designer/` today.
>
> Attribution + license: MIT © 2026 Leon Lin. See `## Attribution` at the end.
> Adapted: condensed to the cross-cutting rules; cortex-specific framing
> (designer + ux-copywriter callouts, "When this fires" gate, R1/R2 alignment).

## When this fires

Use this standard whenever a task lands frontend code or visuals — directly
(implementing a hero / section / page), via the `designer` skill's Phase 2-3
(rules layer), or before declaring a UI task done (the pre-flight gate). The
copy side has its own SSOT in [`ux-copywriter`](../shared/skills/ux-copywriter/SKILL.md);
this is the **visual** lane.

Scope: landing pages, portfolios, marketing sections, redesigns. Not internal
dashboards, data tables, or admin product UI (different aesthetic, different
rules — defer to the design system in use).

## 1. The three taste dials

Set three dials from the brief BEFORE any layout/motion decisions. They gate
every rule below. Use the design-read inference table to pick values; do not
ask the operator to edit numbers.

| Dial | Range | What it controls |
|---|---|---|
| **`DESIGN_VARIANCE`** | 1 (perfect symmetry) → 10 (asymmetric / artsy) | Grid rhythm, alignment, white-space distribution |
| **`MOTION_INTENSITY`** | 1 (static) → 10 (cinematic, scroll-hijack, physics) | Animation budget, scroll-triggered reveals, hover physics |
| **`VISUAL_DENSITY`** | 1 (art gallery / airy) → 10 (cockpit / packed data) | Padding scale, breathing room, card vs. line separation |

**Baseline** (when the design read does not override): `8 / 6 / 4`.

### Design-read → dial inference

| Brief signals | VARIANCE | MOTION | DENSITY |
|---|---|---|---|
| minimalist · calm · editorial · Linear-style | 5–6 | 3–4 | 2–3 |
| premium consumer · Apple-y · luxury brand | 7–8 | 5–7 | 3–4 |
| playful · agency · Awwwards · experimental | 9–10 | 8–10 | 3–4 |
| trust-first · public-sector · regulated · a11y-critical | 3–4 | 2–3 | 4–5 |
| landing page / portfolio (default) | 7–9 | 6–8 | 3–5 |
| **redesign** — preserve | match existing | +1 | match existing |
| **redesign** — overhaul | +2 | +2 | match existing |

**Motion claimed, motion shown.** If `MOTION_INTENSITY > 4`, the page MUST
actually move (entry transitions, scroll reveals, hover physics). A static
page that claims dial 7 is broken. Conversely, if the scope can't ship working
motion, drop the dial to 3 and ship a clean static page — don't half-build it.

## 2. EM-DASH BAN (zero, not "sparingly")

The em-dash (`—`) is the single most-violated AI tell in production tests.
The model treats "use sparingly" as "use moderately"; the only enforceable
phrasing is binary. **Zero em-dashes on any user-visible surface.**

Banned in: headlines, eyebrows, labels, pills, button text, body copy, quote
attribution, captions, alt text, nav items. Also the en-dash (`–`) when used
as a separator (date ranges, number ranges).

Permitted dash characters: regular hyphen `-` (compound words, ranges,
markup), minus sign in math.

**How to replace it:**

| Was | Now |
|---|---|
| `Built for teams — and the ones building them.` | `Built for teams, and the ones building them.` |
| `Free — forever.` | `Free. Forever.` or `Free for life.` |
| `Sarah Chen — Engineering Manager` | `Sarah Chen, Engineering Manager` (or stack name + role on two lines) |
| `2018 — 2026` | `2018-2026` |
| `Plate · Brand — No. 02` | `Plate · Brand · No. 02` (still ration the dot, see pre-flight) |

Single occurrence of `—` or `–` visible to the user fails the pre-flight
check. No exceptions.

## 3. Pre-flight check (mechanical)

Run before declaring any frontend task complete. Each item is a binary pass/fail.

### Layout

- [ ] **Hero fits the initial viewport.** Headline ≤ 2 lines on desktop. Subtext ≤ 20 words and ≤ 4 lines. CTAs visible without scroll.
- [ ] **Hero top padding** ≤ `pt-24` (6rem) on desktop. More than that = layout bug, not intentional space.
- [ ] **Hero text-stack max 4 elements**: eyebrow OR brand-strip (one or zero) · headline (≤2 lines) · subtext (≤20 words) · CTAs (1 primary + ≤1 secondary). Trust micro-strips, taglines under CTAs, feature bullets, social-proof rows = move to dedicated sections below.
- [ ] **Navigation single line** at desktop (≥1024px). Height ≤ 80px (default 64–72px).
- [ ] **Section-layout-repetition cap**: each layout family appears at most once per page. A landing page with 8 sections uses ≥4 different layout families.
- [ ] **Zigzag alternation cap**: max 2 consecutive image-text-split sections. The 3rd in a row = fail. Break the pattern with a full-width section, vertical-stack, bento, or marquee.
- [ ] **Eyebrow restraint**: count `uppercase tracking` small-caps labels above section headlines. Allowed `≤ ceil(sectionCount / 3)`. Hero counts as one. 9-section page → max 3 eyebrows total.
- [ ] **Bento grid cell count == content count.** Three items → three cells. No empty tiles in the middle or at the end.
- [ ] **Bento background diversity**: in multi-cell grids, ≥2–3 cells have real visual variation (image, brand-appropriate gradient, pattern, tinted bg) — not all white-on-white cards.
- [ ] **Split-header pattern banned** as default (left big headline + right small floating explainer). Stack vertically OR use a genuine 2-column with real content in the right column.
- [ ] **Mobile collapse explicit per section.** Every multi-column layout declares its `< 768px` fallback in the same component.

### Accessibility

- [ ] **WCAG AA button contrast** (4.5:1 body, 3:1 ≥18px). White-on-white CTAs, transparent buttons over the page bg with no border, ghost buttons over photography without a scrim — all fail.
- [ ] **WCAG AA form contrast.** Placeholder, focus ring, helper text, error text all pass against the section bg.
- [ ] **CTA button wraps**: button text fits ONE line at desktop. Wrapped = fail. Fix by shortening label (≤3 words for primary, ideally 1-2) OR widening the button.
- [ ] **No duplicate CTA intent.** Two CTAs that mean the same thing on one page = fail. "Get in touch / Contact us / Let's talk / Start a project" = all `contact` intent; pick one label and use it everywhere.

### Consistency locks

- [ ] **Color consistency lock**: one accent color per page. A warm-grey page doesn't get a blue CTA in section 7.
- [ ] **Shape consistency lock**: one corner-radius scale per page. Mixed only when there's a documented rule (e.g. buttons pill, cards 16px, inputs 8px) followed everywhere.
- [ ] **Page theme lock**: page is light OR dark, sections don't invert. Exception only if the brief explicitly calls for a Color Block Story or Theme Switch on Scroll AND it's a single deliberate transition.

### Typography

- [ ] **Italic descender clearance.** When italic display type contains `y g j p q`, `leading-none` clips the descender. Use `leading-[1.1]` minimum + `pb-1`/`mb-1` reserve.
- [ ] **Em-dash count == 0.** See § 2.
- [ ] **Single copy register per page** unless the brand voice calls for mixed. Don't mix technical mono / editorial prose / marketing punch in the same composition.

### Content & visuals

- [ ] **Copy self-audit.** Re-read every visible string. Flag broken grammar, unclear referents, AI-hallucination wordplay, forced "thoughtful" metaphors. Rewrite or replace with a plain functional sentence.
- [ ] **Fake-precise numbers banned.** `92%`, `4.1×`, `48k`, `5.8mm` either come from real data (brief, brand) or are explicitly labeled `<!-- mock -->`. AI-invented spec aesthetics = fail.
- [ ] **No hand-rolled SVG icons.** Use Phosphor / HugeIcons / Radix / Tabler. One family per project. `strokeWidth` standardized globally.
- [ ] **No div-based fake screenshots.** A fake task list / terminal / dashboard built from styled `<div>`s = #1 AI tell. Use a real screenshot, a generated image, a real component preview, or skip the preview.
- [ ] **No version labels in the hero** (`v0.6`, `BETA`, `EARLY ACCESS`) unless the brief is explicitly about launch / preview status.
- [ ] **No locale / time / weather strips** (`LIS 14:23 · 18°C`) unless the brief is genuinely a globally-distributed studio or place-specific brand.
- [ ] **No scroll cues** (`Scroll`, `↓ scroll`, animated mouse-wheel icons). If they haven't scrolled, they know what scroll is.
- [ ] **No decorative status dots** (colored dots before every nav item / list row / badge). Only when conveying real semantic state, one per section max.
- [ ] **Decoration text strips banned** at hero bottom (`BRAND · MOTION · SPATIAL` mono-caps strips) unless they carry real navigable links or status info.
- [ ] **Marquees**: max one per page. Two = lazy filler.
- [ ] **Hero needs a real visual.** Text + gradient blob is a placeholder, not a hero.
- [ ] **No fake "Sarah Chen / John Doe" names + no fake-perfect numbers** for placeholder data (use organic data: `47.2%`, `+1 (312) 847-1928`, locale-appropriate names).

### Motion

- [ ] **`prefers-reduced-motion` honored** for everything above `MOTION_INTENSITY > 3`. Infinite loops, parallax, scroll-hijack, magnetic physics must collapse to static / instant under reduced motion.
- [ ] **`window.addEventListener("scroll", …)` not used.** Banned. See § 4.D.
- [ ] **Animate only `transform` and `opacity`**, never `top` / `left` / `width` / `height`.
- [ ] **Each animation has a one-sentence reason** (hierarchy / storytelling / feedback / state transition). "Looked cool" = fail. GSAP-everywhere because GSAP is available = amateur.

## 4. GSAP skeletons (use these, don't roll your own)

When the design read picks scroll-pinning or scroll-hijack, use the canonical
skeletons below. Common failure mode for both: `start: "top center"` or
`"top 80%"` — the animation fires halfway through scroll and shows a half-
slide. **Always `start: "top top"`.**

### 4.A Sticky-Stack (cards pin and stack on scroll)

```tsx
"use client";
import { useRef, useEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "motion/react";

gsap.registerPlugin(ScrollTrigger);

export function StickyStack({ cards }: { cards: React.ReactNode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || !ref.current) return;
    const ctx = gsap.context(() => {
      const cardEls = gsap.utils.toArray<HTMLElement>(".stack-card");
      cardEls.forEach((card, i) => {
        if (i === cardEls.length - 1) return;
        ScrollTrigger.create({
          trigger: card,
          start: "top top",                               // pin at viewport top
          endTrigger: cardEls[cardEls.length - 1],
          end: "top top",
          pin: true,
          pinSpacing: false,
        });
        gsap.to(card, {
          scale: 0.92,
          opacity: 0.55,
          ease: "none",
          scrollTrigger: {
            trigger: cardEls[i + 1],
            start: "top bottom",
            end: "top top",
            scrub: true,
          },
        });
      });
    }, ref);
    return () => ctx.revert();
  }, [reduce]);

  return (
    <div ref={ref} className="relative">
      {cards.map((card, i) => (
        <div key={i} className="stack-card sticky top-0 min-h-[100dvh] flex items-center justify-center">
          {card}
        </div>
      ))}
    </div>
  );
}
```

Critical: `start: "top top"` + `pin: true` + every card except the last is
pinned + the scale/opacity transform is driven by the **next** card's scroll
trigger (so the current card shrinks as the next one arrives).

### 4.B Horizontal-Pan (vertical scroll → horizontal slide)

```tsx
"use client";
import { useRef, useEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "motion/react";

gsap.registerPlugin(ScrollTrigger);

export function HorizontalPan({ children }: { children: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce || !wrap.current || !track.current) return;
    const ctx = gsap.context(() => {
      const distance = track.current!.scrollWidth - window.innerWidth;
      gsap.to(track.current, {
        x: -distance,
        ease: "none",
        scrollTrigger: {
          trigger: wrap.current,
          start: "top top",
          end: () => `+=${distance}`,                    // scroll length = horizontal travel
          pin: true,
          scrub: 1,
          invalidateOnRefresh: true,
        },
      });
    }, wrap);
    return () => ctx.revert();
  }, [reduce]);

  return (
    <section ref={wrap} className="relative overflow-hidden">
      <div ref={track} className="flex h-[100dvh] items-center">{children}</div>
    </section>
  );
}
```

### 4.C Scroll-Reveal Stagger (lighter — prefer this when no pinning needed)

For "items appear as they enter the viewport," skip GSAP and use Motion's
`whileInView`:

```tsx
"use client";
import { motion, useReducedMotion } from "motion/react";

export function RevealStagger({ items }: { items: string[] }) {
  const reduce = useReducedMotion();
  return (
    <ul className="grid gap-6">
      {items.map((item, i) => (
        <motion.li
          key={item}
          initial={reduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.6, delay: i * 0.06, ease: [0.16, 1, 0.3, 1] }}
        >
          {item}
        </motion.li>
      ))}
    </ul>
  );
}
```

Use this for feature lists, testimonial grids, logo walls — anything that
just needs "enter on scroll." Save GSAP for actual pin/scrub work.

### 4.D Forbidden animation patterns

- **`window.addEventListener("scroll", …)`** — runs every scroll frame, jank-prone, no batching. Use Motion's `useScroll()`, GSAP `ScrollTrigger`, `IntersectionObserver`, or CSS `animation-timeline: view()`.
- **Scroll-progress in React state via `window.scrollY`** — same: re-renders the tree on every frame.
- **`requestAnimationFrame` loops that touch React state** — use motion values (`useMotionValue` + `useTransform`).
- **Wrap static content in `layout` props "for safety"** — costs measurement work. Use `layout` only on visible state changes (re-ordering, expanding modals, shared elements).

## 5. Composition with cortex

- **`designer` skill** ([`shared/skills/designer/SKILL.md`](../shared/skills/designer/SKILL.md)) — the orchestration: discover → research → architect → scaffold → adapt. Phase 2-3 (visual exploration + DS-conformance) consume *this* standard as their rules layer. designer is the process; visual-taste is the gate.
- **`ux-copywriter` skill** ([`shared/skills/ux-copywriter/SKILL.md`](../shared/skills/ux-copywriter/SKILL.md)) — the copy side. The pre-flight `copy self-audit` item delegates to it.
- **Standards order**: visual-taste sits under Rule 3 (Process) — polish on top of Rule 1 (SSOT / Modular / Scalable) + Rule 2 (Security / Correctness / Testing). A visual-taste failure is a warning, not a merge-block (unlike a Rule 1 SSOT violation).

## Attribution

This standard adapts content from **`taste-skill`** by Leon Lin
(<hello@tasteskill.dev>, [tasteskill.dev](https://tasteskill.dev),
[github.com/Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill)),
licensed under the **MIT License**, © 2026 Leon Lin.

Adapted parts (selective vendor of the structural levers):

- The three dials (VARIANCE / MOTION / DENSITY) + the design-read inference table — § 1
- The em-dash ban — § 2 (verbatim rule; examples rewritten for cortex)
- The pre-flight checklist — § 3 (extracted from the source's per-section "mandatory" callouts and condensed into one mechanical list)
- The GSAP sticky-stack / horizontal-pan / scroll-reveal skeletons — § 4 (code reproduced under MIT; the `useReducedMotion` integration + the "always `top top`" failure-mode commentary preserved)
- The forbidden animation patterns — § 4.D

The full taste-skill repository contains substantially more (palette bans,
typography deep-dives, premium-consumer rules, redesign-audit protocol, the
v1 SKILL.md fallback, gpt-tasteskill / soft-skill / minimalist-skill /
brutalist-skill variants, three image-gen skills). Operators who need those
should install the full skill upstream: `npx skills add https://github.com/Leonxlnx/taste-skill`.

MIT permission: this adaptation preserves the copyright notice + license
reference per MIT § 1 ("the above copyright notice and this permission notice
shall be included in all copies or substantial portions of the Software").
