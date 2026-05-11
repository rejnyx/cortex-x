# QA Tester Onboarding — den 1 v cortex-x

> Pro novou QA inženýrku / testerku, která se přidává do týmu a chce použít cortex-x jako AI-augmented audit nástroj.
> Doba čtení: 10 min. Doba první runy: ~30 min auditu na repo + ~30 min review výstupů. Hotová první iterace: ~1.5h.

## Co dostaneš v 30 minutách

Pustíš `/test-audit` na svůj duplikát firemního repa. Po 30 minutách máš v `cortex/qa/`:

- **`AUDIT.md`** — 12-section audit aligned na ISO/IEC 25010:2023 (9 product-quality charakteristik + 3 cortex extras: correctness, AI-eval, test-observability). Senior-konzultantský deliverable, který by ručně trval 2 týdny.
- **`testing-strategy.md`** — 12-měsíční pyramid plan, tool decisions s citacemi, CI gating philosophy, risk-tiered coverage thresholds, ISO 25010 char-by-char targets, 3-month execution plan.
- **`testing-gaps.md`** — prioritizovaný P0/P1/P2 backlog s 3-hop traceability (claim → finding → URL). Každý gap má **inline auto-fetched research findings** (3 implementační patterns + 2 anti-patterns + minimal-working-example + 5+ cited URLs).

To není "AI generated test boilerplate". To je výstup, který ti senior konzultant píše první 2 týdny v gigu — komprimovaný do 30 min.

## Filozofie — co ti cortex NENÍ

**cortex-x tě nenahrazuje.** Audit produkuje *evidence*; ty rozhoduješ, co znamená business risk. Phase 3 audit má 5 otázek, na které **kód neumí odpovědět** (top business risk, posledních 3 incidentů, compliance scope, off-limits zóny, tvoje kapacita) — ty je odpovídáš ty, ne AI.

**Pozicování:** AI-augmented tester > AI alone > tester alone. 75 % organizací cílí na AI-driven testing, jen 16 % to úspěšně adoptuje (testdevlab 2026). Differentiator = začni s auditem před automatizací. cortex-x ti dá ten audit první den.

## Setup (jednou, 5 minut)

```bash
# 1. Naklonuj cortex-x do svého home
git clone https://github.com/Rejnyx/cortex-x ~/cortex-x

# 2. Spusť install s qa-tester profilem
cd ~/cortex-x
./install.ps1 --profile=qa-tester       # Windows
# nebo
./install.sh --profile=qa-tester         # macOS / Linux
```

**Co tím získáš:**
- `~/.claude/skills/test-audit/SKILL.md` — slash-skill `/test-audit` aktivní v každém projektu
- `~/.claude/skills/cortex-init/SKILL.md` — pro general retrofit (chain po `/test-audit` pokud chceš)
- `~/.claude/cortex/user.yaml` má `profile: qa-tester` → aktivuje **auto-research-per-gap** (každý gap dostane 200-word web-fetched memo s implementačními patterns)
- `~/.claude/shared/standards/test-types-catalog.md` — 117-entry exhaustivní katalog 2026 test types (12 kategorií)
- `~/.claude/shared/profiles/qa-engineer.yaml` — risk-tiered quality gates + 15 QA concerns + ASVS 5.0 mappings

Banner po installu ti řekne přesně, co dál. Zkrácená verze:

```
Next step (QA tester) — open Claude Code at the root of the repo you're auditing:

    claude
    /test-audit
```

## Den 1 — první audit (30 min run + 30 min review)

### Krok 1 — otevři Claude Code v repu

```bash
cd /path/to/repo-which-you-are-auditing  # tvůj duplikát firemního repa
claude
```

V Claude Code session:

```
/test-audit
```

Tím spustíš 7-fázový audit. Můžeš to nechat běžet bez zásahu — vrátí se s otázkami v Phase 3.

### Krok 2 — Phase 3 (5 otázek, kterým musíš odpovědět ty)

