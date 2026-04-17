# New Project Prompt — Bootstrap via cortex-x

> **How to use:** Create empty folder for new project. Open Claude Code there. Paste this prompt. Tell Claude the project description. Claude scans cortex-x and scaffolds everything.

---

## Your task

Dave is starting a new project. Your job: **don't start from scratch**. Scan `~/cortex-x/` first, pick the right profile, and scaffold a senior-level project foundation in under 10 minutes.

Never re-invent. Never lower the bar. Every new Dave's project should inherit the same quality standards his production projects have.

## Step 1 — Ask Dave 3 questions

Exactly these 3, nothing more:

1. **Název projektu?** (e.g., "medikon", "klient-portal", "smart-menu")
2. **Co to dělá?** (1-2 věty — co řeší, pro koho)
3. **Jaký typ?** Nabídni profily z `~/cortex-x/profiles/` a navrhni nejvhodnější:
   - `nextjs-saas` — Next.js + Supabase SaaS (RELO-style)
   - `chatbot-platform` — multi-tenant chatbot s kanály
   - `waas-template` — website-as-a-service, multi-tenant
   - `ai-agent` — autonomní multi-step agent
   - `tauri-desktop` — desktop app (Rust + Web)
   - `astro-static` — portfolio, blog, docs
   - `cli-tool` — Node.js CLI na npm
   - `kiosek` — touch PWA
   - `minimal` — prototyp bez ceremonie

Na základě popisu projektu **pre-selectni** nejvhodnější profil a Dave jen potvrdí / změní.

## Step 2 — Scan cortex-x (paralelní čtení)

Než začneš cokoliv vytvářet, přečti:

1. `~/cortex-x/profiles/<selected>.yaml` — stack, structure, conventions, initial_sprint
2. `~/cortex-x/standards/README.md` — index standardů (11 pillars)
3. `~/cortex-x/templates/CLAUDE.md.hbs` — project bible template
4. `~/cortex-x/templates/PROGRESS.md.hbs` — sprint tracking template
5. `~/cortex-x/templates/MEMORY.md.hbs` — memory scaffold
6. `~/cortex-x/templates/settings.json.hbs` — .claude/settings.json template
7. `~/cortex-x/templates/README.md.hbs` — public README template
8. `~/cortex-x/shared/hooks/*.cjs` — universal hooks (to install in project)
9. `~/cortex-x/projects/README.md` — cross-project library index (for similar projects)

Pokud existuje podobný projekt v `~/cortex-x/projects/<slug>.md`, přečti ho — zjistíš patterns, decisions, lessons learned, které můžeš aplikovat.

## Step 3 — Scaffold (use current working directory)

**Do NOT** copy cortex-x files blindly. **Render templates intelligently** based on profile + Dave's answers.

### 3a. Directory structure

Based on `profiles/<selected>.yaml` → `structure` section, create folders.

### 3b. Render templates

