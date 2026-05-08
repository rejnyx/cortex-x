# Sprint 2.0 — Langfuse self-hosted observability (R1 research memo, 2026-05-08)

> Scope: pick a self-hostable LLM-observability backend for the Steward runtime
> (formerly Hermes; renamed in Sprint 4.7 to avoid the NousResearch/hermes-agent
> name collision). Today the only signal is `~/.cortex/journal/<slug>/<date>.jsonl`
> + `cortex-steward status`. Sprint 2.0 wants real spans, prompt
> management, and cost ledgers, without violating the framework's "zero runtime
> deps in cortex-x itself" principle and without dialing home to a SaaS.

## TL;DR

Use **Arize Phoenix** in single-container mode (SQLite + persistent volume) as
the default Sprint 2.0 backend, and keep **Langfuse v3** documented as the
opt-in "I want prompt management + multi-window cost ledgers" upgrade. Phoenix
is a literal one-container drop with native OpenInference + OpenTelemetry
gen_ai semconv support and zero feature gating, which matches a single-dev
home-NAS box. Langfuse is the better dashboard but requires a six-container
stack (postgres + clickhouse + redis + minio + web + worker) with documented
unbounded ClickHouse log growth that must be tamed with TTL on system tables —
operationally heavier than the workload (~1 trace/night) justifies until
Tier 3 / Tier 4.

## 1. Langfuse self-hosted — verdict

### What v3 actually ships in 2026-05

Langfuse v3 is the only officially supported self-host path as of this memo;
v2 (single-Postgres) is migration-only. The current `docker-compose.yml` on
`main` defines **six services** ([source][lf-compose]):

| service | image | port | volumes |
|---|---|---|---|
| `langfuse-web` | `langfuse/langfuse:3` | `3000:3000` | — |
| `langfuse-worker` | `langfuse/langfuse-worker:3` | `127.0.0.1:3030:3030` | — |
| `clickhouse` | `clickhouse/clickhouse-server` | `127.0.0.1:8123, 9000` | `clickhouse_data`, `clickhouse_logs` |
| `redis` | `redis:7` | `127.0.0.1:6379` | `redis_data` |
| `minio` | `cgr.dev/chainguard/minio` | `9090:9000`, `127.0.0.1:9091:9001` | `minio_data` |
| `postgres` | `postgres:17` | `127.0.0.1:5432` | `postgres_data` |

The architecture rationale ([source][lf-clickhouse-blog]): "Postgres handles
transactional workloads, Clickhouse is a high-performance OLAP database which
stores traces, observations, and scores, Redis/Valkey cache serves as a fast
in-memory data structure store for queue and cache operations, and S3/Blob
Store provides object storage to persist all incoming events."

Hard requirements ([source][lf-clickhouse-doc]): "All infrastructure components
(ClickHouse and Postgres) must run with their timezone set to UTC, as non-UTC
timezones will cause queries to return incorrect or empty results."

### Required CHANGEME secrets

From the actual `docker-compose.yml`: `DATABASE_URL`, `SALT`,
`ENCRYPTION_KEY` (must be 64-hex chars), `CLICKHOUSE_PASSWORD`,
`LANGFUSE_S3_EVENT_UPLOAD_SECRET_ACCESS_KEY`,
`LANGFUSE_S3_MEDIA_UPLOAD_SECRET_ACCESS_KEY`,
`LANGFUSE_S3_BATCH_EXPORT_SECRET_ACCESS_KEY`, `REDIS_AUTH`,
`MINIO_ROOT_PASSWORD`, `POSTGRES_PASSWORD`, `NEXTAUTH_SECRET`. Optional
`LANGFUSE_INIT_*` block can pre-create org/project/user so first boot is
non-interactive (useful for cortex-x install scripts).

### Networking footprint