cortex-x ti pošle 5 dotazů, na které kód neumí odpovědět. Toto je **load-bearing** část — bez tvojích reálných odpovědí audit ti dá generic backlog místo backlog tailored na váš business risk.

1. **Q1 — Top business risk this quarter:** Co kdyby v produkci selhalo, byl by to průšvih? (Buď konkrétní: "checkout failure invisible to customer support", ne "tests should be better")
2. **Q2 — Last 3 production incidents:** Krátký popis + co se rozbilo + máš na to už test? (Tohle dá P0 prioritu pro regression-bug-replay v backlogu)
3. **Q3 — Compliance / regulatory pressure:** Jste pod regulací? GDPR Art. 32 audit-log? PCI-DSS scope? AI Act high-risk system? WCAG 2.2 AA per EAA 2025-06-28? **Tohle eskaluje security/compliance entries v katalogu na P0.**
4. **Q4 — Off-limits / fragile zones:** Co se nemá refaktorovat bez svolení? (Legacy auth? Third-party integration? "Bobův modul"?)
5. **Q5 — Tester capacity + skill profile:** Solo junior / pair / dev tým? Hodin/týden? Tools, které UMÍŠ (Playwright? Stryker? k6?). **Tohle right-size'uje backlog** — junior solo dostane max 5 P0 + 10 P1; senior team získá full backlog.

**Tip:** odpovězi krátké a konkrétní. cortex-x je ne-přehnaně-defenzivní — věří tvým odpovědím a podle nich filtruje 117-entry katalog na 12-25 typů testů relevantních pro **vaše konkrétní** repo.

### Krok 3 — review výstupu (cca 30 min)

cortex-x ti vyrobí 3 deliverables. Otevři je ve VS Code / editoru:

```
cortex/qa/AUDIT.md           ← 12-section audit, executive summary nahoře
cortex/qa/testing-strategy.md ← high-level plan, tool decisions, CI gates
cortex/qa/testing-gaps.md    ← prioritizovaný P0/P1/P2 backlog
```

**Co dělat při review:**

1. **Začni s `AUDIT.md` § Executive summary (5 bullets)** — to je TL;DR. Sedí to s tím, co znáš o repu? Pokud ne, je to signál že audit chytl něco, co tobě uniklo (nebo audit minul kontext, který znáš jen ty).

2. **Quality scorecard (1-5 per ISO 25010 char)** — co je nejnižší? To je tvůj startovací bod pro 3-month plan. Cortex-x ti to už zarovnal v `testing-strategy.md`.