Use Handlebars-style substitution (manually — don't invoke a template engine):

| Placeholder | Value source |
|-------------|--------------|
| `{{projectName}}` | Dave's answer #1 |
| `{{description}}` | Dave's answer #2 |
| `{{stack.*}}` | From selected profile YAML |
| `{{conventions.*}}` | From selected profile YAML |
| `{{structure}}` | From selected profile YAML |
| `{{agents}}` | From selected profile YAML |
| `{{hooks}}` | From selected profile YAML |
| `{{date}}` | Today's date (ISO) |
| `{{author}}` | "David Rajnoha (Rejnyx) · REDACTED@redacted.invalid" |
| `{{initial_sprint}}` | From selected profile YAML |

Render:
- `CLAUDE.md` (project bible)
- `PROGRESS.md` (sprint tracking — populate `initial_sprint` stories)
- `MEMORY.md` (memory scaffold)
- `README.md` (public facing — proprietary banner + what it does)
- `.claude/settings.json` (permissions + hook config)

### 3c. Install hooks

Create `.claude/hooks/` and copy from `~/cortex-x/shared/hooks/`:
- `block-destructive.cjs`
- `session-start.cjs`
- `pre-compact.cjs`

Or reference global ones (preferred — less duplication).

### 3d. Stack-specific files

Based on profile `stack.framework`:

- **nextjs-saas / waas-template / chatbot-platform / ai-agent / kiosek:**
  - `package.json` with Next.js 16, React 19, TypeScript, Tailwind 4, shadcn/ui deps
  - `next.config.ts`, `tsconfig.json` (strict), `tailwind.config.ts`, `postcss.config.mjs`
  - `.env.example` with required vars from profile
  - `src/app/layout.tsx`, `src/app/page.tsx` (starter)

- **astro-static:**
  - `package.json` with Astro 5, integrations
  - `astro.config.mjs`
  - `src/pages/index.astro`

- **tauri-desktop:**
  - Run `npm create tauri-app@latest` via Bash (or scaffold manually if that's blocked)

- **cli-tool:**
  - `package.json` with `bin` field, Commander 12, @clack/prompts, picocolors, execa
  - `bin/cli.js` with shebang
  - `tsup.config.ts`

- **minimal:**
  - Just `package.json` with bare necessities

### 3e. Gitignore

Copy appropriate `.gitignore` (Next.js / Astro / Node / Rust based on profile).

### 3f. License

`LICENSE` — proprietary template from cortex-x (Dave's default).

### 3g. Git init + first commit

```bash
git init
git add .
git commit -m "init: scaffold via cortex-x (profile: <selected>)"
```

### 3h. Install dependencies

```bash
npm install
```

Only if Dave confirms (it's slow).

## Step 4 — Report

Reply to Dave:

```
✅ Projekt '{{projectName}}' nascaffoldován via cortex-x

Profil: <selected>
Standards zděděné: SSOT, Modular, Scalable, Security, Testing, Observability, Performance, A11y, Error handling, Git, Docs
Stack: <summary>
Struktura: <tree depth 2>

Vygenerováno:
- CLAUDE.md (project bible, ready for you to fill tech specifics)
- PROGRESS.md (<N> stories from profile initial_sprint)
- MEMORY.md (multi-layer scaffold)
- README.md (proprietary template)
- .claude/settings.json (hooks registered)
- .claude/hooks/ (3 universal safety hooks)
- <stack-specific configs>

Git: init + first commit done.

Další krok:
1. Přečti si CLAUDE.md a doplň tech specifika (architektura, env vars)
2. Zkontroluj PROGRESS.md — upravit stories podle tvé vize
3. npm install (pokud jsem nespustil)
4. npm run dev → začni Story 1.1

Když chceš další help — řekni, jdu na to.
```

## Step 5 — Ask if Dave wants cortex library entry

After scaffold is complete, ask:

```
Chceš, abych hned vytvořil záznam v ~/cortex-x/projects/{{slug}}.md?

Výhoda: budoucí sessions v tomhle projektu budou mít okamžitý kontext,
a když budeš dělat jiný projekt podobného typu, cortex to tam zahrne.

(yes — vytvořím teď / později — spustíš prompts/project-scan.md kdykoli)
```

Pokud yes → naskenuj čerstvý projekt (i když je prázdný — stack, profile, planned sprint struktura) a přidej do `~/cortex-x/projects/`.

## Rules

- **Rychlost > perfekce.** 80% řešení teď > 100% řešení zítra.
- **Nikdy nevynechávej standardy.** SSOT, Modular, Scalable, Security, Testing — všechny. Bez výjimky.
- **Nikdy nehardcoduj Dave's cesty** — v package.json a README používej dynamické hodnoty.
- **Nikdy nescaffolduj bez cortex-x** — pokud není dostupné, ptej se Dave předtím než improvizuješ.
- **Preferuj globální hooks.** Project-level jen pokud potřebuje domain-specific override.
- **Čeština v UI, Angličtina v kódu.** Zadání profilu.
- **Konvence profilu jsou zákon.** Neporušuj je bez Dave's souhlasu.

## Anti-patterns

- ❌ Scaffold bez přečtení profilu → dostaneš nekonzistentní stack
- ❌ "Později přidám testy" → přidej test setup teď (Vitest + Playwright)
- ❌ "Zatím bez Sentry" → přidej z Day 1 (i když disabled v dev)
- ❌ "RLS později" → RLS od prvního migrace (scalable.md rule)
- ❌ Install všech deps najednou → rozděl na core + dev, let npm prune later
- ❌ Ignore cortex-x/projects/ — ztrácíš institutional knowledge

## Philosophy

Každý nový projekt začíná s **11 standardami**, **3 universal hooks**, **testing pyramid ready**, **Sentry ready**, **RLS ready**, **Czech UI conventions**, **TypeScript strict**, **Git safety**.

Dave ušetří 3-5 dní setupu, který by dělal ručně.

Dave nikdy nezapomene na best practice, protože cortex-x je memory.

Dave škáluje tím, že každý nový projekt má stejný **senior foundation** — nezačíná z nuly.
