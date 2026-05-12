---
title: "Sprint 2.18 — Read-coverage proof: is agent-completion verification the right next gate?"
date: 2026-05-12
sprint: 2.18 (proposed)
status: research-complete
---

# Sprint 2.18 — Read-coverage proof research memo

## Problem framing

cortex-x Sprint 1.9 spec-driven verification (`bin/steward/_lib/spec-verifier.cjs`) gates the **edit side** of an agent action — every `acceptance_criterion[]` runs after `applyAction` and before `runNpmTest`, with five criterion kinds covering shell, file_predicate, regex, ears_text, llm_judge. What it does **not** check: whether the agent actually consumed the inputs it claims to have consumed. The failure mode that motivates this memo (agent claims to have documented 278 API methods, actually read 64 and confabulated 214) is structurally invisible to every current gate, because the edit-side artifact is internally consistent — it's just wrong about coverage of the input set.

## 1. State of the art for "agent completion verification" (2026)

**Plan verification has shifted toward Judge-LLM critique, not observation grounding.** The 2025/26 line of work (Plan Verification for LLM-Based Embodied Task Completion Agents, arXiv 2509.02761) explicitly **avoids environment grounding**: "The Judge LLM operates independently of any environment simulator or visual input" — so the framework reasons about plan coherence, not about whether the agent actually saw what it claims to have seen ([arxiv.org/html/2509.02761v2](https://arxiv.org/html/2509.02761v2)).

**The closest named category is "Execution Hallucination" in the agent-hallucination taxonomy** (arXiv 2509.18970): agents "claim to have completed certain sub-stages during the execution phase, but in reality, they have not actually been performed." The survey scopes this to **tool-invocation claims**, not observation/read claims — so "I read all 278 files" is not currently a recognized hallucination subtype with its own defense pattern ([arxiv.org/html/2509.18970v1](https://arxiv.org/html/2509.18970v1)).

**TheAgentCompany (arXiv 2412.14161) is the closest production benchmark** — it introduces *checkpoints* and a *partial completion score* (proportional credit + 50% bonus only when all checkpoints pass) to defend against this exact "claims done, isn't" failure mode. Crucially, checkpoints are **programmatic evaluators** baked into the task definition, not derived from agent self-report. Best model (Gemini 2.5 Pro) completes only 30.3% autonomously — meaning the gap between agent-claimed and agent-achieved is the dominant signal in the field ([arxiv.org/html/2412.14161v2](https://arxiv.org/html/2412.14161v2)).

No 2026 framework I found ships a first-class "prove your read set" primitive. The terminology hasn't crystallized — searches for "completion proof", "coverage attestation", "read-set verification", "work attestation" return no canonical hits in 2026 academic or production literature.

## 2. Anthropic Claude Code + Agent SDK specifically

**Hooks are the official mechanism for read-set capture.** Claude Agent SDK exposes `PreToolUse` and `PostToolUse` hooks that fire for every tool call including Read; the hook receives stdin JSON containing `tool_input.file_path`, so the host harness can build an authoritative read manifest independently of the agent's self-report ([code.claude.com/docs/en/agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview), [code.claude.com/docs/en/agent-sdk/hooks](https://code.claude.com/docs/en/agent-sdk/hooks)). This is precisely the primitive cortex-x needs — the agent **cannot lie about what it read**, because the harness logs every Read invocation at the SDK boundary.

**Compliance-side audit is weaker than hook-side capture.** Anthropic's Compliance API audit feed "does not record what tools Claude called or what those tools returned, nor is there any record of MCP server traffic" ([generalanalysis.com/guides/claude-compliance-api](https://generalanalysis.com/guides/claude-compliance-api)). OpenTelemetry via the Agent SDK is "the best current visibility tool" — it ships usage metrics, cost data, and tool activity through the SDK's OTel events schema ([mintmcp.com/blog/claude-cowork-security](https://www.mintmcp.com/blog/claude-cowork-security)). So the right architectural anchor for cortex-x is **PostToolUse hook → journal entry**, with OTel as a secondary export path that already aligns with Sprint 2.0 Phoenix.

## 3. Doc-generation / API-mapping subdomain

**CloudAPIBench (arXiv 2407.09726) is the most relevant 2026-adjacent benchmark for API hallucination.** It measures method-level hallucination occurrences and shows hallucination rate decreases as retriever precision increases; "low frequency APIs" still hallucinate even with high retriever precision, and "high frequency APIs require precision greater than 80%" to beat base model ([arxiv.org/abs/2407.09726](https://arxiv.org/abs/2407.09726)). This is direct evidence the doc-generation failure class is **quantified and persistent** — not a one-off Facebook anecdote.

**Mintlify ships change-detection but not completeness verification.** Their agent "monitors your codebase for user-facing changes and proposes documentation updates automatically," and they push OpenAPI-spec-driven generation so "what developers and AI agents read always matches the actual API behavior" — but no method-count-in-source vs method-count-in-docs lint ([mintlify.com/library/ai-hallucinations](https://www.mintlify.com/library/ai-hallucinations)). ⚠️ I did not find equivalent disclosure for Stoplight or Apidog, so I can't claim no competitor ships this — only that it's not the standard product feature in 2026.

## 4. Counting / hashing as a primitive

I found **no off-the-shelf framework** shipping the simple defense ("agent declares `files_read[]`, verifier hashes each and cross-checks against `process.cwd()` enumeration"). The Claude Code hooks tutorial corpus shows the building block — hook reads `$CLAUDE_TOOL_INPUT_FILE_PATH`, logs to audit — but nobody composes it into a coverage-attestation primitive ([datacamp.com/tutorial/claude-code-hooks](https://www.datacamp.com/tutorial/claude-code-hooks)). This is a genuine whitespace in the ecosystem.

## 5. Open-source patterns to steal

**GitNexus is the closest analog and worth studying directly.** It ships `gitnexus status` ("shows index status for current repo") and detects "stale indexes after edits," maps git diffs to affected processes, and runs "blast-radius checks before you merge" — and exposes a PostToolUse hook for Claude Code that detects a stale index after commits and prompts reindex ([github.com/abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus), [marktechpost.com](https://www.marktechpost.com/2026/04/24/meet-gitnexus-an-open-source-mcp-native-knowledge-graph-engine-that-gives-claude-code-and-cursor-full-codebase-structural-awareness/)). This is "coverage attestation for the knowledge graph" — directly transferable as a model for "coverage attestation for a Steward action's declared scope."

**Aider tracks the "files in chat" set explicitly** ([github.com/Aider-AI/aider](https://github.com/Aider-AI/aider)) but ⚠️ I found no evidence it gates completion claims against that set. Sweep — no read-completeness assertion found in the search corpus.

## 6. Real-world incident data

Production-agent failure analyses from 2026 do flag related but not identical failure modes:

- Arize's field analysis: agents "hallucinating parameters because field names appear valid, and fabricating information like refund policies" ([arize.com/blog/common-ai-agent-failures](https://arize.com/blog/common-ai-agent-failures/)).
- Level Up Coding postmortem rule: "never ask Copilot to review or optimise a fragment ... the entire function goes in — not just the lines you're curious about" — explicit recognition that **partial-input causes confabulation about the unseen rest** ([levelup.gitconnected.com](https://levelup.gitconnected.com/from-hallucination-to-production-bug-a-post-mortem-on-ai-generated-code-0987034037f8)).
- $4,200/63-hour runaway agent postmortem ([medium.com/@sattyamjain96](https://medium.com/@sattyamjain96/the-agent-that-burned-4-200-in-63-hours-a-production-ai-postmortem-d38fd9586a85)) — cost-side, not coverage-side.

⚠️ No postmortem I found names "read-coverage hallucination" as a discrete failure class with a defense pattern. The Facebook 64/278 incident is consistent with the broader pattern but cortex-x would be naming and gating a failure class the field hasn't yet labeled.

## Recommendation

**Ship Sprint 2.18 with narrow scope: `read_set_attestation` as a 6th acceptance-criterion kind in spec-verifier.cjs, not a standalone capability.**

Justification, three cited points:

1. **The primitive is cheap and the integration surface is already in Sprint 1.9.** Adding `kind: read_set` to the `acceptance_criteria[]` registry plus a PostToolUse-hook-fed read manifest (which the Claude Agent SDK supports out of the box per [code.claude.com/docs/en/agent-sdk/hooks](https://code.claude.com/docs/en/agent-sdk/hooks)) folds neatly into the existing 5-kind verifier — no new top-level subsystem.
2. **GitNexus has already proven the architecture works** at the indexed-codebase level ([github.com/abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus)); cortex-x would just generalize "stale index check" into "declared-scope check" for any Steward action with a scope manifest.
3. **The whitespace is real but narrow.** The field has named edit-side hallucination (Execution Hallucination, arXiv 2509.18970) and shipped checkpoint-based partial-completion scoring (TheAgentCompany, arXiv 2412.14161), but no framework gates *read-side coverage* against agent self-report. Shipping this as a named cortex-x primitive is a **R1 differentiator**, not a me-too — and ties cleanly to the Sprint 2.11 `senior_tester_review` capability that the roadmap already calls out as a differentiator.

**Do not** make this a standalone Tier-1 sprint or a new top-level capability_kind — the failure class is real but the defense is one criterion-kind + one hook handler, not a new architectural layer. Estimate: ~150 LoC in `_lib/spec-verifier.cjs` + ~80 LoC PostToolUse hook + 1 new error code (`SPEC_READ_SET_INCOMPLETE`) + ~12 tests. Half-day if Sprint 2.8 (Memory Foundation) hasn't shifted the journal schema; one day if it has.

Sources: see inline citations above.
