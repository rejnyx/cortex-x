# CZ cultural lint rules — anti-slop + anti-patos + typography

> Companion to [`../SKILL.md`](../SKILL.md). Loaded during Phase 4 (slop blocklist) + Phase 5 (CZ localization gates). The rule of thumb: CZ market is skeptical to US hype. Numbers beat adjectives. Concrete verbs beat abstract nouns. Hedged superlatives beat absolute ones.

## 1 — The 7 US tropes and their CZ counter-strategies

### Trope 1: Hype + unverified superlatives
**Source pattern**: `The absolute best way to skyrocket your growth and crush your limits.`

**Counter-strategy**: hedged superlatives. Replace with concrete metric or functional process.

> `Nástroj, který prokazatelně šetří váš čas a podpoří růst projektu.`

### Trope 2: Gushing congratulation / infantilization
**Source pattern**: `You're awesome! You did it! Whoopsie!`

**Counter-strategy**: Understated Success. Czech users don't accept applause for trivial mechanical actions.

> `Hotovo.` / `Změny byly uloženy.`

### Trope 3: Revolutionary + game-changer claims
**Source pattern**: `This new update is a complete game-changer for the industry.`

**Counter-strategy**: absolute ban on direct translation of "hra-měnič" or "revoluce v oboru". Pick a concrete pragmatic benefit.

> `Představujeme funkci, která zásadně usnadní práci s velkými daty.`

### Trope 4: Begging in CTAs
**Source pattern**: `Please click here to learn more immediately.`

**Counter-strategy**: cancel all begging + urgency phrasing. Czech UI doesn't beg, it directs concisely.

> `Více informací` / `Zjistit více`.

### Trope 5: Title Case headers / capitalization
**Source pattern**: `Check Out Our New Awesome Features in Version 2.0`

**Counter-strategy**: Czech sentence case rule. Capital only on first word of sentence + proper nouns.

> `Podívejte se na naše nové funkce ve verzi 2.0.`

### Trope 6: Inclusive-corporate optimism floor
**Source pattern**: `We're so excited to share this incredible journey with all of you!`

**Counter-strategy**: drop the emotion narration. Czech audience reads enthusiasm narration as suspicious.

> `Spouštíme novou verzi. Co se mění: [3 bullety s konkrétními změnami].`

### Trope 7: Big-picture vagueness ("transform / empower / unlock")
**Source pattern**: `Unlock the full potential of your team.`

**Counter-strategy**: replace verb with measurable action.

> `Tým má sdílený přehled o úkolech v jednom prostoru.`

## 2 — Banned-word blocklist (full list)

### English bans
**Marketing buzzwords** (auto-rewrite):
- revolutionize · revolutionary · unlock · elevate · seamless · seamlessly
- cutting-edge · state-of-the-art · best-in-class · world-class · world's leading
- empower · empowering · empowerment · supercharge · turbocharge
- delve · delve into · dive deep · take a deep dive
- robust · scalable · agile · holistic · bespoke
- testament · paradigm shift · sea change · game-changer · disruptor · disruptive
- next-generation · next-gen · cutting · breakthrough
- synergy · synergies · synergistic
- streamline · streamlined (when used vaguely)

**Empty enthusiasm**:
- Awesome! · Amazing! · You're amazing! · You're a rockstar! · Whoopsie!
- Hooray! · Woohoo!
- gratuitous emoji — `🎉` `✨` `🚀` `💯` `🔥` outside of social-media context

**LinkedIn cliché openers**:
- In today's fast-paced world / In today's competitive landscape
- It's no secret that
- Let's dive in / Let's explore / Let's unpack
- Here's the thing
- At the end of the day
- Going forward / Moving forward
- I'm humbled / I'm so excited to announce

### Czech bans
**Buzzwords**:
- revoluční · revoluce v oboru
- magický · kouzelný · kouzlo
- super (jako náhrada za jakoukoli vlastnost)
- nejlepší (bez podloženého důkazu) · 100% nejlepší · #1 v ČR (bez metriky)
- bezkonkurenční · konkurenceschopný (jako jediná vlastnost)
- na míru (když znamená "vytvořené pro vás" abstraktně)
- inovativní řešení · disruptivní · přelomový
- 10× rychlejší / 10× lepší (bez tvrdého čísla)
- ultimátní · totální (bez kontextu)
- moderní (jako jediný benefit) · pokročilý (jako jediný benefit)

**US-patos doslovné překlady**:
- Skvěle! (po triviální akci typu uložení formuláře)
- Jste úžasní! · Jste skvělí! · Jste super!
- Hurá! · Sláva!
- Bezprostředně teď (místo `hned`)
- Naprosto neuvěřitelné · doslova fantastické

