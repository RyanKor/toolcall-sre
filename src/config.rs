//! Runtime configuration for the toolcall-sre proxy.

use std::net::SocketAddr;
use std::time::Duration;

use clap::{Parser, ValueEnum};

/// How aggressively the proxy is allowed to repair an invalid tool call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum RepairPolicy {
    /// Never repair. Validate, classify and record only. (Pure sensor mode.)
    Off,
    /// Repair only failures where the value is present but malformed — wrong
    /// type, bad enum, broken JSON. Never repairs a missing required property,
    /// because that would force the model to invent one. **Default.**
    SyntacticOnly,
    /// Also repair missing values, but attach the conversation context and let
    /// the model decline rather than guess.
    Contextual,
    /// Repair anything, context-free. This is what silently invents values —
    /// opt in only when every tool is side-effect free.
    Full,
}

/// `toolcall-sre` — an OpenAI-compatible reliability proxy for local-LLM tool calls.
///
/// It sits in front of any OpenAI-compatible endpoint (vLLM, Ollama, SGLang,
/// llama.cpp server) and makes tool/function calls reliable: tolerant parsing,
/// JSON-Schema validation, and a bounded repair loop for malformed arguments.
#[derive(Debug, Clone, Parser)]
#[command(name = "toolcall-sre", version, about)]
pub struct Cli {
    /// Address the proxy listens on.
    #[arg(long, env = "TCS_LISTEN", default_value = "127.0.0.1:8080")]
    pub listen: SocketAddr,

    /// Upstream OpenAI-compatible base URL (should include the `/v1` suffix).
    #[arg(long, env = "TCS_UPSTREAM", default_value = "http://127.0.0.1:11434/v1")]
    pub upstream: String,

    /// Optional API key used for the upstream when the client does not send one.
    #[arg(long, env = "TCS_API_KEY")]
    pub api_key: Option<String>,

    /// Additional upstream, selectable per request by alias: `--upstream-alias
    /// vllm=http://127.0.0.1:8000/v1`. Repeatable. One proxy in front of several
    /// backends is how you compare models under identical policy and metrics.
    #[arg(long = "upstream-alias", value_parser = crate::upstream::parse_alias_flag, action = clap::ArgAction::Append)]
    pub upstream_alias: Vec<(String, String)>,

    /// Header naming which registered upstream a request should go to.
    #[arg(long, env = "TCS_UPSTREAM_HEADER", default_value = "x-tcs-upstream")]
    pub upstream_header: String,

    /// Allow the upstream registry to be edited at runtime via `/admin/*`.
    /// Off by default: an endpoint that adds new request destinations is an SSRF
    /// surface, so it is opt-in and meant for a trusted local console.
    #[arg(long, env = "TCS_ALLOW_ADMIN", default_value_t = false)]
    pub allow_admin: bool,

    /// Maximum number of repair attempts for a malformed tool call.
    #[arg(long, env = "TCS_MAX_REPAIR_ATTEMPTS", default_value_t = 2)]
    pub max_repair_attempts: u32,

    /// How much the proxy may repair. Defaults to the safe policy: fix broken
    /// values, never invent missing ones.
    #[arg(long, env = "TCS_REPAIR_POLICY", value_enum, default_value = "syntactic-only")]
    pub repair_policy: RepairPolicy,

    /// Deprecated alias for `--repair-policy off`.
    #[arg(long, env = "TCS_NO_REPAIR", default_value_t = false)]
    pub no_repair: bool,

    /// Tools that must never have values invented for them, as a comma-separated
    /// list of glob patterns (e.g. `send_*,delete_*,pay_*`). Matching tools fall
    /// back to `syntactic-only` regardless of `--repair-policy`.
    #[arg(long, env = "TCS_NO_FABRICATE_FOR", value_delimiter = ',')]
    pub no_fabricate_for: Vec<String>,

    /// Rewrite well-formed arguments as canonical JSON. Off by default so that a
    /// valid call passes through byte-for-byte.
    #[arg(long, env = "TCS_NORMALIZE", default_value_t = false)]
    pub normalize: bool,

