# Coding Behavior — Concrete Examples

> Ten before/after scenarios, written from cortex-x's actual tech stack (Next.js 16, Supabase, TypeScript strict, Vercel AI SDK, agentic tools). Each targets one of the four principles from [`coding-behavior.md`](./coding-behavior.md).
>
> Originals paraphrased/re-derived from Karpathy-style observations and cortex-x's own 2026-04-17 retrospective. Written from scratch in the cortex-x idiom — no text copied verbatim.

---

## 1. Hidden assumptions → ask first

**Task:** "Add user export."

### ❌ Without discipline

```ts
// src/app/api/users/export/route.ts
export async function GET() {
  const users = await supabase.from('users').select('*')
  return new Response(JSON.stringify(users.data))
}
```

Silently decided: all users, no pagination, full columns (including PII), JSON format, no auth check, no filtering.

### ✅ Surface first

> "Export ambiguities:
> 1. Scope: all users / filtered by status / current tenant only?
> 2. Format: JSON download / CSV / email attachment?
> 3. Fields: include email/phone (PII) or just aggregates?
> 4. Auth: admin-only or per-user self-export?
> Pick or tell me defaults and I proceed."

---

## 2. Multiple interpretations → name them

**Task:** "Make the AI chat faster."

### ❌ Guessing

Adds a 5-level Redis cache for model responses.

### ✅ Clarify the metric

> "'Faster' could mean:
> a) Time-to-first-token (streaming UX) — currently `await generateText` (no stream) in `src/app/api/chat/route.ts`
> b) Total response latency (throughput) — currently bottlenecked by tool call roundtrips
> c) Perceived speed (skeletons, optimistic UI) — client-side fix
> Each has a different fix. Which hurts most?"

---

## 3. Over-abstraction → straight-line code

**Task:** "Add a 10% discount for premium users."

### ❌ Over-abstracted

```ts
// src/lib/pricing/discount-strategy.ts
interface DiscountStrategy { apply(price: number, user: User): number }
class PercentDiscount implements DiscountStrategy { /* ... */ }
class TierDiscount implements DiscountStrategy { /* ... */ }
class ChainedDiscount implements DiscountStrategy { /* ... */ }
// + factory + registry + config
```

Five files, zero shipped product requirements.

### ✅ Straight-line

```ts
// src/lib/pricing.ts
export function finalPrice(base: number, user: User) {
  return user.tier === 'premium' ? base * 0.9 : base
}
```

When a second discount actually exists, refactor. Rule of Three.

---

## 4. Speculative features → ship what's asked

**Task:** "Add user preferences storage."

### ❌ Scope sprawl

Delivers: Supabase table, Zod schema, API route, React hook, context provider, invalidation cache, analytics event emission, audit log, TTL/expiry, multi-device sync, optimistic update queue.

### ✅ Minimum viable

Supabase table + 1 API route (`GET`/`PUT`) + 1 hook (`usePreferences`). No cache layer, no sync, no events. Add each when a feature needs them.

**Telltale in cortex-x:** [`prompts/cortex-evolve.md`](../prompts/cortex-evolve.md) budget rule — "max 3 insights/week" exists because earlier drafts generated 20+/week of speculative pattern observations. Speculation has a cost.

---

## 5. Drive-by refactoring → stay on-task

**Task:** "Fix bug: `createLead` crashes when `email` is empty string."

### ❌ Mass rename smuggled in

Diff touches: the crash fix + 3 unrelated functions reformatted + variable renames in pre-existing code + comment rewrites + new type annotations on untouched lines.

### ✅ One-line fix

```diff
 export async function createLead(data: LeadInput) {
-  const email = data.email.toLowerCase()
+  const email = (data.email ?? '').toLowerCase()
   // ...
 }
```

Everything else stays. The renames / formatting can be their own PR.

**Evidence in repo:** 2026-04-17 commit `b3397a1` violated this with a 72-location mass-rename piggybacked onto a "ship-ready" task. Review caught it; fix cost = separate commit.

---

## 6. Style drift → respect existing conventions

**Task:** "Add logging to the tool execution path."