3. **`testing-gaps.md` P0 sekce** — máš tam ≤ 5 položek (Phase 3 Q5 right-size'oval). U každého gap najdeš:
   - **Type:** který catalog entry to mapuje (klikneš → `~/.claude/shared/standards/test-types-catalog.md` má tool decision tree + 2026 best practices)
   - **Risk if unfixed:** jednověta — proč to bolí
   - **Estimate:** S/M/L odhad
   - **Owner skill:** junior / mid / senior
   - **3-hop citations:** [audit: §X] [src: URL] [research: topic-name]
   - **Research nudge:** WebSearch query, kterou paste'neš do Claude Code PŘED tím, než začneš implementaci (audit-then-research-first discipline)
   - **Research findings (auto-fetched)** — na qa-tester profilu je už pre-fetched 200-word memo: 3 patterns + 2 anti-patterns + minimal-working-example snippet + 5+ cited URLs

4. **Discuss with team:** ukaž `AUDIT.md` na 1:1 s tech leadem nebo seniorem. Jejich reakce + kontext, který kód neumí říct, jsou input pro Q1-Q5 override (pokud auto-mode RA fills jsou špatně). Re-run `/test-audit` s aktualizovanými odpověďmi pokud je třeba.

5. **Pick ONE P0 gap to ship week 1** — nejlevnější + nejvíc business risk. Implementace = paste research nudge → research → write test → PR. Senior reviewer to zkontroluje, ty se učíš diff mezi co jsi měla v hlavě a co best practice 2026 říká.

## Co dělat když nesouhlasíš s auditem

Cortex-x je nástroj, ne autorita. Pokud:

- **Phase 3 RA fills jsou špatné** — audit běžel v auto-módu a hádal Q1-Q5. Otevři `cortex/qa/AUDIT.md § Phase 3 — Human input` a přepiš odpovědi vlastními. Re-run `/test-audit` (idempotent — používá `cortex/qa/audit-context.md` jako cache).
- **Audit našel něco neexistujícího** — cortex-x používá file:line citace; pokud claim neukazuje na reálný kód, je to halucinace. Otevři issue v cortex-x repu (Rejnyx/cortex-x) s file:line a quote — pomůže prompt iterace.
- **P0 backlog je moc velký pro tvoji kapacitu** — Phase 3 Q5 (kapacita) jsi pravděpodobně odpověděla štědře. Re-fill s reálným číslem hodin/týden, re-run.

## Týdenní cadence (po prvním auditu)

- **Pondělí:** zkontrolovat P0 backlog, vybrat 1-2 itemy na týden
- **Po-Pá:** ship per Research nudge → Research → Write test → PR. Tech lead review.
- **Pátek:** update `cortex/qa/testing-gaps.md` (mark closed gaps); commit.
- **Měsíčně:** quick re-look at `testing-strategy.md` 3-month plan; je vše on-track?
- **Kvartálně:** re-run `/test-audit` — diff s předchozím = signál pokroku.

## Příklad — meta-audit cortex-x samotného

Pro představu jak audit reálně vypadá na production-grade frameworku, přečti si self-audit cortex-x:

```bash
cat ~/cortex-x/cortex/qa/AUDIT.md          # 12-section self-audit
cat ~/cortex-x/cortex/qa/testing-gaps.md   # 24 gapů: 4 P0 + 14 P1 + 5 P2
cat ~/cortex-x/cortex/qa/testing-strategy.md  # 12-month pyramid plan
```

Klíčový pattern, který audit najde: **"defense-by-design ≠ defense-by-regression-test"** — cortex-x má 4 defense layers (spec-verifier + halt-check + redact + path-safety) všechny unit-tested jako knihovny, ALE žádný end-to-end "adversarial input → defense fires" regression test. Top-line P0 finding ≤ 12h opravit.

Tvoje práce den 1: spustíš `/test-audit` na svůj duplikát firemního repa, dostaneš obdobný deliverable, override Phase 3 RA fills vlastními odpověďmi, pick first P0 to ship.

## Filozofie — k čemu se vracet

> Audit producuje evidence. Tester evaluates které evidence mapuje na business risk. AI nedokáže to druhé.

> Coverage % je vanity metric. Mutation score je honest fitness function (Trail of Bits 2026).

> Determinism je dead — `seed=0` na OpenAI je best-effort, na Anthropic žádný. Property-based + LLM-judge testy > snapshot tests.

> Žij katalog: 117 typů, vyber 12-25 podle scan retrofitu. Don't apply all; apply LEAST testing necessary to verify the most critical risks.

> Defense-by-design je polovina práce; defense-by-regression-test je druhá. Pokud spec-verifier existuje ale nikde není test, který simulate "malicious input → defense fires", tvoje defense layers jsou theoretical.

## Reference

- Hlavní prompt: `~/.claude/shared/prompts/qa-retrofit.md` (40KB, 7 fází)
- Profile YAML: `~/.claude/shared/profiles/qa-engineer.yaml` (12KB, risk-tiered gates)
- Test types catalog: `~/.claude/shared/standards/test-types-catalog.md` (55KB, 117 entries, 148 cited URLs)
- Testing standard: `~/.claude/shared/standards/testing.md` (pyramid + 5 pillars per test)
- Correctness standard: `~/.claude/shared/standards/correctness.md` (Zod boundaries + property-based + mutation)
- Security standard: `~/.claude/shared/standards/security.md` (8-layer defense + ASVS L1/L2 alignment)

## Otázky / problémy

- **cortex-x repo:** https://github.com/Rejnyx/cortex-x (private, gh auth)
- **Sprint 2.10 R1 memo (background):** `docs/research/sprint-2.10-qa-retrofit-2026-05-09.md` — proč jsme to postavili, 38 cited sources
- **Self-audit příklad:** `cortex/qa/AUDIT.md` v cortex-x samotném — meta-příklad jak audit vypadá na production-grade frameworku

## Pokud chceš to ukázat manažerovi / tech leadovi

Po prvním auditu máš v rukou objektivní deliverable — můžeš ho použít k diskuzi. Doporučená sequence:

1. **Začni s `cortex/qa/AUDIT.md § Executive summary`** — 5 bullets, < 2 minuty čtení. Nech ho je přečíst první. Ty mlč.
2. **Quality scorecard** — 9 ISO 25010 charakteristik + 3 cortex extras se skóre 1-5. Vizuálně okamžitě vidí "kde jsme silní, kde slabí." Většina senior managers tohle ocení (mnohem víc než "máme málo testů").
3. **`testing-gaps.md` § P0 sekce** — ≤ 5 položek. Ne víc. Každý gap má **risk if unfixed** (jednověta proč to bolí) + **estimate** (S/M/L) + **owner skill** (junior/mid/senior). To je rozhodovací matice na týdenní 1:1.
4. **Talking point:** "Toto není můj subjektivní názor — je to ISO 25010:2023 + OWASP ASVS 5.0 + Bach HTSM grounded audit. 148 citovaných URLs. Senior konzultant by tohle psal 2 týdny, mně to bot vygeneroval za 30 min. Co zafixovat první?"
5. **Pokud reagují skepticky** ("AI něco vyplivlo, nedůvěřuji tomu") — ukaž jim **3-hop traceability** v gapech: každý finding má `[audit: §X]` (kde to vidíš v audit dokumentu) + `[src: file:line]` (kde to je v jejich kódu) + `[research: topic]` (které best practice to cituje). Ne hallucination — file:line citace.
6. **Pokud reagují obranně** ("náš tým to ví, jen nemáme čas") — to je validní bod. Audit je *evidence*, ne obvinění. Tvůj follow-up: "Co kdybych vzala 1 P0 týdně, ty bys reviewnul? Za 12 týdnů máme všech 12 fixed."

**Nepokoušej se být arrogantní.** AI deliverable ti dává hard data, nemá ti nahrazovat soft skills. Tvoje hodnota = umíš to interpretovat business-relevantně + máš empatii ke kontextu týmu.

## Pokud manažer chce vidět "framework, který to udělal"

cortex-x je veřejně dokumentovaný (GitHub: `Rejnyx/cortex-x`, dnes private, na cestě k v0.1.0 public). Klíčové demo body pro tech-lead/CTO publikum:

- **Spec-driven verification** — každá AI změna musí splnit `acceptance_criteria[]` před commitem. 5 criterion kinds (shell/file_predicate/regex/ears_text/llm_judge). Bez toho rollback.
- **Property-based + mutation testing** — fast-check chytl reálný cross-platform security regression (2026-05-10) v `scrubClaudeCliEnv` který by jinak existoval indefinitely.
- **Multi-window cost guards** — daily $5 / weekly $25 / monthly $80 + token velocity cap + cross-session loop detector. AI se nezacyklí ani v exotických případech.
- **8-layer defense per `standards/security.md`** + § Agentic Security 2026 (lethal trifecta, 7 MUST patterns) — production-grade safety, ne demo.
- **Defense-by-design ≠ defense-by-regression-test** je load-bearing finding z self-auditu cortex-x. 4 defense layers existují, **end-to-end adversarial regression test** je top P0 ve self-backlogu. Honestní.

Welcome to AI-augmented testing 2026. The bar is: walk in den 1 with a senior-consultant deliverable already on disk. You review it, don't build it.