Per docs ([source][lf-networking]): "Only the langfuse-web container and minio
must be accessible from outside the instance, with other components bound to
localhost (127.0.0.1) to only accept connections from the local machine."
Port 3000 is the UI, 9090 is the minio API. Reasonable for a home-NAS install
behind Tailscale or a reverse proxy.

### OpenAI-compatible / OpenRouter ingestion

Langfuse claims native OpenRouter support ([source][lf-openrouter]) by way of
the OpenAI SDK wrapper since "OpenRouter uses the OpenAI API schema." For
**raw `fetch()` callers — which is exactly Steward's situation
(zero-deps, Node 18+ built-in fetch)** — the docs do not advertise a drop-in
recipe; you fall back to the manual instrumentation SDK ([source][lf-instr])
and wrap calls with `observe()` (TS) or context managers (Python). There is
also OpenRouter's "Broadcast" mode that can ship traces server-side without
client code changes ([source][lf-openrouter]).

**Cost tracking with OpenRouter has a known sharp edge**
([source][lf-openrouter-cost]): the built-in models registry covers OpenAI,
Anthropic, Google. For DeepSeek-via-OpenRouter you "may need to add custom
model definitions" or use the community sync script
[`thiswillbeyourgithub/openrouter_cost_into_langfuse`][lf-cost-sync] to
mirror OpenRouter's pricing into Langfuse's pricing page nightly. Steward
already captures usage from OpenRouter responses (`addCostFields` SSOT
helper, Sprint 1.6.14), so the cost number is authoritative on our side; the
question is just whether Langfuse's UI displays it correctly.

### Prompt management

Langfuse ships a versioned prompt store with a "Collaborative playground with
versioning, caching, fallbacks, and protected labels"
([source][lf-vs-phoenix]). Critically, when **self-hosting**, Phoenix's
counter-FAQ ([source][phoenix-vs-lf]) states bluntly: "while Langfuse is
open-source, several critical features are gated behind its paid offering
when self-hosting" — Prompt Playground, LLM-as-a-Judge, annotation queues.
This matters because Steward's Tier 2 roadmap (AlphaEvolve prompt
evolution) explicitly wants a self-hosted prompt registry and an
LLM-as-judge harness; Langfuse's free OSS tier may not cover both. **Verify
against Langfuse's `EE` license matrix before committing**.

### Retention

Per [lf-retention]: "By default, Langfuse stores event data (Traces,
Observations, Scores, and Media Assets) **indefinitely**." Configurable
per-project, **minimum 3 days**. Nightly job deletes by `timestamp`
(traces/scores), `start_time` (observations), `created_at` (media). Self-host
gotcha: "administrators must grant `s3:DeleteObject` permissions to the
Langfuse IAM role on all buckets" — translates for minio to making sure the
bucket policy + access key allow `DeleteObject`.

### Disk-growth gotcha (load-bearing)

This is the big one for a single-dev install. ClickHouse's default config
ships log tables (`trace_log`, `text_log`, `opentelemetry_span_log`,
`metric_log`, `query_log`) **with no TTL** ([source][lf-cli-issue],
[source][lf-disk-spheron]). Reported behavior: "100 GB disk requirements,
with one deployment exhausting server storage in about one day with no
actual usage." Maintainer fix: add TTL on system tables, set
`CLICKHOUSE_CLUSTER_ENABLED=false` for single node, disable `log_queries` /
`metric_log` / `query_log`, raise
`LANGFUSE_INGESTION_CLICKHOUSE_WRITE_INTERVAL_MS`. Documented at
`langfuse.com/self-hosting/scaling#clickhouse-disk-usage`. **Any cortex-x
Langfuse recipe MUST ship these flags pre-tuned**, otherwise a dev's MacBook
fills its disk in 24 h with one trace per night.

### Hardware floor

Langfuse's own scaling doc ([source][lf-scaling]) recommends "at least 4
cores and 16 GiB of memory, e.g. a t3.xlarge on AWS" with 100 GiB storage
for VM-style deploys; ClickHouse alone wants 2 CPU + 8 GiB minimum. Survives
on 8 GiB MacBook RAM but with measurable pressure from idle ClickHouse.

