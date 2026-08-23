//! Upstream registry and client.
//!
//! A measurement proxy that can only ever talk to one backend cannot answer the
//! question people actually have — *which* model behaves best inside my harness.
//! So upstreams are a registry: several named entries, one selected per request
//! by an alias header, all sharing the same policy, the same parser and the same
//! metrics. That is what makes a comparison honest.
//!
//! The header carries an **alias**, never a URL. A proxy that forwarded requests
//! to any address a caller names is an SSRF gadget; resolving aliases against a
//! registry the operator controls closes that off. Adding entries at runtime is
//! gated behind `--allow-admin` for the same reason.

use std::sync::RwLock;

use anyhow::{Context, Result};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Serialize;
use serde_json::Value;

/// A resolved place to send a request.
#[derive(Debug, Clone)]
pub struct Target {
    pub alias: String,
    pub base: String,
    pub api_key: Option<String>,
}

/// One registered upstream.
#[derive(Debug, Clone, Serialize)]
pub struct UpstreamEntry {
    pub alias: String,
    pub base_url: String,
    /// Human label for dashboards; falls back to the alias.
    pub label: String,
    /// Model id to use when a caller does not name one. Purely informational to
    /// the proxy — it never rewrites the request's `model`.
    pub default_model: Option<String>,
    /// `flag` (from the command line) or `admin` (registered at runtime).
    pub source: &'static str,
    pub is_default: bool,
    #[serde(skip)]
    pub api_key: Option<String>,
    pub has_api_key: bool,
}

#[derive(Default)]
pub struct Upstreams {
    inner: RwLock<Vec<UpstreamEntry>>,
}

/// Aliases are used as map keys and appear in traces; keep them boring.
pub fn valid_alias(alias: &str) -> bool {
    !alias.is_empty()
        && alias.len() <= 64
        && alias
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
}

/// Reject anything that is not a plain http(s) URL, and refuse the cloud
/// metadata address outright — it is the one host where an SSRF is immediately
/// a credential leak.
pub fn validate_base_url(url: &str) -> Result<String> {
    let parsed = reqwest::Url::parse(url).context("not a valid URL")?;
    match parsed.scheme() {
        "http" | "https" => {}
        s => anyhow::bail!("unsupported scheme `{s}`: only http and https are allowed"),
    }
    if let Some(host) = parsed.host_str()
        && (host == "169.254.169.254" || host == "metadata.google.internal")
    {
        anyhow::bail!("refusing to register the cloud metadata endpoint as an upstream");
    }
    Ok(url.trim_end_matches('/').to_string())
}

impl Upstreams {
    pub fn new(default_base: &str, default_key: Option<String>) -> Self {
        let up = Upstreams {
            inner: RwLock::new(Vec::new()),
        };
        up.inner.write().unwrap().push(UpstreamEntry {
            alias: "default".to_string(),
            base_url: default_base.trim_end_matches('/').to_string(),
            label: "default".to_string(),
            default_model: None,
            source: "flag",
            is_default: true,
            has_api_key: default_key.is_some(),
            api_key: default_key,
        });
        up
    }

    /// Register or replace an entry. `source` distinguishes command-line entries
    /// from ones added at runtime so a dashboard can show which are which.
    pub fn upsert(
        &self,
        alias: &str,
        base_url: &str,
        label: Option<String>,
        default_model: Option<String>,
        api_key: Option<String>,
        source: &'static str,
    ) -> Result<UpstreamEntry> {
        if !valid_alias(alias) {
            anyhow::bail!("invalid alias `{alias}`: use letters, digits, `-`, `_` or `.`");
        }
        let base_url = validate_base_url(base_url)?;

        let mut list = self.inner.write().unwrap();
        let is_default = list
            .iter()
            .find(|e| e.alias == alias)
            .map(|e| e.is_default)
            .unwrap_or(false);

        let entry = UpstreamEntry {
            alias: alias.to_string(),
            base_url,
            label: label.unwrap_or_else(|| alias.to_string()),
            default_model,
            source,
            is_default,
            has_api_key: api_key.is_some(),
            api_key,
        };
        match list.iter_mut().find(|e| e.alias == alias) {
            Some(slot) => *slot = entry.clone(),
            None => list.push(entry.clone()),
        }
        Ok(entry)
    }

    /// Remove an entry. The default upstream cannot be removed — the proxy would
    /// have nowhere to send an unlabelled request.
    pub fn remove(&self, alias: &str) -> Result<bool> {
        let mut list = self.inner.write().unwrap();
        match list.iter().position(|e| e.alias == alias) {
            Some(i) if list[i].is_default => {
                anyhow::bail!("cannot remove the default upstream")
            }
            Some(i) => {
                list.remove(i);
                Ok(true)
            }
            None => Ok(false),
        }
    }

