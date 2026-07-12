# toolcall-sre

**Reliability engineering for local-LLM tool calls.**

`toolcall-sre` is an OpenAI-compatible reverse proxy that sits in front of any
local inference endpoint (vLLM, Ollama, SGLang, llama.cpp server) and makes
tool/function calls *reliable*. Point your agent at `toolcall-sre` instead of the
raw endpoint and malformed tool calls get tolerantly parsed, schema-validated,
and auto-repaired — with SRE-style telemetry on the well-formed / repair / failure rates.

> Why this exists: tool-call reliability compounds across an agent run
> (95% per-call over 8 steps ≈ 66% end-to-end), and small/local models emit
> malformed calls far more often than frontier APIs. `toolcall-sre` is a drop-in
> layer that closes that gap **without fine-tuning the model**.

## What it does

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
| `--no-repair` | `TCS_NO_REPAIR` | `false` | Validate + normalize only, no repair |
| `--timeout-secs` | `TCS_TIMEOUT_SECS` | `120` | Upstream request timeout |

### Endpoints

- `POST /v1/chat/completions` — the proxied, reliability-enhanced endpoint.
- `GET /health` — liveness (`ok`).
- `GET /metrics` — Prometheus exposition; `?format=json` for a JSON snapshot.

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

## Roadmap

- **M1**: delegate constrained decoding to backends that support it
  (vLLM `guided_json`, SGLang xgrammar) instead of post-hoc repair.
- **M1**: streaming-aware repair (buffer tool-call deltas, repair, re-emit).
- **M2**: `before/after` reliability report against BFCL v4 / tau-bench.
- **M2**: community model-dialect registry (YAML) as the low-barrier first PR.
- Reflection-based repair, per-step reliability prediction, tool-call caching.

## Status

MVP (M0). Non-streaming repair loop is implemented and verified end-to-end.
Not yet production-hardened (no auth on the proxy itself, single-process metrics).

## License

Apache-2.0.
