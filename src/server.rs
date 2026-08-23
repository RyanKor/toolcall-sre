//! HTTP surface: OpenAI-compatible `/v1/chat/completions` plus health, metrics,
//! sessions, and a no-LLM inspection endpoint for tooling.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use axum::{
    Router,
    body::{Body, Bytes},
    extract::{Query, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures_util::StreamExt;
use jsonschema::Validator;
use serde_json::Value;
use tracing::{info, warn};

use crate::config::AppConfig;
use crate::repair::RepairContext;
use crate::sse::{self, Accumulator, StreamedCall};
use crate::telemetry::Metrics;
use crate::trace::{self, Action, Recorder, RequestEvent, ToolCallRecord};
use crate::upstream::{Target, Upstreams};
use crate::validate::{Failure, Violation};
use crate::{profiles, repair, upstream, validate};

/// Shared application state.
pub struct AppInner {
    pub cfg: AppConfig,
    pub http: reqwest::Client,
    pub metrics: Metrics,
    pub recorder: Recorder,
    /// Registered backends, selectable per request by alias.
    pub upstreams: Upstreams,
}

pub type AppState = Arc<AppInner>;

/// Compiled schemas for the tools a request declared.
type Schemas = HashMap<String, (Validator, Value)>;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health).options(preflight))
        .route("/metrics", get(metrics).options(preflight))
        .route("/sessions", get(sessions).options(preflight))
        .route("/events", get(events).options(preflight))
        .route("/models", get(models).options(preflight))
        .route("/upstreams", get(list_upstreams).options(preflight))
        .route("/admin/upstreams", post(add_upstream).options(preflight))
        .route("/admin/upstreams/{alias}", axum::routing::delete(delete_upstream).options(preflight))
        .route("/admin/probe", post(probe_upstream).options(preflight))
        .route("/debug/inspect", post(debug_inspect).options(preflight))
        .route("/v1/chat/completions", post(chat_completions).options(preflight))
        .with_state(state)
}

// ---------------------------------------------------------------------------
// CORS (read-only convenience for a local dashboard)
// ---------------------------------------------------------------------------

fn apply_cors(cfg: &AppConfig, resp: &mut Response) {
    if !cfg.cors {
        return;
    }
    let h = resp.headers_mut();
    h.insert(
        HeaderName::from_static("access-control-allow-origin"),
        HeaderValue::from_static("*"),
    );
    h.insert(
        HeaderName::from_static("access-control-allow-headers"),
        HeaderValue::from_static("content-type, authorization, x-session-id"),
    );
    h.insert(
        HeaderName::from_static("access-control-allow-methods"),
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
}

async fn preflight(State(state): State<AppState>) -> Response {
    let mut resp = StatusCode::NO_CONTENT.into_response();
    apply_cors(&state.cfg, &mut resp);
    resp
}

// ---------------------------------------------------------------------------
// Read-only endpoints
// ---------------------------------------------------------------------------

async fn health(State(state): State<AppState>) -> Response {
    let mut resp = axum::Json(serde_json::json!({
        "status": "ok",
        "upstream": state.cfg.upstream_base,
        "repair_policy": format!("{:?}", state.cfg.policy),
        "measure_streaming": state.cfg.measure_streaming,
        "repair_streaming": state.cfg.repair_streaming,
        "normalize": state.cfg.normalize,
    }))
    .into_response();
    apply_cors(&state.cfg, &mut resp);
    resp
}

#[derive(serde::Deserialize)]
struct MetricsQuery {
    format: Option<String>,
}

async fn metrics(State(state): State<AppState>, Query(q): Query<MetricsQuery>) -> Response {
    let mut resp = if q.format.as_deref() == Some("json") {
        let mut snap = state.metrics.snapshot();
        if let Some(obj) = snap.as_object_mut() {
            obj.insert("in_harness".to_string(), state.recorder.summary_json());
        }
        axum::Json(snap).into_response()
    } else {
        (
            [(header::CONTENT_TYPE, "text/plain; version=0.0.4")],
            state.metrics.prometheus(),
        )
            .into_response()
    };
    apply_cors(&state.cfg, &mut resp);
    resp
}

#[derive(serde::Deserialize)]
struct SessionsQuery {
    limit: Option<usize>,
    offset: Option<usize>,
}

/// Per-session in-harness behavior rollup.
async fn sessions(State(state): State<AppState>, Query(q): Query<SessionsQuery>) -> Response {
    let limit = q.limit.unwrap_or(200).clamp(1, 1000);
    let offset = q.offset.unwrap_or(0);
    let mut resp = axum::Json(state.recorder.sessions_json(limit, offset)).into_response();
    apply_cors(&state.cfg, &mut resp);
    resp
}

/// Reliability broken down by model and upstream.
async fn models(State(state): State<AppState>) -> Response {
    let mut resp = axum::Json(state.recorder.models_json()).into_response();
    apply_cors(&state.cfg, &mut resp);
    resp
}

/// The registered backends a request may be routed to.
async fn list_upstreams(State(state): State<AppState>) -> Response {
    let mut body = state.upstreams.list_json();
    if let Some(o) = body.as_object_mut() {
        o.insert("admin_enabled".into(), Value::Bool(state.cfg.allow_admin));
        o.insert("header".into(), Value::String(state.cfg.upstream_header.clone()));
    }
    let mut resp = axum::Json(body).into_response();
    apply_cors(&state.cfg, &mut resp);
    resp
}

#[derive(serde::Deserialize)]
struct UpstreamBody {
    alias: String,
    base_url: String,
    label: Option<String>,
    default_model: Option<String>,
    api_key: Option<String>,
}

fn admin_gate(state: &AppState) -> Option<Response> {
    if state.cfg.allow_admin {
        return None;
    }
    Some(
        (
            StatusCode::FORBIDDEN,
            axum::Json(serde_json::json!({
                "error": {
                    "message": "runtime upstream editing is disabled; start the proxy with --allow-admin, or register backends with --upstream-alias",
                    "type": "admin_disabled"
                }
            })),
        )
            .into_response(),
    )
}

/// Register or replace an upstream at runtime.
async fn add_upstream(
    State(state): State<AppState>,
    axum::Json(body): axum::Json<UpstreamBody>,
) -> Response {
    if let Some(denied) = admin_gate(&state) {
        return denied;
    }
    let mut resp = match state.upstreams.upsert(
        &body.alias,
        &body.base_url,
        body.label,
        body.default_model,
        body.api_key,
        "admin",
    ) {
        Ok(entry) => {
            info!(alias = %entry.alias, base = %entry.base_url, "upstream registered");
            axum::Json(serde_json::json!({ "upstream": entry })).into_response()
        }
        Err(e) => (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({
                "error": { "message": e.to_string(), "type": "invalid_upstream" }
            })),
        )
            .into_response(),
    };
    apply_cors(&state.cfg, &mut resp);
    resp
}

