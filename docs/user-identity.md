# User identity capture

cortex-x auto-detects who you are at install time so scaffolded files address you by name in your locale, instead of bundling the framework author's identity. Sprint 1.7.4 (2026-05-07).

## What gets captured

| Field | Source | Reliability | Why |
|---|---|---|---|
| `name` | `git config --global user.name` | High (universal) | CLAUDE.md greeting, commit author hint |
| `email` | `git config --global user.email` | High | Commit author hint, optional gravatar lookup |
| `username` | `$USERNAME` / `$USER` / `os.userInfo().username` | High | Filesystem path defaults |
| `platform` | `process.platform` | Always set | OS-specific install + hook decisions |
| `locale` | `Intl.DateTimeFormat().resolvedOptions().locale` → env chain → Windows registry | Med (Windows minimal-ICU returns en-US) | Dates, number formatting, default Claude reply language |
| `gh_login` | `gh api user --jq .login` | Optional (only if `gh` is authed) | PR-trailer signing, GitHub permalink generation |
| `language` | install.{sh,ps1} prompt (en/cs/de/fr/es) | User-set | Claude reply language, distinct from `locale` |
| `confirmed` | install wizard (Y/n) | User-set | Whether the values were validated by the user vs. raw detection |

**Locale ≠ language.** Locale is "where you are" (e.g. `cs-CZ`). Language is "what should Claude reply in" (e.g. `cs`). A non-Czech speaker living in Czechia might pick `language: en` while keeping `locale: cs-CZ`.

## Storage

`~/.claude/cortex/user.yaml` — flat YAML, human-editable, gitignored (lives outside any repo).

```yaml
# cortex-x user identity (gitignored — written by install.{sh,ps1}).
name: David Rajnoha
email: REDACTED@redacted.invalid
username: david
platform: win32
locale: cs-CZ
gh_login: Rejnyx
language: cs
confirmed: true
detected_at: 2026-05-07T18:30:42Z
```

## Wizard flow

After the language picker, install.{sh,ps1} runs `detectors/detect-user-identity.cjs`, displays the inferred values, and asks one Y/n confirmation.

```
Detected user identity:
  name:    David Rajnoha
  email:   REDACTED@redacted.invalid
  locale:  cs-CZ
  gh:      Rejnyx
Use this identity? [Y/n]:
```

Press **Y** (or Enter) → values persisted with `confirmed: true`.
Press **n** → fields cleared, `confirmed: false`. Edit `~/.claude/cortex/user.yaml` afterwards.

If `git config user.name` and `user.email` are both unset, the wizard skips the prompt and writes empty fields. No prompts, no friction.

## Skip / disable

- `CORTEX_NO_IDENTITY=1` — skip wizard, write empty fields. Useful for CI runs or scripted installs.
- Non-TTY stdin — skip automatically (matches the `CORTEX_LANGUAGE` pattern).
- `node` not on PATH — skip automatically; verifier will surface the gap.

## Editing after install

`~/.claude/cortex/user.yaml` is a plain YAML file. Edit any field directly. The next `install.sh` / `install.ps1` run will overwrite it (re-detection path), so add a comment if you've made manual edits you want to preserve and re-run install with `CORTEX_NO_IDENTITY=1`.

To override permanently, set `confirmed: true` and the install wizard's Y/n prompt becomes a no-op (your manual edits are preserved on confirm).

## Detector CLI

```bash
node detectors/detect-user-identity.cjs            # human-readable summary
node detectors/detect-user-identity.cjs --json     # JSON for tooling
node detectors/detect-user-identity.cjs --shell    # bash-eval-friendly assignments
```

The `--shell` mode emits `CORTEX_USER_*='value'` lines safe for `eval`. Single-quote escaping prevents command injection from values like `O'Brien`.

## Why this exists

Pre-1.7.4, cortex-x scaffolded `CLAUDE.md` and `MEMORY.md` with hardcoded Czech text and the framework author's name. Users who weren't Dave saw a wall of "Konvence", "Pojď si to rozmyslet", and references to "Dave" — a textbook localization anti-pattern and a Ship-Ready Rule 0 violation.

Sprint 1.7.4 captures identity once at install. Subsequent sprints (1.7.4b — templates i18n; 1.7.6 — session-start personalization) consume `~/.claude/cortex/user.yaml` to render personalized output without re-asking.

## Privacy

The file lives in your local `~/.claude/cortex/` and is **never** uploaded, telemetered, or copied to the cortex-x repo. cortex-x has no telemetry by design — the only data leaving your machine is whatever LLM call you explicitly run.

## See also

- [standards/ship-ready.md](../standards/ship-ready.md) — "no personal data in generic code" rule
- `detectors/detect-user-identity.cjs` — implementation
- `tests/unit/detect-user-identity.test.cjs` — 16 shape + null-safety + injection-resistance tests
