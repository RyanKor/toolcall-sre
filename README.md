# toolcall-sre

**Reliability engineering for local-LLM tool calls.**

`toolcall-sre` is a small, drop-in **OpenAI-compatible reverse proxy** that sits
between your agent/harness and any local inference endpoint (vLLM, Ollama, SGLang,
llama.cpp server). It exists to make **tool calling (function calling) reliable for
open/local models** — the single most common failure point when you move an agent
off a frontier API and onto a self-hosted model.

You don't change your agent code or fine-tune the model. You point the agent's
`OPENAI_BASE_URL` at `toolcall-sre` instead of the raw endpoint, and every tool call
that flows through is parsed, schema-validated, repaired if broken, and measured.

### The problem it solves

- **Tool-call errors compound.** A 95%-per-call success rate over an 8-step agent
  run is only ~66% end-to-end. One malformed call derails the whole task.
- **Local/open models are the weak point.** Small and non-tool-tuned models emit
  malformed or schema-invalid arguments far more often than frontier APIs (prose
  around the JSON, Markdown fences, trailing commas, wrong types, missing required
  fields, invalid enums).
- **You can't see it happening.** Standard benchmarks score a model in isolation;
  they don't tell you how it behaves *inside your actual harness*, across turns.

### Two roles, one core

The same `parse + validate` engine serves two complementary jobs:

1. **Runtime reliability proxy** — in production, it *fixes* broken tool calls
   in-flight (tolerant parse → JSON-Schema validation → bounded auto-repair loop),
   so a weak model's occasional bad call doesn't break the run.
2. **In-harness measurement sensor** — in evaluation, it *records and scores* how a
   given model behaves inside a given harness across a full multi-turn task
   (turns, tool-call sequence, tool-result errors, recovery, end-to-end reliability),
   without the harness having to cooperate.

Run it with repair on to mitigate, or with `--repair-policy off` to measure raw behavior.

### The rule that shapes the repair loop

A schema failure is one of two very different things, and treating them the same is
how a reliability tool starts causing incidents:

| | example | information is | context-free repair |
|---|---|---|---|
| **Syntactic** | prose around the JSON, a fence, `"unit": "C"`, `"location": 123` | **present** | safe — nothing to invent |
| **Fabricating** | `unit` is simply absent | **absent** | the model **invents** a value |

The second case turns a loud, visible failure into a silent wrong action: schema-valid
arguments carrying a fact nobody supplied. So the default policy is
`--repair-policy syntactic-only`: fix broken values, never invent missing ones. When a
repair does introduce a value found nowhere in the call or the conversation, it is
counted (`tcs_repair_fabricated_total`) and named in the trace — you always know what
share of your "successful" repairs were inventions.

### Key features

- **Drop-in & framework-agnostic** — one OpenAI-compatible endpoint swap; works with
  any harness (claude-code, OpenHands, hermes-agent, deepagents, LangGraph, …) and
  any OpenAI-compatible backend.
- **Tolerant argument parsing** — recovers JSON from prose, code fences, and trailing
  commas that `serde_json` would reject.
- **JSON-Schema validation** — checks arguments against each tool's
  `function.parameters` schema (types, required fields, enums, patterns).
- **Bounded auto-repair loop** — on an invalid call, asks the model to correct itself
  with the schema and the exact validation error, up to `--max-repair-attempts`.
- **Policy-governed repair** — `off` / `syntactic-only` (default) / `contextual` / `full`,
  plus `--no-fabricate-for 'send_*,delete_*'` so tools with side effects never get a
  guessed argument.
- **Fabrication detection** — flags repairs whose values appear neither in the original
  call nor in the conversation, per call and as an SLI.
- **Streaming that is not a blind spot** — SSE tool-call deltas are reassembled and
  measured at zero added latency; `--repair-streaming` additionally buffers *tool-call*
  responses so they can be corrected (text responses keep streaming untouched).
- **SRE-style telemetry** — Prometheus + JSON SLIs with counters that each mean one
  thing, latency histograms including the time repair adds, and rates that report
  `null` rather than `1.0` when nothing has been observed.
- **In-harness session measurement** — correlates multi-turn requests into sessions
  and reports per-session behavior + a JSONL flight recorder (see below).
- **Model-dialect awareness** — labels the model family (qwen/llama/mistral/…) as an
  extension point for family-specific handling.
- **Safe by construction** — a call that is already valid JSON is forwarded
  byte-for-byte (key order included); only payloads the client could not parse are
  rewritten. Non-JSON requests pass through untouched.
- **Bounded memory** — sessions retire by TTL and capacity, folding their totals into
  lifetime counters so retiring one never moves a reported rate.
- **Fast & self-contained** — a single Rust binary (axum + tokio), no runtime deps.