async fn delete_upstream(
    State(state): State<AppState>,
    axum::extract::Path(alias): axum::extract::Path<String>,
) -> Response {
    if let Some(denied) = admin_gate(&state) {
        return denied;
    }
    let mut resp = match state.upstreams.remove(&alias) {
        Ok(true) => axum::Json(serde_json::json!({ "removed": alias })).into_response(),
        Ok(false) => (
            StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({
                "error": { "message": format!("no upstream `{alias}`"), "type": "not_found" }
            })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({
                "error": { "message": e.to_string(), "type": "invalid_upstream" }
            })),
        )
            .into_response(),
    };
    apply_cors(&state.cfg, &mut resp);
    resp
}

#[derive(serde::Deserialize)]
struct ProbeBody {
    base_url: String,
    api_key: Option<String>,
}

/// Check that a backend is reachable and list the models it serves, without
/// registering anything. Lets a console validate a URL before committing to it.
async fn probe_upstream(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::Json(body): axum::Json<ProbeBody>,
) -> Response {
    if let Some(denied) = admin_gate(&state) {
        return denied;
    }
    let base = match upstream::validate_base_url(&body.base_url) {
        Ok(b) => b,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({
                    "error": { "message": e.to_string(), "type": "invalid_upstream" }
                })),
            )
                .into_response();
        }
    };
    let target = Target { alias: "probe".into(), base, api_key: body.api_key };
    let started = Instant::now();
    let mut resp = match upstream::probe(&state.http, &target, caller_auth(&headers).as_deref()).await {
        Ok(models) => axum::Json(serde_json::json!({
            "ok": true,
            "elapsed_ms": started.elapsed().as_millis() as u64,
            "models": models,
        }))
        .into_response(),
        Err(e) => axum::Json(serde_json::json!({
            "ok": false,
            "elapsed_ms": started.elapsed().as_millis() as u64,
            "error": e.to_string(),
        }))
        .into_response(),
    };
    apply_cors(&state.cfg, &mut resp);
    resp
}

#[derive(serde::Deserialize)]
struct EventsQuery {
    session: Option<String>,
    limit: Option<usize>,
}

/// Recent per-request records — the live window of the flight recorder.
async fn events(State(state): State<AppState>, Query(q): Query<EventsQuery>) -> Response {
    let limit = q.limit.unwrap_or(100).clamp(1, 1000);
    let mut resp =
        axum::Json(state.recorder.events_json(q.session.as_deref(), limit)).into_response();
    apply_cors(&state.cfg, &mut resp);
    resp
}

// ---------------------------------------------------------------------------
// /debug/inspect — run the engine on one payload, no upstream involved
// ---------------------------------------------------------------------------

#[derive(serde::Deserialize)]
struct InspectRequest {
    /// Raw `function.arguments`, as a string or as an already-parsed object.
    arguments: Value,
    /// The tool's `function.parameters` JSON Schema (optional).
    schema: Option<Value>,
    #[serde(default = "default_tool_name")]
    tool: String,
}

fn default_tool_name() -> String {
    "unnamed_tool".to_string()
}

