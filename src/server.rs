//! HTTP surface: OpenAI-compatible `/v1/chat/completions` plus health/metrics/sessions.

use std::collections::HashMap;
use std::sync::Arc;

use axum::{
    Router,
    body::{Body, Bytes},
    extract::{Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use jsonschema::Validator;
use serde_json::Value;
use tracing::{info, warn};

use crate::config::AppConfig;
use crate::telemetry::Metrics;
use crate::trace::{self, Recorder, RequestEvent, ToolCallRecord};
use crate::{profiles, repair, upstream, validate};

/// Shared application state.
pub struct AppInner {
    pub cfg: AppConfig,
    pub http: reqwest::Client,
    pub metrics: Metrics,
    pub recorder: Recorder,
}

pub type AppState = Arc<AppInner>;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .route("/sessions", get(sessions))
        .route("/v1/chat/completions", post(chat_completions))
        .with_state(state)
}

async fn health() -> &'static str {
    "ok"
}

#[derive(serde::Deserialize)]
struct MetricsQuery {
    format: Option<String>,
}

async fn metrics(State(state): State<AppState>, Query(q): Query<MetricsQuery>) -> Response {
    if q.format.as_deref() == Some("json") {
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
    }
}

/// Per-session in-harness behavior rollup.
async fn sessions(State(state): State<AppState>) -> Response {
    axum::Json(state.recorder.sessions_json()).into_response()
}

/// Pull the caller's Authorization header, if any.
fn caller_auth(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

/// Outcome of validating (and possibly repairing) a single tool call — carries
/// both the rewrite decision and the observation used by the sensor.
struct CallOutcome {
    /// New arguments string to write back (normalized or repaired), if any.
    new_args: Option<String>,
    /// Arguments parsed as JSON (possibly after tolerant recovery).
    parse_ok: bool,
    /// Valid against the schema on first sight (true when there is no schema).
    schema_valid_first: bool,
    /// A repair was performed.
    repaired: bool,
    /// First-sight error, if the call was malformed/invalid.
    error: Option<String>,
}

async fn chat_completions(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    Metrics::inc(&state.metrics.requests);
    let auth = caller_auth(&headers);

    // Parse the request; if it is not JSON we cannot help — just proxy it raw.
    let req: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => return passthrough(&state, auth.as_deref(), body).await,
    };

    // Streaming is passed through untouched (repair/measurement need the full response).
    if req.get("stream").and_then(Value::as_bool).unwrap_or(false) {
        Metrics::inc(&state.metrics.passthrough_stream);
        return passthrough(&state, auth.as_deref(), body).await;
    }

    let model = req
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let dialect = profiles::detect(&model);
    let schemas = extract_tool_schemas(&req);

    // Session correlation for in-harness measurement.
    let sess_hdr = headers
        .get(state.cfg.session_header.as_str())
        .and_then(|v| v.to_str().ok());
    let session = trace::session_key(&req, sess_hdr);
    let turn = trace::turn_index(&req);
    let tool_results_in = trace::tool_results_in(&req);

    // Forward the (unmodified) request to the upstream.
    let mut resp = match upstream::post_json(&state.http, &state.cfg, auth.as_deref(), &req).await {
        Ok(v) => v,
        Err(e) => {
            Metrics::inc(&state.metrics.upstream_errors);
            warn!(error = %e, session, turn, "upstream request failed");
            return (
                StatusCode::BAD_GATEWAY,
                axum::Json(serde_json::json!({
                    "error": { "message": e.to_string(), "type": "upstream_error" }
                })),
            )
                .into_response();
        }
    };

    // Walk every tool call: validate/repair in place, and record the observation.
    let mut records: Vec<ToolCallRecord> = Vec::new();
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
            let args = tc["function"]["arguments"].as_str().unwrap_or("").to_string();

            let outcome = ensure_valid(
                &state,
                &model,
                dialect,
                &session,
                turn,
                &name,
                &args,
                &schemas,
                auth.as_deref(),
            )
            .await;

            if let Some(fixed) = &outcome.new_args {
                resp["choices"][ci]["message"]["tool_calls"][ti]["function"]["arguments"] =
                    Value::String(fixed.clone());
            }

            records.push(ToolCallRecord {
                function: name,
                parse_ok: outcome.parse_ok,
                schema_valid: outcome.schema_valid_first,
                repaired: outcome.repaired,
                error: outcome.error,
            });
        }
    }

    let reached_final = records.is_empty();
    state.recorder.record(&RequestEvent {
        ts_ms: trace::now_ms(),
        session,
        turn,
        model,
        dialect: dialect.to_string(),
        tool_results_in,
        tool_calls: records,
        reached_final,
    });

    axum::Json(resp).into_response()
}