    /// Measure streaming responses by reassembling tool-call deltas as they pass
    /// through. Never alters the stream; costs nothing in latency.
    #[arg(long, env = "TCS_MEASURE_STREAMING", default_value_t = true, action = clap::ArgAction::Set)]
    pub measure_streaming: bool,

    /// Buffer streaming responses that contain tool calls so they can be
    /// validated and repaired, then re-emit them. Text-only responses still
    /// stream through untouched. Tool-call deltas are consumed by the harness,
    /// not read by a human, so buffering them costs no perceived latency.
    #[arg(long, env = "TCS_REPAIR_STREAMING", default_value_t = false)]
    pub repair_streaming: bool,

    /// Upstream request timeout, in seconds.
    #[arg(long, env = "TCS_TIMEOUT_SECS", default_value_t = 120)]
    pub timeout_secs: u64,

    /// Write a JSONL flight-recorder trace of tool-call behavior to this path
    /// (one record per processed request). Enables in-harness measurement.
    #[arg(long, env = "TCS_TRACE_FILE")]
    pub trace_file: Option<String>,

    /// Header used to correlate multi-turn requests into a session. When absent
    /// on a request, the session is derived by fingerprinting the conversation
    /// prefix and checking that each turn actually extends the previous one.
    #[arg(long, env = "TCS_SESSION_HEADER", default_value = "x-session-id")]
    pub session_header: String,

    /// Maximum sessions kept in memory; the least recently seen are retired
    /// (their totals are folded into lifetime counters, not lost).
    #[arg(long, env = "TCS_MAX_SESSIONS", default_value_t = 10_000)]
    pub max_sessions: usize,

    /// Retire a session after this many seconds without traffic. 0 disables.
    #[arg(long, env = "TCS_SESSION_TTL_SECS", default_value_t = 3600)]
    pub session_ttl_secs: u64,

    /// Recent request events kept in memory for `GET /events`.
    #[arg(long, env = "TCS_MAX_EVENTS", default_value_t = 500)]
    pub max_events: usize,

    /// Maximum tool names kept in a session's call sequence before truncating.
    #[arg(long, env = "TCS_MAX_SEQUENCE_LEN", default_value_t = 256)]
    pub max_sequence_len: usize,

    /// Require callers to present an `Authorization` header. Mandatory when
    /// binding to a non-loopback address.
    #[arg(long, env = "TCS_REQUIRE_AUTH", default_value_t = false)]
    pub require_auth: bool,

    /// Send permissive CORS headers on the read-only endpoints so a local
    /// dashboard can poll them directly from the browser.
    #[arg(long, env = "TCS_CORS", default_value_t = false)]
    pub cors: bool,
}

/// Resolved configuration shared across the request lifecycle.
#[derive(Debug, Clone)]
pub struct AppConfig {
    pub upstream_base: String,
    pub api_key: Option<String>,
    pub max_repair_attempts: u32,
    pub policy: RepairPolicy,
    pub no_fabricate_for: Vec<String>,
    pub normalize: bool,
    pub measure_streaming: bool,
    pub repair_streaming: bool,
    pub timeout: Duration,
    pub trace_file: Option<String>,
    pub session_header: String,
    pub upstream_header: String,
    pub allow_admin: bool,
    pub max_sessions: usize,
    pub session_ttl: Option<Duration>,
    pub max_sequence_len: usize,
    pub max_events: usize,
    pub require_auth: bool,
    pub cors: bool,
}

impl AppConfig {
    /// Is any repair enabled at all?
    pub fn repair_enabled(&self) -> bool {
        self.policy != RepairPolicy::Off
    }

    /// May we repair a *missing* value for this tool — i.e. let the model supply
    /// information the call did not contain?
    pub fn may_fabricate(&self, tool: &str) -> bool {
        match self.policy {
            RepairPolicy::Off | RepairPolicy::SyntacticOnly => false,
            RepairPolicy::Contextual | RepairPolicy::Full => !self.is_protected(tool),
        }
    }

    /// Should the repair prompt carry conversation context?
    pub fn wants_context(&self) -> bool {
        self.policy == RepairPolicy::Contextual
    }

