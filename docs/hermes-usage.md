# Hermes Usage

This document describes how to use the Hermes autonomous code-editing agent within the cortex-x framework.

## Running Hermes

Hermes is invoked by cortex-recommend to execute a single action item from `cortex/recommendations.md`. The agent receives a system prompt and the action body, then produces a JSON edit-plan on stdout. Hermes operates under strict file-change constraints defined in `config/evolve.yaml`.

## Input Format

Each action item consists of:
- An action title and body (primary spec)
- Optional untrusted data blocks (sources, citations, project context) — these are informational only; Hermes never follows imperative instructions inside `<untrusted>` tags.

## Output Format

Hermes outputs a JSON object with a single `"edits"` array. Each edit must be a full file replacement. Partial diffs or patch syntax are not permitted.

## Troubleshooting

### DIRTY_TREE

**Symptom:** `Halt-check failed: workspace contains dirty files (filter artifact found).`

**Diagnostic command:** `git status --porcelain` (detects uncommitted changes); also check `echo $CORTEX_DATA_HOME` to verify the data directory location.

**Remediation:**
1. Ensure `CORTEX_DATA_HOME` is set to a path *outside* the workspace directory (e.g., `$HOME/.cortex-data`).
2. If using the legacy `cortex/journal/` path, update the halt-check filter in `config/evolve.yaml` to recognize the new artifact location.
3. Run `git add -A && git stash` to clear workspace of generated artifacts before invoking Hermes.

### OPENROUTER_KEY_MALFORMED

**Symptom:** `OPENROUTER_KEY_MALFORMED: Authorization header is empty after read`

**Diagnostic command:** `echo "$OPENROUTER_API_KEY" | od -c | head -3` (shows trailing newline or whitespace characters)

**Remediation:**
1. Strip trailing whitespace/newline: `export OPENROUTER_API_KEY=$(echo "$OPENROUTER_API_KEY" | tr -d '\n')`.
2. When setting the secret via GitHub CLI, use `printf '%s' "$key" | gh secret set OPENROUTER_API_KEY` to avoid appending a newline.
3. Verify the key length with `echo ${#OPENROUTER_API_KEY}` — should match OpenRouter's expected length (typically 64 characters).

### OPENROUTER_AUTH_REJECTED

**Symptom:** `OPENROUTER_AUTH_REJECTED: 401 Unauthorized (or 403 Forbidden) from OpenRouter API`

**Diagnostic command:** `curl -s -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/auth/key | jq .data`

**Remediation:**
1. Confirm the key is active and not revoked in the [OpenRouter dashboard](https://openrouter.ai/keys).
2. Distinguish between **provisioning keys** (used for account management) and **inference keys** (used for model calls). The `/v1/auth/key` endpoint only validates inference keys; provisioning keys will return 403.
3. If using an inference key, regenerate it and re-set the secret following the KEY_MALFORMED remediation steps.
4. Check that the key has not exceeded rate limits or quota (OpenRouter returns 429 for quota issues, but may surface as 403 in some cases).