/// Validate a single tool call and, if needed, repair it.
#[allow(clippy::too_many_arguments)]
async fn ensure_valid(
    state: &AppState,
    model: &str,
    dialect: &str,
    session: &str,
    turn: u32,
    name: &str,
    args: &str,
    schemas: &HashMap<String, (Validator, Value)>,
    auth: Option<&str>,
) -> CallOutcome {
    Metrics::inc(&state.metrics.tool_calls);
    let schema_entry = schemas.get(name);

    // First sight: try to parse and validate.
    let (parse_ok, first_error) = match repair::parse_tolerant(args) {
        Ok(v) => match schema_entry {
            Some((validator, _)) => match validate::check(validator, &v) {
                Ok(()) => {
                    return CallOutcome {
                        new_args: Some(repair::canonical(&v)),
                        parse_ok: true,
                        schema_valid_first: true,
                        repaired: false,
                        error: None,
                    };
                }
                Err(e) => (true, e),
            },
            None => {
                // No schema to validate against — well-formed is enough.
                return CallOutcome {
                    new_args: Some(repair::canonical(&v)),
                    parse_ok: true,
                    schema_valid_first: true,
                    repaired: false,
                    error: None,
                };
            }
        },
        Err(e) => (false, e),
    };

    // Malformed or schema-invalid on first sight.
    Metrics::inc(&state.metrics.malformed);
    warn!(function = name, dialect, session, turn, error = %first_error, "malformed tool call");

    let (validator, raw_schema) = match schema_entry {
        Some(entry) if state.cfg.repair_enabled => entry,
        // No schema to repair against, or repair disabled: observe only.
        _ => {
            Metrics::inc(&state.metrics.repair_failed);
            return CallOutcome {
                new_args: None,
                parse_ok,
                schema_valid_first: false,
                repaired: false,
                error: Some(first_error),
            };
        }
    };

    let mut last_error = first_error;
    for attempt in 1..=state.cfg.max_repair_attempts {
        let req = repair::build_repair_request(model, name, args, raw_schema, &last_error);
        let corrected_text = match upstream::post_json(&state.http, &state.cfg, auth, &req).await {
            Ok(resp) => resp["choices"][0]["message"]["content"]
                .as_str()
                .unwrap_or("")
                .to_string(),
            Err(e) => {
                Metrics::inc(&state.metrics.upstream_errors);
                warn!(error = %e, attempt, session, "repair upstream call failed");
                continue;
            }
        };

        match repair::parse_tolerant(&corrected_text) {
            Ok(v) => match validate::check(validator, &v) {
                Ok(()) => {
                    Metrics::inc(&state.metrics.repaired);
                    info!(function = name, attempt, session, turn, "tool call repaired");
                    return CallOutcome {
                        new_args: Some(repair::canonical(&v)),
                        parse_ok: true,
                        schema_valid_first: false,
                        repaired: true,
                        error: None,
                    };
                }
                Err(e) => last_error = e,
            },
            Err(e) => last_error = e,
        }
    }

    Metrics::inc(&state.metrics.repair_failed);
    warn!(function = name, session, turn, error = %last_error, "tool call repair exhausted");
    CallOutcome {
        new_args: None,
        parse_ok,
        schema_valid_first: false,
        repaired: false,
        error: Some(last_error),
    }
}

/// Build a `name -> (validator, raw_schema)` map from the request's `tools`.
fn extract_tool_schemas(req: &Value) -> HashMap<String, (Validator, Value)> {
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
        if let Some(validator) = validate::compile(params) {
            map.insert(name.to_string(), (validator, params.clone()));
        }
    }
    map
}

/// Raw proxy for streaming / non-JSON requests: forward bytes, stream back.
async fn passthrough(state: &AppState, auth: Option<&str>, body: Bytes) -> Response {
    match upstream::send_raw(&state.http, &state.cfg, auth, body).await {
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
            (
                StatusCode::BAD_GATEWAY,
                axum::Json(serde_json::json!({
                    "error": { "message": e.to_string(), "type": "upstream_error" }
                })),
            )
                .into_response()
        }
    }
}
