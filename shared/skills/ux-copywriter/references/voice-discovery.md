# Voice discovery — intake + Podmajersky chart + archetypes + decision tree

> Companion to [`../SKILL.md`](../SKILL.md). Loaded during Phase 1 (brand-mode intake). Used to translate the operator's brief into an auditable `cortex/VOICE.md` that lints every later session.

## 1 — The 12-point intake questionnaire

Use this as the source for `AskUserQuestion` blocks in Phase 1. Skip questions the operator already answered in the trigger message. **Don't waive Q12** in brand mode — verbatim customer quotes are the seed that makes copy good.

1. What is the **real Job-to-be-done** of your product, in 1 plain sentence, from the customer's pragmatic perspective?
2. If your product were a **historic / public person**, who would it be and why?
3. Three adjectives you'd want customers to use about you **after trying it**?
4. Three adjectives you absolutely **don't want** customers to use about you?
5. Who is your **biggest competitor** and what specifically sounds wrong / corporate / boring about their copy?
6. **Critical-scenario tone**: a user just made an irreversible mistake (e.g., deleted their data). How does your error message sound? (apologetic / matter-of-fact / lightly humorous?)
7. **Topic complexity**: is your customer an expert in the field, or a layperson you have to educate?
8. **Banned buzzwords / jargon**: words your real customers hate hearing, even when the industry uses them?
9. (CZ) **Tykání or vykání**? Tykání reads startup-and-fast; vykání reads professional-with-distance.
10. (CZ, if vykání) Are you OK with **occasional informal softening** (light double meanings in ads), or do you want strict formality everywhere?
11. **Emotional catharsis**: what should the customer feel right after they complete signup / purchase / onboarding? (relief / childlike excitement / smart-choice satisfaction?)
12. **MANDATORY**: 2–3 **verbatim** quotes from real customers — mix 1 strongly positive, 1 mid-3-star with rationale, 1 critical.

## 2 — Podmajersky Voice Chart — the template

After intake, fill this 4-column × 3–5-principle matrix and write it to `cortex/VOICE.md`. This is the format every later session lints against.

```markdown
# Voice chart — [Brand name]

| Principle | Concepts (mental anchors) | Vocabulary (yes / no) | Verbosity (length, rhythm) | Grammar + punctuation |
|---|---|---|---|---|
| 1 — [Principle name] | [What to emphasize in any copy] | **Yes:** [verb], [noun], [adj]. **No:** [banned word], [banned word]. | [Sentence length pattern, paragraph density] | [Punctuation rules, voice (active/passive), tykání/vykání mode] |
| 2 — [Principle name] | ... | ... | ... | ... |
| 3 — [Principle name] | ... | ... | ... | ... |
```

### Worked example (B2B SaaS — fictional "ZenFaktura" CZ accounting tool)

| Principle | Concepts | Vocabulary | Verbosity | Grammar + punctuation |
|---|---|---|---|---|
| **1 — Klid a přehled** | Finanční klid uživatele. Bezstresové účetnictví pod kontrolou. | **Yes:** přehled, zjednodušit, vyřešeno, hotovo. **No:** inovativní, ultimátní, komplexní. | Krátké texty, hodně bílého místa. Žádné odstavce delší než 3 řádky. | Tečky na konci vět. Žádné vykřičníky. Vykání-plurál. |
| **2 — Klinická přesnost** | Účetní data nelžou. Automatizace eliminuje lidskou chybu. | **Yes:** spárováno, přesně, detekováno, systém zaznamenal. **No:** asi, zhruba, magicky, snad. | Fakta první. Klíčové číslo před vysvětlením. | Čísla 1–10 v číslicích pro rychlé skenování. Bez vykřičníků. |
| **3 — Lidskost v technologii** | Nástroj slouží lidem, není uzavřená černá skříňka. | **Yes:** jsme tu pro vás, rádi pomůžeme, ozvěte se podpoře. **No:** systémový error 404, kritická výjimka. | Změkčovat na chybových stránkách a v empty states. Nebýt robotický. | Otazníky v tooltipech nápovědy. Vykání-plurál. |

### Worked example (CZ B2C delivery — "Rohlík" reverse-engineered)