## How the runtime proxy works

For every `/v1/chat/completions` response that contains `tool_calls`:

1. **Read the arguments** — as a JSON string (the OpenAI wire format) *or* as an
   already-parsed object (Ollama's native shape, some gateways). Reading only the
   string form turns the latter into `""`, which then gets reported as malformed and
   possibly overwritten.
2. **Tolerant parse** — recovers arguments from prose, Markdown code fences and
   trailing commas. Empty/`null` arguments become `{}` so that the *schema* decides
   whether a no-parameter call is acceptable; the parser makes no policy decisions.
3. **Schema validation & classification** — validates against the tool's
   `function.parameters`, and classifies any failure as **syntactic** (the value is
   there, just wrong) or **fabricating** (the value is absent).
4. **Policy** — `syntactic-only` repairs the first and reports the second.
   `contextual` also repairs the second, but attaches the conversation and tells the
   model to return `{"__unrecoverable__": true}` rather than guess.
5. **Repair loop** — bounded by `--max-repair-attempts`, zero temperature. On success,
   any field whose value appears nowhere in the call, the raw text or the context is
   recorded as **fabricated**.
6. **Write back** — a call that was already valid JSON is left byte-for-byte. Only a
   payload the client could not have parsed is rewritten, and always in the shape it
   arrived in (string stays string, object stays object).
7. **Telemetry** — one counter per distinct fact, plus latency histograms that
   separate the time repair added from the request's own time.

**Streaming** is no longer a blind spot. `--measure-streaming` (on by default)
reassembles `delta.tool_calls` fragments as they pass through and records them without
touching a byte or adding a millisecond. `--repair-streaming` additionally buffers
*tool-call* responses so they can be corrected and re-emitted as valid SSE — those
deltas are parsed by the harness, never read by a human, so buffering them costs no
perceived latency. Text-only responses always stream straight through.

## Quick start

```bash
# Build
cargo build --release

# Run: proxy on :8088, upstream = local Ollama
./target/release/toolcall-sre \
  --listen 127.0.0.1:8088 \
  --upstream http://127.0.0.1:11434/v1

# Point your agent/client at the proxy
export OPENAI_BASE_URL=http://127.0.0.1:8088/v1
```

### Configuration

All flags have environment-variable equivalents.

| Flag | Env | Default | Description |
|---|---|---|---|
| `--listen` | `TCS_LISTEN` | `127.0.0.1:8080` | Proxy listen address. A non-loopback address requires `--require-auth` |
| `--upstream` | `TCS_UPSTREAM` | `http://127.0.0.1:11434/v1` | Upstream OpenAI-compatible base URL (include `/v1`) |
| `--api-key` | `TCS_API_KEY` | – | Upstream key when the caller sends none |
| `--upstream-alias` | – | – | Extra backend selectable per request: `vllm=http://127.0.0.1:8000/v1`. Repeatable |
| `--upstream-header` | `TCS_UPSTREAM_HEADER` | `x-tcs-upstream` | Header naming which registered backend serves a request |
| `--allow-admin` | `TCS_ALLOW_ADMIN` | `false` | Allow the registry to be edited at runtime via `/admin/*` (loopback only) |
| `--repair-policy` | `TCS_REPAIR_POLICY` | `syntactic-only` | `off` \| `syntactic-only` \| `contextual` \| `full` |
| `--no-fabricate-for` | `TCS_NO_FABRICATE_FOR` | – | Glob list of tools that must never get an invented value (`send_*,delete_*`) |
| `--max-repair-attempts` | `TCS_MAX_REPAIR_ATTEMPTS` | `2` | Repair attempts per malformed call |
| `--measure-streaming` | `TCS_MEASURE_STREAMING` | `true` | Reassemble SSE tool-call deltas to measure them (never alters the stream) |
| `--repair-streaming` | `TCS_REPAIR_STREAMING` | `false` | Buffer tool-call responses so they can be repaired, then re-emit |
| `--normalize` | `TCS_NORMALIZE` | `false` | Re-serialize already-valid arguments (off = byte-for-byte passthrough) |
| `--no-repair` | `TCS_NO_REPAIR` | `false` | Compatibility alias for `--repair-policy off` |
| `--timeout-secs` | `TCS_TIMEOUT_SECS` | `120` | Upstream request timeout |
| `--trace-file` | `TCS_TRACE_FILE` | – | Write a JSONL flight-recorder trace |
| `--session-header` | `TCS_SESSION_HEADER` | `x-session-id` | Header used to correlate multi-turn requests into a session |
| `--max-sessions` | `TCS_MAX_SESSIONS` | `10000` | Sessions kept in memory; LRU beyond this |
| `--session-ttl-secs` | `TCS_SESSION_TTL_SECS` | `3600` | Retire an idle session after this long (0 disables) |
| `--max-sequence-len` | `TCS_MAX_SEQUENCE_LEN` | `256` | Cap on a session's recorded call sequence |
| `--max-events` | `TCS_MAX_EVENTS` | `500` | Recent request records kept for `GET /events` |
| `--require-auth` | `TCS_REQUIRE_AUTH` | `false` | Reject callers with no `Authorization` header |
| `--cors` | `TCS_CORS` | `false` | Permissive CORS on the read-only endpoints |

### Endpoints

- `POST /v1/chat/completions` — the proxied, reliability-enhanced endpoint.
- `GET /health` — liveness plus the active policy.
- `GET /metrics` — Prometheus exposition; `?format=json` adds an `in_harness` summary.
- `GET /sessions?limit=&offset=` — per-session in-harness behavior rollup (JSON).
- `GET /events?session=&limit=` — recent per-request records: which action was taken
  per tool call, how the violation was classified, which fields a repair invented.
- `GET /models` — reliability broken down by (model, upstream): the comparison view.
- `GET /upstreams` — the registered backends a request may be routed to.
- `POST /admin/upstreams`, `DELETE /admin/upstreams/{alias}`, `POST /admin/probe` —
  edit the registry and test a backend. Requires `--allow-admin`.
- `POST /debug/inspect` — run the parser, validator and policy on one payload with
  **no upstream call**. Body: `{"tool", "arguments", "schema"}`.

### Several backends, one proxy

A proxy that can only reach one backend cannot answer the question people actually
have: *which model behaves best inside my harness?* So upstreams are a registry —
several named entries, one selected per request, all measured under the same policy
by the same parser:

```bash
cargo run -- --upstream http://127.0.0.1:8000/v1 \
             --upstream-alias qwen=http://127.0.0.1:8000/v1 \
             --upstream-alias llama=http://127.0.0.1:8001/v1

curl localhost:8080/v1/chat/completions -H 'x-tcs-upstream: llama' -d '{…}'
curl localhost:8080/models | jq          # side-by-side reliability
```

The header carries an **alias, never a URL** — a proxy that forwarded requests to any
address a caller named would be an SSRF gadget. An unregistered alias is rejected with
`400` rather than falling back to the default, because a silent fallback would
attribute one model's results to another. Registering backends at runtime is gated
behind `--allow-admin`, which the proxy refuses to combine with a non-loopback bind.

### Console (Next.js)

A dashboard for watching all of the above, with a mock upstream built in — so the
whole path is exercisable with no model and no GPU:

```bash
cd ui && npm install && npm run dev        # http://localhost:3100
cargo run -- --upstream http://127.0.0.1:3100/api/mock/v1 \
             --listen 127.0.0.1:8091 --repair-policy contextual --repair-streaming
```

Six screens — a live SLI dashboard, a lab that replays real failure modes against any
backend, a `/debug/inspect` playground, a per-request flight recorder, backend
registration with a side-by-side comparison, and proxy connection management. Available
in Korean, English, Japanese and Chinese; the language is chosen in the sidebar, stored
in a cookie and resolved server-side so the first paint is already correct. See
[`ui/README.md`](./ui/README.md).

The console keeps the backend list on disk and pushes it into whichever proxy it is
connected to, so the proxy stays a single binary with no config file and a restart
loses nothing.

### Checks

```bash
cargo test                              # 35 unit tests
python3 scripts/verify_behaviors.py     # 26 end-to-end behavior assertions
python3 scripts/verify_ui.py            # 16 scenarios driven through the console
python3 scripts/verify_models.py        # 15 assertions on the multi-backend registry
python3 scripts/verify_i18n.py          # 31 assertions on the four-language console
```

## Example

Malformed upstream tool call:

```
get_weather(arguments = 'Sure! {"location": 123, }')
```

against schema `{location: string (required), unit: enum[celsius,fahrenheit] (required)}`
→ `toolcall-sre` detects it (`"unit" is a required property; 123 is not of type
"string"`), repairs it, and returns:

```json
{"location":"Seoul","unit":"celsius"}
```

`GET /metrics?format=json` then reports `malformed=1, repaired=1,
repair_success_rate=1.0`.

An end-to-end reproduction (mock upstream + assertions) lives in
[`scripts/mock_upstream.py`](scripts/mock_upstream.py).

## In-harness measurement (sensor mode)

A standalone benchmark (BFCL, tau-bench) measures a model's *raw* tool-calling.
It cannot tell you how that model behaves *inside a real harness* (hermes-agent,
deepagents, claude-code, OpenHands…), where the harness controls tool formatting,
multi-turn context, and error recovery — and where the same model scores
differently.

Because the proxy already sits at the tool-call boundary, it can measure this for
free. A harness drives a task as a *sequence* of `/v1/chat/completions` calls with
a growing `messages` history; `toolcall-sre` correlates them into a **session**
(via an explicit `--session-header`, or by fingerprinting the conversation prefix
when none is sent) and records how the model behaves across the whole run:

- **turns** — how many round-trips the harness needed to finish the task
- **tool-call sequence** — which tools, in what order
- **tool-result errors** — errors the harness fed back (from `role:"tool"` messages)
- **recovery** — a session that hit a tool-result error yet still reached a final answer
- **end-to-end clean** — the model never emitted a malformed/invalid call across the
  *whole* run (this is the metric that compounds: 95%-per-call over 8 steps ≈ 66%)

The same `parse + validate` core powers both roles: **repair** (runtime mitigation)
and **record/score** (measurement). Run with `--no-repair` to measure raw in-harness
behavior, or with repair on to measure the mitigated behavior.

```bash
# Measure a real harness loop (writes a JSONL trace)
toolcall-sre --upstream http://127.0.0.1:8000/v1 \
             --trace-file ./trace.jsonl

# A minimal 3–4 turn harness simulator (happy path + tool-error recovery)
python3 scripts/harness_sim.py http://127.0.0.1:8088 <model> happy    task-happy
python3 scripts/harness_sim.py http://127.0.0.1:8088 <model> recovery task-recovery

curl -s http://127.0.0.1:8088/sessions | jq         # per-session rollup
curl -s 'http://127.0.0.1:8088/metrics?format=json' # includes in_harness summary
python3 scripts/print_trace.py ./trace.jsonl        # flight recorder
```

Example `/sessions` output (real vLLM + qwen3.6-35b): the `recovery` session shows
`turns=4`, sequence `[get_weather, get_weather, set_reminder]`, `tool_result_errors=1`,
`reached_final=true` — i.e. the model recovered from a tool error inside the harness loop.

## Architecture

```
Agent / Harness
   │  POST /v1/chat/completions (tools=[…])
   ▼
┌──────────────── toolcall-sre ────────────────┐
│ profiles   → model dialect label             │
│ upstream   → forward request unmodified      │
│ repair     → tolerant parse of arguments     │
│ validate   → JSON-Schema check               │
│ repair     → bounded auto-repair loop        │
│ telemetry  → SLIs (well-formed/repair/fail)  │
└──────────────────────┬───────────────────────┘
                       ▼
     local endpoint (vLLM / Ollama / SGLang / llama.cpp)
```

Module map:

| Module | Responsibility |
|---|---|
| `config.rs` | CLI/env configuration |
| `server.rs` | HTTP surface + repair orchestration |
| `upstream.rs` | Upstream client (JSON + raw streaming passthrough) |
| `repair.rs` | Tolerant JSON parsing + repair-prompt construction |
| `validate.rs` | JSON-Schema compilation & validation |
| `profiles.rs` | Model dialect detection (extension point) |
| `telemetry.rs` | Reliability counters / metrics |
| `trace.rs` | In-harness measurement: session correlation, flight recorder, `/sessions` |

## Roadmap

- ~~**M1**: streaming-aware repair (buffer tool-call deltas, repair, re-emit).~~ **done**
- **M1**: delegate constrained decoding to backends that support it
  (vLLM `guided_json`, SGLang xgrammar) so calls do not break in the first place.
- **M1**: offline aggregation CLI (`toolcall-sre report trace.jsonl`) so several
  proxies can be scored together without a shared metrics store.
- **M2**: `before/after` reliability report against BFCL v4 / tau-bench.
- **M2**: community model-dialect registry (YAML) as the low-barrier first PR.
- Reflection-based repair, per-step reliability prediction, tool-call caching.

## Status

MVP (M0), hardened. The repair loop, the policy layer, streaming measurement and
repair, and the in-harness measurement layer are implemented and verified end to end
against a mock upstream and against a real vLLM server running `qwen3.6-35b`
(Qwen3.6-35B-A3B-AWQ).

Verified by `cargo test` (40), `scripts/verify_behaviors.py` (26 end-to-end assertions),
`scripts/verify_ui.py` (16 scenarios through the console), `scripts/verify_models.py`
(15 assertions on the multi-backend registry, including its SSRF guards) and
`scripts/verify_i18n.py` (31 assertions on the four-language console).

Known limits: metrics are single-process and in-memory (the JSONL trace is the durable
record — aggregate several proxies from their trace files, not from `/metrics`); the
upstream registry is in memory too, so the console refills it after a restart; the
proxy has no auth of its own beyond `--require-auth`; repair still happens after the
fact rather than being pushed down into the backend's constrained decoding.

## License

Apache-2.0.
