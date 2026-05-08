# templates/observability/ — Sprint 2.0 LLM observability templates

> Self-hostable LLM observability stacks for Steward. Drop-in `docker compose` recipes; Steward emits OTLP HTTP/JSON spans via its zero-deps emitter at `bin/steward/_lib/otel-emitter.cjs`.

## Quick start (Phoenix — recommended for single-dev)

```bash
# From the cortex-x repo root:
docker compose -f templates/observability/docker-compose.phoenix.yml up -d

# Phoenix UI:    http://localhost:6006
# OTLP receiver: http://localhost:6006/v1/traces  (HTTP/JSON)

# Point Steward at the receiver:
export STEWARD_OTEL_ENDPOINT=http://localhost:6006/v1/traces

# Run a Steward action — spans flush at run end:
node bin/cortex-steward.cjs execute --plan-file=path/to/plan.json

# Open http://localhost:6006 → projects → cortex-x → traces
```

Tear down (data persists in the named volume):

```bash
docker compose -f templates/observability/docker-compose.phoenix.yml down
```

Wipe data + tear down:

```bash
docker compose -f templates/observability/docker-compose.phoenix.yml down -v
```

## What gets traced

Each Steward run emits a span tree shaped like:

```
AGENT (workflow=steward-nightly)
├── LLM   (provider=openrouter, model=deepseek-v4-flash, op=chat)   [recommendation kind only]
├── TOOL  (name=spec_verifier)
├── TOOL  (name=npm_test)
└── TOOL  (name=git_commit_and_pr)
```

Attribute set is dual-emitted on every span:

| Set | Examples |
|---|---|
| **OpenInference** | `openinference.span.kind`, `llm.provider`, `llm.model_name`, `llm.token_count.{prompt,completion,total}`, `llm.cost_usd`, `tool.name` |
| **OTel gen_ai semconv** | `gen_ai.system`, `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.usage.{input,output}_tokens` |

Phoenix renders the OpenInference set natively. Any future OTel-compatible backend (Jaeger, Tempo, Grafana, Langfuse upgrade) reads the gen_ai set. Cost ~10 extra bytes per span; portability is worth it.

## Why not Langfuse?

See [`docs/research/sprint-2.0-langfuse-observability-2026-05-08.md`](../../docs/research/sprint-2.0-langfuse-observability-2026-05-08.md) for the full R1 memo. Headlines:

- **Langfuse v3 is a 6-container stack** (postgres + clickhouse + redis + minio + 2× pods). Documented unbounded ClickHouse disk-growth bug — fresh installs filling 100 GB/day at zero activity unless TTLs pre-tuned.
- **Phoenix is 1 container, SQLite, native OpenInference + native OpenRouter**.
- **Tier-2 prompt-evolution features** (Prompt Playground, LLM-as-Judge evals, annotation queues) are paywalled in Langfuse self-host, open in Phoenix.
- **Helicone is RIP** (Mintlify acquisition 2026-03-03, self-host code untouched).

Langfuse remains a sane choice if you outgrow Phoenix or want enterprise SSO/RBAC; we'll add a `docker-compose.langfuse.yml` here when a Tier 3 sprint actually needs it.

## Fail-open posture

If Phoenix isn't running (or `STEWARD_OTEL_ENDPOINT` is unset):

- Steward completes the run identically.
- Journal stays the source of truth — every event a span would have captured is also in `~/.cortex/journal/<slug>/<date>.jsonl`.
- One stderr warning per run (not per span) when the endpoint is unreachable.

The journal is canonical. Phoenix is **additive** — a richer surface for the operator to inspect runs visually. Don't rely on Phoenix as the primary record.

## Operational notes

- **Localhost-only by default.** Both port mappings bind to `127.0.0.1`. Change to `0.0.0.0` only behind a reverse proxy + auth.
- **No auth in the local dev preset.** Set `PHOENIX_ENABLE_AUTH=true` + `PHOENIX_SECRET=<32+ random chars>` for shared deployments.
- **SQLite ceiling.** Sufficient for cortex-x's 1 trace/night cadence. Switch to postgres via `PHOENIX_SQL_DATABASE_URL=postgresql://...` if you outgrow it.
- **Restart-after-OS-update.** `restart: unless-stopped` policy keeps Phoenix alive across reboots; if you want it to NOT auto-start, change to `no`.

## What's coming (Sprint 4.5+)

- **BIOS-style health dashboard** (sibling repo `cortex-dashboard`) — wraps Phoenix's OTLP API + the journal; renders the swarm view post-Sprint-2.2.
- **Langfuse compose recipe** — when prompt evolution / LLM-as-Judge sprints actually need it; documented here as the upgrade path.
