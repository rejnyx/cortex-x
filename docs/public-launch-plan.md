# cortex-x + Hermes Agent — Public Launch Plan

> **Status:** Draft v1, 2026-05-06
> **Owner:** David Rajnoha (Rejnyx)
> **Branch this lives on:** `claude/verify-message-legitimacy-T45Te`
> **Source of truth for blockers:** [`MIGRATIONS.md`](../MIGRATIONS.md) (D-1 through D-4, "Pre-public-tag debt")

This plan combines two threads:
1. Take cortex-x from closed beta to public v0.1.0 release.
2. Bundle a self-hosted **Hermes Agent** profile so every scaffolded project ships with its own learning agent from commit zero.

---

## 1. Pitch positioning (decided 2026-05-06)

### Primary: **B — Sovereign AI Stack** 🇪🇺

> **The only AI dev framework where your code, your agent, and your agent's learnings never leave your server.**
>
> 2026: GDPR auditors want to know where data flows. NIS2 demands supply-chain transparency. The EU AI Act regulates high-risk systems. cortex-x + Hermes gives you an agentically mature stack in **3 minutes** — fully self-hosted, fully auditable, fully yours.

**Why this wins:**
- Real budget on the other side (compliance ≠ hobby)
- Timing: AI Act enforcement, NIS2 deadlines, GDPR audits — all peaking in 2026
- Competitor wipe-out: OpenClaw has CVE-2026-25253 (CVSS 8.8 RCE), most others are cloud-only
- Author authenticity: David is an EU dev, framework already supports CZ/EN/DE language preference

### Secondary undertones (used in messaging, not headline)

**A — "Day 0 Agent"**
> Your project doesn't ship without a coworker. Onboarded once, grows with the codebase forever.

**C — "Compound AI Productivity"**
> Self-improving Hermes loop + cortex-x evals = each project is smarter than the last. Compound interest, on productivity.

### Tagline candidates (pick one for landing)

- **"The agentic framework that never leaves your server."** ← favored
- "Sovereign AI for builders. Self-hosted from day zero."
- "Your stack. Your agent. Your data. Always."

### Target persona stack-rank

1. **EU SMB consultancies** (legal, fintech, healthcare) — compliance budget, hate cloud-only
2. **Indie SaaS founders** wanting agentic features without rewrites
3. **Dev shops / agencies** needing repeatable enterprise-grade output
4. **Senior solo devs** who care about privacy + craftsmanship

