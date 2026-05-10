# Sprint 2.14 — Research-trigger implementation mechanics

**Date:** 2026-05-10
**Scope:** Implementation primitives for the "research-when-uncertain" rule (policy already designed in `sprint-research-self-invoking-and-research-default-2026-05-10.md`).
**Audience:** cortex-x maintainer + autonomous Steward sessions.

---

## 1. Executive summary

- **Cheap, deterministic detectors beat semantic uncertainty for the four trigger categories.** Production agentic IDEs (Cursor, Copilot) expose web/docs lookup as **explicit tools the model decides to call**, not auto-fired retrieval — the gating signal is the model's own tool-call, plus deterministic guard-rails on top. cortex-x can mirror this: detectors gate the *option*, the model picks the *moment*.
- **Trigger heuristics that ship today:** version-string regex over user prompts and `recentEdits`, `package.json` diff against a small `last-known-good.json` snapshot, and a path/keyword allow-list for `auth|crypto|jwt|cookie|cors|csrf` files. These are <50 LoC each.
- **Cache:** plain JSON files keyed by `sha256(category + canonicalQuery)`, two-segment TTL (per-category) + ETag for source URL revalidation. No LRU library needed for v0 — directory size cap with mtime-sort eviction.
- **Cost ceiling:** counter file `~/.claude/cache/research/_ledger.json`, graduated `log → warn → throttle → hard-stop` (Microsoft Agent Governance pattern). Soft-fail at 80%, hard-fail at 100%, **fail-closed** for unauthenticated research (only privileged paths fail-open).
- **Anti-pattern to avoid:** entropy-based uncertainty triggers (DRAGIN/ETC). They require token logprobs cortex-x doesn't have access to inside the Claude Code harness, and add cost without proportional benefit at our scale.

---

## 2. Q1 — Current-API-docs detector heuristics