| Principle | Concepts | Vocabulary | Verbosity | Grammar + punctuation |
|---|---|---|---|---|
| **1 — Lidský a sousedský** | Nakupování nemá být stres. Jsme jako prodejce na rohu, který vás zná. | **Yes:** Dobrý den, nákup, rodina, my, vy, mrzí nás to. **No:** Objednávka č., zákazník, uživatel, reklamace. | Prostor pro vlídnost u uvítání a poděkování. | Aktivní rod. Občasný smajlík nebo vykřičník. Moderní vykání. |
| **2 — Posedlý časem** | Váš čas patří vám a rodině, ne supermarketu. | **Yes:** hned, za chvilku, hotovo, do x minut. **No:** v co nejkratším termínu, procesuje se. | Strohost v checkoutu. Jednoslovná tlačítka. | Krátké věty. Vynechávání podmětu. Žádná souvětí. |
| **3 — Nekompromisně férový** | Pokud uděláme chybu, přiznáme ji a kompenzujeme. | **Yes:** vrátíme peníze, zdarma, férově. **No:** v souladu s VOP, sankční poplatek. | Otevřenost vyžaduje vysvětlení, ale v krátkých blocích. | Aktivní rod ("Kurýr se zpozdil", ne "Doručení bylo zpožděno"). |

## 3 — Brand archetypes (12 Jungian → 6 simplified)

The 12-archetype Mark/Pearson model gives a psychological frame; in practice cortex collapses it to 6 for digital products:

| Archetype | Profile | Best for | Avoid for |
|---|---|---|---|
| **Učitel / Edukátor** (Sage) | Patient, structured, builds conceptual understanding | Complex B2B SaaS, edu platforms, healthcare | Lifestyle B2C, gaming |
| **Průvodce / Mentor** (Guide) | Reassuring, builds trust step-by-step, professional | Fintech, healthcare, professional services | Disruptive startups, B2C impulse |
| **Parťák** (Everyman / Friend) | Informal, conversational, light slang, peer-tone | B2C lifestyle, social apps, gig economy | Banking, healthcare, legal |
| **Vyzyvatel / Disruptor** (Outlaw / Rebel) | Sharply differentiated against legacy, confident, light sarcasm OK | Disruptive startups, prosumer rebels | Healthcare, legal, fintech |
| **Šašek** (Jester) | Playful, irreverent, peer-tone with humor as load-bearing element | Gen Z lifestyle, social apps, FMCG brands with personality | B2B enterprise, healthcare, legal |
| **Hrdina** (Hero) | Strong, confident, mastery-themed, overcoming-odds narrative | Gaming, fitness, esports, performance tools | Calm/zen products, healthcare |

When intake answers point to multiple archetypes, **pick the dominant one** for hero copy and reserve the secondary for specific surfaces (e.g., Mentor primary on landing page + Parťák on social).

## 4 — Voice-discovery decision tree

This is the algorithm Phase 1 follows after the intake. Encode as a series of if/then tests on the answers:

### Test 1 — B2B vs B2C core
- B2B SaaS / fintech / healthcare / legal / enterprise → branch **Vykání + formal**
- B2C e-commerce / lifestyle / gaming / fitness → branch **Tykání + informal**
- Mixed (solo entrepreneur tools, creative agencies) → check market conservatism (Fakturoid playful-vykání vs iDoklad strict-vykání), default vykání

### Test 2 — Vykání calibration (B2B branch)
- Brief contains `enterprise / security / compliance / audit / reliability` → **Strict vykání**, factual tone, 3rd-person passive for system logs. Archetype: Učitel / Mudrc.
- Brief contains `innovation / fast / simple / automation / get out of your way` → **Vykání s odlehčeným tónem**. Plurálové imperativy, light self-deprecation. Archetype: Průvodce.

### Test 3 — Tykání calibration (B2C branch)
- Brand targets Gen Z / students / niche lifestyle → **Bold tykání**. Slang allowed, emoji allowed, emotional language allowed. Archetype: Šašek / Hrdina / Rebel.
- Brand targets broad mass-market e-commerce → **Cautious tykání**. Friendly but no slang, must not alienate older customers. Archetype: Parťák.

### Test 4 — Mobile/space lint
- Output is for mobile UI / fixed-width buttons / micro-CTAs → activate **+30% headroom** and `≤2 word infinitive` preference. Iterate until fits 375px viewport.

## 5 — Verbatim CZ brand voice survey

For few-shot grounding. Brands operating in CZ, their voice signature, and what they do well.