**Begging / urgency v CTAs**:
- Klikněte prosím sem
- Zaregistrujte se prosím
- Nezmeškejte! · Nepropásněte!
- Poslední šance! (bez tvrdého deadlinu)
- Pouze dnes! (když to není pravda)

**Generický corporate-CZ**:
- Naše komplexní řešení
- Pokročilá platforma nové generace
- Vytvořeno s ohledem na zákazníka (replace s konkrétem)
- Plně škálovatelný · plně modulární (replace s konkrétem)
- Profesionální tým s mnohaletými zkušenostmi (vágní — replace s konkrétem)

## 3 — Structural slop signals (rewrite regardless of vocabulary)

These don't have a banned word — they have a banned **shape**.

- **Symmetric paragraphs**: 3+ paragraphs of identical length stacked in a row. Vary sentence length.
- **Closing summary phrase**: anything starting with `In conclusion`, `Ultimately`, `To summarize`, `Závěrem`, `Na závěr`, `V podstatě`. Cut entirely.
- **Three-adjective lists**: `fast, reliable, and innovative` / `rychlý, spolehlivý a inovativní`. Pick one and make it concrete.
- **Mirror sentences**: `We don't just X, we Y` / `Nejen X, ale i Y` — overused, auto-rewrite to direct claim.
- **Setup-payoff opener**: `What if I told you...` / `Co kdybych vám řekl, že...` — corporate slop pattern.
- **Self-referential intros**: `Welcome to [Brand], where...` / `Vítejte v [Brand], kde...` — wastes the first 8 words.
- **Hedging language stacking**: `pretty much`, `kind of`, `víceméně`, `tak nějak` — pick one or drop both.

## 4 — Harry Dry's 3-filter rewrite examples

For every claim, run: **Can I visualize it? · Can I falsify it? · Can nobody else say this?** If any fails, rewrite.

| Filter fails | Bad claim | Rewrite |
|---|---|---|
| Visualize | Innovative portable music device with high capacity. | 1,000 Songs In Your Pocket. |
| Falsify | Best and fastest pizza delivery in your city. | Pizza Delivered in 30 Minutes or It's Free. |
| Differentiate | Trusted by leading global companies. | Used by 4 of the top 5 US banks. |
| Visualize (CZ) | Inovativní e-mailové řešení s vysokou flexibilitou. | Doručíme váš e-mail do schránky, ne do spamu. |
| Falsify (CZ) | Nejrychlejší účetnictví na trhu. | Faktura vystavena za méně než 60 sekund — to garantujeme. |
| Differentiate (CZ) | Důvěřuje nám řada firem v ČR. | Používá nás 7 z 10 největších českých e-shopů. |

## 5 — Mozilla CZ typography (the full ruleset)

Source: Mozilla CZ Localization Style Guide + Microsoft CZ Style Guide. This is the canonical software-localization standard for Czech.

### Sentence case
Buttons + labels + headers: capital only on first word and proper nouns.
- ✓ `Uložit nové nastavení`
- ✗ `Uložit Nové Nastavení`

### Date
Default UI format: `d. m. rrrr` with spaces around the periods.
- ✓ `25. 5. 2026` (user-facing UI, prose, headers)
- ✓ `25. 05. 2026` (acceptable in tabular data per Microsoft CZ Style Guide where alignment matters)
- ✓ `2026-05-25` (ISO is fine for system logs, API responses, file names — NOT for end-user UI)
- ✗ `25.05.2026` (no spaces — anti-pattern in user-facing UI; tolerable only in cramped table cells if the rest of the cell budget is genuinely starved)
- ✗ `5/25/2026` (US format)
- Ideally use non-breaking spaces so the date doesn't split across lines.

### Time
24h cycle. Separator is colon (modern UI) or period (traditional).
- ✓ `18:05` · `18.05`
- ✗ `6:05 PM` · `6:05 AM` (no AM/PM in Czech UI)
- No leading zero on the hour when speaking conversationally; in tabular data, leading zero is fine.

### Decimal separator
Czech decimals use **comma**, not period.
- ✓ `1,5`
- ✗ `1.5` (English-format — confusing)

### Thousands separator
Non-breaking space, never comma.
- ✓ `1 500 Kč` · `123 456`
- ✗ `1,500 Kč` (would mean 1.5 CZK in Czech reading)
- ✗ `1.500 Kč` (Eurozone format, not Czech)

