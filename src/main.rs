//! toolcall-sre — an OpenAI-compatible reliability proxy for local-LLM tool calls.

mod config;
mod profiles;
mod repair;
mod server;
mod sse;
mod telemetry;
mod trace;
mod upstream;
mod validate;

use std::sync::Arc;

use anyhow::Context;
use clap::Parser;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use crate::config::{AppConfig, Cli, RepairPolicy};
use crate::server::AppInner;
use crate::telemetry::Metrics;
use crate::trace::{Limits, Recorder};
use crate::upstream::Upstreams;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();
    let cfg = AppConfig::from(&cli);

    // The proxy injects `--api-key` for callers that send none. Exposing that on
    // a routable address without requiring auth hands the upstream key to
    // anyone who can reach the port, so refuse to start rather than warn.
    if !cli.listen.ip().is_loopback() && !cfg.require_auth {
        anyhow::bail!(
            "refusing to listen on {} without --require-auth: any client able to reach \
             this port could use the configured upstream credentials. Bind to a loopback \
             address, or pass --require-auth.",
            cli.listen
        );
    }

    if cfg.allow_admin && !cli.listen.ip().is_loopback() {
        anyhow::bail!(
            "refusing to expose --allow-admin on {}: runtime upstream registration lets a \
             caller add new request destinations. Keep it on a loopback address.",
            cli.listen
        );
    }

    if cfg.policy == RepairPolicy::Full {
        warn!(
            "--repair-policy full repairs missing values context-free: the model will \
             invent them. Prefer `contextual`, and use --no-fabricate-for for tools with \
             side effects."
        );
    }

    let http = reqwest::Client::builder()
        .timeout(cfg.timeout)
        .build()
        .context("building HTTP client")?;

    let limits = Limits {
        max_sessions: cfg.max_sessions,
        ttl_ms: cfg.session_ttl.map(|d| d.as_millis()),
        max_sequence_len: cfg.max_sequence_len,
        max_models: 200,
        max_events: cfg.max_events,
    };
    let recorder = Recorder::new(cfg.trace_file.as_deref(), limits)
        .with_context(|| format!("opening trace file {:?}", cfg.trace_file))?;

    // The default upstream plus any `--upstream-alias` entries. A console may add
    // more at runtime only when `--allow-admin` is set.
    let upstreams = Upstreams::new(&cfg.upstream_base, cfg.api_key.clone());
    for (alias, url) in &cli.upstream_alias {
        upstreams
            .upsert(alias, url, None, None, None, "flag")
            .with_context(|| format!("registering --upstream-alias {alias}"))?;
    }
    let registered: Vec<String> = upstreams.list().iter().map(|e| e.alias.clone()).collect();

    let state = Arc::new(AppInner {
        cfg: cfg.clone(),
        http,
        metrics: Metrics::default(),
        recorder,
        upstreams,
    });

    let app = server::router(state);

    let listener = tokio::net::TcpListener::bind(cli.listen)
        .await
        .with_context(|| format!("binding {}", cli.listen))?;

    info!(
        listen = %cli.listen,
        upstream = %cfg.upstream_base,
        policy = ?cfg.policy,
        max_repair_attempts = cfg.max_repair_attempts,
        measure_streaming = cfg.measure_streaming,
        repair_streaming = cfg.repair_streaming,
        normalize = cfg.normalize,
        trace_file = ?cfg.trace_file,
        max_sessions = cfg.max_sessions,
        upstreams = ?registered,
        allow_admin = cfg.allow_admin,
        "toolcall-sre listening"
    );

    axum::serve(listener, app).await.context("server error")?;
    Ok(())
}