**Production reference points.** Cursor's [Agent docs](https://cursor.com/docs/agent/overview) describe web lookup as a **tool the agent chooses to call** during multi-step tasks; the gating is via system-prompt instructions + tool availability, not a separate "should I research?" classifier. GitHub Copilot's [cloud-agent docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent) and the [awesome-copilot agents catalog](https://github.com/github/awesome-copilot/blob/main/docs/README.agents.md) similarly expose `microsoft_docs_search` / `microsoft_docs_fetch` MCP tools — the agent decides when, the platform supplies the option. **Recommendation: cortex-x stays aligned — research is a tool surface, the rule's job is to remind the model it exists when triggers fire.**

**Three deterministic signals (combine with OR):**

1. **Version-string regex over user prompt + last 10 edits.**
   ```js
   /\b(next\.?js|react|tailwind|astro|vite|node|drizzle|supabase|prisma|hono|elysia|effect|zod|wagmi|viem|ai\s?sdk)[\s@]?v?(\d{1,2})(?:\.\d+)?\b/gi
   ```
   Match → look up framework's last-known-stable in `~/.claude/cache/research/known-versions.json`. If captured major > known major OR > model knowledge cutoff (Jan 2026), fire `category: 'api'`. Pattern shamelessly inspired by [npm-dview](https://github.com/skratchdot/npm-dview) and [analyze-deps](https://github.com/moroshko/analyze-deps), which both compare local declared versions against a remote "latest" snapshot.

2. **`package.json` diff trigger.** On detected `package.json` write, parse `dependencies` + `devDependencies`, diff against the same `known-versions.json` snapshot. Any new package OR major-version bump in a tracked framework → fire. [`npm-dview`](https://github.com/skratchdot/npm-dview) and [`check-dependency-version-consistency`](https://github.com/bmish/check-dependency-version-consistency/blob/main/package.json) demonstrate this is a 30-line operation with the SemVer regex `/^[\^~]?(\d+)\.(\d+)\.(\d+)/`.

3. **Import-statement scan.** Regex `/from\s+['"]([^'"]+)['"]/g` over modified files. If imported module is in `known-versions.json` AND its hash differs from cached "API surface" snapshot (top-level export names from the cached docs page), fire revalidation. v0 can skip this and rely on signals 1+2.

**What to skip.** Token-level entropy detection (DRAGIN, ETC — see [Decide Then Retrieve, arXiv 2601.03908](https://arxiv.org/abs/2601.03908v1)) requires logprobs the Claude Code harness does not expose. Defer to v3.

---

## 3. Q2 — Security-advisory detector heuristics

**Path + keyword allow-list (10 LoC).** Fire `category: 'security'` when **any** modified path matches:

```
/(auth|session|login|password|crypto|jwt|bcrypt|argon2?|cookie|cors|csrf|oauth|saml|webauthn|passkey)(\.[tj]sx?|\/)/i
```
plus declared dependency add of any package in a small denylist (`crypto-js`, `jsonwebtoken<9`, `bcrypt<5`, etc.). The 2026 [OWASP AI Agent Security cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html) and [LLM Prompt Injection Prevention cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html) both recommend identifying security-sensitive files via path heuristics first, AST analysis second.

**Dependency-add → CVE check.** [OSV-Scanner](https://github.com/google/osv-scanner) (Google, free, 11+ ecosystems via [osv.dev](https://osv.dev/)) and [`npm audit --json`](https://github.com/orgs/community/discussions/153882) are both viable. Tradeoff:

| Tool | Zero-deps fit | Coverage | Cost |
|---|---|---|---|
| `npm audit --json` | ✅ shells out to existing npm CLI | npm only, GHSA-backed | $0 |
| OSV-Scanner | ❌ requires Go binary install | 11 ecosystems | $0 |
| Snyk Free | ❌ requires `snyk` CLI + auth | Full | Free tier limited |

**Recommendation:** v0 = `child_process.spawn('npm', ['audit', '--json'])` post `package.json` write, parse `vulnerabilities` field. No JSON Schema is officially documented (per the [GitHub community discussion](https://github.com/orgs/community/discussions/153882)) — wrap the parse in try/catch and degrade gracefully on shape changes. Defer OSV-Scanner to v2 when multi-ecosystem (Go/Python/Rust/Cargo) projects appear.

**AST anti-pattern.** Don't ship a tree-sitter or Babel-based AST scanner in v0 — research from [2107.07065 — Why Crypto-detectors Fail](https://arxiv.org/pdf/2107.07065) shows AST-based crypto-misuse detectors miss 30-60% of real misuses without semantic flow analysis. Path + keyword + npm audit gives 80% of the value at 5% of the LoC.

---

## 4. Q3 — Cache schema + TTL discipline

**Schema (zero-deps, file-per-entry):**

```
~/.claude/cache/research/
├── _ledger.json           # cost ledger (Q4)
├── known-versions.json    # framework -> last-known-stable
├── api/
│   └── <sha256(query)>.json
├── security/
│   └── <sha256(query)>.json
└── taxonomy/
    └── <sha256(query)>.json
```

Each entry:
```json
{
  "key": "next.js@16.0",
  "category": "api",
  "fetchedAt": "2026-05-10T14:23:00Z",
  "ttlSeconds": 1209600,
  "sourceUrls": ["https://nextjs.org/docs/..."],
  "etag": "W/\"abc123\"",
  "contentSha256": "...",
  "summary": "...",
  "costUsd": 0.0021
}
```

**TTLs (from prior memo, validated):** `security: 86400` (1d), `api_docs: 1209600` (14d), `taxonomy: 7776000` (90d). [Asteria, arXiv 2509.17360](https://arxiv.org/html/2509.17360v1) and [Lukas Niessen — Caching in 2026](https://lukasniessen.medium.com/caching-in-2026-fundamentals-invalidation-and-why-it-matters-867fee46e98b) both endorse per-category TTLs over a single global value; Bedrock prompt-caching [permits 5-min and 1-hour TTLs](https://caylent.com/blog/prompt-caching-saving-time-and-money-in-llm-applications) as canonical "rapidly changing" vs "stable" defaults.

**Invalidation:** time-based is sufficient for v0. **Add ETag/`If-None-Match` revalidation when expired** — per Niessen's 2026 piece, this gives a free 304 path that costs ~50 bytes vs full re-fetch. v0 simplification: skip ETag, always re-fetch on TTL expiry. Add ETag in Sprint 2.15 if cost-ledger shows >20% cache misses are stale-but-unchanged.

**Cache cap:** directory size budget `200 MB`. On overrun, sort entries by mtime, delete oldest 25%. No LRU library needed — `fs.readdirSync` + sort + unlink is 15 LoC. ([lru-cache](https://npm-compare.com/apicache,lru-cache,memory-cache,node-cache) is the Node standard but violates zero-deps.)

**MCP cache mechanics (Cursor/Bifrost):** [LiteLLM/Bifrost](https://www.getmaxim.ai/articles/top-enterprise-llm-gateways-to-optimize-token-costs-with-caching-and-smart-routing/) use Redis/Qdrant for semantic caching — not portable for cortex-x (zero-deps). The Cursor team has not published their MCP cache internals; Asteria is the closest published academic reference.

---

## 5. Q4 — Cost-ceiling enforcement

**Ledger schema** (`~/.claude/cache/research/_ledger.json`):
```json
{
  "day": "2026-05-10",
  "spentUsd": 0.42,
  "calls": 14,
  "circuit": "closed"
}
```

**Graduated response (Microsoft Agent Governance pattern, [Microsoft Tech Community 4510105](https://techcommunity.microsoft.com/blog/linuxandopensourceblog/agent-governance-toolkit-architecture-deep-dive-policy-engines-trust-and-sre-for/4510105)):**

| Spend % of $0.50 cap | Action |
|---|---|
| < 60% | log only |
| 60-80% | warn in stdout, prefer cache |
| 80-100% | **throttle** — only `category: 'security'` may fire (others get cache-only fallback) |
| ≥ 100% | **hard-stop** — write `STEWARD_HALT_RESEARCH` flag, all categories cache-only until next UTC day |

This mirrors Steward's existing daily/weekly/monthly cost safety in `bin/steward/_lib/cost-safety.cjs` (Sprint 1.9.1).

**Soft- vs hard-fail.** [Cordum's 2026 circuit-breaker pattern](https://cordum.io/blog/ai-agent-circuit-breaker-pattern), [Fountain City's cost circuit breaker](https://fountaincity.tech/resources/blog/ai-agent-cost-circuit-breaker/), and [Ravoid's $47k post-mortem](https://ravoid.com/blog/ai-agent-budget-enforcement) all converge on: **fail-closed on cost (hard-stop), fail-open only on auth/availability outages where blocking research would block a security-critical answer**. cortex-x recommendation: hard-stop on cost (research is never strictly required to ship), but still surface the question + cached snippets to the operator.

**Per-query estimation.** Before firing WebSearch/WebFetch, estimate `~0.005 USD/call` flat (WebSearch) and `~0.02 USD/call` (WebFetch with summarization). If `ledger.spent + estimate > cap × 1.0`, deny.

---

## 6. Q5 — Trigger function pseudocode

```js
// bin/steward/_lib/research-trigger.cjs
function shouldResearch({ userPrompt, recentEdits, recentImports, cache, ledger }) {
  const reasons = [];

  // --- Q1: api category ---
  const versionRe = /\b(next\.?js|react|tailwind|astro|vite|node|drizzle|supabase|prisma|hono|elysia|effect|zod|wagmi|viem|ai\s?sdk)[\s@]?v?(\d{1,2})(?:\.\d+)?\b/gi;
  for (const text of [userPrompt, ...recentEdits.map(e => e.diff)]) {
    let m; while ((m = versionRe.exec(text))) {
      const [, fw, major] = m;
      const known = cache.knownVersions[fw.toLowerCase()];
      if (!known || Number(major) > known.major) {
        reasons.push({ category: 'api', reason: `${fw}@${major} ahead of cache (${known?.major ?? 'none'})` });
      }
    }
  }

  // --- Q2: security category ---
  const sensitiveRe = /(auth|session|login|password|crypto|jwt|bcrypt|argon2?|cookie|cors|csrf|oauth|saml|webauthn|passkey)(\.[tj]sx?|\/)/i;
  for (const edit of recentEdits) {
    if (sensitiveRe.test(edit.path)) {
      reasons.push({ category: 'security', reason: `sensitive path: ${edit.path}` });
      break;
    }
  }

  // --- exit criteria: cache hit covers it ---
  const live = reasons.filter(r => {
    const key = sha256(`${r.category}:${canonicalize(r.reason)}`);
    const hit = cache.lookup(r.category, key);
    return !(hit && !hit.expired);
  });

  if (live.length === 0) return { should: false, category: null, reason: 'cache-hit or no trigger' };

  // --- cost gate ---
  const verdict = ledger.gate(live[0].category);  // 'allow' | 'throttle' | 'deny'
  if (verdict === 'deny') return { should: false, category: live[0].category, reason: 'cost-cap reached' };
  if (verdict === 'throttle' && live[0].category !== 'security') {
    return { should: false, category: live[0].category, reason: 'throttled — non-security cache-only' };
  }

  return { should: true, category: live[0].category, reason: live[0].reason };
}
```

**Anti-patterns to avoid:**
- **Don't fire on every user prompt.** The `userPrompt` regex pass is fine; running an LLM "is this uncertain?" classifier is the 3-10x token inflation the policy explicitly avoids.
- **Don't trust `userPrompt` content as instructions for research.** Wrap any retrieved content in `<untrusted>...</untrusted>` delimiters before re-injection per [OWASP LLM01:2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) — strict delimiter templates achieve 96.3% defense success per [Whetlan's 13-LLM test](https://dev.to/whetlan/i-tested-delimiter-based-prompt-injection-defense-across-13-llms-50mn).
- **Don't share the ledger across machines.** Each operator workstation has its own `_ledger.json`. Multi-machine aggregation is Sprint 4.x territory.
- **Don't fail-open on cost.** Auth/availability outages may justify fail-open elsewhere; cost cap never does — the alternative is the [$47k LangChain bill](https://ravoid.com/blog/ai-agent-budget-enforcement).

---

## 7. Sources

- [Cursor — Agent overview](https://cursor.com/docs/agent/overview)
- [GitHub Copilot — cloud agent docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent)
- [github/awesome-copilot — agents README](https://github.com/github/awesome-copilot/blob/main/docs/README.agents.md)
- [google/osv-scanner](https://github.com/google/osv-scanner) · [osv.dev](https://osv.dev/)
- [npm-dview — package.json version compare](https://github.com/skratchdot/npm-dview)
- [moroshko/analyze-deps](https://github.com/moroshko/analyze-deps)
- [npm audit --json — community discussion (no official schema)](https://github.com/orgs/community/discussions/153882)
- [Asteria — Semantic-Aware Caching for Agentic LLM Tool Access (arXiv 2509.17360)](https://arxiv.org/html/2509.17360v1)
- [Lukas Niessen — Caching in 2026: Fundamentals + Invalidation](https://lukasniessen.medium.com/caching-in-2026-fundamentals-invalidation-and-why-it-matters-867fee46e98b)
- [Caylent — Bedrock Prompt Caching (TTL 5min/1hr)](https://caylent.com/blog/prompt-caching-saving-time-and-money-in-llm-applications)
- [Microsoft Tech Community — Agent Governance Toolkit (graduated response)](https://techcommunity.microsoft.com/blog/linuxandopensourceblog/agent-governance-toolkit-architecture-deep-dive-policy-engines-trust-and-sre-for/4510105)
- [Cordum — AI Agent Circuit-Breaker Pattern (2026)](https://cordum.io/blog/ai-agent-circuit-breaker-pattern)
- [Fountain City — Cost Circuit Breaker for Production AI Agents](https://fountaincity.tech/resources/blog/ai-agent-cost-circuit-breaker/)
- [Ravoid — $47k LangChain budget post-mortem](https://ravoid.com/blog/ai-agent-budget-enforcement)
- [OWASP — LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- [OWASP — AI Agent Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html)
- [OWASP LLM01:2025 — Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- [Whetlan — 13-LLM delimiter defense test](https://dev.to/whetlan/i-tested-delimiter-based-prompt-injection-defense-across-13-llms-50mn)
- [Decide Then Retrieve — uncertainty-guided retrieval (arXiv 2601.03908)](https://arxiv.org/abs/2601.03908v1)
- [Why Crypto-detectors Fail (arXiv 2107.07065)](https://arxiv.org/pdf/2107.07065)
