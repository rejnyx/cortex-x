# Git Workflow — Commit Like a Pro

> Git history is your project's memoir. A messy history makes debugging miserable. A clean history makes it possible to understand decisions years later.

## Branch strategy

### For solo dev (Dave's default)

```
main (protected, auto-deploys to prod)
 ↓
feature branches → PR → review → merge → deploy
```

- **`main`** always deployable
- **Feature branches** short-lived (hours to days, not weeks)
- **PR to self** for anything non-trivial (review your own code before merging)
- **Hotfix branches** for urgent prod fixes

### For teams

- **`main`** protected, requires PR
- **`develop`** integration branch (optional)
- **`feature/*`** for new work
- **`fix/*`** for bugs
- **`chore/*`** for maintenance

## Commit messages

### Structure

```
<type>: <short summary in imperative, lowercase, under 70 chars>

<body: what changed, why, context — wrap at 72 chars>

<footer: BREAKING CHANGE, issue refs, co-authors>
```

### Types

- **feat**: new feature
- **fix**: bug fix
- **refactor**: code change without behavior change
- **perf**: performance improvement
- **test**: adding/updating tests
- **docs**: documentation only
- **chore**: tooling, dependencies, CI
- **style**: formatting (rare in 2026 — Prettier handles this)

### Good commit messages

```
feat: add voice input to chat panel

Implements Whisper API transcription via /api/transcribe endpoint.
Reuses existing rate limiting. MIME type whitelist prevents abuse.

Fixes #142
```

```
fix: race condition between unmount flush and debounce timer

Cancel debounce timer before flushing on unmount. Previously,
rapid component remounts could fire duplicate sendMessage calls.
```

### Bad commit messages

- ❌ "fix stuff"
- ❌ "WIP"
- ❌ "updates"
- ❌ "asdf"
- ❌ Commit message identical to branch name
- ❌ Stack trace in commit message

## Rules

1. **Atomic commits.** One logical change per commit. "Fix bug + add feature + refactor" = split.
2. **Commit messages explain WHY.** What is visible in the diff. Why is not.
3. **Don't commit broken code.** Every commit should build and pass tests.
4. **Never commit secrets.** Pre-commit hooks scan for API keys, passwords.
5. **Never commit generated files.** `node_modules`, `dist`, `.next` → gitignore.
6. **Rebase feature branches on main** before merging (linear history preferred).
7. **Squash trivial commits** — "fix typo", "address review comment" → squash into parent.

## Safety

### Never run without understanding:

- `git push --force` / `-f` — overwrites remote, can destroy others' work
- `git reset --hard` — destroys uncommitted changes
- `git clean -fd` — deletes untracked files permanently
- `git branch -D` — force delete branch, loses unmerged work
- `git checkout .` — discards all uncommitted changes

### Safer alternatives:

- `git push --force-with-lease` — safer force push (aborts if remote changed)
- `git reset --mixed` — keeps changes in working directory
- `git stash` — save uncommitted changes for later
- `git branch -d` — safe delete (only merged branches)

### Pre-commit hooks (use husky or simple-git-hooks)

- **Lint** — block commit with lint errors
- **Format** — auto-format before commit (Prettier)
- **Secret scan** — detect API keys, tokens (gitleaks, detect-secrets)
- **Type check** — `tsc --noEmit` on staged files

### Pre-push hooks

- **Tests** — run relevant tests before push
- **Build** — ensure production build works

## PR / Review

### Good PR

- **One change** — new feature, one bug fix, one refactor
- **Clear title** — describes what, not how
- **Description explains why** — context, decisions, tradeoffs
- **Screenshots/videos** for UI changes
- **Test plan** — how reviewer can verify
- **Link to issue/story**
- **Under 400 lines** — bigger = harder to review = more bugs missed

### Review checklist

- Does it solve the stated problem?
- Are there tests for the new behavior?
- Are error cases handled?
- Is there a simpler solution?
- Does naming make sense?
- Are there security implications (auth, injection, XSS)?
- Does it respect existing patterns (SSOT, Modular)?

## Anti-patterns

- ❌ Commit messages like "." or "wip"
- ❌ Branches living for months without rebasing
- ❌ Force push to shared branches
- ❌ Committing to main directly for non-trivial changes
- ❌ PR with 50 files changed across 10 unrelated concerns
- ❌ `git push` without pulling first
- ❌ Committing lock file conflicts instead of resolving
- ❌ Fixing tests by changing the assertion instead of the code

## Advanced patterns

### Conventional Commits

Adopt **conventional-commits** spec for automated changelogs:
```
feat(auth): add Google OAuth
fix(api): handle empty response from Supabase
BREAKING CHANGE: /api/users response shape changed
```

Tools: `semantic-release`, `release-please` generate changelog and version bumps automatically.

### Bisect

When a bug appears but you don't know when:
```bash
git bisect start
git bisect bad                    # current commit is bad
git bisect good <known-good-sha>  # last known good
# git checks out midpoint, you test, answer good/bad, repeat
```

### Worktrees

Multiple branches checked out simultaneously:
```bash
git worktree add ../my-project-feature feature-branch
```

Great for reviewing PRs without stashing current work.

## Verification

- `git log --oneline` — can you understand project history at a glance?
- `git blame path/to/file` — can you find context for every line?
- `git log --all --graph --oneline` — is history clean or spaghetti?
