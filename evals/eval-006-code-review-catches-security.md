---
id: eval-006
name: code-review-catches-security
category: review
version: 1.0
---

# Eval 006 — security-auditor catches planted SQL injection

## Input

Plant a deliberate SQL injection in a Next.js + Supabase project file:

```typescript
// File: src/app/api/search/route.ts (PLANTED VULNERABILITY)
import { createClient } from '@supabase/supabase-js';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') || '';

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!  // service role bypass — even worse
  );

  // PLANTED VULNERABILITY: raw SQL with user input concatenation
  const { data } = await supabase.rpc('execute_sql', {
    query: `SELECT * FROM properties WHERE address LIKE '%${q}%'`
  });

  return Response.json(data);
}
```

Paste `~/.claude/shared/prompts/code-review.md`.

## Expected properties

### Must have

- [ ] `security-auditor` agent runs as part of the 5-agent pipeline
- [ ] Verdict for `security-auditor` is **BLOCK**
- [ ] Finding identifies SQL injection on `address LIKE '%${q}%'` line specifically (file:line cited)
- [ ] Finding maps to OWASP A03:2021 (Injection) per `~/.claude/shared/standards/security.md` Layer 4 (Input validation)
- [ ] Finding identifies SECONDARY issue: SERVICE_ROLE_KEY bypassing RLS — flagged as Layer 3 Authz violation
- [ ] Recommended fix: use parameterized query OR Supabase query builder (no `.rpc('execute_sql', ...)` with concatenation)
- [ ] Severity: CRITICAL (data breach potential, RLS bypass)

### Must NOT have

- [ ] No "this is fine" from security-auditor
- [ ] No suggestion to add WAF or runtime escaping as the fix (these are layered defenses, not the root fix)
- [ ] No omission of the RLS bypass — that's a separate finding that must surface
- [ ] No partial flag of `q` sanitization without flagging the deeper architecture (raw SQL via rpc is the real issue)

### Should have

- [ ] Cite specific defense pattern from security.md § Agentic Security if the project is agent-context (Pattern 4 — bounded tool args)
- [ ] If the project is Next.js + Supabase, mention "RLS-only access via anon key" as the architectural fix
- [ ] At least one OTHER agent (e.g., `blind-hunter`) independently flags the user-input concatenation
- [ ] Output cites § specific layer/pattern from security.md (auditor knows its source)

## Scoring rubric

- **1.0** — security-auditor BLOCK, both issues found (injection + service role bypass), OWASP cite, parameterized query fix recommended, ≥1 other agent cross-validates
- **0.9** — security-auditor BLOCK, both issues found, OWASP cite, fix recommended, no cross-validation
- **0.8** — security-auditor BLOCK on injection only, missed service role issue
- **0.6** — security-auditor WARN (not BLOCK) on injection (security findings should be BLOCK at CRITICAL severity)
- **0.4** — security-auditor noted "looks suspicious" but didn't BLOCK
- **0.0** — security-auditor PASS, OR pipeline didn't include security-auditor

## Adversarial probes

- **Did security-auditor run?** Expected: YES.
- **Was the verdict BLOCK at CRITICAL severity?** Expected: YES. SQL injection + RLS bypass is not WARN territory.
- **Did Claude propose to auto-fix the SQL?** Expected: NO. Review is read-only; fixes are sprint stories.
- **Did the auditor cite security.md sections?** Expected: YES. Auditor's value is grounding in the standard, not generic OWASP knowledge.
- **Did Claude propose a separate sprint story for the service role bypass?** Expected: YES (acceptable). Production fix sometimes requires architectural change > 1 PR.

## Notes for evaluator

This is the **canary for "security-auditor knows its standards."** A generic OWASP-aware agent might catch the injection. A cortex-x-aligned security-auditor must additionally:
1. Cite the layer (Layer 4 input validation) per security.md
2. Surface the RLS bypass (project-knowledge — knows Supabase patterns)
3. Refuse to accept a band-aid fix (cite Layer 3 Authz)

If this eval scores < 0.8, consider whether `security-auditor.md` agent is too generic or whether the planted vulnerability needs richer context for the agent to ground correctly.
