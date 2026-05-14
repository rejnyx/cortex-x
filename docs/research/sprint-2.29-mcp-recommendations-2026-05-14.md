# Sprint 2.29 research memo — Profile-level MCP recommendations

**Date:** 2026-05-14
**Author:** web-research dispatch (auto)
**Sprint:** 2.29 — `recommended_mcp_servers:` field across profile YAMLs
**Scope:** ai-agent, chatbot-platform, nextjs-saas, browser-agent, qa-engineer
**Policy:** cortex surfaces recommendations during `/cortex-init` Step 5 + `cortex-doctor` info-severity. Cortex does NOT auto-install — operator runs `claude mcp add` themselves.

---

## 1. Context7 (upstash/context7) — current status

**Latest version (as of 2026-05-14):**
- CLI: `ctx7@0.4.2` (May 11, 2026) — unchanged tag from operator's 2026-05-11 sighting [^c1]
- MCP server package: `@upstash/context7-mcp@2.2.5` (May 11, 2026) [^c1]

**Stars / maintainer activity:**
- 55.3k stars on `upstash/context7` [^c2]
- Active maintenance: 3 patch releases in the last 30 days (2.2.3 Apr 29, 2.2.4 May 4, 2.2.5 May 11). Maintainer = Upstash team (not solo).
- Open-source MIT license [^c2]. Repository disclaims accuracy: "community-contributed; we cannot guarantee accuracy, completeness, or security of all library documentation" [^c2].
- 8M+ npm downloads cumulative [^c5].

**Breaking changes in last 90 days:**
- **`researchMode` removed** entirely from `query-docs` MCP tool and `--research` flag removed from CLI (2.2.4, May 4) [^c1]. If a profile or skill referenced research mode, it is gone.
- **MCP server architecture change** (2.2.4): fresh `McpServer` instance per HTTP request to avoid concurrent `transport.close` clearing shared `Protocol._transport` (this fix is invisible to operators but eliminates a notification loss bug).
- **`CLAUDE_CONFIG_DIR` env now respected** during config removal (2.2.5).
- No protocol-level breaking changes — same tool names, same MCP surface.

**Recommended install command:**
The Context7 README **does not** publish a `claude mcp add` one-liner. It directs operators to either `npx ctx7 setup --claude` (interactive) or manual config pointing at the hosted endpoint `https://mcp.context7.com/mcp` with `CONTEXT7_API_KEY` header [^c2]. For cortex's profile recommendation we should document **two** install paths:

```bash
# Option A — interactive setup (writes config, may install ctx7 CLI)
npx ctx7 setup --claude

# Option B — direct HTTP transport (matches the rest of our recs)
claude mcp add --transport http context7 https://mcp.context7.com/mcp \
  --header "CONTEXT7_API_KEY: $CONTEXT7_API_KEY"
```

Option B follows the same `claude mcp add --transport http <name> <url>` syntax confirmed in the current Claude Code MCP docs [^c3], so it's the form we should ship in profile YAML comments.

**Known limitations / common issues operators hit:**
- **Free-tier squeeze (January 2026):** monthly request allowance cut from ~6,000 to 1,000 — 83–92% reduction [^c5]. Any profile recommending Context7 should warn operators that production-grade use needs a paid tier.
- **ContextCrush vulnerability (CVE-class, disclosed 2026-03-05, patched 2026-02-23):** poisoned community-contributed libraries could trigger credential theft, file exfiltration, and destructive local-file deletion through Context7 results [^c5]. Patched, but the architectural risk (community registry of documents ingested into agent context) is structural, not one-off. Stacklok's ToolHive guide recommends outbound-network filtering as ongoing mitigation [^c5].
- Rate-limit complaints documented in alternatives roundups (top 7 alternatives blog post Feb 2026) [^c5] — primarily about the cap, not correctness.
- No offline mode — full network dependency.

**Verdict for cortex profiles:** keep recommending Context7 (still best-in-class for live docs), but **add caution language** about (a) free-tier limits and (b) post-ContextCrush trust posture. Don't pin it as a "default-install" — it's a "recommended after consent" item.

---

## 2. Claude Code MCP install path 2026-05

**`claude mcp add` command stability:**
Syntax is stable and well-documented. From the official docs (May 2026 snapshot) [^c3]:

```bash
# HTTP transport (recommended for remote)
claude mcp add --transport http <name> <url>
claude mcp add --transport http <name> <url> --header "Authorization: Bearer ..."

# stdio (local process)
claude mcp add [options] <name> -- <command> [args...]

# SSE transport DEPRECATED — use http instead [^c3]
```

All option flags (`--transport`, `--env`, `--scope`, `--header`, `--callback-port`, `--client-id`, `--client-secret`) must come **before** the server name; `--` separates server name from spawn command [^c3]. This ordering is enforced and will reject older "name-first" examples.

A `claude mcp add-json <name> '<json>'` form is available for one-shot JSON config (handy for CI / scripts) [^c3].

**Where MCP config is stored:**

| Scope | Loads in | Shared | Stored in |
|---|---|---|---|
| Local (default) | Current project only | No | `~/.claude.json` |
| Project | Current project only | Yes (commit it) | `.mcp.json` in project root |
| User | All your projects | No | `~/.claude.json` |

[^c3] [^c6]

**Important corrections to prior cortex notes:**
- Config is at `~/.claude.json` (a single file), **NOT** `~/.claude/mcp.json` and **NOT** inside the `~/.claude/` directory [^c6]. Prior cortex research said `~/.claude/mcp.json` — this is wrong as of 2026-05; needs a fix in audit + doctor strings.
- Older terminology: `--scope project` was renamed (`local` was previously called `project`; `user` was previously called `global`) [^c3]. cortex-doctor messaging should use the new names.

**Per-project vs global scoping — yes, project-level override is supported:**
- Project scope writes to `.mcp.json` at repo root — designed for version-controlled, team-shared MCP setups [^c3].
- Precedence: Local > Project > User > Plugin-provided > claude.ai connectors [^c3]. Same-name duplicates resolve to highest-precedence source.
- Project-scoped servers from `.mcp.json` **require approval prompt on first use** — security control to prevent prompt-injection-via-checked-in-config attacks [^c3].

**Breaking changes in MCP protocol as of 2026-Q2:**
- **SSE transport deprecated** — operators should migrate to HTTP transport [^c3].
- **`streamable-http` is an alias for `http`** in JSON configs (added so configs copied from server docs work without modification) [^c3].
- **Tool Search defaults ON** (since Claude Code v2.1.x): MCP tool definitions are deferred and loaded on demand via the `ToolSearch` tool. Disable per-server with `alwaysLoad: true` in config. Controlled via `ENABLE_TOOL_SEARCH` env var [^c3]. **Material for cortex:** this lowers the context-window cost of recommending multiple MCPs — Sprint 2.29 should not be afraid to surface 3-4 recommended MCPs per profile because they don't all eat context at session start.
- **Auto-reconnect with exponential backoff** for HTTP/SSE servers (5 attempts, 1s → 16s) [^c3] — improves reliability for flaky cloud MCPs.
- **`/plugin install mcp-server-dev@claude-plugins-official`** scaffolds custom MCP servers — relevant if operators want to build internal MCPs (out of scope for Sprint 2.29 but worth a forward-ref in `standards/skills.md`).

**Recommended cortex-doctor health check:** after `claude mcp add`, doctor should suggest the operator run `claude mcp list` and `/mcp` (inside a session) to verify all configured servers are reachable [^c3]. The `/mcp` panel shows tool count and flags zero-tool servers explicitly.

---

## 3. Other production-grade MCPs worth recommending per profile

### nextjs-saas / ai-agent: Supabase MCP

**Status:** v0.8.1 (May 1, 2026), 2.7k stars, npm `@supabase/mcp-server-supabase`, MIT [^c7] [^c8].

**Pre-1.0 disclaimer is explicit:** "This server is pre-1.0, so expect some breaking changes between versions" [^c7]. Production warning from Supabase official docs is **emphatic and repeated**: "Supabase MCP is only designed for development and testing purposes" and "never connect the MCP server to production data" (stated twice) [^c8].

**Read-only flag is the primary safety lever:** `https://mcp.supabase.com/mcp?read_only=true` — executes all queries as a read-only Postgres user [^c8]. If a profile recommends Supabase MCP, the YAML comment MUST include the `read_only=true` form as the default. The non-read-only form should only be suggested via an explicit "_advanced" comment block.