## 2. Phoenix (Arize) — comparison

### Deployment shape

Phoenix is the OpenInference reference implementation and the contrast with
Langfuse on deployment is stark. Phoenix's own FAQ ([source][phoenix-vs-lf]):
**"Arize Phoenix can be launched with a single Docker container"** vs
Langfuse, which "requires you to separately setup and link Clickhouse,
Redis, and S3."

The simplest persistent recipe ([source][phoenix-docker]):

```
docker run -p 6006:6006 -p 4317:4317 -i -t arizephoenix/phoenix:latest
```

Production-grade with persistence is one compose file, one volume:

```yaml
services:
  phoenix:
    image: arizephoenix/phoenix:latest
    ports: ["6006:6006", "4317:4317"]
    environment:
      - PHOENIX_WORKING_DIR=/mnt/data
    volumes:
      - phoenix_data:/mnt/data
volumes:
  phoenix_data: { driver: local }
```

Default backend is **SQLite at `PHOENIX_WORKING_DIR`**. Postgres ≥14 is
optional via `PHOENIX_SQL_DATABASE_URL`. Port 6006 = UI + OTLP HTTP, 4317 =
OTLP gRPC.

### Agentic-trace fidelity

Phoenix is built on OpenTelemetry and **OpenInference is its native semconv**
([source][openinference-spec]). It has documented out-of-the-box support for
"OpenAI Agents SDK, Claude Agent SDK, LangGraph, Vercel AI SDK, Mastra,
CrewAI, LlamaIndex, DSPy" and providers including "OpenAI, Anthropic, Google
GenAI, AWS Bedrock, **OpenRouter**, LiteLLM" ([source][phoenix-readme]).
Multi-step agent runs map cleanly to OpenInference span kinds — see § 4.

### Feature gating (or lack of it)

Phoenix's FAQ on the Langfuse comparison ([source][phoenix-vs-lf]):
*"Arize Phoenix offers these capabilities fully open-source"* — Prompt
Playground, LLM-as-a-Judge evaluations, prompt experiments, annotation queues
— exactly the set Langfuse paywalls in self-host. For Steward's Tier 2
prompt-evolution work, this is a tangible advantage.

### Maintenance overhead

One container, one SQLite file, one volume. No ClickHouse log-table TTL
ritual. No Redis password rotation. No minio bucket-policy footgun. The
trade-off is a UI/UX gap vs Langfuse's polished web app and a smaller models
registry.

## 3. Helicone — status as of 2026-05

**RIP for our purposes.** Helicone was acquired by Mintlify on 2026-03-03,
and the cloud product entered maintenance mode ([source][helicone-rip]):
"Following the March 2026 acquisition by Mintlify, the Helicone cloud
product entered maintenance mode. While the open-source code remains
available and self-hosting is fully supported, new feature development on
the SaaS product has stopped."

Self-host is technically still alive ([source][helicone-self-host]) — single
docker command to deploy — but "development has stopped, and the
self-hosted version has open issues that are not being fixed." For an
agent-runtime sovereign-AI bet with multi-year horizon (cortex-x Tier 4),
a maintenance-only project is a non-starter. Document and move on.

## 4. OpenLLMetry / OpenInference semantic conventions

### Two parallel standards, both relevant

There are two semconv tracks and Sprint 2.0 should know both:

