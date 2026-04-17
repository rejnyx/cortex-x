---
project: food-banner-builder
date: 2026-04-17
agents: [domain, technical, competitive]
slug_candidates: [food-banner-builder, heroforge, sushi-to-banner]
---

# Research: Food Banner Builder (1920×600 wide hero, solo dogfood)

**Context:** Dave's solo dogfood tool. Workflow dnes = AI image gen → Photoshop manual (text, cena, CTA, logo). Target = one-step generator: template + AI food background → export PNG 1920×600. E-shops with food (sushi, pizza, meal kits, grocery).

---

## Domain (2026 best practices)

### Existing tools — food-specific gaps
- **Template-API tier** (Bannerbear, Placid, Creatomate): strong text-over-image composition, brand-kit, no native image gen. Creatomate ~20-33% cheaper than Bannerbear.
- **Canva Magic Design**: weak brand lock, generic food output, fails hero-strip aspect ratios.
- **LovPics / Sivi AI**: closest direct competitors — "AI places product + text + CTA, locks brand kit." No food verticalization.
- **AdMaker.AI**: only explicitly food-targeted banner tool found.

### Food-specific AI pitfalls (DIFFERENTIATOR)
**2025 *Appetite* study** confirmed **uncanny valley for "almost real" food** — rated less pleasant than fully stylized OR fully realistic. Specific failures:
- plasticky/too-glossy textures
- impossible symmetrical cheese pulls
- robot-perfect garnish
- repetitive rice grains
- sharp edges on soft foods
- inconsistent lighting in composites

**Counter-prompts (bake into scaffold):** "natural crumbs, uneven sauce, one garnish slightly off-center, imperfect lighting." Offer **stylized-illustration fallback** when photoreal fails QA.

### Table stakes 2026
- Brand kit (logo, colors, fonts locked)
- Multi-aspect-ratio export
- AI gen with **negative-space awareness** (for CTA placement)
- Smart text-fitting with auto contrast
- Iterative refinement loop (generate → evaluate → tweak → regen)
- **Variant grid + pin-and-regen** beats single-shot

### UX: prompt-to-banner patterns
- **Structured prompt scaffolds** > free-text. "Goal + subject + 4-6 details (medium/lighting/framing/mood/palette)."
- **Negative-space specification** ("negative space right for CTA") critical for banners.
- **Real brand text from start**, not Lorem Ipsum.

### Key sources
- https://strategyforbakeries.com/blog/2025/10/31/ai-images-for-bakeries-authenticity-guide/
- https://www.sciencedirect.com/science/article/pii/S0195666325000790 (Appetite uncanny valley)
- https://petapixel.com/2025/03/27/ai-generated-food-images-can-make-people-feel-uncomfortable/
- https://minimaxir.com/2025/11/nano-banana-prompts/
- https://www.typeface.ai/blog/ai-image-generation-for-food-and-beverage-brands-how-to-ace-food-photography-with-ai

---

## Technical (Next.js 16 + React 19 + Gemini patterns)

### Canvas library: **Fabric.js v6** (recommended)
- High-level object model (Textbox, Image, Rect) → fits placeholder-slot pattern
- Built-in selection/transform handles
- Native `canvas.toDataURL('image/png')` at exact pixel dimensions
- **SSR gotcha:** dynamic import with `ssr: false` (canvas.node binding breaks SSR)
- Runner-up: Konva (faster/smaller, more custom UX code)
- Avoid: html2canvas (CORS taints AI images, font rendering unreliable), tldraw (wrong tool, infinite canvas)

```tsx
const FabricEditor = dynamic(() => import('./FabricEditor'), { ssr: false });
```

### AI model: **Nano Banana 2** (`gemini-3.1-flash-image-preview`)
- Launched 2026-02-26
- ~$0.067/image at 1K output
- Half the price of Nano Banana Pro ($0.134)
- Better for food photography than 2.5 Flash Image ($0.039)
- Via Vercel AI SDK v6 `generateImage()` (promoted from experimental)

### 1920×600 sizing trick
- Gemini has **no native 1920×600**
- **21:9** is closest (~1920×823) → generate 21:9, **center-crop to 1920×600 in Fabric**
- Do NOT outpaint (quality drop on food)
- 16:9 = 1344×768, too tall, waste

