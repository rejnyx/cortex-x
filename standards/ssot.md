# SSOT — Single Source of Truth

> Every piece of knowledge in the system has exactly one authoritative location.

## Why

Duplicated knowledge drifts. Labels in 3 files become 3 slightly different labels. Constants in 5 places become 5 different values after one hasty edit. Bug fixes get applied to 4 of 5 copies. Entropy wins.

SSOT eliminates drift by making duplication structurally impossible.

## Rules

1. **Define once, import everywhere.** Labels, enums, colors, API routes, types, magic numbers — all live in exactly one module.
2. **Prefer imports over re-declaration.** If you're copy-pasting a constant, stop and extract it.
3. **Config over code.** Environment-dependent values go in `.env` / config, not hardcoded.
4. **Database as the source for data.** Frontend computes from API response, doesn't hardcode shape.
5. **One migration = one source.** Don't duplicate schema knowledge in ORM models + raw SQL.

## Common SSOT locations

| Domain | SSOT location |
|--------|---------------|
| Czech labels for enums | `config/constants.ts` |
| Design tokens (colors, spacing) | `config/design-tokens.ts` |
| API routes | Generated from OpenAPI or TypeScript route manifest |
| Error messages | `lib/errors.ts` or `i18n/` |
| Feature flags | `config/features.ts` or GrowthBook |
| Environment variables | `.env.example` is schema, `.env.local` is values |

## Anti-patterns

- ❌ Same status enum defined in TypeScript type + Zod schema + DB CHECK constraint — without deriving one from another
- ❌ Hard-coded Czech labels in 3 components instead of shared constants
- ❌ Color hex values sprinkled through 20 files instead of design tokens
- ❌ Duplicate validation logic: server validates, frontend re-validates with different rules

## When to break SSOT

**Never.** If you're tempted, you're solving the wrong problem. Either:
- Extract to shared module (preferred)
- Generate one from another (codegen)
- Document why duplication is necessary (extremely rare)

## Verification

Grep for magic values. If you find the same string/number in 2+ places, it's a candidate for extraction.
