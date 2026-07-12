//! Reliability telemetry — the "SRE" in toolcall-sre.
//!
//! Every tool call flowing through the proxy is counted so operators can watch
//! the well-formed rate, repair rate, and end-to-end failure rate as SLIs.

use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Default)]
pub struct Metrics {
    /// Total inbound chat-completion requests.
    pub requests: AtomicU64,
    /// Streaming requests passed through untouched (repair bypassed).
    pub passthrough_stream: AtomicU64,
    /// Tool calls observed in upstream responses.
    pub tool_calls: AtomicU64,
    /// Tool calls whose arguments were malformed or schema-invalid on first sight.
    pub malformed: AtomicU64,
    /// Malformed tool calls that were successfully repaired.
    pub repaired: AtomicU64,
    /// Malformed tool calls that could not be repaired within budget.
    pub repair_failed: AtomicU64,
    /// Upstream request failures (network / non-2xx during repair).
    pub upstream_errors: AtomicU64,
}

impl Metrics {
    #[inline]
    pub fn inc(counter: &AtomicU64) {
        counter.fetch_add(1, Ordering::Relaxed);
    }

    fn get(counter: &AtomicU64) -> u64 {
        counter.load(Ordering::Relaxed)
    }

    /// JSON snapshot for `/metrics?format=json` and debugging.
    pub fn snapshot(&self) -> serde_json::Value {
        let tool_calls = Self::get(&self.tool_calls);
        let malformed = Self::get(&self.malformed);
        let repaired = Self::get(&self.repaired);
        // Well-formed = tool calls that never needed repair.
        let well_formed = tool_calls.saturating_sub(malformed);
        let well_formed_rate = ratio(well_formed, tool_calls);
        let repair_success_rate = ratio(repaired, malformed);

        serde_json::json!({
            "requests": Self::get(&self.requests),
            "passthrough_stream": Self::get(&self.passthrough_stream),
            "tool_calls": tool_calls,
            "malformed": malformed,
            "repaired": repaired,
            "repair_failed": Self::get(&self.repair_failed),
            "upstream_errors": Self::get(&self.upstream_errors),
            "well_formed_rate": well_formed_rate,
            "repair_success_rate": repair_success_rate,
        })
    }

    /// Minimal Prometheus text exposition.
    pub fn prometheus(&self) -> String {
        let mut out = String::new();
        let mut line = |name: &str, help: &str, val: u64| {
            out.push_str(&format!("# HELP {name} {help}\n# TYPE {name} counter\n{name} {val}\n"));
        };
        line("tcs_requests_total", "Inbound chat-completion requests", Self::get(&self.requests));
        line("tcs_passthrough_stream_total", "Streaming requests passed through", Self::get(&self.passthrough_stream));
        line("tcs_tool_calls_total", "Tool calls observed", Self::get(&self.tool_calls));
        line("tcs_malformed_total", "Malformed/invalid tool calls on first sight", Self::get(&self.malformed));
        line("tcs_repaired_total", "Tool calls repaired", Self::get(&self.repaired));
        line("tcs_repair_failed_total", "Tool calls that failed repair", Self::get(&self.repair_failed));
        line("tcs_upstream_errors_total", "Upstream request failures", Self::get(&self.upstream_errors));
        out
    }
}

fn ratio(num: u64, den: u64) -> f64 {
    if den == 0 { 1.0 } else { num as f64 / den as f64 }
}
