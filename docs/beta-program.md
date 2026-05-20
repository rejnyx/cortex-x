# cortex-x · closed beta program

> **What this is.** A 2-week verification program for the cortex-x install path across real-world developer machines. The 5-lane CI matrix proves `install.sh` exits 0 on a clean GitHub runner. It does not prove install works on your machine, which has OneDrive sync, CrowdStrike, an exotic shell, three node versions, and a non-default `~/.claude/`. That gap is what closed beta covers.

> **What it is not.** A waitlist. A marketing list. A "vote for features" forum. The cohort is small, the loop is short: install, run `cortex-doctor`, file one structured report, done.

## What we're measuring

Three things, in this order:

1. **Does install reach a green `cortex-doctor` on your real machine?** The "stranger-reproducible install" claim has to survive 10+ real PCs across OS × shell × Node × antivirus × cloud-sync combinations CI cannot reach.
2. **What's the median first-run friction?** Where does a fresh user pause, re-read, or give up? `cortex-init` should land within 3 minutes from `claude` prompt.
3. **What breaks weekly on the 15 nightly cron workflows?** Steward is the only autonomous surface. If it opens 0 PRs over 7 nights on your repo, that's a real signal.

We do not measure feature requests, UI polish, or roadmap input in this cycle. Those reopen after the install path is proven.

## What testers do (≤30 minutes total)

```bash
# 1) Install
curl -fsSL https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.sh | bash
# or on Windows PowerShell:
iwr https://raw.githubusercontent.com/Rejnyx/cortex-x/main/install.ps1 | iex

# 2) Verify
cortex-doctor --json > cortex-doctor.json
node ~/cortex-x/tests/smoke/verify-install.cjs --strict --json > verify-install.json

# 3) First-run smoke
cd ~/your-favorite-project   # any git repo with no .claude/ yet
claude
/cortex-init                 # pick "New / Existing / Framework" — whichever fits
```

That's it. Whether it works or breaks, file one issue. If it breaks: [Install failed template ↗](https://github.com/Rejnyx/cortex-x/issues/new?template=install-failed.yml). If it works: [Beta feedback template ↗](https://github.com/Rejnyx/cortex-x/issues/new?template=beta-feedback.yml).

Step 1 (install) and step 2 (verify) take ~5 minutes combined. Step 3's `/cortex-init` may run 5–15 minutes if it spawns a multi-agent audit — that is expected and still inside the 30-minute envelope.

## What testers get

- **GitHub credit** in the next release notes (`THANKS.md`), unless you opt out
- **Direct access to the operator** (email + LinkedIn) for follow-up — bug reports are not "submitted to the void"
- **Priority feedback channel** for the first 30 days post-launch
- **Optional**: early access to Codeceipt closed beta (the hosted Codeceipt SaaS built on top of cortex-x verifier — separate product, separate signup, but cortex-x beta testers get first invite)

No money, no equity, no NDA. Apache-2.0 open source — this is a peer-review cycle, not a customer pipeline.

## Cohort target — 10 testers across these axes

| Axis | Spread we want |
|---|---|
| OS | 3 Linux · 3 macOS · 3 Windows · 1 WSL2 |
| Shell | bash · zsh · fish · pwsh 7 · PowerShell 5.1 |
| Node install path | nvm · asdf · Volta · system package · NodeSource |
| Claude Code state | fresh install · existing install with `~/.claude/CLAUDE.md` · existing install with team `settings.json` |
| Project state | empty folder · pre-existing repo · monorepo · qa-engineer profile · ai-agent profile |
| Corporate friction | none · antivirus · cloud sync (OneDrive/Dropbox/iCloud) · proxy · locked-down corp Windows |

Each tester covers 3-5 axes. Combinations matter more than individuals.

## Recruit channels (in order of fit)

1. **Personal network** — peers already running Devin / Codex / Cursor alongside an issue tracker. Closest persona match for self-host cortex-x.
2. **Developer event attendees** — workshops and meetups; a room of active Claude Code / Cursor users is an ideal cohort.
3. **Build-in-public network** — anyone who has engaged with cortex-x posts in the last 30 days.
4. **Developer communities** — Claude Code Discord / Slack groups, regional dev forums.
5. **Reddit** — r/SideProject as the primary post, r/LocalLLaMA as a technical follow-up (lead with a build write-up, not the beta CTA).

## Cycle cadence

- **Day 0–3 · Recruit.** 30 reached → 15 replied → 12 installed → 10 finish with a `cortex-doctor` report.
- **Day 4–10 · Install + smoke + 7-night cron run.** Testers do their work.
- **Day 11–14 · Triage + patch.** Operator reviews every report, ships fixes for P0 + P1 install bugs.
- **Day 15 · Close.** `THANKS.md` published. Public-launch claims tightened or relaxed based on what 10 PCs proved.

## When this program ends

The closed beta ends when **`cortex-doctor` reports green on 10 of 10 real testers' first install attempt**, with no operator intervention. Until then, "stranger-reproducible install" stays as a goal, not a claim.

## Operator contact

GitHub: [@Rejnyx](https://github.com/Rejnyx) · Email + LinkedIn on [davidrajnoha.dev](https://davidrajnoha.dev)