1. **OpenTelemetry's `gen_ai.*` semconv** — the "official" path under
   `opentelemetry.io/docs/specs/semconv/gen-ai/`. As of 2026-05 the agent-
   span attribute set ([source][otel-genai-agent]) includes:

   - **Required:** `gen_ai.operation.name`, `gen_ai.provider.name`
   - **Conditionally required (if available):** `gen_ai.request.model`
   - **Recommended:** `gen_ai.agent.id`, `gen_ai.agent.name`,
     `gen_ai.agent.description`, `gen_ai.agent.version`,
     `gen_ai.conversation.id`, `gen_ai.request.{max_tokens,temperature,top_p,...}`,
     `gen_ai.response.finish_reasons`,
     `gen_ai.usage.{input_tokens,output_tokens,cache_read.input_tokens}`,
     `gen_ai.input.messages`, `gen_ai.output.messages`,
     `gen_ai.system_instructions`, `gen_ai.tool.definitions`,
     `gen_ai.workflow.name`

   Span kinds: `CLIENT` (cross-service create_agent / invoke_agent),
   `INTERNAL` (in-process invoke_agent / invoke_workflow). Tool execution
   has its own subsection.

2. **OpenInference's `openinference.span.kind`** — Arize's semconv that
   sits **on top of OTel** ([source][openinference-spec-conv]):
   *"every OpenInference trace is a valid OTLP trace; the conventions give
   attribute names their AI-specific meaning."* Span kinds:
   **`LLM, EMBEDDING, CHAIN, RETRIEVER, RERANKER, TOOL, AGENT, GUARDRAIL, EVALUATOR, PROMPT`** —
   ten in total, and `openinference.span.kind` is required for every span.

### Practical mapping for Steward

A single Steward run should produce a span tree like:

```
AGENT (workflow=steward-nightly)
├── LLM (provider=openrouter, model=deepseek-v4-flash, op=plan)
├── TOOL (name=npm_test, attempt=1)
├── TOOL (name=spec_verifier, criteria=N)
└── TOOL (name=git_commit_and_pr, success=true)
```

This maps cleanly onto OpenInference today. OpenLLMetry (Traceloop) is
positioned as **complementary**, not competitive: it ships
"a span processor for OpenLLMetry (Traceloop) traces" inside OpenInference,
and Traceloop docs describe themselves as "an extension of the standard
OpenTelemetry Semantic Conventions for gen AI applications." Both Phoenix
and Langfuse ingest OpenInference natively; Langfuse also offers OTLP
endpoints for plain `gen_ai.*` spans ([source][lf-otel-cookbook]).

**Recommendation:** instrument once with OpenInference attributes (covers
both backends; portable to Tier 4) and emit via OTLP HTTP to whichever
collector is configured (`OTEL_EXPORTER_OTLP_ENDPOINT`).

## 5. Single-dev operational reality

### What the long-tail issues say

Concrete real-world signals from GitHub discussions and write-ups:

- **ClickHouse can consume 2 GB+ RAM at idle for personal projects**
  ([source][lf-disk-spheron]).
- **ClickHouse storage grows even with no activity** unless TTL is set on
  system log tables ([source][lf-cli-issue]).
- **Six containers is acknowledged operational burden** ([source][lf-disk-spheron]):
  *"managing six containers for a small team or personal project is
  acknowledged as a burden."*
- **Background migrations** run on Langfuse upgrades ([source][lf-bg-migrations])
  — non-trivial on a low-power box; can take minutes to hours on first run
  after a major version bump.
- **Phoenix on a single SQLite file** has effectively zero idle cost, since
  it's a normal Node-style process with one volume.

### Disk growth at ~1 trace/night

For Steward's nightly cadence (1 run = ~1 LLM call + tool spans, ~10–50 KB
of trace data), both backends are over-provisioned. Phoenix on SQLite can
sit on this workload for years without intervention. Langfuse's ClickHouse
will still write **system telemetry** continuously regardless of workload —
that's the trap.

### Restart-after-OS-update

Phoenix: container starts in seconds, SQLite is just a file, no migrations.
Langfuse: ClickHouse takes ~30–60 s to come ready on a laptop, postgres
needs ~10 s, redis instant, minio instant; on version bumps the worker runs
background migrations. Manageable, but it's a 1–2 minute boot-stutter every
time the dev box reboots.

### NAS migration story (Tier 4 lookahead)