### Gotchas (save from day 1)
1. **Fetch AI image server-side** → re-serve same-origin → no CORS canvas taint
2. `document.fonts.ready` before `canvas.renderAll()` → text exports blank otherwise
3. Dispose Fabric canvas in `useEffect` cleanup → known memory leak
4. Dynamic import ALL canvas code (`ssr: false`)

### Template engine: Creatomate-style JSON
Copy RenderScript shape: array of typed elements (`text`, `image`, `rectangle`) with absolute x/y/w/h + bindable `modifications`. Raster-first (not SVG) — matches Fabric's object model 1:1.

```json
{
  "template_id": "hero-wide-v1",
  "modifications": [
    { "name": "product_name", "text": "Sushi Combo XL" },
    { "name": "price", "text": "349 Kč" },
    { "name": "cta", "text": "Objednat" },
    { "name": "bg_image", "image_prompt": "fresh sushi platter, natural lighting, negative space right" }
  ]
}
```

### Key sources
- https://ai.google.dev/gemini-api/docs/image-generation
- https://ai-sdk.dev/docs/ai-sdk-core/image-generation
- https://vercel.com/blog/ai-sdk-6
- https://github.com/vercel/next.js/issues/43050 (Fabric SSR break)
- https://creatomate.com/docs/json/introduction
- https://developers.bannerbear.com/v2/

---

## Competitive landscape

### Who's in the space
| Tool | Price/mo | Food-specific? | Wide-hero? |
|---|---|---|---|
| Bannerbear | $49 | ❌ | Custom via API |
| Placid | $15-19 | ❌ | Custom |
| Creatomate | $54+ | ❌ | Custom |
| Canva Magic | $15 | ❌ | ❌ hero weak |
| Pebblely | $19-39 | Product photoshoot | 2048² max, ❌ wide |
| Claid.ai | $19-49 | Generic food | Standard ratios |
| MenuPhotoAI | Cheap | ✅ food | Menu-size, ❌ hero |
| Predis.ai | Shopify-linked | ❌ | Social-first |

### Weaknesses to exploit (Dave's leverage)
1. **Credit pricing overkill for 10 banners/mo** — $19-54 minimums for volume Dave won't use.
2. **Generic AI produces floating burgers, fake cheese** — documented failure modes.
3. **Hero-strip (1920×600, ~3.2:1) isn't a first-class preset anywhere** — awkward outpainting elsewhere.
4. **DoorDash banning fully AI dishes** → forces hybrid (real photo + AI bg), which none orchestrate.
5. **Multi-user/template library overhead** irrelevant for 1 user.

### Indie precedent
- **Bannerbear / Jon Yongfook** — solo, open-startup, 2 years to $10K MRR, went API-first for agencies.
- **Lesson:** category validated; indie can survive; but API-first is a pivot away from solo dogfood.

### Dave's differentiator angles (ranked)
1. **Hybrid pipeline** (real product photo + AI bg/props) — sidesteps AI-only bans, none do this natively
2. **Food-vertical prompt library** — curated seeds for sushi/pizza/meal-kit/grocery
3. **1920×600 as PRIMARY canvas** — every competitor treats it as afterthought
4. **Self-hosted, no per-credit cost** — Dave's own Gemini key, unlimited iterations
5. **CLI/agentic trigger** — "regenerate spring sushi hero" from Claude Code session fits Dave's workflow

### Key sources
- https://www.imejis.io/blogs/comparisons/best-bannerbear-alternatives
- https://thinkpeak.ai/creatomate-vs-bannerpeak-2026-media-generation/
- https://vibedex.ai/blog/best-ai-image-generator-food-photography-2026
- https://www.indiehackers.com/podcast/208-jon-yongfook (Bannerbear origin)
- https://claid.ai/pricing

---

## Key insights (TOP 3 — load-bearing for scaffold)

1. **Anti-uncanny food prompts as first-class feature** — prompt scaffold with "imperfection tokens" (uneven sauce, off-center garnish, natural crumbs) baked into every generation. This is the #1 quality differentiator backed by peer-reviewed research (Appetite 2025).

2. **Nano Banana 2 at 21:9 → center-crop to 1920×600 in Fabric** — NOT outpaint. $0.067/img. This is the concrete technical path; don't prototype with any other model/library combo.

3. **Creatomate-style JSON template schema from day 1** — future-proofs for multi-template + API export later, without overbuilding now. One `hero-wide-v1` template with 4 `modifications` slots = MVP scope.
