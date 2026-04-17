# Contributing to cortex-x

cortex-x is currently in **closed beta**. The `main` branch is the rolling beta channel; tagged `vX.Y.Z` releases are the stable channel.

## Beta posture

- No public contribution process yet — the framework is maintained by a single author.
- Beta testers are invited directly. Access = agreement to the [LICENSE](./LICENSE) (PolyForm Noncommercial 1.0.0).
- Bug reports, feature ideas, and feedback welcome via GitHub Issues on the [cortex-x repo](https://github.com/Rejnyx/cortex-x). Prefix issues with `[beta]` so they're easy to triage.
- Security issues → see [SECURITY.md](./SECURITY.md) (do not open a public issue for those).

## Channels

| Channel | How to install | When to use |
|---|---|---|
| `beta` (rolling) | `CORTEX_CHANNEL=beta ./install.sh` | Beta testers accepting breaking changes |
| `stable` (tagged) | `CORTEX_CHANNEL=stable ./install.sh` (default) | Anyone who wants a reproducible snapshot |

See [standards/ship-ready.md](./standards/ship-ready.md) for the full distribution model.

## Expectations

- **No PRs expected** during closed beta. If you want to contribute code, open an issue first so we can discuss scope + license implications.
- **No warranty.** Per LICENSE Section `No Liability`. This is alpha/beta software; expect rough edges.
- **Your data stays local.** The framework collects zero telemetry in v0. See [standards/ship-ready.md](./standards/ship-ready.md#telemetry-stance-opinionated) for future stance.

## Beta tester checklist

Before your first install, please:

1. Read [LICENSE](./LICENSE) — PolyForm Noncommercial means no commercial use without a separate grant.
2. Read [SECURITY.md](./SECURITY.md) — disclosure process matters.
3. Run `./install.sh` (or `.ps1` on Windows). Hooks land in `~/.claude/shared/`.
4. Paste the snippet from the install output into `~/.claude/settings.json` to register hooks.
5. Report back: what worked, what broke, what was confusing.