Avoid for v0.1: hobbyists (won't pay), enterprise procurement (too heavy for solo maintainer).

---

## 2. Audit summary (2026-05-06)

**Headline: 85% ready for closed beta. 95% after D-1 fix. 100% with Hermes profile.**

| Area | State | Severity if untouched |
|---|---|---|
| README & docs | Complete, public-facing | — |
| install.sh / install.ps1 | Idempotent, no hardcoded paths in code | — |
| 9 profiles (YAML) | All complete, `ai_sdk` declared per-profile | — |
| 6 templates (Handlebars) | Functional, intentional user-fill placeholders | — |
| 11 standards docs | 2,700+ lines, RULE-1 binding contract, substantive | — |
| 6 hooks (.cjs) | Functional, no personal hardcoding | — |
| Phase 5 self-improvement | v1 done 2026-04-17, eval substrate ready | — |
| LICENSE / CONTRIBUTING / SECURITY | Complete, PolyForm NC 1.0.0 | — |
| **Phase 2 CLI (`/init-project`)** | **Roadmap only** — users paste prompts | Medium (hurts "one-command" story) |
| **`hermes-agent` profile** | **Greenfield** | Hard blocker for the new pitch |
| **Git history personal data** (D-1) | **Documented in MIGRATIONS.md, not yet purged** | 🔴 Critical — must fix before flipping repo public |
| **GPG-signed tags** (D-2) | Not implemented | High — install.sh trusts unsigned tags |
| **Residual `~/cortex-x/` refs** (D-4) | ✅ RESOLVED 2026-05-06 (14 files, 55 lines, "path convention normalized" commit) | — |
| **Windows ACL warning** (D-3) | ✅ RESOLVED 2026-05-06 — added to SECURITY.md Platform Notes | — |
| **CODE_OF_CONDUCT.md** | ✅ ADDED 2026-05-06 — Contributor Covenant 2.1 (canonical text via curl) | — |
| **CI gate (no-PII)** | ✅ ADDED 2026-05-06 — `.github/workflows/no-pii.yml` runs `validate-no-pii.mjs` on every PR | — |

---

## 3. Competitor & market context

### What exists (and where the gap is)

| Category | Examples | Gap |
|---|---|---|
| Bootstrap frameworks | claude-bootstrap, create-* tools | No live agent |
| Agent runtimes | **Hermes Agent** (110k★, 10wks, fastest-growing 2026), OpenClaw (5,700 skills, but CVE 8.8 RCE) | No project bootstrap |
| AI IDEs | Cursor, Cline, OpenCode, Codex | No bootstrap, no project-persistent memory |

**Nobody offers**: scaffold a project + deploy a self-improving agent that learns YOUR codebase from commit #0. **That's the gap cortex-x + Hermes fills.**

### Why Hermes (not OpenClaw)

- Hermes: depth (self-improving loop, 3-layer memory, 118 bundled skills, **no published CVEs**)
- OpenClaw: breadth (5,700 skills) but **CVE-2026-25253 CVSS 8.8 RCE + CVE-2026-30741** — disqualifying for compliance-driven persona
- Hermes setup: 2-4h local; OpenClaw: 30 min Docker — but Hermes is the strategic fit for our pitch

---

## 4. Sprint plan (6 weeks total)

### Sprint 0 — Pitch lock-in (2 days)

- [x] Decide pitch (B primary, A+C undertones) — **2026-05-06**
- [ ] Draft 1-page landing copy for `davidrajnoha.dev`
- [ ] Validate pitch on 5 humans (FB, Discord, friend devs)
- [ ] Iterate copy based on confusion points

**Definition of done:** 5 people read the landing copy and can correctly summarize the value prop in their own words.

### Sprint 1 — Public hardening (1 week)

- [ ] **D-1: `git filter-repo` purge** — explicitly destructive; requires user execution (commands in MIGRATIONS.md §D-1). Backup branch first. Force-push. Document in CHANGELOG.
- [ ] **D-2: GPG signing infra** — generate key, publish fingerprint in SECURITY.md, sign all `v*` tags, add `git tag -v` check to install.sh + install.ps1
- [x] **D-4: mass rename** — RESOLVED 2026-05-06 via `scripts/fix-d4-paths.mjs` (14 files, 55 lines)
- [x] **D-3: Windows ACL warning** — RESOLVED 2026-05-06 (Platform Notes added to SECURITY.md)
- [x] **CODE_OF_CONDUCT.md** — ADDED 2026-05-06 (Contributor Covenant 2.1, canonical text)
- [x] **CI gate** — ADDED 2026-05-06 (`.github/workflows/no-pii.yml` — sync to public snapshot + validate-no-pii.mjs + ship-ready denylist scan on every PR/push)
- [ ] **Eval baseline run** — execute eval-001-scaffold-nextjs-saas, log baseline scores so post-launch trend is visible
- [ ] **Final grep audit** — `davidrajnoha`, `C:\Users\david`, `Desktop/APPs`, third-party names (post-D-4 verification)

### Sprint 2 — Hermes Agent profile (2 weeks)

**Goal:** New `hermes-agent` profile + scaffold gives the user a deployed, learning Hermes Agent in `<10 min` after `install.sh`.

- [ ] **`profiles/hermes-agent.yaml`** — declare stack (Hermes runtime, vLLM/Ollama backend, MCP servers, Docker compose orchestration), detect rules, scaffolds, structure, agents, hooks, standards, `ai_sdk: claude-agent-sdk` (or `hermes-native`)
- [ ] **`templates/hermes-agent/`** — Docker compose for Hermes + chosen LLM backend (vLLM default for GPU users, Ollama fallback for CPU), systemd unit file, `.env.example`, MCP server registry skeleton, `Hermes.config.yaml`
- [ ] **5 cortex-x-specific Hermes skills (SKILL.md files)**:
  1. `cortex-onboard` — Hermes reads CLAUDE.md + standards/ + module.yaml on first run
  2. `cortex-sync` — Hermes records decisions/lessons via cortex-sync prompt
  3. `cortex-evolve-feeder` — Hermes contributes to evolve loop's journal/insights
  4. `safe-tool-wrapper` — wraps Hermes tool calls with cortex-x's standards/ai-patterns.md safe-tool pattern
  5. `compliance-auditor` — Hermes runs pre-defined GDPR/NIS2 checks on the project tree
- [ ] **Deployment guide** — `docs/hermes-deployment.md`: VPS setup, GPU vs CPU, MCP servers, observability (Sentry, structured logs), keep-alive (systemd + healthcheck), backup/restore of skills+memory
- [ ] **`prompts/new-project.md` Phase 5 extension** — after scaffold, ask user "deploy a Hermes agent for this project? [y/N]" → if yes, render templates/hermes-agent + emit deploy instructions
- [ ] **Update README.md + CLAUDE.md** to mention `hermes-agent` profile in the "agentic-heavy by intent" section

**Definition of done:** From clean VPS → `curl -sSL ./install.sh | bash` → `cortex new-project --profile hermes-agent` → working Hermes agent on `localhost:7777` knowing the project's CLAUDE.md, in under 10 minutes.

### Sprint 3 — Case study #1 (1 week)

**Pick one (priority order):**

1. **Self-hosted compliance auditor for SMB** — Hermes monitors a Next.js codebase for GDPR/NIS2 patterns, files weekly compliance report. Best alignment with pitch B.
2. **DevOps self-healing agent** — Hermes monitors infra, autonomously creates skills for recurring incidents. Best for visible metrics.
3. **Private knowledge agent** — Hermes + RAG over Confluence/Notion on-prem. Best for consulting-firm vertical.

**Recommended: #1.**

- [ ] Pick a real Next.js project from David's portfolio (or build a minimal demo: small SaaS landing+dashboard)
- [ ] Run `cortex new-project --profile hermes-agent --based-on <existing>`
- [ ] Deploy on isolated VPS (Hetzner/Contabo/etc.) — explicitly **closed network, no inbound public traffic**
- [ ] Let it run **7 days** collecting:
  - Skills auto-generated by Hermes
  - Tool-call counts
  - "Useful answer" rate (subjective scoring on 5-point scale, 3 prompts/day)
  - Response latency p50/p99
  - Memory growth (3-layer memory file size over time)
- [ ] Capture before/after screenshots, latency graphs, skill-list growth chart

**Definition of done:** Markdown case study (`docs/case-studies/01-sovereign-compliance-auditor.md`) with 7 days of metrics + 3-min screen recording walking through "fresh project → working private agent → first auto-generated skill."

### Sprint 4 — Public launch (1 week)

- [ ] **v0.1.0 tag** — signed, after D-1 + D-2 + D-4 done
- [ ] **GitHub repo flip to public**
- [ ] **Landing page live** at davidrajnoha.dev
- [ ] **Show HN post** — link to repo, case study, demo video
- [ ] **Reddit posts** — r/selfhosted, r/programming, r/CzechIT
- [ ] **Twitter/X thread** — pitch B as headline, A+C as 2nd-order points, link to case study
- [ ] **FB post** (the one you were asking about earlier — keep it short, point to davidrajnoha.dev)
- [ ] **3-min demo video** — fresh VPS → install → scaffold → Hermes online (real-time, no cuts)
- [ ] **Discord server** (optional) — for early adopters, feedback loop

**Definition of done:** Public URL live, 100+ first-day pageviews, ≥3 GitHub stars from non-network, no critical bugs reported in first 48h.

### Sprint 5 — Compound momentum (ongoing)

- [ ] Weekly: run `cortex-evolve` weekly cadence, review insights/proposals/, merge what passes hard gates
- [ ] Monthly: run eval suite, log scores to `evals/results/`
- [ ] Monthly: write 1 blog post — case study #2, framework lesson, or Hermes skill highlight
- [ ] Quarterly: cortex-thinker meta-review, retro per `module.yaml:audit.cadence_months: 3`
- [ ] Watch for: Hermes Agent v0.2+ (track Nous Research releases), regulatory updates (AI Act enforcement triggers)

---

## 5. Risks & mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Hermes Agent breaking changes mid-Sprint 2 | Medium | High | Pin to specific Hermes version in profile; document upgrade path |
| `git filter-repo` corrupts history during D-1 | Low | Critical | Always backup branch first (`main-pre-filter-backup`); test purge on a clone first |
| Pitch B doesn't resonate with target persona | Medium | High | Sprint 0 validates with 5 humans before lock-in; have A/C as backup framings |
| Solo maintainer burnout on 6-week plan | High | High | Sprints are 1-week scoped; Sprint 5 (post-launch) explicitly low-cadence; PolyForm NC keeps commercial pressure off |
| EU regulatory landscape shifts | Low | Medium | Pitch is phrased around principles (sovereignty, self-hosting), not specific regs — survives reg changes |
| OpenClaw fixes their CVEs and out-paces Hermes | Medium | Medium | Pitch isn't "Hermes vs OpenClaw" — it's "agentic-ready scaffold + private agent." Could swap runtimes if needed (Hermes is bring-your-own-LLM compatible). |

---

## 6. Open questions (to resolve early)

1. **Commercial model:** Pure open-source PolyForm NC, or dual-license (open-core + paid Pro)? Affects pitch wording.
   - **Default:** stay PolyForm NC for v0.1; revisit at v0.5 if there's traction.
2. **First case study target:** real portfolio project, or built-for-demo project? **Default: real portfolio project, anonymized as needed.**
3. **Hermes runtime version pin:** v0.10.0 (stable) or v2026.4.8 (latest)? **Default: v0.10.0 + tested upgrade path documented.**
4. **GPU requirement for Hermes profile:** mandate GPU for credible perf, or Ollama-CPU fallback as default? **Default: Ollama-CPU default + GPU as documented upgrade.**
5. **Discord vs GitHub Discussions for community:** **Default: GitHub Discussions in v0.1; Discord if traction crosses 100 active users.**

---

## 7. Pre-public-tag blockers — execution-ready commands

> ⚠️ **All operations in this section are destructive or require user action on user's machine. Do NOT run them from an automated session without explicit confirmation each time.**

### D-1: Git history purge

Source: [`MIGRATIONS.md` §D-1](../MIGRATIONS.md#d-1-git-history-purge-vojta-žižka-pii--private-project-data)

```bash
# Pre-flight
git -C /home/user/cortex-x status         # must be clean
git -C /home/user/cortex-x branch main-pre-filter-backup
git -C /home/user/cortex-x log --oneline | wc -l   # snapshot pre-purge commit count

# Purge (requires git-filter-repo installed: pip install git-filter-repo)
git -C /home/user/cortex-x filter-repo \
  --invert-paths \
  --path projects/relo.md \
  --path projects/amd-hackathon-2026.md \
  --path insights/2026-04-17-amd-retrofit-gaps.md \
  --path docs/framework-rfc.md \
  --path research/amd-hackathon-2026-2026-04-17.md \
  --path research/food-banner-builder-2026-04-17.md

# Verify hooks still pass
node /home/user/cortex-x/shared/hooks/_lib/redact.test.cjs

# Force-push (only after manual verification)
# git push --force-with-lease origin main
```

**Why deferred to manual:** force-push is one-way; need human eyes on the verify step.

### D-2: GPG signing

```bash
# Generate key (on user's machine, not sandbox)
gpg --full-generate-key  # ed25519, 2-year expiry, no passphrase if for CI

# Export fingerprint
gpg --list-secret-keys --keyid-format=long

# Add to SECURITY.md:
#   Maintainer GPG fingerprint: <FINGERPRINT>

# Sign tag
git tag -s v0.1.0 -m "v0.1.0 — public launch"

# Add to install.sh / install.ps1 (before checkout):
#   git tag -v "$LATEST_TAG" || { echo "ERROR: tag signature invalid"; exit 1; }
```

### D-4: Mass path rename

Per [`MIGRATIONS.md` §D-4](../MIGRATIONS.md#d-4-residual-cortex-x-refs-in-source-docsprompts-non-user-facing):

- `~/.claude/shared/<subdir>/` for installed read-only assets (standards, prompts, templates, agents, hooks, profiles)
- `$CORTEX_HOME` for live source dir (projects/, research/, insights/, journal/)

17 affected files (full list in MIGRATIONS.md). Single commit boundary.

---

## 8. What this plan's commit actually did

✅ Saved this plan to `docs/public-launch-plan.md`

**Correction (2026-05-06, post-merge):** an earlier draft of this section claimed three additional artifacts (`CODE_OF_CONDUCT.md`, D-3 ACL warning in `SECURITY.md`, and a hardcoded-path cleanup in `projects/cortex-x.md`) had landed in this commit. They had not — the source session hit an error before those follow-up edits committed, and only the plan itself made it to `main`. The three items are still TODO and now live in §4 Sprint 1 below.

**Sprint 1 work (planned, not yet done in main):**
- Add `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1)
- Add D-3 Windows ACL advisory to `SECURITY.md`
- Remove residual hardcoded `c:/Users/david/Desktop/APPs/cortex-x/` references from `projects/cortex-x.md` (lines 8, 21)

**Sprint 1 work requiring user execution (destructive):** D-1 history purge, D-2 GPG infrastructure.

**Sprint 1 work that is mechanical (can be auto-applied):** D-4 mass path rename across 17 source files.

---

## 9. Decision log for this planning session

- **2026-05-06** — Pitch primary = B (Sovereign AI Stack). Undertones: A (Day 0 Agent), C (Compound Productivity). David confirmed.
- **2026-05-06** — Hermes Agent chosen over OpenClaw on security grounds (OpenClaw CVE-2026-25253 disqualifying for compliance pitch).
- **2026-05-06** — D-1 (filter-repo) deferred to user-executed step due to destructive nature; documented commands inline.
- **2026-05-06** — D-4 (mass rename) deferred to dedicated commit boundary (not mixed with launch-plan commit).
- **2026-05-06** — License stays PolyForm NC for v0.1; dual-license discussion postponed to v0.5.
