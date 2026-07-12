//! HTTP surface: OpenAI-compatible `/v1/chat/completions` plus health/metrics.

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
use crate::{profiles, repair, upstream, validate};

/// Shared application state.
pub struct AppInner {
    pub cfg: AppConfig,
    pub http: reqwest::Client,
    pub metrics: Metrics,
}

pub type AppState = Arc<AppInner>;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics))
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
        axum::Json(state.metrics.snapshot()).into_response()
    } else {
        (
            [(header::CONTENT_TYPE, "text/plain; version=0.0.4")],
            state.metrics.prometheus(),
        )
            .into_response()
    }
}

/// Pull the caller's Authorization header, if any.
fn caller_auth(headers: &HeaderMap) -> Option<String> {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
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

    // Streaming is passed through untouched (repair needs the full response).
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

    // Forward the (unmodified) request to the upstream.
    let mut resp = match upstream::post_json(&state.http, &state.cfg, auth.as_deref(), &req).await {
        Ok(v) => v,
        Err(e) => {
            Metrics::inc(&state.metrics.upstream_errors);
            warn!(error = %e, "upstream request failed");
            return (
                StatusCode::BAD_GATEWAY,
                axum::Json(serde_json::json!({
                    "error": { "message": e.to_string(), "type": "upstream_error" }
                })),
            )
                .into_response();
        }
    };

    // Walk every tool call and validate/repair it in place.
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

            if let Some(fixed) = ensure_valid(&state, &model, dialect, &name, &args, &schemas, auth.as_deref()).await {
                resp["choices"][ci]["message"]["tool_calls"][ti]["function"]["arguments"] =
                    Value::String(fixed);
            }
        }
    }

    axum::Json(resp).into_response()
}

/// Validate a single tool call and, if needed, repair it.
///
/// Returns `Some(new_arguments_string)` when the arguments should be rewritten
/// (normalized or repaired), or `None` to leave them unchanged.
#[allow(clippy::too_many_arguments)]
async fn ensure_valid(
    state: &AppState,
    model: &str,
    dialect: &str,
    name: &str,
    args: &str,
    schemas: &HashMap<String, (Validator, Value)>,
    auth: Option<&str>,
) -> Option<String> {
    Metrics::inc(&state.metrics.tool_calls);
    let schema_entry = schemas.get(name);

    // First sight: try to parse and validate.
    let first_error: String = match repair::parse_tolerant(args) {
        Ok(v) => match schema_entry {
            Some((validator, _)) => match validate::check(validator, &v) {
                Ok(()) => return Some(repair::canonical(&v)), // valid; normalize
                Err(e) => e,
            },
            None => return Some(repair::canonical(&v)), // no schema; well-formed
        },
        Err(e) => e,
    };

    // Malformed or schema-invalid.
    Metrics::inc(&state.metrics.malformed);
    warn!(function = name, dialect, error = %first_error, "malformed tool call");

    let (validator, raw_schema) = match schema_entry {
        Some(entry) if state.cfg.repair_enabled => entry,
        // No schema to repair against, or repair disabled.
        _ => {
            Metrics::inc(&state.metrics.repair_failed);
            return None;
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
                warn!(error = %e, attempt, "repair upstream call failed");
                continue;
            }
        };

        match repair::parse_tolerant(&corrected_text) {
            Ok(v) => match validate::check(validator, &v) {
                Ok(()) => {
                    Metrics::inc(&state.metrics.repaired);
                    info!(function = name, attempt, "tool call repaired");
                    return Some(repair::canonical(&v));
                }
                Err(e) => last_error = e,
            },
            Err(e) => last_error = e,
        }
    }

    Metrics::inc(&state.metrics.repair_failed);
    warn!(function = name, error = %last_error, "tool call repair exhausted");
    None
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
        // Absent parameters => accept anything (no validator).
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
            let status = StatusCode::from_u16(resp.status().as_u16())
                .unwrap_or(StatusCode::BAD_GATEWAY);
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