Phoenix → copy `phoenix_data` volume to NAS, point new compose at it. Done.
Langfuse → preserve postgres dump + clickhouse data + minio bucket; restore
in same version on target; risk of background migration order issues. Not
catastrophic but non-trivial.

## 6. Recommendation for cortex-x

### Stack pick (Sprint 2.0)

1. **Default backend: Phoenix single-container.** Add a
   `templates/observability/docker-compose.phoenix.yml` to cortex-x with the
   minimal SQLite + persistent-volume recipe. Wire Steward to emit
   OpenInference spans over OTLP HTTP to `http://localhost:6006`, gated by
   `STEWARD_OTEL_ENDPOINT` env var (fail-open: missing endpoint = no-op).

2. **Opt-in upgrade: Langfuse.** Ship
   `templates/observability/docker-compose.langfuse.yml` with
   pre-tuned ClickHouse TTL flags + retention defaults (30 days project,
   15 days media), `CLICKHOUSE_CLUSTER_ENABLED=false`, and the cost-sync
   community script wired as a sidecar cron. Document that this path is
   for operators who want prompt management + multi-window cost ledgers
   and accept the ops burden. Verify the EE-gating list against the
   prompt-evolution roadmap before committing the recipe to main.

3. **Steward instrumentation primitive.** Land a new file
   `bin/steward/_lib/otel-emitter.cjs` (zero-deps, hand-rolled OTLP HTTP
   POST against the OpenInference attribute set) instead of pulling in
   `@opentelemetry/api`. Honors Steward's "zero runtime deps" principle.
   Plumb it through `execute.cjs` Phase boundaries: every phase gets
   one span; LLM call gets `openinference.span.kind=LLM`; npm-test +
   spec-verifier + git-commit each get `kind=TOOL`; the run wrapper is
   `kind=AGENT`. All spans inherit the run's trace_id (already in journal).

### Sprint 2.0 acceptance criteria

- `docker compose -f templates/observability/docker-compose.phoenix.yml up`
  starts Phoenix with SQLite persistence on a clean machine in <30 s.
- A Steward dry-run with `STEWARD_OTEL_ENDPOINT` set produces a single
  parent `AGENT` span with at least one child `LLM` span and one child
  `TOOL` span, viewable at `http://localhost:6006`.
- The emitter is fail-open: with `STEWARD_OTEL_ENDPOINT` unset or
  unreachable, Steward must complete normally and log a single
  warning per run (not per span).
- Cost numbers (`openinference.llm.token_count.{prompt,completion,total}`
  + `gen_ai.usage.input_tokens`/`output_tokens`) match the journal's
  `addCostFields` output to within rounding error on 5 dogfood runs.
- Steward journal still writes (Phoenix is **additive**, not a replacement
  for the JSONL ground truth — SSOT preserved).

### Follow-ups parked for later

- **Sprint 4.x:** BIOS-style health dashboard (memory entry from
  2026-05-09) can pull from Phoenix's OTLP API instead of re-inventing.
- **Tier 3:** Langfuse upgrade recipe + EE-gate audit + prompt-evolution
  integration.
- **Tier 4:** NAS migration script for Phoenix volume; consider whether
  to move to a managed multi-tenant Phoenix or stay single-volume.
- **Sprint 2.1+:** if autoresearch overnight burst increases trace volume
  10x, re-evaluate ClickHouse-backed Langfuse for query performance over
  large windows. Until then Phoenix on SQLite is sufficient.

## Sources