/// Answer "what would the proxy do with this?" without calling a model.
///
/// This is what makes the parser, the validator and the policy testable — and
/// visible — on their own, instead of only as a side effect of a live run.
async fn debug_inspect(State(state): State<AppState>, axum::Json(req): axum::Json<InspectRequest>) -> Response {
    let (raw_text, preparsed, was_object) = split_arguments(&req.arguments);

    let parsed = match &preparsed {
        Some(v) => Ok(v.clone()),
        None => repair::parse_tolerant(&raw_text),
    };

    let validator = req.schema.as_ref().and_then(validate::compile);

    let mut out = serde_json::json!({
        "tool": req.tool,
        "arguments_were_object": was_object,
        "raw": raw_text,
        "policy": format!("{:?}", state.cfg.policy),
    });
    let obj = out.as_object_mut().unwrap();

    match parsed {
        Err(msg) => {
            obj.insert("parse_ok".into(), Value::Bool(false));
            obj.insert("error".into(), Value::String(msg));
            obj.insert("violation".into(), Value::String("syntactic".into()));
            obj.insert(
                "decision".into(),
                decision_json(&state.cfg, &req.tool, Violation::Syntactic, validator.is_some()),
            );
        }
        Ok(v) => {
            obj.insert("parse_ok".into(), Value::Bool(true));
            obj.insert("parsed".into(), v.clone());
            obj.insert("recovered_by_tolerant_parse".into(), Value::Bool(
                preparsed.is_none() && serde_json::from_str::<Value>(raw_text.trim()).is_err(),
            ));
            match &validator {
                None => {
                    obj.insert("schema_valid".into(), Value::Null);
                    obj.insert("decision".into(), serde_json::json!({
                        "action": "left_no_schema",
                        "reason": "no schema supplied; well-formed JSON is all that can be checked"
                    }));
                }
                Some(val) => match validate::check(val, &v) {
                    Ok(()) => {
                        obj.insert("schema_valid".into(), Value::Bool(true));
                        obj.insert("decision".into(), serde_json::json!({
                            "action": if state.cfg.normalize { "normalized" } else { "passthrough" },
                            "reason": "valid on first sight"
                        }));
                    }
                    Err(f) => {
                        obj.insert("schema_valid".into(), Value::Bool(false));
                        obj.insert("error".into(), Value::String(f.message.clone()));
                        obj.insert("violation".into(), Value::String(f.violation.as_str().into()));
                        obj.insert("missing".into(), serde_json::json!(f.missing));
                        obj.insert(
                            "decision".into(),
                            decision_json(&state.cfg, &req.tool, f.violation, true),
                        );
                    }
                },
            }
        }
    }

    let mut resp = axum::Json(out).into_response();
    apply_cors(&state.cfg, &mut resp);
    resp
}

fn decision_json(cfg: &AppConfig, tool: &str, violation: Violation, has_schema: bool) -> Value {
    if !has_schema {
        return serde_json::json!({
            "action": "left_no_schema",
            "reason": "no usable schema to repair against"
        });
    }
    if !cfg.repair_enabled() {
        return serde_json::json!({
            "action": "left_by_policy",
            "reason": "repair is off (--repair-policy off): observing only"
        });
    }
    if violation == Violation::Fabricating && !cfg.may_fabricate(tool) {
        return serde_json::json!({
            "action": "left_by_policy",
            "reason": format!(
                "a required value is absent; repairing it under `{:?}` would invent one",
                cfg.policy
            )
        });
    }
    serde_json::json!({
        "action": "repair",
        "with_context": cfg.wants_context(),
        "reason": if violation == Violation::Fabricating {
            "missing value, but policy allows a context-assisted repair"
        } else {
            "the value is present and merely malformed: safe to correct"
        }
    })
}

// ---------------------------------------------------------------------------
// Chat completions
// ---------------------------------------------------------------------------