**Install command (HTTP, hosted endpoint):**
```bash
claude mcp add --transport http supabase "https://mcp.supabase.com/mcp?read_only=true"
```

**Self-hosted alternative** (stdio via npm package) is documented but flagged as less stable than hosted endpoint [^c7]. GitHub issues report intermittent "Project Ref Not Found" errors and connection drops during OAuth token refresh on self-hosted setups [^c7].

**Verdict:** include in `nextjs-saas` + `ai-agent` profiles, **always with `?read_only=true`** in the example, with a CAUTION comment block warning against connecting to prod databases. Mark as info-severity in cortex-doctor (not error) — recommended but the operator can decline.

### browser-agent: Playwright MCP

**Status:** v0.0.75 (May 7, 2026), 32.5k stars, npm `@playwright/mcp` [^c9] [^c10].

**Pre-1.0 (0.0.x) with rapid iteration:** "v0.0.x status means breaking changes remain possible, as evidenced by v0.0.69–v0.0.70 releases in rapid succession" [^c10]. 20+ releases in the prior cycle. Active Microsoft maintenance.

**Playwright 1.59 "agent-native" release (April 1, 2026)** added `browser.bind()` letting MCP and CLI share browser sessions, `page.screencast` for annotated video receipts of agent runs, and an observability dashboard [^c10]. Significant maturity gain in last 60 days.

**Install command:**
```bash
claude mcp add playwright npx @playwright/mcp@latest
```

(Per repo docs and external verification [^c9].)

**Security caveat (must surface in profile YAML):** the repo explicitly states "Playwright MCP is NOT a security boundary" [^c9]. Additional notes: workspace file access restrictions by default, origin/host allowlist for network requests, Docker deployments require `--no-sandbox` (sandboxing is limited) [^c9]. This pairs naturally with the existing `browser-agent` profile's 3 browser MUSTs in `standards/security.md`.

**Verdict:** include in `browser-agent` profile as the default MCP recommendation. Cite the "not a security boundary" caveat verbatim in the YAML comment.

### qa-engineer: test-framework MCPs

**Worth listing but none are clearly dominant.** Candidates surfaced [^c11]:

1. **`@djankies/vitest-mcp`** — LLM-optimized Vitest runner with clean structured output, log capturing, line-by-line coverage. Active development; community project, not Microsoft/Vitest-team-official.
2. **`fyuuki0jp/testing-mcp-vitest`** — Test Code Generator from JSON specs (boundary-value analysis + equivalence partitioning). Niche.
3. **`josharsh/mcp-jest`** — MCP testing framework "like Jest, but for MCP" — for testing MCP servers themselves, not for running Jest in cortex projects. Useful if cortex starts building internal MCPs.

**Recommendation:** mark all three as `experimental` info-severity in qa-engineer. **Do not default any of them.** The qa-engineer profile already pulls in `senior_tester_review` capability which is more load-bearing than any test-MCP today. Revisit when a "vitest official" or "jest official" MCP ships.

### chatbot-platform: beyond Context7

**No clear winner beyond Context7 + (optionally) Supabase.** The RAG-MCP and chatbot-platform MCP ecosystem in 2026 is heavily fragmented [^c12] — `Bye-666/RAG-MCP-SERVER`, `jashu171/agentic-rag-with-mcp`, and ~10 others all compete but none has Anthropic Directory listing or 10k+ stars. **MCP downloads hit 97M/month in March 2026 (up from 2M at launch)** [^c12] but breadth ≠ quality: a scan of popular MCPs found security findings in **66%** of them [^c12]. 30+ CVEs filed against MCP servers in Jan-Feb 2026 alone.

**Recommendation:** for `chatbot-platform`, recommend **Context7 (docs) + Supabase (data, with read_only)**. Do not recommend a generic RAG MCP — the operator's chatbot-platform projects (Amici, Objedname, RELO) already have first-class RAG via Supabase + pgvector. Adding a generic RAG MCP would be a footgun.

### "Dangerous" MCPs cortex should explicitly NOT recommend

Based on the 2026-Q1 security incidents [^c4] [^c13] and ContextCrush case [^c5], cortex profiles should **avoid** recommending:

- Any MCP server with **stdio transport** that runs arbitrary configured commands without an explicit allowlist (the entire 2026-04-20 OX Security disclosure pattern [^c4]).
- Filesystem MCPs with **write access** to project root by default (e.g. unrestricted `@modelcontextprotocol/server-filesystem` — recommend only with explicit path restrictions if at all).
- Database MCPs **without read-only mode** in their example config (this is why the Supabase example MUST include `?read_only=true`).
- Community-aggregator MCPs without a published security policy or CVE-disclosure track record.

These should be flagged as **`avoid` or `not_recommended`** in profile YAML, not silently omitted — the operator should see why cortex didn't list X.

---

## 4. agentskills.io ecosystem 2026-Q2

**Adopter count:** Up to **32 adopters by March 2026** [^c14] (operator's prior 37+ number is plausible directionally but the most recent authoritative count is 32; AAIF — Agent AI Interop Foundation — grew to **146 member organizations by February 2026** [^c14] which is the broader number and probably the source of the "37+" figure).

Confirmed adopters: Google (Gemini CLI), JetBrains (Junie), Sourcegraph (Amp), Block (Goose), Snowflake, Databricks, ByteDance, Mistral AI, Spring AI, Microsoft (VS Code), OpenAI (ChatGPT + Codex CLI) [^c14]. AAIF provides neutral governance.

**Spec changes in last 60 days:** The agentskills.io spec page [^c15] documents the current schema:
- Required frontmatter: `name` (≤64 chars, lowercase + hyphens), `description` (≤1024 chars).
- Optional: `license`, `compatibility` (≤500 chars), `metadata` (string key-value map), `allowed-tools` (space-separated, **experimental**).
- The `allowed-tools` field is **new since the operator's last sync** — explicitly experimental, space-separated string of pre-approved tools. Example: `allowed-tools: Bash(git:*) Bash(jq:*) Read`. Worth adding to cortex's SKILL.md template as an optional field if not already present.
- Progressive disclosure structure unchanged: ~100 tokens metadata at startup, full SKILL.md (target <500 lines / <5000 tokens) on activation, deferred `scripts/` `references/` `assets/` on-demand [^c15].
- `skills-ref` CLI for validation: `skills-ref validate ./my-skill` — Sprint 2.22's planned `cortex-skill-validate` should wrap or compose with this.

**MCP vs Skill best-practice guidance:** No new Anthropic-published guidance found in the last 60 days. The implicit guidance from agentskills.io [^c15] and Claude Code docs [^c3] remains:
- **Skills** = portable Markdown + scripts, locally hosted, no network. Good for repeatable processes the operator owns.
- **MCPs** = external service connections (Sentry, GitHub, Supabase, Context7), credentialed, network-dependent.
- **Channels** (newer Claude Code feature [^c3]) = push-mode MCP where servers initiate messages. Out of scope for Sprint 2.29.

---

## 5. Risks / footguns to flag in cortex-init Step 5

**Major 2026-Q1/Q2 MCP supply-chain incident — flag explicitly:**

The OX Security / `thehackernews.com` 2026-04-20 disclosure [^c4] [^c13] documented a **systemic design flaw in MCP STDIO transport** allowing arbitrary OS command execution. Scope: 7,000+ publicly accessible servers, 150M+ cumulative downloads, 200+ open-source projects affected. Named impacted projects include LiteLLM, LangChain, LangFlow, Flowise, LettaAI, GPT Researcher, Agent Zero, Windsurf, DocsGPT, Bisheng, Jaaz, Upsonic [^c13]. Anthropic's response: "expected behavior," declined to modify protocol architecture. Some downstream vendors patched independently (LiteLLM, Bisheng, DocsGPT).

**Specific incidents to cite by name in cortex-init Step 5 (so operators understand the threat model is real, not theoretical):**
- **ContextCrush** (Context7, disclosed 2026-03-05, patched 2026-02-23) — community-contributed library poisoning [^c5].
- **CVE-2026-26118** — Microsoft MCP server AI-tool-hijacking vulnerability [^c4].
- **30+ CVEs against MCP servers** in January–February 2026 alone [^c12].
- **66% of popular MCPs had security findings** in a scan [^c12].

**Cortex-init Step 5 language (suggested):**

> Cortex recommends a small set of MCP servers per profile. **MCPs are external services with arbitrary tool capability — treat them like installing unsigned binaries.** As of 2026-Q2, multiple MCP supply-chain incidents have been disclosed (ContextCrush, CVE-2026-26118, 30+ CVEs in Jan-Feb 2026). Cortex never auto-installs MCPs. Before running `claude mcp add`:
>
> 1. Verify the MCP comes from the upstream maintainer (e.g., `@upstash/...`, `@supabase/...`, `@playwright/...`) — not a typosquat.
> 2. Check the read-only / scope flags. For databases, default to `read_only=true`.
> 3. Run `claude mcp list` after adding to verify the registered endpoint matches expectation.
> 4. Use **project scope** (`--scope project`) for team-shared MCPs (writes to `.mcp.json`, version-controlled, approved on first use).
> 5. Use **user scope** (`--scope user`) only for personal-utility MCPs you trust across all projects.

**Recommended `cortex-doctor` info-severity check:**
```
[info] MCP servers registered: 3 (context7, supabase, playwright)
       Run `claude mcp list` to verify endpoints. See standards/security.md § MCP supply chain.
```
(Not an error — just visibility.)

**Deprecation warnings to flag:**
- SSE transport (`--transport sse`) is deprecated [^c3]. Any cortex profile or doc referencing SSE should be updated to HTTP.
- Old scope names (`project` for local, `global` for user) — update cortex-doctor strings [^c3].
- Older cortex docs referencing `~/.claude/mcp.json` are wrong — correct path is `~/.claude.json` (single file at home) [^c6].

---

## Concrete profile YAML recommendations

### `profiles/ai-agent.yaml`
```yaml
recommended_mcp_servers:
  - name: context7
    purpose: Up-to-date library documentation injected on demand
    install: |
      claude mcp add --transport http context7 https://mcp.context7.com/mcp \
        --header "CONTEXT7_API_KEY: $CONTEXT7_API_KEY"
    severity: recommended
    caveats:
      - Free tier cut to ~1,000 req/month in Jan 2026; production needs paid tier
      - ContextCrush vuln patched 2026-02-23; community-registry architecture remains structural attack surface
      - Apply outbound network filtering per Stacklok ToolHive guide
  - name: supabase
    purpose: Database introspection + query (read-only by default)
    install: |
      claude mcp add --transport http supabase "https://mcp.supabase.com/mcp?read_only=true"
    severity: recommended
    caveats:
      - Pre-1.0 (v0.8.1), expect breaking changes
      - NEVER connect to production data; use dev/staging projects only
      - read_only=true is mandatory in the example; advanced users may remove at their own risk
```

### `profiles/chatbot-platform.yaml`
Same as `ai-agent` (context7 + supabase). Explicitly do NOT recommend a generic RAG MCP — operator's chatbot projects use Supabase pgvector natively.

### `profiles/nextjs-saas.yaml`
Same as `ai-agent` + add `playwright` as optional (info-severity) for projects with E2E tests.

### `profiles/browser-agent.yaml`
```yaml
recommended_mcp_servers:
  - name: playwright
    purpose: Browser automation via Playwright accessibility tree
    install: |
      claude mcp add playwright npx @playwright/mcp@latest
    severity: recommended
    caveats:
      - "Playwright MCP is NOT a security boundary" (verbatim from upstream README)
      - v0.0.75 (pre-1.0), expect breaking changes
      - File access restricted to workspace roots by default; verify origin/host allowlist for network requests
      - Docker deployments require --no-sandbox flag
```
(Plus context7 and supabase, same as ai-agent.)

### `profiles/qa-engineer.yaml`
```yaml
recommended_mcp_servers:
  - name: context7
    purpose: Library docs (testing framework reference)
    install: |
      claude mcp add --transport http context7 https://mcp.context7.com/mcp
    severity: recommended
  # Test-framework MCPs intentionally NOT recommended — ecosystem too fragmented as of 2026-05
  # Revisit if @vitest/mcp or @jest/mcp ships from upstream
not_recommended_mcp_servers:
  - name: any-test-framework-mcp
    reason: As of 2026-05-14, no upstream-blessed test-framework MCP exists. Community options (djankies/vitest-mcp, mcp-jest, testing-mcp-vitest) are experimental and not Vitest/Jest team-maintained. cortex's senior_tester_review capability is load-bearing instead.
```

---

## Open questions / [UNVERIFIED] flags

- **Operator's "37+ adopters" claim:** could not pin exact number. agentskills.io page itself doesn't display a counter; the closest figures are "32 adopters by March 2026" [^c14] and "AAIF 146 member orgs" [^c14]. `[UNVERIFIED]` — recommend using the conservative "32+ adopters" phrasing in cortex-init Step 5, or refer to "146 AAIF member orgs" if the bigger number is preferred.
- **Supabase MCP exact stdio install command via `claude mcp add`:** the official docs don't publish a stdio one-liner — only the hosted HTTP form. The npm package `@supabase/mcp-server-supabase` exists [^c7] but the canonical install pattern is HTTP. Sprint 2.29 should ship the HTTP form and leave stdio as an advanced/self-hosted note.
- **Context7 free-tier rate limit numeric:** "cut from ~6,000 to 1,000 req/month in January 2026" [^c5] — single independent source. `[UNVERIFIED]` on the exact "6,000" figure but the 83-92% reduction is multiply-sourced.

---

## Citation footnotes

[^c1]: GitHub releases · upstash/context7. https://github.com/upstash/context7/releases — accessed 2026-05-14
[^c2]: GitHub · upstash/context7 README. https://github.com/upstash/context7 — accessed 2026-05-14
[^c3]: Claude Code docs · Connect Claude Code to tools via MCP. https://code.claude.com/docs/en/mcp — accessed 2026-05-14
[^c4]: Anthropic MCP Design Vulnerability Enables RCE, Threatening AI Supply Chain. The Hacker News, 2026-04-20. https://thehackernews.com/2026/04/anthropic-mcp-design-vulnerability.html
[^c5]: ContextCrush: The Context7 MCP Server Vulnerability Hiding in Plain Sight. Noma Security. https://noma.security/blog/contextcrush-context7-the-mcp-server-vulnerability/ — accessed 2026-05-14
[^c6]: Claude Code Configuration Files: Complete Guide. Inventive HQ. https://inventivehq.com/knowledge-base/claude/where-configuration-files-are-stored — accessed 2026-05-14
[^c7]: GitHub · supabase-community/supabase-mcp. https://github.com/supabase-community/supabase-mcp — accessed 2026-05-14
[^c8]: Supabase Docs · MCP Server. https://supabase.com/docs/guides/getting-started/mcp — accessed 2026-05-14
[^c9]: GitHub · microsoft/playwright-mcp. https://github.com/microsoft/playwright-mcp — accessed 2026-05-14
[^c10]: Playwright MCP Server: How to Set Up, Configure & Use It (2026). TestCollab. https://testcollab.com/blog/playwright-mcp — accessed 2026-05-14
[^c11]: GitHub · djankies/vitest-mcp + josharsh/mcp-jest + fyuuki0jp/testing-mcp-vitest — accessed 2026-05-14 via WebSearch result roundup
[^c12]: Best MCP Servers in 2026: 25 You Should Install Now. Toolradar. https://toolradar.com/blog/best-mcp-servers-2026 — accessed 2026-05-14; 6 Critical Challenges Facing the MCP in 2026. Medium / Matt Mochalkin. https://medium.com/@MattLeads/6-critical-challenges-facing-the-mcp-in-2026-06258e914402
[^c13]: 'By Design' Flaw in MCP Could Enable Widespread AI Supply Chain Attacks. SecurityWeek. https://www.securityweek.com/by-design-flaw-in-mcp-could-enable-widespread-ai-supply-chain-attacks/ — accessed 2026-05-14; CVE-2026-26118 MS MCP Vulnerability. PointGuard AI. https://www.pointguardai.com/ai-security-incidents/microsoft-mcp-server-vulnerability-opens-door-to-ai-tool-hijacking-cve-2026-26118
[^c14]: Agent Skills Open Standard Explained — Interoperability Guide 2026. Paperclipped. https://www.paperclipped.de/en/blog/agent-skills-open-standard-interoperability/ — accessed 2026-05-14
[^c15]: agentskills.io · Specification. https://agentskills.io/specification — accessed 2026-05-14
