---
project: cortex-x
topic: tone-adaptation
date: 2026-04-17
trigger: major_decision — Dave asked whether cortex-x should auto-detect user communication style (máma-mode)
agents: [competitive, technical, security]
cache_ttl_days: 180
cost_estimate: "~$0.20"
---

# Research: Usage-based persona/tone adaptation — should cortex-x auto-detect?

## Trigger
Dave navrhl, že "máma-mode" (laicky vysvětlující tón) by cortex mohl auto-detekovat z chování uživatele napříč projekty. Tohle je architektonické rozhodnutí s bezpečnostními + privacy důsledky. Výzkumný agent spuštěn paralelně s hook implementací.

## TL;DR

- **Smart in principle, risky in execution.** Každý major nástroj (Claude, ChatGPT, Cursor, Copilot) v 2025-26 konvergoval na **explicit Styles / Custom Instructions + opt-in memory**, NE behavioral inference. OpenAI v dubnu 2025 stáhlo GPT-4o právě proto, že inferovaná personalizace sklouzla do sycophancy.
- **Feasible solo-dev scale — ale jako prompt/context engineering, ne ML.** DSPy MIPROv2 ukazuje že instruction-proposal funguje z execution traces bez treninku. Cortex journal je už ten trace substrate.
- **Minimální první krok:** deklarativní `profiles/tone/*.yaml` (máma / peer / terse / mentor) co si uživatel vybere, + *suggestion-only* insight když journal signály nesedí s volbou. Žádná auto-adaptace. PR-gated = matchuje Rule 1 anti-hallucination postoj.

## Key findings