/// Pull the caller's Authorization header, if any.
fn caller_auth(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// `function.arguments` may arrive as a JSON *string* (the OpenAI wire format)
/// or as an already-parsed *object* (Ollama's native shape and some gateways).
/// Reading it with `as_str()` alone turns the latter into an empty string, which
/// the proxy then reports as malformed and may "repair" over the top of a
/// perfectly good call.
fn split_arguments(raw: &Value) -> (String, Option<Value>, bool) {
    match raw {
        Value::String(s) => (s.clone(), None, false),
        Value::Null => (String::new(), None, false),
        other => (other.to_string(), Some(other.clone()), true),
    }
}

/// Did the raw arguments need tolerant parsing to become JSON at all?
///
/// This is the line between "the model wrote valid JSON" and "the model wrote
/// prose with JSON inside it". The second case must always be rewritten — the
/// client cannot parse the raw bytes — while the first is left untouched unless
/// `--normalize` is on.
fn recovery_needed(raw: &str) -> bool {
    let t = raw.trim();
    if t.is_empty() || t.eq_ignore_ascii_case("null") {
        return false; // a no-argument tool, not a mangled payload
    }
    serde_json::from_str::<Value>(t).is_err()
}

/// Outcome of validating (and possibly repairing) a single tool call.
struct CallOutcome {
    /// Replacement arguments, if the call is to be rewritten at all.
    new_args: Option<Value>,
    record: ToolCallRecord,
    repair_ms: u64,
}

async fn chat_completions(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let started = Instant::now();
    Metrics::inc(&state.metrics.requests);

    let auth = caller_auth(&headers);
    if state.cfg.require_auth && auth.is_none() {
        Metrics::inc(&state.metrics.unauthorized);
        return (
            StatusCode::UNAUTHORIZED,
            axum::Json(serde_json::json!({
                "error": { "message": "missing Authorization header", "type": "unauthorized" }
            })),
        )
            .into_response();
    }

    // Parse the request; if it is not JSON we cannot help — just proxy it raw to
    // the default backend (no alias header can be honoured without a body).
    let req: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            let Some(t) = state.upstreams.resolve(None) else {
                return upstream_error("no upstream registered".into());
            };
            return passthrough(&state, &t, auth.as_deref(), body).await;
        }
    };

    let model = req
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let dialect = profiles::detect(&model);
    let is_stream = req.get("stream").and_then(Value::as_bool).unwrap_or(false);

    // Which backend serves this request. An unknown alias is an error, never a
    // silent fallback — otherwise a comparison run could attribute one model's
    // results to another without anyone noticing.
    let alias = headers
        .get(state.cfg.upstream_header.as_str())
        .and_then(|v| v.to_str().ok());
    let Some(target) = state.upstreams.resolve(alias) else {
        Metrics::inc(&state.metrics.unknown_upstream);
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({
                "error": {
                    "message": format!(
                        "unknown upstream alias `{}`; registered: {}",
                        alias.unwrap_or(""),
                        state.upstreams.list().iter().map(|e| e.alias.clone())
                            .collect::<Vec<_>>().join(", ")
                    ),
                    "type": "unknown_upstream"
                }
            })),
        )
            .into_response();
    };

    // Session correlation for in-harness measurement.
    let sess_hdr = headers
        .get(state.cfg.session_header.as_str())
        .and_then(|v| v.to_str().ok());
    let (session, turn) = state.recorder.resolve_session(&req, sess_hdr);
    let declared_turn = trace::assistant_count(&req);
    let tool_results_in = trace::tool_results_in(&req);
    let ctx = repair_context(&req);

    let common = Ctx {
        session,
        turn,
        declared_turn,
        model,
        target,
        dialect: dialect.to_string(),
        tool_results_in,
        ctx,
        started,
    };

    if is_stream {
        if state.cfg.repair_streaming {
            return stream_buffered(state, auth, body, req, common).await;
        }
        if state.cfg.measure_streaming {
            return stream_measured(state, auth, body, req, common).await;
        }
        Metrics::inc(&state.metrics.passthrough_stream);
        return passthrough(&state, &common.target, auth.as_deref(), body).await;
    }

    non_streaming(state, auth, req, common).await
}

/// Everything about a request that both the streaming and non-streaming paths need.
struct Ctx {
    session: String,
    turn: u32,
    declared_turn: u32,
    model: String,
    target: Target,
    dialect: String,
    tool_results_in: trace::ToolResultsIn,
    ctx: RepairContext,
    started: Instant,
}

// ---------------------------------------------------------------------------
// Non-streaming path
// ---------------------------------------------------------------------------