### Percent spacing
- **Noun (value)**: `99 %` with space — reads as "devadesát devět procent"
- **Adjective**: `99% sleva` without space — reads as "devětadevadesátiprocentní sleva"

### URL slugs
Strip diacritics + transliterate.
- `Můj nový článek` → `muj-novy-clanek`
- `Účetnictví pro živnostníky` → `ucetnictvi-pro-zivnostniky`
- Never preserve `ž`, `š`, `č`, `ř`, `ý`, `á` etc. in URLs.

### Pronoun "svůj"
Czech reflexive possessive `svůj` is mandatory when the possessor is the subject — `váš` in that position is wrong.
- ✓ `Nastavte si svůj výchozí prohlížeč.`
- ✗ `Nastavte si váš výchozí prohlížeč.`
- ✓ `Stáhněte si svou aplikaci.`
- ✗ `Stáhněte si vaši aplikaci.`

Often the right move is to **omit the pronoun entirely** — Czech doesn't need `your` everywhere English does.
- ✓ `Stáhněte si aplikaci.`
- Acceptable shorter form when context is clear.

### Past-tense gender trap
**SSOT**: see [`../SKILL.md`](../SKILL.md) § Gate 5d for the full rule + rewrite table.

### Title Case is wrong in CZ
This deserves repeating because it's the most visible amateur signal in machine-translated CZ UI:
- ✗ `Co Je Nového Ve Verzi 2.0`
- ✓ `Co je nového ve verzi 2.0`

## 6 — Common AI-translation prompt pitfalls (when guiding an AI to localize)

If the operator wants to feed strings to an LLM for batch CZ translation, the meta-prompt must contain these directives — otherwise the LLM drifts:

### Pitfall 1: Context loss / literal translation
Without context, LLMs translate word-for-word. Always pass:
- The UI surface (button / error / tooltip / hero)
- The user state (after success / after error / first-run)
- The vykání-tykání mode for this brand
- 2–3 verbatim examples from this brand's existing voice

### Pitfall 2: Tykání-vykání drift mid-output
LLMs flip register paragraph-to-paragraph. Hard rule in system prompt:
> "Throughout all outputs use vykání in 2nd person plural without exception. When user gender is unknown, never use singular past-tense forms with rod (`Zadal jste`, `Uložila jste`, `Uložil jsi`) — those leak gender. Use plural vykání (`Zadali jste`), imperative (`Zadejte`), or passive/reflexive impersonal (`Heslo bylo zadáno nesprávně`)."

### Pitfall 3: US-patos transferred 1:1
Without cultural framing, LLMs translate `Awesome!` as `Skvěle!`. Hard rule:
> "Czech audience is skeptical of US-style enthusiasm. Replace all expressive interjections with neutral state descriptions. Replace superlative claims with hedged, metric-backed claims. Never use words: revoluční, magický, super, 100% nejlepší."

### Pitfall 4: Hallucinated sources / facts
Don't ask LLMs to source citations or quotes during localization. They invent confident-sounding URLs, DOIs, study names. Run translation on **provided text only** — never let the model fabricate "supporting evidence".

## 7 — Mid-skill self-review checklist

Before returning copy to operator, scan it against:

1. **Length budgets** — H1 ≤ 12 words, subhead ≤ 20, button ≤ 3, error body ≤ 3 lines
2. **375px viewport** — mobile-line fit, no orphans on H1
3. **Slop blocklist (EN + CZ)** — no banned words
4. **3 filters (Dry)** — every claim visualizable + falsifiable + differentiated
5. **CZ structural** — vykání-tykání consistent, no past-tense gender trap, sentence case, Mozilla typography
6. **CZ vocabulary** — Smazat/Vymazat distinction, Submit→correct CZ verb, no `Editovat` / `Získat aplikaci`
7. **Patos check** — no `Awesome!`, no `Skvěle!` after trivial actions, no `revoluční`
8. **CTA test** — verb-first, names the outcome (not abstract `Odeslat`)
9. **Error message shape** — what + why + next action, no `Invalid` / `Chyba` / `Neplatné` opener
10. **Tone matches voice chart** — would the brand's `cortex/VOICE.md` lint this string yes/no?

If any item fails, rewrite the specific string and re-check.

## Cross-reference

- Translation lookup runtime → [`cz-translation-pairs.md`](cz-translation-pairs.md)
- Framework selection + hero formulas → [`copywriting-frameworks.md`](copywriting-frameworks.md)
- Voice intake + chart template → [`voice-discovery.md`](voice-discovery.md)
- Phase mapping that calls these gates → [`../SKILL.md`](../SKILL.md) § Phase 4 + 5
