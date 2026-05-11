---
title: Sprint 3.4 — External Tool Capability Adapters (Remotion + Hyperframes) — focused research
date: 2026-05-11
sprint: 3.4
status: in-progress
---

## 1. HeyGen Hyperframes — verified, the URL is real

`github.com/heygen-com/hyperframes` **exists and is the real HeyGen repo** (HTTP 200, 17.2k stars / 1.6k forks, Apache-2.0, TypeScript 96.8%, latest release v0.5.7 on 2026-05-10). The tagline literally is *"Write HTML. Render video. Built for agents."* — sources: [repo root](https://github.com/heygen-com/hyperframes), [README](https://github.com/heygen-com/hyperframes/blob/main/README.md).

Two HeyGen GitHub orgs exist. `HeyGen-Official` was archived 2026-04-10 by admin; **active open-source work moved to `heygen-com`** ([HeyGen-Official](https://github.com/HeyGen-Official), [heygen-com repos](https://github.com/orgs/heygen-com/repositories)).

**Agent invocation surface** is unusually well-suited to cortex-x — Hyperframes ships a **skill bundle** consumable via `npx skills add heygen-com/hyperframes` that registers slash commands `/hyperframes`, `/hyperframes-cli`, `/hyperframes-media`, `/hyperframes-registry`, `/website-to-hyperframes`, plus runtime skills `/tailwind`, `/gsap`, `/animejs`, `/three`, `/lottie` in Claude Code, Cursor, and Codex out of the box ([CLAUDE.md](https://github.com/heygen-com/hyperframes/blob/main/CLAUDE.md), [.codex-plugin](https://github.com/heygen-com/hyperframes/blob/main/.codex-plugin/plugin.json)). CLI is `init / preview / render / lint / inspect / doctor`. Node ≥ 22, FFmpeg required, Puppeteer-driven Chrome headless under the hood, deterministic ("same input = identical output"). **No per-render fees, no seat caps** — Apache-2.0 commercial-clean ([README](https://github.com/heygen-com/hyperframes/blob/main/README.md)).

Implication for cortex-x: Hyperframes is already speaking the agentskills.io dialect we adopted in Sprint 1.8. An adapter is *thinner than I expected* — we just need to wire it into our capability registry + action_kind dispatcher, not invent a translation layer.

## 2. Remotion 2026 — agent invocation surface

- **CLI:** `npx remotion render <entry-point|serve-url>? <composition-id> <output-location>`, props injected via `--props <json-or-filename>` (inline JSON broken on Windows, **must use a file** — relevant since cortex-x cron runs on Linux but operator dogfoods on Win11) ([CLI render docs](https://www.remotion.dev/docs/cli/render)).
- **Programmatic SSR API:** `getCompositions() → selectComposition() → renderMedia()` is the prod-grade path; `renderMedia()` merged `renderFrames+stitchFramesToVideo` in 3.0 ([SSR docs](https://www.remotion.dev/docs/ssr-node), [renderMedia](https://www.remotion.dev/docs/renderer/render-media)).
- **Headless / Docker:** native — defaults to Chrome Headless Shell, auto-downloaded via `npx remotion browser ensure`. Works in CI/Docker but needs ~14 Chrome shared libs (libnss3, libdbus-1-3, libatk1.0-0, libgbm-dev, libasound2, etc.) and FFmpeg. **Image footprint ~1.2 GB base, ~1.8 GB with full Noto fonts** ([Dockerizing Remotion](https://www.remotion.dev/docs/docker), [Scott Havird guide](https://scotthavird.com/blog/remotion-docker-template/)).
- **Cost model — this is the snag.** Remotion is **NOT** OSS-permissive. Free for individuals, non-profits, and **for-profits ≤ 3 employees**; above that, **Creators tier $25/seat/mo OR Automators tier $0.01/render with $100/mo minimum** ([license docs](https://www.remotion.dev/docs/license), [pricing](https://www.remotion.pro/license)). For an agent that fires renders programmatically, Automators is the relevant tier — **$100/mo floor is a real cortex-x cost-ceiling item (R4 budget)**.
- **Maintenance signal:** Remotion 4.x active, the org publishes regularly on remotion.dev/blog and remotion.pro (price-increase announcement timestamp is recent), package count for `@remotion/*` is north of 25.

**Adapter consequence:** Remotion forces cortex-x to confront a *licensed* external tool. Hyperframes does not. If we ship ONE adapter pattern, **Hyperframes is the cleaner first build target** — Apache-2.0, agent-native skill format already, zero per-render economics. Remotion becomes adapter #2 with a `license_required: true` capability flag + cost-meter integration.

## 3. State of the art 2026 — "agent frameworks driving external tools"

The pattern you described (clone repo + invoke CLI in-process) is **rapidly displacing MCP for cost reasons**. The headline data point: a comparative study of 75 identical tasks found **CLI-based agents 10-32× cheaper on tokens than MCP-based agents** while winning every efficiency metric ([Firecrawl 2026 CLI roundup](https://www.firecrawl.dev/blog/best-cli-tools), [Medium roundup](https://medium.com/@unicodeveloper/10-must-have-clis-for-your-ai-agents-in-2026-51ba0d0881df)). This validates the cortex-x direction *before we ship Sprint 3.4*.

**Named adapter-pattern example for citation:** `claude-agent-acp` (Zed Industries) and `claude-code-acp` both wrap the Claude Code CLI as a subprocess adapter, exposing it as an Agent Communication Protocol provider — that's textbook "external CLI → typed agent capability" ([claude-agent-sdk npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), [adapter migration issue](https://github.com/srothgan/claude-code-rust/issues/23)). The Microsoft Agent Framework v1.0 (released 2026-04-02) bakes "clone repo + prepare deps + invoke CLI" into its setup-script contract ([microsoft/agent-framework](https://github.com/microsoft/agent-framework)).

**Sandboxing options for agent-driven subprocess execution, ranked by maturity** ([Firecrawl sandbox guide](https://www.firecrawl.dev/blog/ai-agent-sandbox), [list of coding-agent sandboxes 2026-05 gist](https://gist.github.com/wincent/2752d8d97727577050c043e4ff9e386e)):
- **E2B** — what Letta uses by default (`E2B_API_KEY` + template ID); managed cloud micro-VMs, no self-host overhead ([Letta docker docs](https://docs.letta.com/quickstart/docker)).
- **Docker sandboxes** — official Docker AI sandboxes shipped 2026 ([docs.docker.com/ai/sandboxes/](https://docs.docker.com/ai/sandboxes/)).
- **agent-infra/sandbox** — all-in-one OSS (Browser+Shell+File+MCP+VSCode in one container) ([repo](https://github.com/agent-infra/sandbox)).
- **firejail / nsjail / minijail** — kernel namespace + seccomp; firejail mature for desktop Linux, nsjail used by Windmill in prod ([Firejail](https://firejail.wordpress.com/)).
- **Per-task hosted VM** — what Cursor / Devin / Cognition each ship internally.

**Recommendation for Sprint 3.4:** for cortex-x's cron-driven Steward, **Docker-per-action-kind** is the right first slice (matches our existing `bin/steward/execute.cjs` mutex model, no new auth surface), with E2B as the upgrade path when we cross multi-tenant boundary in Sprint 4.0 marketplace.

## 4. Composite "total SaaS builder" positioning — who else is shipping this pitch

Nobody is shipping the **full** composite (app + web + design variations + promo video from one prompt) under one brand in 2026, but four players occupy adjacent quadrants you'd be measured against:

- **Flatlogic** — *"AI Web Application Generator"*: full-stack frontend+backend+DB+auth+roles, deploys to dedicated VM sandbox, plain English in. Pitch is "SaaS/CRM/ERP in minutes" ([Flatlogic generator](https://flatlogic.com/generator)).
- **Fuzen** — *"AI SaaS Builder 2026"*, vibe-coding angle: describe app → "solid foundation in minutes, refine after" ([Fuzen post](https://www.fuzen.io/posts/ai-saas-website-builder)).
- **WeWeb** — *"Best SaaS Website Builder 2026"*, no-code platform-tier ([WeWeb 2026 picks](https://www.weweb.io/blog/best-saas-website-builder-tools)).
- **Agent Opus (Opus.pro)** — closest to the *video* half of your pitch: URL or doc in → AI-narrated promo video out, voice clone optional ([Opus SaaS workflow](https://www.opus.pro/agent/workflows/saas-product-video-maker)).

The pitch shape: **"text in → working SaaS out"** (Flatlogic/Fuzen) or **"URL in → promo video out"** (Opus, Hyperframes' `/website-to-hyperframes`). Nobody glues both halves under one operator-grade autonomous-agent shell. **That is the cortex-x white space.** Market context: AI video market $614.8M (2024) → $716.8M (2025), 75% of marketing video projected AI-generated/assisted by 2026, 95% cost reduction and 4× content output cited by adopters ([Leadde 2026 ranking](https://leadde.ai/blog/best-saas-product-demo-software)).

## Unverified / next steps

- **Hyperframes long-term maintenance bet** — 17.2k stars and v0.5.7 are great signals, but the repo is < 1 year old. Need to monitor 2026-Q3 commit cadence before betting Sprint 3.4 ship date on it.
- **Remotion Automators tier** — $100/mo minimum is documented but I did not verify whether it scales to actual per-render economics for our expected volume; need to model 1k / 10k / 100k renders against operator's cost ceiling.
- **E2B vs Docker-per-action cost** at cortex-x scale — needs a separate R1 memo before Sprint 4.0 marketplace.
- **agentskills.io spec stability** — Hyperframes assumes the spec; if it drifts before our Sprint 3.4 lands, the "free skill bundle" advantage evaporates. Worth a single-fetch check against the agentskills.io spec page closer to ship.
- **Hyperframes Windows-shell support** — Remotion's `--props` is known-broken on Windows; Hyperframes inherits Puppeteer + FFmpeg, and operator dogfoods on Win11. Need a smoke test on win32 before committing the adapter as a first-class action_kind.