async fn non_streaming(state: AppState, auth: Option<String>, req: Value, c: Ctx) -> Response {
    let schemas = extract_tool_schemas(&req);

    let mut resp = match upstream::post_json(&state.http, &c.target, auth.as_deref(), &req).await {
        Ok(v) => v,
        Err(e) => {
            Metrics::inc(&state.metrics.upstream_errors);
            warn!(error = %e, session = %c.session, turn = c.turn, "upstream request failed");
            return (
                StatusCode::BAD_GATEWAY,
                axum::Json(serde_json::json!({
                    "error": { "message": e.to_string(), "type": "upstream_error" }
                })),
            )
                .into_response();
        }
    };

    let mut records: Vec<ToolCallRecord> = Vec::new();
    let mut repair_ms = 0u64;

    let n_choices = resp
        .get("choices")
        .and_then(Value::as_array)
        .map(|a| a.len())
        .unwrap_or(0);

    for ci in 0..n_choices {
        let n_tc = resp["choices"][ci]["message"]["tool_calls"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0);

        for ti in 0..n_tc {
            let tc = &resp["choices"][ci]["message"]["tool_calls"][ti];
            let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
            let (raw_text, preparsed, was_object) = split_arguments(&tc["function"]["arguments"]);

            let outcome = ensure_valid(
                &state,
                &c,
                &name,
                &raw_text,
                preparsed.as_ref(),
                &schemas,
                auth.as_deref(),
            )
            .await;
            repair_ms += outcome.repair_ms;

            if let Some(fixed) = &outcome.new_args {
                // Give the arguments back in the shape they arrived in; changing
                // a string into an object (or vice versa) breaks the client.
                resp["choices"][ci]["message"]["tool_calls"][ti]["function"]["arguments"] =
                    if was_object {
                        fixed.clone()
                    } else {
                        Value::String(repair::canonical(fixed))
                    };
            }
            records.push(outcome.record);
        }
    }

    let finish_reason = resp["choices"][0]["finish_reason"]
        .as_str()
        .map(str::to_string);
    let content_len = resp["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.trim().len())
        .unwrap_or(0);

    let event = RequestEvent {
        ts_ms: trace::now_ms(),
        session: c.session.clone(),
        turn: c.turn,
        declared_turn: c.declared_turn,
        model: c.model.clone(),
        upstream: c.target.alias.clone(),
        dialect: c.dialect.clone(),
        stream: false,
        tool_results_in: c.tool_results_in,
        reached_final: is_final(&records, finish_reason.as_deref(), content_len),
        tool_calls: records,
        finish_reason,
        duration_ms: c.started.elapsed().as_millis() as u64,
        repair_ms,
    };
    state.metrics.request_latency.observe(event.duration_ms);
    if repair_ms > 0 {
        state.metrics.repair_latency.observe(repair_ms);
    }
    state.recorder.record(&event, c.declared_turn);

    axum::Json(resp).into_response()
}

/// A response is a genuine final answer only if it stopped on purpose and
/// actually said something. A truncated or empty response is not "the model
/// finished the task" — counting it as one inflates the recovery metric.
fn is_final(records: &[ToolCallRecord], finish_reason: Option<&str>, content_len: usize) -> bool {
    records.is_empty() && finish_reason == Some("stop") && content_len > 0
}

// ---------------------------------------------------------------------------
// Streaming: measure without touching the bytes
// ---------------------------------------------------------------------------

async fn stream_measured(
    state: AppState,
    auth: Option<String>,
    body: Bytes,
    req: Value,
    c: Ctx,
) -> Response {
    let raw_schemas = raw_tool_schemas(&req);

    let upstream_resp = match upstream::send_raw(&state.http, &c.target, auth.as_deref(), body).await {
        Ok(r) => r,
        Err(e) => {
            Metrics::inc(&state.metrics.upstream_errors);
            return upstream_error(e.to_string());
        }
    };

    let status = StatusCode::from_u16(upstream_resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = upstream_resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("text/event-stream")
        .to_string();

    Metrics::inc(&state.metrics.stream_measured);

    let probe = Probe {
        acc: Accumulator::new(),
        state: state.clone(),
        ctx: c,
        schemas: raw_schemas,
        done: false,
    };

    let byte_stream = Box::pin(upstream_resp.bytes_stream());
    let observed = futures_util::stream::unfold(
        (byte_stream, probe),
        |(mut s, mut probe)| async move {
            match s.next().await {
                Some(Ok(chunk)) => {
                    probe.acc.feed(&chunk);
                    Some((Ok(chunk), (s, probe)))
                }
                Some(Err(e)) => Some((Err(e), (s, probe))),
                None => {
                    probe.finalize();
                    None
                }
            }
        },
    );

    let mut out = Response::new(Body::from_stream(observed));
    *out.status_mut() = status;
    if let Ok(ct) = content_type.parse() {
        out.headers_mut().insert(header::CONTENT_TYPE, ct);
    }
    out
}

/// Rides along with a streamed response and records what it contained.
///
/// Finalizes on end-of-stream, and via `Drop` if the client disconnects early —
/// a half-finished run is still data about how the model behaves.
struct Probe {
    acc: Accumulator,
    state: AppState,
    ctx: Ctx,
    schemas: HashMap<String, Value>,
    done: bool,
}

impl Probe {
    fn finalize(&mut self) {
        if self.done {
            return;
        }
        self.done = true;

        let assembled = std::mem::take(&mut self.acc).finish();
        let mut records = Vec::new();

        for call in &assembled.calls {
            Metrics::inc(&self.state.metrics.tool_calls);
            let compiled = self.schemas.get(&call.name).and_then(validate::compile);
            let record = observe_only(&self.state, &call.name, &call.arguments, compiled.as_ref());
            records.push(record);
        }

        let event = RequestEvent {
            ts_ms: trace::now_ms(),
            session: self.ctx.session.clone(),
            turn: self.ctx.turn,
            declared_turn: self.ctx.declared_turn,
            model: if assembled.model.is_empty() {
                self.ctx.model.clone()
            } else {
                assembled.model.clone()
            },
            upstream: self.ctx.target.alias.clone(),
            dialect: self.ctx.dialect.clone(),
            stream: true,
            tool_results_in: self.ctx.tool_results_in,
            reached_final: is_final(
                &records,
                assembled.finish_reason.as_deref(),
                assembled.content_chars,
            ),
            tool_calls: records,
            finish_reason: assembled.finish_reason.clone(),
            duration_ms: self.ctx.started.elapsed().as_millis() as u64,
            repair_ms: 0,
        };
        self.state.metrics.request_latency.observe(event.duration_ms);
        self.state.recorder.record(&event, self.ctx.declared_turn);
    }
}

impl Drop for Probe {
    fn drop(&mut self) {
        self.finalize();
    }
}

/// Validate a call and report it, without repairing anything.
fn observe_only(
    state: &AppState,
    name: &str,
    raw: &str,
    validator: Option<&Validator>,
) -> ToolCallRecord {
    let recovered = recovery_needed(raw);
    if recovered {
        Metrics::inc(&state.metrics.recovered);
    }
    let mut rec = ToolCallRecord {
        function: name.to_string(),
        parse_ok: true,
        recovered,
        schema_valid: true,
        violation: None,
        missing: vec![],
        repaired: false,
        fabricated: vec![],
        action: if recovered { Action::Recovered } else { Action::Passthrough },
        error: None,
    };

    let parsed = match repair::parse_tolerant(raw) {
        Ok(v) => v,
        Err(msg) => {
            Metrics::inc(&state.metrics.malformed);
            rec.parse_ok = false;
            rec.schema_valid = false;
            rec.violation = Some(Violation::Syntactic);
            rec.action = Action::LeftByPolicy;
            rec.error = Some(msg);
            return rec;
        }
    };

    let Some(v) = validator else {
        rec.action = Action::LeftNoSchema;
        return rec;
    };

    if let Err(f) = validate::check(v, &parsed) {
        Metrics::inc(&state.metrics.malformed);
        if f.violation == Violation::Fabricating {
            Metrics::inc(&state.metrics.malformed_fabricating);
        }
        rec.schema_valid = false;
        rec.violation = Some(f.violation);
        rec.missing = f.missing;
        rec.action = Action::LeftByPolicy;
        rec.error = Some(f.message);
    }
    rec
}

// ---------------------------------------------------------------------------
// Streaming: buffer tool-call responses so they can be repaired
// ---------------------------------------------------------------------------

async fn stream_buffered(
    state: AppState,
    auth: Option<String>,
    body: Bytes,
    req: Value,
    c: Ctx,
) -> Response {
    let schemas = extract_tool_schemas(&req);

    let upstream_resp = match upstream::send_raw(&state.http, &c.target, auth.as_deref(), body).await {
        Ok(r) => r,
        Err(e) => {
            Metrics::inc(&state.metrics.upstream_errors);
            return upstream_error(e.to_string());
        }
    };
    let status = StatusCode::from_u16(upstream_resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let raw = match upstream_resp.bytes().await {
        Ok(b) => b,
        Err(e) => {
            Metrics::inc(&state.metrics.upstream_errors);
            return upstream_error(e.to_string());
        }
    };

    let mut acc = Accumulator::new();
    acc.feed(&raw);
    let assembled = acc.finish();

    // No tool calls: nothing to repair, replay verbatim.
    if assembled.calls.is_empty() {
        Metrics::inc(&state.metrics.stream_measured);
        let event = build_stream_event(&c, &assembled, Vec::new(), 0);
        state.metrics.request_latency.observe(event.duration_ms);
        state.recorder.record(&event, c.declared_turn);
        return sse_response(status, raw);
    }

    Metrics::inc(&state.metrics.stream_repaired);

    let mut records = Vec::new();
    let mut fixed: Vec<StreamedCall> = Vec::new();
    let mut changed = false;
    let mut repair_ms = 0u64;

    for call in &assembled.calls {
        let outcome = ensure_valid(
            &state,
            &c,
            &call.name,
            &call.arguments,
            None,
            &schemas,
            auth.as_deref(),
        )
        .await;
        repair_ms += outcome.repair_ms;

        let mut out = call.clone();
        if let Some(v) = &outcome.new_args {
            out.arguments = repair::canonical(v);
            changed = true;
        }
        fixed.push(out);
        records.push(outcome.record);
    }

    let event = build_stream_event(&c, &assembled, records, repair_ms);
    state.metrics.request_latency.observe(event.duration_ms);
    if repair_ms > 0 {
        state.metrics.repair_latency.observe(repair_ms);
    }
    state.recorder.record(&event, c.declared_turn);

    if changed {
        sse_response(status, Bytes::from(sse::render_tool_call_stream(&assembled, &fixed)))
    } else {
        sse_response(status, raw)
    }
}

fn build_stream_event(
    c: &Ctx,
    assembled: &sse::Assembled,
    records: Vec<ToolCallRecord>,
    repair_ms: u64,
) -> RequestEvent {
    RequestEvent {
        ts_ms: trace::now_ms(),
        session: c.session.clone(),
        turn: c.turn,
        declared_turn: c.declared_turn,
        model: if assembled.model.is_empty() {
            c.model.clone()
        } else {
            assembled.model.clone()
        },
        upstream: c.target.alias.clone(),
        dialect: c.dialect.clone(),
        stream: true,
        tool_results_in: c.tool_results_in,
        reached_final: is_final(
            &records,
            assembled.finish_reason.as_deref(),
            assembled.content_chars,
        ),
        tool_calls: records,
        finish_reason: assembled.finish_reason.clone(),
        duration_ms: c.started.elapsed().as_millis() as u64,
        repair_ms,
    }
}

fn sse_response(status: StatusCode, body: Bytes) -> Response {
    let mut out = Response::new(Body::from(body));
    *out.status_mut() = status;
    out.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream"),
    );
    out.headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    out
}

fn upstream_error(message: String) -> Response {
    (
        StatusCode::BAD_GATEWAY,
        axum::Json(serde_json::json!({
            "error": { "message": message, "type": "upstream_error" }
        })),
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// The engine: validate, decide, repair
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
async fn ensure_valid(
    state: &AppState,
    c: &Ctx,
    name: &str,
    raw_text: &str,
    preparsed: Option<&Value>,
    schemas: &Schemas,
    auth: Option<&str>,
) -> CallOutcome {
    Metrics::inc(&state.metrics.tool_calls);

    let recovered = preparsed.is_none() && recovery_needed(raw_text);
    if recovered {
        Metrics::inc(&state.metrics.recovered);
    }

    let mut rec = ToolCallRecord {
        function: name.to_string(),
        parse_ok: true,
        recovered,
        schema_valid: true,
        violation: None,
        missing: vec![],
        repaired: false,
        fabricated: vec![],
        action: Action::Passthrough,
        error: None,
    };

    let schema_entry = schemas.get(name);

    // --- first sight -------------------------------------------------------
    let (parsed, failure): (Option<Value>, Option<Failure>) = match preparsed {
        Some(v) => (Some(v.clone()), None),
        None => match repair::parse_tolerant(raw_text) {
            Ok(v) => (Some(v), None),
            Err(msg) => (None, Some(Failure::parse(msg))),
        },
    };

    let failure = match (&parsed, failure) {
        (_, Some(f)) => Some(f),
        (Some(v), None) => match schema_entry {
            Some((validator, _)) => validate::check(validator, v).err(),
            // No schema to validate against — well-formed is all we can ask.
            None => None,
        },
        (None, None) => None,
    };

    let Some(failure) = failure else {
        let v = parsed.expect("valid call always parses");

        // Recovered payloads MUST be rewritten: the raw bytes are prose the
        // client cannot parse. Already-valid JSON is left byte-for-byte unless
        // `--normalize` asks otherwise.
        if recovered {
            rec.action = Action::Recovered;
            return CallOutcome { new_args: Some(v), record: rec, repair_ms: 0 };
        }
        if state.cfg.normalize {
            rec.action = Action::Normalized;
            return CallOutcome { new_args: Some(v), record: rec, repair_ms: 0 };
        }
        if schema_entry.is_none() {
            rec.action = Action::LeftNoSchema;
        }
        return CallOutcome { new_args: None, record: rec, repair_ms: 0 };
    };

    // --- malformed ---------------------------------------------------------
    Metrics::inc(&state.metrics.malformed);
    if failure.violation == Violation::Fabricating {
        Metrics::inc(&state.metrics.malformed_fabricating);
    }
    rec.parse_ok = parsed.is_some();
    rec.schema_valid = false;
    rec.violation = Some(failure.violation);
    rec.missing = failure.missing.clone();
    rec.error = Some(failure.message.clone());
    warn!(
        function = name,
        dialect = %c.dialect,
        session = %c.session,
        turn = c.turn,
        violation = failure.violation.as_str(),
        error = %failure.message,
        "malformed tool call"
    );

    // When we decline to repair we still hand back parseable bytes if tolerant
    // parsing produced any: refusing to invent a value is not a reason to also
    // hand the client prose it cannot read.
    let salvage = if recovered { parsed.clone() } else { None };

    let Some((validator, raw_schema)) = schema_entry else {
        Metrics::inc(&state.metrics.repair_skipped_no_schema);
        rec.action = Action::LeftNoSchema;
        return CallOutcome { new_args: salvage, record: rec, repair_ms: 0 };
    };

    if !state.cfg.repair_enabled()
        || (failure.violation == Violation::Fabricating && !state.cfg.may_fabricate(name))
    {
        // The decisive case: a required value is simply not there. Repairing it
        // context-free would have the model invent one, turning a loud failure
        // into a silent wrong action. Report it instead.
        Metrics::inc(&state.metrics.repair_skipped_by_policy);
        rec.action = Action::LeftByPolicy;
        return CallOutcome { new_args: salvage, record: rec, repair_ms: 0 };
    }

    // --- repair ------------------------------------------------------------
    let repair_started = Instant::now();
    Metrics::inc(&state.metrics.repair_attempted);

    let ctx = if state.cfg.wants_context() {
        c.ctx.clone()
    } else {
        RepairContext::default()
    };

    let mut last_error = failure.message.clone();
    for attempt in 1..=state.cfg.max_repair_attempts {
        let req = repair::build_repair_request(
            &c.model,
            name,
            raw_text,
            raw_schema,
            &last_error,
            &ctx,
        );
        let corrected_text = match upstream::post_json(&state.http, &c.target, auth, &req).await {
            Ok(resp) => resp["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("")
                .to_string(),
            Err(e) => {
                Metrics::inc(&state.metrics.upstream_errors);
                warn!(error = %e, attempt, session = %c.session, "repair upstream call failed");
                continue;
            }
        };

        match repair::parse_tolerant(&corrected_text) {
            Ok(v) => {
                if repair::is_unrecoverable(&v) {
                    Metrics::inc(&state.metrics.repair_declined);
                    info!(function = name, session = %c.session, "model declined to invent a value");
                    rec.action = Action::Declined;
                    return CallOutcome {
                        new_args: salvage,
                        record: rec,
                        repair_ms: repair_started.elapsed().as_millis() as u64,
                    };
                }
                match validate::check(validator, &v) {
                    Ok(()) => {
                        Metrics::inc(&state.metrics.repaired);
                        let fabricated =
                            repair::fabricated_fields(raw_text, parsed.as_ref(), &v, &ctx);
                        if !fabricated.is_empty() {
                            Metrics::inc(&state.metrics.repair_fabricated);
                            warn!(
                                function = name,
                                session = %c.session,
                                fields = ?fabricated,
                                "repair introduced values found nowhere in the call or context"
                            );
                        }
                        info!(function = name, attempt, session = %c.session, turn = c.turn, "tool call repaired");
                        rec.repaired = true;
                        rec.fabricated = fabricated;
                        rec.action = Action::Repaired;
                        rec.error = None;
                        return CallOutcome {
                            new_args: Some(v),
                            record: rec,
                            repair_ms: repair_started.elapsed().as_millis() as u64,
                        };
                    }
                    Err(f) => last_error = f.message,
                }
            }
            Err(e) => last_error = e,
        }
    }

    Metrics::inc(&state.metrics.repair_exhausted);
    warn!(function = name, session = %c.session, turn = c.turn, error = %last_error, "tool call repair exhausted");
    rec.action = Action::RepairFailed;
    rec.error = Some(last_error);
    CallOutcome {
        new_args: salvage,
        record: rec,
        repair_ms: repair_started.elapsed().as_millis() as u64,
    }
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/// The little conversation context a contextual repair is allowed to see.
fn repair_context(req: &Value) -> RepairContext {
    let Some(msgs) = req.get("messages").and_then(Value::as_array) else {
        return RepairContext::default();
    };
    let text = |m: &Value| match m.get("content") {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Array(parts)) => Some(
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join(" "),
        ),
        _ => None,
    };
    let role_is = |m: &Value, r: &str| m.get("role").and_then(Value::as_str) == Some(r);

    RepairContext {
        user_task: msgs.iter().rev().find(|m| role_is(m, "user")).and_then(text),
        last_tool_result: msgs
            .iter()
            .rev()
            .find(|m| role_is(m, "tool") || role_is(m, "function"))
            .and_then(text),
    }
}

/// Build a `name -> (validator, raw_schema)` map from the request's `tools`.
fn extract_tool_schemas(req: &Value) -> Schemas {
    let mut map = HashMap::new();
    for (name, params) in raw_tool_schemas(req) {
        if let Some(validator) = validate::compile(&params) {
            map.insert(name, (validator, params));
        }
    }
    map
}

/// Same, but leaving the schemas uncompiled — cheap to carry across a stream.
fn raw_tool_schemas(req: &Value) -> HashMap<String, Value> {
    let mut map = HashMap::new();
    let Some(tools) = req.get("tools").and_then(Value::as_array) else {
        return map;
    };
    for tool in tools {
        if tool.get("type").and_then(Value::as_str) != Some("function") {
            continue;
        }
        let func = &tool["function"];
        let Some(name) = func.get("name").and_then(Value::as_str) else {
            continue;
        };
        let Some(params) = func.get("parameters") else {
            continue;
        };
        map.insert(name.to_string(), params.clone());
    }
    map
}

/// Raw proxy for streaming / non-JSON requests: forward bytes, stream back.
async fn passthrough(state: &AppState, target: &Target, auth: Option<&str>, body: Bytes) -> Response {
    match upstream::send_raw(&state.http, target, auth, body).await {
        Ok(resp) => {
            let status =
                StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let content_type = resp
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/json")
                .to_string();
            let stream = resp.bytes_stream();
            let mut out = Response::new(Body::from_stream(stream));
            *out.status_mut() = status;
            if let Ok(ct) = content_type.parse() {
                out.headers_mut().insert(header::CONTENT_TYPE, ct);
            }
            out
        }
        Err(e) => {
            Metrics::inc(&state.metrics.upstream_errors);
            upstream_error(e.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn object_arguments_are_not_read_as_empty() {
        // Ollama's native shape. The old `.as_str().unwrap_or("")` turned this
        // into "" — reported malformed, and possibly overwritten by a "repair".
        let (text, preparsed, was_object) = split_arguments(&json!({"location": "Seoul"}));
        assert!(was_object);
        assert_eq!(preparsed, Some(json!({"location": "Seoul"})));
        assert_eq!(text, r#"{"location":"Seoul"}"#);

        let (text, preparsed, was_object) = split_arguments(&json!("{\"a\":1}"));
        assert!(!was_object);
        assert!(preparsed.is_none());
        assert_eq!(text, "{\"a\":1}");
    }

    #[test]
    fn truncated_response_is_not_a_final_answer() {
        assert!(is_final(&[], Some("stop"), 12));
        assert!(!is_final(&[], Some("length"), 12), "truncated ≠ finished");
        assert!(!is_final(&[], Some("stop"), 0), "empty ≠ finished");
        assert!(!is_final(&[], None, 12));
    }

    #[test]
    fn repair_context_picks_the_latest_user_and_tool_messages() {
        let req = json!({"messages":[
            {"role":"user","content":"first"},
            {"role":"assistant","content":null},
            {"role":"tool","content":"{\"temp\":21}"},
            {"role":"user","content":"weather in Seoul in celsius"}
        ]});
        let ctx = repair_context(&req);
        assert_eq!(ctx.user_task.as_deref(), Some("weather in Seoul in celsius"));
        assert_eq!(ctx.last_tool_result.as_deref(), Some("{\"temp\":21}"));
    }
}
