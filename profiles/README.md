# profiles/

YAML manifests describing project archetypes. `cortex-bootstrap` and `/cortex-init` pick one and scaffold the new project around its choices (which standards to enforce, which AI patterns are mandatory, which hooks ship, which SDK is default).

## Roster

| Profile | When to pick | AI SDK default | Notable rules |
|---|---|---|---|
| [`nextjs-saas.yaml`](./nextjs-saas.yaml) | Next.js 16 SaaS w/ Supabase + maybe AI | Vercel AI SDK | RLS-by-default, observability mandatory, agentic-ready scaffold |
| [`chatbot-platform.yaml`](./chatbot-platform.yaml) | Multi-tenant chatbot w/ N adapters | Vercel AI SDK | 7 MUST agentic-security patterns enforced |
| [`waas-template.yaml`](./waas-template.yaml) | Website-as-a-service (client websites at scale) | Vercel AI SDK (light) | Template + per-client overrides, Tailwind 4 + GSAP defaults |
| [`ai-agent.yaml`](./ai-agent.yaml) | Project where AI IS the product (agent-first) | Claude Agent SDK | All 7 MUST patterns + browser-automation rules + tirith-scan hook |
| [`browser-agent.yaml`](./browser-agent.yaml) | Browser-automation agent (extends ai-agent) | Claude Agent SDK | + 3 browser-specific MUSTs (CDP isolation, screenshot redaction, etc.) |
| [`cli-tool.yaml`](./cli-tool.yaml) | Node CLI tool, no UI | (none) | Minimal scaffold, no observability stack |
| [`tauri-desktop.yaml`](./tauri-desktop.yaml) | Tauri 2 desktop app | OpenAI Agents SDK (optional) | IPC-boundary validation, file-system permission model |
| [`kiosek.yaml`](./kiosek.yaml) | Restaurant/kiosk self-service PWA | (none) | Offline-first, touch-target accessibility, kiosk lockdown |
| [`qa-engineer.yaml`](./qa-engineer.yaml) | QA retrofit on existing repo (not a greenfield archetype) | (none) | Installs `/test-audit` skill + qa-retrofit prompt |
| [`astro-static.yaml`](./astro-static.yaml) | Static blog / portfolio / landing page | (none — opt-out of AI) | Drops AI patterns, no `/api/chat` reservation |
| [`minimal.yaml`](./minimal.yaml) | Anything else (fallback) | (none) | CLAUDE.md + Rule 1 standards only |

## Choosing a profile

A decision tree lives in [`standards/ai-sdks.md`](../standards/ai-sdks.md). Headlines:

- AI is the product? → `ai-agent` or `browser-agent`
- Multi-tenant chat surface? → `chatbot-platform`
- Next.js SaaS with maybe-AI? → `nextjs-saas` (agentic-ready by default, opt-out via flag)
- Just a website? → `astro-static` or `waas-template`
- Don't know yet? → `minimal` (you can switch later via retrofit)

## Adding a profile

1. Copy the closest existing `.yaml` as a starting point.
2. Set `ai_sdk:` explicitly (one of `vercel-ai-sdk` / `claude-agent-sdk` / `openai-agents-sdk` / `none`).
3. Set `standards:` to the subset of `standards/*.md` that apply.
4. Set `hooks:` to the subset that ship for this archetype.
5. Add a test fixture under [`tests/fixtures/detectors/`](../tests/fixtures/detectors/) so the profile detector regression-tests against your shape.
6. Run `npm run test:detectors` to validate.