1. **Industry konvergoval na explicit preference capture, ne inference.**
   - Claude = Styles + upload writing samples ([Anthropic Styles](https://support.anthropic.com/en/articles/10181068-configuring-and-using-styles))
   - Claude Code "Auto memory" = ukládá workflow/commands, NE tone ([docs.anthropic.com/claude-code/memory](https://docs.anthropic.com/en/docs/claude-code/memory))
   - GitHub Copilot = 3-tier Personal/Repo/Org instructions ([docs.github.com/copilot](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions))
   - Cursor 3 (April 2026) = `.mdc` rule files, stále declarative ([cursor.com/docs/rules](https://cursor.com/docs/rules))

2. **Sycophancy je dokumentovaný failure mode personalizace.**
   - GPT-4o rollback (duben 2025) + follow-up studie měří "Turn of Flip / Number of Flip" — modely se pod sustained contextem přizpůsobí stance uživatele, vznikne echo chamber.
   - [arXiv 2509.12517](https://arxiv.org/pdf/2509.12517) — 2026 evidence že persistent context zvyšuje drift.
   - [arXiv 2505.23840](https://arxiv.org/html/2505.23840v4) — ToF/NoF whiplash metriky.
   - "Adapt to user" je **přesně ten mechanismus co to rozbil**.

3. **Behavioral signály sice predikují expertise, ale slabě a noisy.**
   - Novice studies: novici mají víc turnů, disclose méně per turn; experti používají precizní terminologii.
   - Signal existuje, ale **je malý** — individual query length je chabý proxy.
   - [Ask or Assume, arXiv 2603.26233](https://arxiv.org/html/2603.26233v1) — single-user journal (Dave n=1) **nepřekročí žádný statistický bar**.

4. **DSPy MIPROv2 = správný mental model pro solo-dev.**
   - Navrhuje candidate instructions grounded v execution traces, Bayesian-select z nich.
   - Prompt engineering, ne training loop.
   - [dspy.ai/optimizers/MIPROv2](https://dspy.ai/api/optimizers/MIPROv2/)
   - **Pasuje na cortex:** journal = traces, PR mutation = selection, evolve loop už je skelet.

5. **GDPR: profiling communication style = profiling "personal preferences."**
   - I single-user, pokud cortex-x pak poletí ven: auto-inference komunikačních preferencí spadá pod Art. 22 / Recital 71 profiling.
   - Vyžaduje explicit informed consent, transparency o logice, human override.
   - [gdpr-info.eu/art-22-gdpr](https://gdpr-info.eu/art-22-gdpr/) + [ICO AI guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/artificial-intelligence/guidance-on-ai-and-data-protection/how-do-we-ensure-individual-rights-in-our-ai-systems/)

## Recommended approach for cortex-x

**DO:**
- Vytvořit `profiles/tone/` adresář: `mama.yaml`, `peer.yaml`, `terse.yaml`, `mentor.yaml`. User volí explicitně v CLAUDE.md nebo přes `~/.claude/settings.json` key jako `cortex.tone: mama`.
- Evolve loop **surfacuje suggestion** ("journal ukazuje 12 follow-up clarifications na scaffold output over 3 projects — zvaž `tone: máma`?"). Udrž hard gates: ≥3 events / ≥2 projects / ≥3 citations. **PR-only, nikdy auto-flip.**
- Logovat jen metadata už v journalu (tool calls, follow-up count, correction events). **Žádná NLP na content.**

**DO NOT:**
- Inferovat tone z vocabulary complexity nebo query length on-the-fly — přesně ta smyčka co vyrobí sycophancy drift dle arXiv 2509.12517.
- Ukládat conversation content pro tone modeling — rozbije privacy-safe invariant + triggeruje GDPR profiling thresholds ve chvíli kdy má cortex druhého uživatele.
- Adaptovat mid-session. Adaptation whiplash je měřitelný (ToF/NoF) a rozežírá důvěru.

**Scales to multi-user:** protože je to deklarativní + PR-gated, není co re-trainovat. Nový uživatel si vybere tone profile; jejich journal navrhne switch; humans approve.

## Sources

- [Anthropic Styles](https://support.anthropic.com/en/articles/10181068-configuring-and-using-styles) — explicit style via writing samples, ne inference
- [Claude Code memory](https://docs.anthropic.com/en/docs/claude-code/memory) — Auto memory scope excluduje tone
- [GitHub Copilot instructions](https://docs.github.com/en/copilot/how-tos/configure-custom-instructions) — 3-tier priority model
- [Cursor Rules](https://cursor.com/docs/rules) — `.mdc` declarative, žádná inference
- [OpenAI Customizing Personality](https://help.openai.com/en/articles/11899719-customizing-your-chatgpt-personality) — post-rollback shift k explicit selection
- [Interaction Context + Sycophancy, arXiv 2509.12517](https://arxiv.org/pdf/2509.12517) — 2026 evidence
- [Measuring Sycophancy arXiv 2505.23840](https://arxiv.org/html/2505.23840v4) — ToF/NoF whiplash metriky
- [DSPy MIPROv2](https://dspy.ai/api/optimizers/MIPROv2/) — trace-driven instruction proposal bez trainingu
- [Ask or Assume arXiv 2603.26233](https://arxiv.org/html/2603.26233v1) — expertise signály jsou slabé
- [GDPR Art. 22](https://gdpr-info.eu/art-22-gdpr/) + [ICO AI rights](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/artificial-intelligence/guidance-on-ai-and-data-protection/how-do-we-ensure-individual-rights-in-our-ai-systems/) — profiling = behavioral inference, needs consent

## Synthesis

Auto-detect = ❌. Declarative tone profile + journal-surfaced *suggestion* přes existing evolve loop = ✅. Máma-mode zůstává first-class feature, ale jako **user-chosen hat**, ne věc co cortex hádá.

## Recommended actions

1. Vytvořit `profiles/tone/` s 4 YAMLy (máma / peer / terse / mentor)
2. Rozšířit `config/evolve.yaml` o `tone_mismatch` insight type (mining z follow-up frequency + correction frequency)
3. Zdokumentovat v `standards/ai-patterns.md` paragraph "Tone: declarative, never inferred" + odkaz na arXiv 2509.12517
4. V CLAUDE.md příkladu přidat `cortex.tone: peer` řádek do template
