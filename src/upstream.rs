//! Thin client for the upstream OpenAI-compatible endpoint.

use anyhow::{Context, Result};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde_json::Value;

use crate::config::AppConfig;

/// Compose the chat-completions URL from the configured base.
fn chat_url(cfg: &AppConfig) -> String {
    format!("{}/chat/completions", cfg.upstream_base)
}

/// Apply the caller's `Authorization` if present, else fall back to the
/// configured API key.
fn auth(
    rb: reqwest::RequestBuilder,
    cfg: &AppConfig,
    caller_auth: Option<&str>,
) -> reqwest::RequestBuilder {
    if let Some(a) = caller_auth {
        rb.header(AUTHORIZATION, a)
    } else if let Some(k) = &cfg.api_key {
        rb.bearer_auth(k)
    } else {
        rb
    }
}

/// POST a JSON body and parse the JSON response (non-streaming).
pub async fn post_json(
    client: &reqwest::Client,
    cfg: &AppConfig,
    caller_auth: Option<&str>,
    body: &Value,
) -> Result<Value> {
    let rb = client
        .post(chat_url(cfg))
        .header(CONTENT_TYPE, "application/json")
        .json(body);
    let resp = auth(rb, cfg, caller_auth)
        .send()
        .await
        .context("upstream request failed")?;
    let status = resp.status();
    let text = resp.text().await.context("reading upstream body")?;
    if !status.is_success() {
        anyhow::bail!("upstream returned {status}: {text}");
    }
    serde_json::from_str(&text).context("parsing upstream JSON")
}

/// Send a request and hand back the raw streaming response for passthrough.
pub async fn send_raw(
    client: &reqwest::Client,
    cfg: &AppConfig,
    caller_auth: Option<&str>,
    body: bytes::Bytes,
) -> Result<reqwest::Response> {
    let rb = client
        .post(chat_url(cfg))
        .header(CONTENT_TYPE, "application/json")
        .body(body);
    auth(rb, cfg, caller_auth)
        .send()
        .await
        .context("upstream request failed")
}
