//! toolcall-sre — an OpenAI-compatible reliability proxy for local-LLM tool calls.

mod config;
mod profiles;
mod repair;
mod server;
mod telemetry;
mod trace;
mod upstream;
mod validate;

use std::sync::Arc;

use anyhow::Context;
use clap::Parser;
use tracing::info;
use tracing_subscriber::EnvFilter;

use crate::config::{AppConfig, Cli};
use crate::server::AppInner;
use crate::telemetry::Metrics;
use crate::trace::Recorder;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();
    let cfg = AppConfig::from(&cli);

    let http = reqwest::Client::builder()
        .timeout(cfg.timeout)
        .build()
        .context("building HTTP client")?;

    let recorder = Recorder::new(cfg.trace_file.as_deref())
        .with_context(|| format!("opening trace file {:?}", cfg.trace_file))?;

    let state = Arc::new(AppInner {
        cfg: cfg.clone(),
        http,
        metrics: Metrics::default(),
        recorder,
    });

    let app = server::router(state);

    let listener = tokio::net::TcpListener::bind(cli.listen)
        .await
        .with_context(|| format!("binding {}", cli.listen))?;

    info!(
        listen = %cli.listen,
        upstream = %cfg.upstream_base,
        repair = cfg.repair_enabled,
        max_repair_attempts = cfg.max_repair_attempts,
        trace_file = ?cfg.trace_file,
        "toolcall-sre listening"
    );

    axum::serve(listener, app).await.context("server error")?;
    Ok(())
}