| Brand | Segment | Registr | What works | Voice line example |
|---|---|---|---|---|
| **Fakturoid** | B2B SaaS (živnostníci) | Vykání + maskot robota | Lidský a hravý tón ve formálním rámci. Žertovné copy ("Robot pro vás upekl cookies") + vykání zachovává autoritu v oblasti financí. | `Jednoduchá a výkonná online fakturace.` / `Vyzkoušejte ho 30 dní zdarma.` |
| **iDoklad** | B2B SaaS (účetnictví) | Striktní vykání | Konzervativní formálnost. Social proof tvrdými čísly (`300 000 podnikatelů`). Čistý infinitiv v CTA. | `Osvoboďte se od papírování. Dělejte to, co vás baví. Stejně jako 300 000 podnikatelů před vámi.` |
| **Rohlík.cz** | B2C delivery | Tykání | Friendly + speed guarantee jako hlavní zbraň. | `Kvalitní potraviny doručené do 90 minut.` / `Vyber si z široké nabídky.` |
| **Bageterie Boulevard** | B2C gastro/QSR | Mixed gourmet | Profiluje se proti řetězcům slovníkem "gourmet" + "Chef menu" + frankofonní obraty. | `Exprès gourmet.` / `Paris Box pro 2.` |
| **Kofola** | B2C FMCG | Tykání (vysoká familiarita) | Emoční leader. Nostalgie + lokální hravost ("páteček"). Archetyp: Milenec. | `Když ji miluješ, není co řešit.` |
| **Bernard** | B2C pivovar | Bold / provokativní | Archetyp Vyzyvatele. Politický komentář, vymezení proti korporátu. | `Vlastní cestou.` / `Svět se zbláznil, držte se...` |
| **Mews** | B2B hospitality | EN primární + CZ modul | Globální značka s CZ kořeny. PR i web v EN. CZ pouze v PMS UI, formálně. | `Hotelový systém vytvořený pro moderní hoteliéry.` |
| **Apify** | B2B dev-tool (CZ → global) | EN primární | Matter-of-fact. Suchý, inženýrský, deskriptivní popis kategorie. | `The full-stack web-scraping & automation platform.` |
| **Productboard** | B2B (CZ → global) | EN primární | Cílí na globální PM komunitu. CZ lokalizace volitelná v Labs. | `Make products that matter.` / CZ: `Dělejte produkty, na kterých záleží.` |
| **Alza** | B2C e-commerce gigant | Tykání + agresivní maskot | Drzé, ukřičené, Klaun/Vyzyvatel. Konzistentní tykání napříč cestou. | `Spolehlivé doručení do AlzaBoxu.` |
| **Slido** | B2B/B2C (SK → global) | EN primární | Universalní nástroj pro konference. EN bez nutnosti masivní lokalizace. | — |

## 6 — Czech copywriting authorities (resources)

When operator asks for "deeper than this skill goes" or wants a human to consult:

- **Vladimír Vaněček** — copywriter, autor eseje „50 odstínů copy a tonalita aneb Kdy a jak měnit styl psaní". Analytický pohled na modulaci tónu podle kanálu.
- **Otto Bohuš** — mentor, kurz „Škola mistrů textu". Důraz na stručnost, údernost, rytmus textu.
- **Vladana Bačová (Contesaur / Pretty Much Nomads)** — propagátorka UX writingu v ČR. Analytický funkční přístup pro B2B tech.
- **Copybara (Lucie Smetanová)** — agenturní pohled, technické + marketingové znalosti, SEO + PPC literacy.
- **H1.cz (dnes pod GroupM Nexus)** — historicky nejvýznamnější škola českých copywriterů.
- **MediaGuru.cz / Markething.cz / Lupa.cz / MarketingJournal.cz** — odborný průmyslový tisk pro CZ marketing + e-commerce + IT.

## 7 — Bloomstein BrandSort cards (45 commonly used)

For workshop-style intake when operator wants depth. Sort each into three piles: **WE ARE** / **WE ARE NOT** / **WE'D LIKE TO BE**.

```
Konzervativní · Trendy · Autoritativní · Rovnocenný · Chytrý · Jízlivý · Korporátní · Startupový
Vážný · Hravý · Formální · Neformální · Tradiční · Moderní · Sofistikovaný · Přístupný
Drzý · Uctivý · Provokativní · Bezpečný · Riskující · Spolehlivý · Nadšený · Klidný
Optimistický · Realistický · Vřelý · Profesionální · Lidský · Technický · Pragmatický · Vizionářský
Empatický · Direktivní · Trpělivý · Energický · Stručný · Detailní · Inkluzivní · Exkluzivní
Hrdý · Pokorný · Vážený · Mladistvý · Zkušený · Místní · Globální · Specializovaný · Univerzální
```

The **negative selection** is the load-bearing output. "We are playful but not sarcastic" is a much sharper constraint than "we are playful".

## Cross-reference

- Phase 1 intake mechanics → [`../SKILL.md`](../SKILL.md) § Phase 1
- CZ cultural register + anti-patos → [`cz-cultural-lint.md`](cz-cultural-lint.md)
- Production framework selection → [`copywriting-frameworks.md`](copywriting-frameworks.md)
- Translation pairs for lint runtime → [`cz-translation-pairs.md`](cz-translation-pairs.md)
