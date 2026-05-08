# Hermes Runtime Troubleshooting

This document is an operator-facing diagnostic guide for errors raised by the Hermes runtime during cortex-x project evolution. Each section covers a specific error code with symptom, diagnostic, and remediation steps.

## DIRTY_TREE

**Symptom** — The literal error string `working tree has uncommitted changes; commit or stash before running Hermes` fires from the dirty-tree halt check in `config/evolve.yaml` at the start of an evolve run.

**Diagnostic** — Run `git status --porcelain` to list all unstaged/untracked files. Check whether `.cortex-data/` or workflow-generated artifacts are present. Correlate these results with the `CORTEX_DATA_HOME` environment variable in the workflow configuration.

**Remediation** — Ensure `CORTEX_DATA_HOME` either points to a directory outside the repository or that its target directory is covered by `.gitignore`. Sprint 1.8.12 added `.cortex-data/` to the framework-level `.gitignore`, and the halt-check filter now recognizes that path. If workflow artifacts are legitimately uncommitted, commit or stash them before re-running.

## OPENROUTER_KEY_MALFORMED

**Symptom** — The error message includes the phrase "whitespace or control characters" and is raised from the key-validation step before any API fetch.

**Diagnostic** — The runtime now trims the `OPENROUTER_API_KEY` environment variable and rejects internal whitespace before the fetch. Inspect the stored secret for leading/trailing newlines or embedded space characters.

**Remediation** — Re-set the secret using either `gh secret set OPENROUTER_API_KEY --body "$KEY"` or `printf '%s' "$KEY" | gh secret set OPENROUTER_API_KEY`. Never use `echo "$KEY" | gh secret set`, because `echo` appends a trailing newline (`\n`) that the runtime trims silently, producing a malformed Authorization header in undici.

## OPENROUTER_AUTH_REJECTED

**Symptom** — The runtime receives an HTTP 401 or 403 status code from OpenRouter, reported under the distinct error code `OPENROUTER_AUTH_REJECTED` (separate from generic `HTTP_ERROR`).

**Diagnostic** — Run `curl -s -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/auth/key | jq .data`. The response should return `"is_provisioning_key": false`. Any other value or a 401/403 response confirms a bad key.

**Remediation** — Generate a new Inference Key in the OpenRouter dashboard. Provisioning keys cannot make `/chat/completions` calls and will always raise this error. After generating the new key, set it with `gh secret set OPENROUTER_API_KEY --body "$KEY"` or `printf '%s' "$KEY" | gh secret set OPENROUTER_API_KEY` to avoid whitespace injection.

## EDIT_DESTRUCTIVE_REWRITE

**Symptom** — The error message includes a phrase like "would shrink existing file" along with byte counts, raised from the content-integrity check in Sprint 1.8.13.

**Diagnostic** — The existing file is ≥ 200 bytes, and the LLM returned replacement content that is less than 50% of the existing file size. The runtime interprets this as a destructive rewrite and rejects the edit.

**Remediation** — Reword the recommendation with explicit "APPEND/INSERT only, preserve existing content" language. If a full rewrite is intentional, set `"replace_all": true` on the edit in the plan. Watch for fabricated content — the LLM may invent prior history when rewriting, leading to loss of real work.