    /// Resolve an alias to a target, falling back to the default.
    ///
    /// Returns `None` for an alias that is not registered — an unknown alias must
    /// be an error, never a silent fallback, or a benchmark could attribute one
    /// model's results to another.
    pub fn resolve(&self, alias: Option<&str>) -> Option<Target> {
        let list = self.inner.read().unwrap();
        let entry = match alias.filter(|a| !a.is_empty()) {
            Some(a) => list.iter().find(|e| e.alias == a)?,
            None => list.iter().find(|e| e.is_default).or(list.first())?,
        };
        Some(Target {
            alias: entry.alias.clone(),
            base: entry.base_url.clone(),
            api_key: entry.api_key.clone(),
        })
    }

    pub fn list(&self) -> Vec<UpstreamEntry> {
        self.inner.read().unwrap().clone()
    }

    pub fn list_json(&self) -> Value {
        serde_json::json!({ "upstreams": self.list() })
    }
}

/// Compose the chat-completions URL from a target's base.
fn chat_url(t: &Target) -> String {
    format!("{}/chat/completions", t.base)
}

/// Apply the caller's `Authorization` if present, else the target's key.
fn auth(rb: reqwest::RequestBuilder, t: &Target, caller_auth: Option<&str>) -> reqwest::RequestBuilder {
    if let Some(a) = caller_auth {
        rb.header(AUTHORIZATION, a)
    } else if let Some(k) = &t.api_key {
        rb.bearer_auth(k)
    } else {
        rb
    }
}

/// POST a JSON body and parse the JSON response (non-streaming).
pub async fn post_json(
    client: &reqwest::Client,
    target: &Target,
    caller_auth: Option<&str>,
    body: &Value,
) -> Result<Value> {
    let rb = client
        .post(chat_url(target))
        .header(CONTENT_TYPE, "application/json")
        .json(body);
    let resp = auth(rb, target, caller_auth)
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
    target: &Target,
    caller_auth: Option<&str>,
    body: bytes::Bytes,
) -> Result<reqwest::Response> {
    let rb = client
        .post(chat_url(target))
        .header(CONTENT_TYPE, "application/json")
        .body(body);
    auth(rb, target, caller_auth)
        .send()
        .await
        .context("upstream request failed")
}

/// Probe a target's `/models` endpoint — used by `POST /admin/upstreams/probe`
/// so a dashboard can check a backend before registering it.
pub async fn probe(
    client: &reqwest::Client,
    target: &Target,
    caller_auth: Option<&str>,
) -> Result<Vec<String>> {
    let rb = client.get(format!("{}/models", target.base));
    let resp = auth(rb, target, caller_auth)
        .send()
        .await
        .context("could not reach the endpoint")?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!("endpoint returned {status}: {}", truncate(&text, 300));
    }
    let v: Value = serde_json::from_str(&text).context("response was not JSON")?;
    let ids = v
        .get("data")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|m| m.get("id").and_then(Value::as_str).map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(ids)
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n).collect::<String>() + "…"
    }
}

/// Parse a `name=url` pair from the command line.
pub fn parse_alias_flag(raw: &str) -> Result<(String, String), String> {
    let (name, url) = raw
        .split_once('=')
        .ok_or_else(|| format!("expected `alias=url`, got `{raw}`"))?;
    if !valid_alias(name) {
        return Err(format!("invalid alias `{name}`"));
    }
    validate_base_url(url).map_err(|e| e.to_string())?;
    Ok((name.to_string(), url.to_string()))
}

/// Aliases keyed for the per-model rollup.
pub fn model_key(model: &str, upstream: &str) -> String {
    format!("{model}\u{1}{upstream}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_dangerous_upstreams() {
        assert!(validate_base_url("file:///etc/passwd").is_err());
        assert!(validate_base_url("http://169.254.169.254/latest/meta-data").is_err());
        assert!(validate_base_url("not a url").is_err());
        assert!(validate_base_url("http://127.0.0.1:8000/v1").is_ok());
    }

    #[test]
    fn trailing_slash_is_normalised() {
        assert_eq!(
            validate_base_url("http://127.0.0.1:8000/v1/").unwrap(),
            "http://127.0.0.1:8000/v1"
        );
    }

    #[test]
    fn unknown_alias_does_not_fall_back() {
        let up = Upstreams::new("http://127.0.0.1:11434/v1", None);
        assert!(up.resolve(None).is_some());
        assert!(up.resolve(Some("nope")).is_none(), "silent fallback would misattribute results");
    }

    #[test]
    fn register_select_and_remove() {
        let up = Upstreams::new("http://127.0.0.1:11434/v1", None);
        up.upsert("vllm", "http://127.0.0.1:8000/v1", None, Some("qwen".into()), None, "admin")
            .unwrap();
        let t = up.resolve(Some("vllm")).unwrap();
        assert_eq!(t.base, "http://127.0.0.1:8000/v1");
        assert_eq!(up.list().len(), 2);

        assert!(up.remove("vllm").unwrap());
        assert!(up.resolve(Some("vllm")).is_none());
        assert!(up.remove("default").is_err(), "the default must stay");
    }

    #[test]
    fn alias_names_are_constrained() {
        let up = Upstreams::new("http://x.test/v1", None);
        assert!(up.upsert("bad alias", "http://x.test/v1", None, None, None, "admin").is_err());
        assert!(up.upsert("ok-name.1_2", "http://x.test/v1", None, None, None, "admin").is_ok());
    }
}