    fn is_protected(&self, tool: &str) -> bool {
        self.no_fabricate_for.iter().any(|pat| glob_match(pat, tool))
    }
}

/// Minimal `*`-only glob match, enough for `send_*` / `*_delete` / `pay_*`.
fn glob_match(pattern: &str, value: &str) -> bool {
    let pattern = pattern.trim();
    if pattern.is_empty() {
        return false;
    }
    let parts: Vec<&str> = pattern.split('*').collect();
    if parts.len() == 1 {
        return pattern.eq_ignore_ascii_case(value);
    }
    let lower = value.to_ascii_lowercase();
    let mut cursor = 0usize;
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        let part = part.to_ascii_lowercase();
        match lower[cursor..].find(&part) {
            Some(pos) => {
                // A leading literal must anchor at the start.
                if i == 0 && pos != 0 {
                    return false;
                }
                cursor += pos + part.len();
            }
            None => return false,
        }
    }
    // A trailing literal must anchor at the end.
    if let Some(last) = parts.last()
        && !last.is_empty()
        && !lower.ends_with(&last.to_ascii_lowercase())
    {
        return false;
    }
    true
}

impl From<&Cli> for AppConfig {
    fn from(cli: &Cli) -> Self {
        // `--no-repair` is kept as a compatibility alias and always wins.
        let policy = if cli.no_repair {
            RepairPolicy::Off
        } else {
            cli.repair_policy
        };

        AppConfig {
            upstream_base: cli.upstream.trim_end_matches('/').to_string(),
            api_key: cli.api_key.clone(),
            max_repair_attempts: cli.max_repair_attempts,
            policy,
            no_fabricate_for: cli.no_fabricate_for.clone(),
            normalize: cli.normalize,
            measure_streaming: cli.measure_streaming,
            repair_streaming: cli.repair_streaming,
            timeout: Duration::from_secs(cli.timeout_secs),
            trace_file: cli.trace_file.clone(),
            session_header: cli.session_header.to_ascii_lowercase(),
            upstream_header: cli.upstream_header.to_ascii_lowercase(),
            allow_admin: cli.allow_admin,
            max_sessions: cli.max_sessions.max(1),
            session_ttl: match cli.session_ttl_secs {
                0 => None,
                n => Some(Duration::from_secs(n)),
            },
            max_sequence_len: cli.max_sequence_len.max(1),
            max_events: cli.max_events.min(10_000),
            require_auth: cli.require_auth,
            cors: cli.cors,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glob_patterns() {
        assert!(glob_match("send_*", "send_email"));
        assert!(glob_match("send_*", "SEND_EMAIL"));
        assert!(!glob_match("send_*", "get_weather"));
        assert!(glob_match("*_delete", "record_delete"));
        assert!(!glob_match("*_delete", "delete_record"));
        assert!(glob_match("get_weather", "get_weather"));
        assert!(!glob_match("get_weather", "get_weather_2"));
    }

    fn cfg(policy: RepairPolicy, protected: &[&str]) -> AppConfig {
        let mut c = AppConfig::from(&Cli::parse_from(["toolcall-sre"]));
        c.policy = policy;
        c.no_fabricate_for = protected.iter().map(|s| s.to_string()).collect();
        c
    }

    #[test]
    fn default_policy_never_fabricates() {
        let c = AppConfig::from(&Cli::parse_from(["toolcall-sre"]));
        assert_eq!(c.policy, RepairPolicy::SyntacticOnly);
        assert!(c.repair_enabled());
        assert!(!c.may_fabricate("get_weather"));
    }

    #[test]
    fn protected_tools_never_fabricate_even_on_full() {
        let c = cfg(RepairPolicy::Full, &["send_*"]);
        assert!(c.may_fabricate("get_weather"));
        assert!(!c.may_fabricate("send_email"));
    }

    #[test]
    fn no_repair_alias_wins() {
        let c = AppConfig::from(&Cli::parse_from([
            "toolcall-sre",
            "--no-repair",
            "--repair-policy",
            "full",
        ]));
        assert_eq!(c.policy, RepairPolicy::Off);
        assert!(!c.repair_enabled());
    }
}
