# Positioning vs Ralph

> Ralph teaches you to **sit on the loop**. cortex-x teaches you to **sleep through it**.

## The Ralph pattern (2026)

Geoffrey Huntley's [Ralph Wiggum technique](https://ghuntley.com/ralph/) — popularised through `snarktank/ralph` (18.8k stars) and the official [`anthropics/claude-code/plugins/ralph-wiggum`](https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/README.md) plugin — proved that a 140-line bash loop calling `claude --dangerously-skip-permissions` repeatedly against a `prd.json` of `passes:false` stories can ship real software (a working programming language; YC hackathon repos overnight for $297).

The breakthrough is philosophical, not technical: **"engineer the setup, then sit ON the loop, not IN it."** The human's job is to design the prompt, the state files, and the feedback gates — and let the AI iterate until done.

Ralph is the **hobby-grade** demonstration that this category exists. It works because the human supervises the loop. It is explicitly built around `--dangerously-skip-permissions`.

## What cortex-x is, relative to Ralph

cortex-x and its Steward runtime are the **production-grade descendants** of the Ralph pattern, designed for scenarios where `--dangerously-skip-permissions` is a non-starter:

- Companies that want autonomous overnight maintenance on production codebases.
- Solo developers who want a loop they can leave running unsupervised across multiple projects.
- Teams who need atomic-commit safety, draft-PR discipline, budget caps, and audit trails.

Where Ralph delegates everything to the prompt and trusts the AI to verify itself, Steward layers hard gates around the same idea:

| Concern | Ralph | Steward (cortex-x) |
|---|---|---|
| Loop driver | 140 LOC bash | Node CJS pipeline (`bin/steward/execute.cjs` + `_lib/`) |
| Permissions | `--dangerously-skip-permissions` | 7 hardcoded refusals (see `standards/steward-policy.md`) + denylist + halt-check file |
| Verification | Delegated to prompt | `npm test` gate + per-kind acceptance criteria (`spec-verifier.cjs`, `action-kinds.cjs`) |
| Commit pipeline | AI writes commits directly | Atomic: branch → LLM apply → spec gate → npm test → commit → push → draft PR; rollback on any failure |
| State per action | `prd.json` + `progress.txt` | `cortex/recommendations.md` + `journal/<slug>/<date>.jsonl` + `lessons.jsonl` (ReasoningBank-lite) |
| Trigger model | Manual `./ralph.sh 10` | Manual + nightly cron (`.github/workflows/steward.yml`) |
| Cost guard | None | Daily USD cap + consecutive-failure circuit breaker |
| Multi-repo | Single repo | Sibling-manifest (`sibling-reader.cjs`) — fleet-aware |
| Distribution | bash + Claude Code marketplace plugin | curl one-liner + Claude Code marketplace plugin (`.claude-plugin/`) |
| Stars / proof | 18.8k stars, YC hackathons, 3-month Huntley loop | Closed beta; first dogfood iteration on cortex-x itself |

## Story sizing — shared discipline

Both Ralph and Steward demand the same input shape: **stories sized to fit one context window**. Cortex-x codifies this as a Rule 3 standard ([`standards/story-sizing.md`](../standards/story-sizing.md)) with concrete examples and a sizing checklist; the audit phase (`prompts/existing-project-audit.md` Phase 5) generates recommendations bounded to that shape.

If the input recommendation backlog is sized correctly, both Ralph and Steward succeed. If it's oversized ("Build the entire dashboard"), both fail — Ralph in fewer lines, Steward with a better paper trail.

## What cortex-x deliberately steals from Ralph

1. **Story-sizing language.** The Ralph README's "right-sized vs too-big" examples are the clearest articulation of single-context-window discipline in the ecosystem. Codified into `standards/story-sizing.md` (Rule 3).
2. **Append-only learnings.** Ralph's `progress.txt` (success-side) and `AGENTS.md` (per-directory codebase patterns) inspired cortex-x's split: failures go to `lessons.jsonl` (ReasoningBank-lite, used at decision time), successes go to `projects/<slug>.md` (institutional wisdom, read by future humans + agents).
3. **Plugin marketplace manifest.** Ralph showed that Claude Code's marketplace is a viable mass-distribution channel even for solo-author tools. cortex-x ships `.claude-plugin/plugin.json` for the same reason.
4. **The "sit on / sit in / sleep through" framing.** Useful narrative anchor for case studies and pitch decks. Differentiates cortex-x without pretending Ralph is a competitor.

## What cortex-x deliberately rejects from Ralph

- `--dangerously-skip-permissions`. The opposite of Steward's value proposition.
- Bash-only orchestrator. Steward's Node CJS pipeline is cross-platform robust (Windows + macOS + Linux verified by 5-lane CI matrix).
- AI as its own verifier. Steward's atomic rollback + per-kind acceptance criteria are non-negotiable safety; verification is a hard gate, not a prompt suggestion.
- Single-repo model. Steward's sibling-manifest gives fleet-aware autonomy across multiple projects from a single cron schedule.

## When to use which

- **Use Ralph** for personal experiments, hackathons, throwaway prototypes, single-spec generation runs, and any case where the human is sitting next to the loop watching the iterations land.
- **Use cortex-x + Steward** for production codebases where the loop must run unsupervised overnight, atomic-commit safety is required, multiple projects share the same agent, or the work needs an audit trail (commit trailers, journal entries, draft-PR discipline).

## Why this matters for cortex-x positioning

Ralph (and Huntley's writing around it) has done the market education for free. The category "autonomous AI loop on a real codebase" is no longer an unfamiliar concept that needs a 30-minute explanation in every sales call. The conversation has shifted to **"which loop, with which guardrails, for which risk profile."**

cortex-x's pitch is now one sentence: *"It's the production-grade descendant of the Ralph pattern, with the safety guarantees Ralph deliberately skips."*

## References

- Geoffrey Huntley — [Ralph Wiggum as a software engineer](https://ghuntley.com/ralph/)
- Geoffrey Huntley — [Everything is a Ralph loop](https://ghuntley.com/loop/)
- [`snarktank/ralph`](https://github.com/snarktank/ralph) — Ryan Carson's reusable packaging of the pattern (MIT, 18.8k stars).
- [`ghuntley/how-to-ralph-wiggum`](https://github.com/ghuntley/how-to-ralph-wiggum) — original methodology repo.
- [`anthropics/claude-code/plugins/ralph-wiggum`](https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/README.md) — Anthropic's official Ralph plugin.
- [HumanLayer — A Brief History of Ralph](https://www.humanlayer.dev/blog/brief-history-of-ralph)
- [LinearB — Mastering Ralph loops](https://linearb.io/blog/ralph-loop-agentic-engineering-geoffrey-huntley)