### ❌ Incidental rewrite

While adding logging, the diff also switches the file from `function x() {}` style to `const x = () => {}`, from `'` to `"`, and adds JSDoc above every existing function.

### ✅ Match surroundings

Adds logging using the codebase's existing function declaration style, quote style, comment style. Nothing else changes.

**In cortex-x:** `.gitattributes` enforces LF/CRLF split. New files inherit surrounding convention. Lint catches the small stuff; principle catches the deliberate sneak-ins.

---

## 7. Vague goals → verifiable success

**Task:** "Fix the auth flow."

### ❌ Unverifiable

Edits auth code, commits `"fix: auth flow"`, closes the ticket.

### ✅ Test-first

> "Which auth flow? Three candidates in `src/app/(auth)/`:
> - `login/` — OAuth magic link callback
> - `signup/` — email verification loop
> - `proxy.ts` — cookie refresh on protected routes
>
> I'll write a failing test for whichever is broken. What's the observed symptom?"

Then:
```ts
// tests/auth/refresh-cookie.test.ts
it('refreshes session cookie on 401 from protected route', async () => {
  // ... reproduces the bug, fails red
})
```

Fix → test passes → commit references test name.

---

## 8. Monolithic implementation → incremental with verification

**Task:** "Add per-user rate limiting on `/api/chat`."

### ❌ One giant commit

Writes the Redis integration + middleware + config + cost budget logic + user-friendly error responses + admin dashboard all in one commit. First time any of it runs in integration is on Vercel preview.

### ✅ Vertical slices

1. **Slice 1:** rate limiter in isolation (library call + unit test). Commit, verify.
2. **Slice 2:** middleware wiring with a hardcoded limit. Commit, verify on preview.
3. **Slice 3:** config-driven limits. Commit, verify.
4. **Slice 4:** user-friendly error response. Commit, verify.

Each slice is a separately-revertable commit. Problems surface at the slice boundary, not after 400 lines.

---

## 9. Unfixed bug reproducer → write the failing test first

**Task:** "Sometimes the AI picks the wrong tool."

### ❌ Symptom-chasing

Tweaks the system prompt. Maybe it helps? Maybe it doesn't? No way to tell.

### ✅ Reproducer first

```ts
// tests/agent/tool-selection.test.ts
it('picks createLead not createDeal for "new contact from fair"', async () => {
  const res = await runAgent({ messages: [{ role: 'user', content: '...' }] })
  expect(res.toolCalls[0].toolName).toBe('createLead')
}) // fails red
```

Now either:
- The test stays red until the real fix (prompt edit / tool description tweak) makes it green.
- The test is wrong about what the AI should do — argue that before touching code.

Either way, the bug is now verifiable.

---

## 10. Premature optimization → defer until measured

**Task:** "The scaffold generation feels slow."

### ❌ Guess-and-ship

Adds template caching, parallelizes file writes, introduces a worker pool.

### ✅ Measure first

```bash
hyperfine --warmup 2 'node bin/cortex new test-project'
# → Mean: 3.2s. 80% is `npm install`. The framework itself: ~0.6s.
```

**Decision:** don't optimize the framework; document the `npm install` cost in onboarding docs. Cache-layer idea archived to `insights/parking-lot.md` for when/if the baseline changes.

---

## How to use this document

- **Writing code:** before starting, scan the four principle titles. If any applies to your task, reread that section.
- **Reviewing a PR:** match findings to principle number. Comment: "Surgical Changes §3 — the variable rename is out of scope for this bug fix, split into a separate PR."
- **Scaffolding new prompts/agents:** cite the principle the prompt enforces (e.g., `new-project.md` Phase 1 = Principle 1).

---

## See also

- [`coding-behavior.md`](./coding-behavior.md) — the principles themselves.
- [`ssot.md`](./ssot.md) — architectural companion to Principle 2 (Simplicity).
- [`testing.md`](./testing.md) — architectural companion to Principle 4 (Goal-Driven).
- [`prompts/code-review.md`](../prompts/code-review.md) — review pipeline that enforces.
