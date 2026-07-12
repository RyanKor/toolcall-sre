//! Runtime configuration for the toolcall-sre proxy.

use std::net::SocketAddr;
use std::time::Duration;

use clap::Parser;

/// `toolcall-sre` — an OpenAI-compatible reliability proxy for local-LLM tool calls.
///
/// It sits in front of any OpenAI-compatible endpoint (vLLM, Ollama, SGLang,
/// llama.cpp server) and makes tool/function calls reliable: tolerant parsing,
/// JSON-Schema validation, and an auto-repair loop for malformed arguments.
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

    /// Maximum number of repair attempts for a malformed tool call.
    #[arg(long, env = "TCS_MAX_REPAIR_ATTEMPTS", default_value_t = 2)]
    pub max_repair_attempts: u32,

    /// Disable the auto-repair loop (validation-only, still normalizes arguments).
    #[arg(long, env = "TCS_NO_REPAIR", default_value_t = false)]
    pub no_repair: bool,

    /// Upstream request timeout, in seconds.
    #[arg(long, env = "TCS_TIMEOUT_SECS", default_value_t = 120)]
    pub timeout_secs: u64,

    /// Write a JSONL flight-recorder trace of tool-call behavior to this path
    /// (one record per processed request). Enables in-harness measurement.
    #[arg(long, env = "TCS_TRACE_FILE")]
    pub trace_file: Option<String>,

    /// Header used to correlate multi-turn requests into a session. When absent
    /// on a request, the session is derived by fingerprinting the conversation
    /// prefix (system + first user message).
    #[arg(long, env = "TCS_SESSION_HEADER", default_value = "x-session-id")]
    pub session_header: String,
}

/// Resolved configuration shared across the request lifecycle.
#[derive(Debug, Clone)]
pub struct AppConfig {
    pub upstream_base: String,
    pub api_key: Option<String>,
    pub max_repair_attempts: u32,
    pub repair_enabled: bool,
    pub timeout: Duration,
    pub trace_file: Option<String>,
    pub session_header: String,
}

impl From<&Cli> for AppConfig {
    fn from(cli: &Cli) -> Self {
        AppConfig {
            upstream_base: cli.upstream.trim_end_matches('/').to_string(),
            api_key: cli.api_key.clone(),
            max_repair_attempts: cli.max_repair_attempts,
            repair_enabled: !cli.no_repair,
            timeout: Duration::from_secs(cli.timeout_secs),
            trace_file: cli.trace_file.clone(),
            session_header: cli.session_header.to_ascii_lowercase(),
        }
    }
}