[lf-compose]: https://github.com/langfuse/langfuse/blob/main/docker-compose.yml
[lf-clickhouse-blog]: https://clickhouse.com/blog/langfuse-and-clickhouse-a-new-data-stack-for-modern-llm-applications
[lf-clickhouse-doc]: https://langfuse.com/self-hosting/deployment/infrastructure/clickhouse
[lf-networking]: https://langfuse.com/self-hosting/security/networking
[lf-openrouter]: https://langfuse.com/integrations/gateways/openrouter
[lf-instr]: https://langfuse.com/docs/observability/sdk/instrumentation
[lf-openrouter-cost]: https://github.com/orgs/langfuse/discussions/3559
[lf-cost-sync]: https://github.com/thiswillbeyourgithub/openrouter_cost_into_langfuse
[lf-vs-phoenix]: https://langfuse.com/faq/all/best-phoenix-arize-alternatives
[phoenix-vs-lf]: https://arize.com/docs/phoenix/resources/frequently-asked-questions/langfuse-alternative-arize-phoenix-vs-langfuse-key-differences
[lf-retention]: https://langfuse.com/docs/administration/data-retention
[lf-cli-issue]: https://github.com/orgs/langfuse/discussions/7582
[lf-disk-spheron]: https://www.spheron.network/blog/llm-observability-gpu-cloud-langfuse-arize-phoenix-helicone/
[lf-scaling]: https://langfuse.com/self-hosting/configuration/scaling
[lf-bg-migrations]: https://langfuse.com/self-hosting/upgrade/background-migrations
[phoenix-docker]: https://arize.com/docs/phoenix/self-hosting/deployment-options/docker
[phoenix-readme]: https://github.com/Arize-ai/phoenix
[openinference-spec]: https://github.com/Arize-ai/openinference
[openinference-spec-conv]: https://arize-ai.github.io/openinference/spec/semantic_conventions.html
[otel-genai-agent]: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-agent-spans/
[otel-genai-spans]: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
[helicone-rip]: https://dev.to/torrixai/helicone-is-now-in-maintenance-mode-here-is-how-to-switch-to-a-self-hosted-alternative-in-5-4li0
[helicone-self-host]: https://docs.helicone.ai/getting-started/self-host/overview
[lf-otel-cookbook]: https://langfuse.com/guides/cookbook/otel_integration_arize

- [Langfuse `docker-compose.yml` on `main`][lf-compose]
- [ClickHouse + Langfuse architecture blog (ClickHouse, Inc.)][lf-clickhouse-blog]
- [Langfuse ClickHouse self-hosting doc — UTC requirement][lf-clickhouse-doc]
- [Langfuse self-host networking — ports + bind addresses][lf-networking]
- [Langfuse OpenRouter integration page][lf-openrouter]
- [Langfuse manual instrumentation SDK guide][lf-instr]
- [GitHub discussion 3559 — OpenRouter cost tracking gaps][lf-openrouter-cost]
- [`thiswillbeyourgithub/openrouter_cost_into_langfuse` — pricing sync script][lf-cost-sync]
- [Langfuse FAQ — Phoenix/Arize alternative comparison][lf-vs-phoenix]
- [Phoenix FAQ — Langfuse comparison + feature-gating callout][phoenix-vs-lf]
- [Langfuse data-retention doc][lf-retention]
- [GitHub discussion 7582 — ClickHouse storage grows without activity][lf-cli-issue]
- [Spheron blog — long-tail self-host comparison Langfuse / Phoenix / Helicone (2026)][lf-disk-spheron]
- [Langfuse scaling doc — hardware floor][lf-scaling]
- [Langfuse background-migrations doc][lf-bg-migrations]
- [Phoenix Docker deployment doc — single-container recipe][phoenix-docker]
- [Phoenix README on GitHub — agent-framework support matrix][phoenix-readme]
- [`Arize-ai/openinference` repo][openinference-spec]
- [OpenInference semantic-conventions spec — span kinds][openinference-spec-conv]
- [OpenTelemetry gen_ai agent-spans semconv][otel-genai-agent]
- [OpenTelemetry gen_ai client-spans semconv][otel-genai-spans]
- [Helicone maintenance-mode write-up (DEV.to, post-acquisition)][helicone-rip]
- [Helicone self-host quickstart (docs)][helicone-self-host]
- [Langfuse OTel/OpenInference cookbook][lf-otel-cookbook]
