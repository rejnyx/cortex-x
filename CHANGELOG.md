# Changelog

All notable changes to cortex-x. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), [SemVer](https://semver.org/).

## [Unreleased]

### Added
- `standards/ship-ready.md` — governance invariants for beta/stable distribution
- `research/beta-distribution-2026-04-17.md` — research-grounded staging/prod decision matrix
- `CONTRIBUTING.md`, `SECURITY.md`, `MIGRATIONS.md`, `CHANGELOG.md` — ship-ready artifacts
- PolyForm Noncommercial 1.0.0 license (replaces `Proprietary` stub)

### Changed
- LICENSE from "Proprietary" to **PolyForm Noncommercial 1.0.0**. Backwards-incompatible license change; prior collaborators with any access receive the new terms on any subsequent pull.
- Personal data (private project entries, dated insights, journal, dated research caches) moved out of the shipped distribution via `.gitignore` patterns. Files remain on maintainer's local install.

### Fixed
- `prompts/new-project.md`, `prompts/cortex-doctor.md` — replaced hardcoded `~/Desktop/APPs/cortex-x/` with `{cortex_root}` placeholder / `~/cortex-x/` default.
- Personal email removed from public `README.md`.

## [0.0.0] — Pre-beta (pre-2026-04-17)

Internal development. Phases 1–5 foundations: hooks, standards, agents, profiles, self-improvement loop, auto-research primitive. Not distributed.
