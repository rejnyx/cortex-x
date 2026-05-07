# hermes-dryrun (fixture)

> Minimal target project for Hermes runtime dry-run tests.
> Not a real project — see [README.md](./README.md).

## Tech Stack

- Node.js (no framework)
- node:test built-in test runner
- Zero dependencies

## Architecture

```
src/index.js   single function exposing add(a, b)
tests/         node:test smoke test asserting add(2, 3) === 5
```

## Development commands

```bash
npm test       # node --test tests/
```

## Status

Phase: fixture. No production deployment. Used only by
`tests/contract/hermes-fixture-shape.test.cjs` and (when Hermes v0 ships)
the Hermes dry-run target.
