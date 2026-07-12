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

Run it with repair on to mitigate, or with `--no-repair` to measure raw behavior.

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
- **SRE-style telemetry** — Prometheus + JSON SLIs: well-formed rate, repair rate,
  repair-success rate, failure rate.
- **In-harness session measurement** — correlates multi-turn requests into sessions
  and reports per-session behavior + a JSONL flight recorder (see below).
- **Model-dialect awareness** — labels the model family (qwen/llama/mistral/…) as an
  extension point for family-specific handling.
- **Safe by construction** — well-formed calls are only normalized, never altered;
  streaming and non-JSON requests pass through untouched.
- **Fast & self-contained** — a single Rust binary (axum + tokio), no runtime deps.

## How the runtime proxy works

For every non-streaming `/v1/chat/completions` response that contains `tool_calls`:

1. **Tolerant parse** — recovers arguments from prose, Markdown code fences,
   trailing commas, and other common local-model JSON quirks.
2. **Schema validation** — validates arguments against each tool's
   `function.parameters` JSON Schema.
3. **Auto-repair loop** — on invalid arguments, sends a focused, zero-temperature
   repair request to the upstream (bounded by `--max-repair-attempts`) until the
   arguments validate.
4. **Normalize** — rewrites the arguments back as canonical JSON.
5. **Telemetry** — counts tool calls, malformed, repaired, and failed as SLIs.

Streaming requests (`"stream": true`) and non-JSON bodies are passed through
untouched (repair needs the full response).

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
| `--listen` | `TCS_LISTEN` | `127.0.0.1:8080` | Proxy listen address |
| `--upstream` | `TCS_UPSTREAM` | `http://127.0.0.1:11434/v1` | Upstream OpenAI-compatible base URL (include `/v1`) |
| `--api-key` | `TCS_API_KEY` | – | Upstream key when the caller sends none |
| `--max-repair-attempts` | `TCS_MAX_REPAIR_ATTEMPTS` | `2` | Repair attempts per malformed call |
| `--no-repair` | `TCS_NO_REPAIR` | `false` | Validate + normalize only, no repair (pure measurement mode) |
| `--timeout-secs` | `TCS_TIMEOUT_SECS` | `120` | Upstream request timeout |
| `--trace-file` | `TCS_TRACE_FILE` | – | Write a JSONL flight-recorder trace (enables in-harness measurement) |
| `--session-header` | `TCS_SESSION_HEADER` | `x-session-id` | Header used to correlate multi-turn requests into a session |

### Endpoints

- `POST /v1/chat/completions` — the proxied, reliability-enhanced endpoint.
- `GET /health` — liveness (`ok`).
- `GET /metrics` — Prometheus exposition; `?format=json` adds an `in_harness` summary.
- `GET /sessions` — per-session in-harness behavior rollup (JSON).

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

- **M1**: delegate constrained decoding to backends that support it
  (vLLM `guided_json`, SGLang xgrammar) instead of post-hoc repair.
- **M1**: streaming-aware repair (buffer tool-call deltas, repair, re-emit).
- **M2**: `before/after` reliability report against BFCL v4 / tau-bench.
- **M2**: community model-dialect registry (YAML) as the low-barrier first PR.
- Reflection-based repair, per-step reliability prediction, tool-call caching.

## Status

MVP (M0). Both the non-streaming repair loop and the in-harness measurement layer
are implemented and verified end-to-end against a mock upstream and against a real
vLLM server running `qwen3.6-35b` (Qwen3.6-35B-A3B-AWQ). Not yet production-hardened
(no auth on the proxy itself, single-process in-memory metrics, non-streaming only).

## License

Apache-2.0.
