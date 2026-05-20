---
name: external-adapter-hyperframes
description: External tool capability adapter for Hyperframes (HTML → video, agent-native). Sprint 3.4 v0 ships the SKILL.md frontmatter contract + license-tier gate; Sprint 3.4 v1 wires the executor + Docker sandbox + first end-to-end render. Apache-2.0 OSS; no per-render fees; deterministic ("same input = identical output"). Operator invokes via "/external-adapter-hyperframes" or natural-language equivalent ("render the landing as a 30-second hero video"). Auto-discovered after install.{sh,ps1} sync.
external_dependency:
  adapter_slug: external-adapter-hyperframes
  repo: https://github.com/heygen-com/hyperframes
  install_cmd: npm install -g @heygen/hyperframes
  version: ^0.5.7
  license_tier: oss-permissive
disable-model-invocation: true
---

# /external-adapter-hyperframes — HTML → video render bridge (v0 scaffold)

**Sprint 3.4 v0 status**: this skill exists as a frontmatter-contract proof-of-concept. The actual Hyperframes invocation is wired in Sprint 3.4 v1 (Docker sandbox + git clone + install + render call). v0 demonstrates that the `external_dependency` block + license-tier gate works end-to-end for an OSS-permissive adapter.

## What Hyperframes does

[github.com/heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) — Apache-2.0, 17.2k★, v0.5.7 (2026-05-10). Tagline: *"Built for agents."*

Takes HTML + a render spec, produces deterministic video via Puppeteer + FFmpeg. Already ships an agentskills.io-aligned skill bundle that Claude Code / Cursor / Codex consume out of the box — cortex-x's adapter is **thinner than expected**.

## v0 invocation contract (this skill)

When operator types `/external-adapter-hyperframes` or natural-language equivalent:

1. **Probe adapter availability** via `bin/steward/_lib/external-adapter.cjs:probeAdapter()`.
2. If `EXTERNAL_TOOL_MISSING` → tell operator how to install (`npm install -g @heygen/hyperframes`), do not silently degrade.
3. If license gate passes (oss-permissive → always passes) → proceed.
4. **Sprint 3.4 v1+**: actually invoke `hyperframes render --html=<path> --output=<path>` inside Docker sandbox.

## v1+ deferred (not in this commit)

- Docker-per-action sandbox (matches existing `bin/steward/execute.cjs` mutex model).
- git clone + install command execution.
- Cost attribution rollup into journal (cost = $0 for Hyperframes, but the path needs to be wired for Remotion v1).
- 5-second test composition for CI smoke test.

## Why Hyperframes first

Sprint 3.4 R1 (`docs/research/sprint-3.4-external-adapters-research-2026-05-11.md`) selected Hyperframes as the v0 proof-of-concept because:

- Apache-2.0 → exercises `oss-permissive` license tier (no env gate)
- "Built for agents" tagline + agentskills.io spec → adapter is thinner than expected
- 17.2k★ + active 2026-05-10 release → R1 maintenance-signal check passes
- Node ≥22 + FFmpeg + Puppeteer-driven Chrome — same runtime cortex-x already requires

The second adapter (Remotion) lands in Sprint 3.4 v1 because Remotion forces design of the `per_invocation_metered` + `license_required` license-tier path ($0.01/render with $100/mo floor; see [remotion.dev/docs/license](https://www.remotion.dev/docs/license)).

## Related

- Sprint 3.4 R1 memo: `docs/research/sprint-3.4-external-adapters-research-2026-05-11.md`
- Adapter lib: [`bin/steward/_lib/external-adapter.cjs`](../../../bin/steward/_lib/external-adapter.cjs)
- Roadmap entry: `docs/steward-roadmap.md` § Sprint 3.4
