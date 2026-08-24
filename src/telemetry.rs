//! Reliability telemetry — the "SRE" in toolcall-sre.
//!
//! Two rules shape this module:
//!
//!  * **A counter means one thing.** "Repair failed" must not also mean "there
//!    was no schema" or "repair was switched off" — those are different
//!    operational facts and get different counters.
//!  * **An empty denominator is not 100%.** A proxy that has seen no traffic
//!    reports `null`, never a perfect score, so a dashboard cannot mistake
//!    "nothing happened yet" for "everything is healthy".

use std::sync::atomic::{AtomicU64, Ordering};

/// Upper bounds, in milliseconds, for the latency histograms.
const LATENCY_BUCKETS_MS: [u64; 9] = [5, 25, 50, 100, 250, 500, 1_000, 5_000, 30_000];

/// A minimal cumulative histogram (Prometheus-style `le` buckets).
#[derive(Debug, Default)]
pub struct Histogram {
    buckets: [AtomicU64; LATENCY_BUCKETS_MS.len()],
    inf: AtomicU64,
    sum_ms: AtomicU64,
    count: AtomicU64,
    /// The largest observation seen, tracked separately from the buckets so a
    /// quantile that falls past the last bound has a real number to report —
    /// see the comment on `quantile` for why `u64::MAX` was wrong here.
    max_ms: AtomicU64,
}

impl Histogram {
    pub fn observe(&self, ms: u64) {
        self.count.fetch_add(1, Ordering::Relaxed);
        self.sum_ms.fetch_add(ms, Ordering::Relaxed);
        self.max_ms.fetch_max(ms, Ordering::Relaxed);
        let mut placed = false;
        for (i, bound) in LATENCY_BUCKETS_MS.iter().enumerate() {
            if ms <= *bound {
                self.buckets[i].fetch_add(1, Ordering::Relaxed);
                placed = true;
                break;
            }
        }
        if !placed {
            self.inf.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn count(&self) -> u64 {
        self.count.load(Ordering::Relaxed)
    }

    /// Interpolation-free quantile: the upper bound of the bucket the quantile
    /// falls in. Coarse by construction, and honest about it.
    ///
    /// The buckets top out at `LATENCY_BUCKETS_MS`'s last bound (30s). A
    /// quantile landing past it used to fall through to `Some(u64::MAX)` —
    /// meant as "off the chart", but a JSON consumer has no way to read
    /// 18446744073709551615 as anything but a broken number, which is exactly
    /// the kind of report this module exists to not produce. Once a slow real
    /// model (a reasoning model answering in over a minute, say) pushed an
    /// observation past 30s, the dashboard's own latency tile went dishonest.
    /// Reporting the largest value actually observed keeps the number real.
    fn quantile(&self, q: f64) -> Option<u64> {
        let total = self.count();
        if total == 0 {
            return None;
        }
        let target = (total as f64 * q).ceil() as u64;
        let mut seen = 0u64;
        for (i, bound) in LATENCY_BUCKETS_MS.iter().enumerate() {
            seen += self.buckets[i].load(Ordering::Relaxed);
            if seen >= target {
                return Some(*bound);
            }
        }
        Some(self.max_ms.load(Ordering::Relaxed))
    }

    fn mean_ms(&self) -> Option<f64> {
        let n = self.count();
        if n == 0 {
            return None;
        }
        Some(self.sum_ms.load(Ordering::Relaxed) as f64 / n as f64)
    }

    fn json(&self) -> serde_json::Value {
        serde_json::json!({
            "count": self.count(),
            "mean_ms": self.mean_ms(),
            "p50_ms": self.quantile(0.50),
            "p95_ms": self.quantile(0.95),
            "p99_ms": self.quantile(0.99),
        })
    }

    fn prometheus(&self, name: &str, help: &str) -> String {
        let mut out = format!("# HELP {name} {help}\n# TYPE {name} histogram\n");
        let mut cumulative = 0u64;
        for (i, bound) in LATENCY_BUCKETS_MS.iter().enumerate() {
            cumulative += self.buckets[i].load(Ordering::Relaxed);
            let le = *bound as f64 / 1000.0;
            out.push_str(&format!("{name}_bucket{{le=\"{le}\"}} {cumulative}\n"));
        }
        cumulative += self.inf.load(Ordering::Relaxed);
        out.push_str(&format!("{name}_bucket{{le=\"+Inf\"}} {cumulative}\n"));
        out.push_str(&format!(
            "{name}_sum {}\n",
            self.sum_ms.load(Ordering::Relaxed) as f64 / 1000.0
        ));
        out.push_str(&format!("{name}_count {}\n", self.count()));
        out
    }
}

#[derive(Debug, Default)]
pub struct Metrics {
    /// Total inbound chat-completion requests.
    pub requests: AtomicU64,
    /// Streaming requests passed through with no observation at all.
    pub passthrough_stream: AtomicU64,
    /// Streaming responses whose tool calls were reassembled and measured.
    pub stream_measured: AtomicU64,
    /// Streaming responses buffered so their tool calls could be repaired.
    pub stream_repaired: AtomicU64,
    /// Tool calls observed in upstream responses.
    pub tool_calls: AtomicU64,
    /// Tool calls whose raw arguments were not valid JSON but were recovered by
    /// tolerant parsing alone — no model round-trip, no invented values.
    pub recovered: AtomicU64,
    /// Tool calls whose arguments were malformed or schema-invalid on first sight.
    pub malformed: AtomicU64,
    /// Malformed because a required value was absent (repair would invent it).
    pub malformed_fabricating: AtomicU64,

    /// Repairs actually sent upstream.
    pub repair_attempted: AtomicU64,
    /// Repairs that produced schema-valid arguments.
    pub repaired: AtomicU64,
    /// Repairs attempted but still invalid when the attempt budget ran out.
    pub repair_exhausted: AtomicU64,
    /// Not repaired: the tool had no usable schema to repair against.
    pub repair_skipped_no_schema: AtomicU64,
    /// Not repaired: policy forbade it (`off`, or a missing value under
    /// `syntactic-only`, or a protected tool).
    pub repair_skipped_by_policy: AtomicU64,
    /// Repairs that succeeded but introduced a value found nowhere in the
    /// original call or the conversation — i.e. the model invented it.
    pub repair_fabricated: AtomicU64,
    /// Repairs where the model declined to guess rather than invent.
    pub repair_declined: AtomicU64,

    /// Upstream request failures (network / non-2xx).
    pub upstream_errors: AtomicU64,
    /// Requests rejected because `--require-auth` was set and none was sent.
    pub unauthorized: AtomicU64,
    /// Requests naming an upstream alias that is not registered.
    pub unknown_upstream: AtomicU64,

    /// End-to-end proxy handling time.
    pub request_latency: Histogram,
    /// Time spent *only* in the repair loop — the price of reliability.
    pub repair_latency: Histogram,
}

impl Metrics {
    #[inline]
    pub fn inc(counter: &AtomicU64) {
        counter.fetch_add(1, Ordering::Relaxed);
    }

    fn get(counter: &AtomicU64) -> u64 {
        counter.load(Ordering::Relaxed)
    }

    /// JSON snapshot for `/metrics?format=json` and the dashboard.
    pub fn snapshot(&self) -> serde_json::Value {
        let tool_calls = Self::get(&self.tool_calls);
        let malformed = Self::get(&self.malformed);
        let attempted = Self::get(&self.repair_attempted);
        let repaired = Self::get(&self.repaired);
        let fabricated = Self::get(&self.repair_fabricated);
        let well_formed = tool_calls.saturating_sub(malformed);

        serde_json::json!({
            "requests": Self::get(&self.requests),
            "passthrough_stream": Self::get(&self.passthrough_stream),
            "stream_measured": Self::get(&self.stream_measured),
            "stream_repaired": Self::get(&self.stream_repaired),
            "tool_calls": tool_calls,
            "well_formed": well_formed,
            "recovered": Self::get(&self.recovered),
            "malformed": malformed,
            "malformed_fabricating": Self::get(&self.malformed_fabricating),
            "repair_attempted": attempted,
            "repaired": repaired,
            "repair_exhausted": Self::get(&self.repair_exhausted),
            "repair_skipped_no_schema": Self::get(&self.repair_skipped_no_schema),
            "repair_skipped_by_policy": Self::get(&self.repair_skipped_by_policy),
            "repair_fabricated": fabricated,
            "repair_declined": Self::get(&self.repair_declined),
            "upstream_errors": Self::get(&self.upstream_errors),
            "unauthorized": Self::get(&self.unauthorized),
            "unknown_upstream": Self::get(&self.unknown_upstream),

            // Rates are null — never 1.0 — when nothing has been observed yet.
            "well_formed_rate": ratio(well_formed, tool_calls),
            // Denominator is repairs actually attempted, not every malformed call.
            "repair_success_rate": ratio(repaired, attempted),
            // Of the repairs we call successful, how many invented a value?
            "fabrication_rate": ratio(fabricated, repaired),

            "request_latency": self.request_latency.json(),
            "repair_latency": self.repair_latency.json(),
        })
    }

    /// Prometheus text exposition: counters and histograms only. Rates belong in
    /// PromQL, where an empty denominator stays empty instead of becoming 1.0.
    pub fn prometheus(&self) -> String {
        let mut out = String::new();
        {
            let mut line = |name: &str, help: &str, val: u64| {
                out.push_str(&format!(
                    "# HELP {name} {help}\n# TYPE {name} counter\n{name} {val}\n"
                ));
            };
            line("tcs_requests_total", "Inbound chat-completion requests", Self::get(&self.requests));
            line("tcs_passthrough_stream_total", "Streaming requests passed through unobserved", Self::get(&self.passthrough_stream));
            line("tcs_stream_measured_total", "Streaming responses measured", Self::get(&self.stream_measured));
            line("tcs_stream_repaired_total", "Streaming responses buffered and repaired", Self::get(&self.stream_repaired));
            line("tcs_tool_calls_total", "Tool calls observed", Self::get(&self.tool_calls));
            line("tcs_recovered_total", "Tool calls rescued by tolerant parsing alone", Self::get(&self.recovered));
            line("tcs_malformed_total", "Malformed/invalid tool calls on first sight", Self::get(&self.malformed));
            line("tcs_malformed_fabricating_total", "Invalid because a required value was absent", Self::get(&self.malformed_fabricating));
            line("tcs_repair_attempted_total", "Repair requests sent upstream", Self::get(&self.repair_attempted));
            line("tcs_repaired_total", "Tool calls repaired successfully", Self::get(&self.repaired));
            line("tcs_repair_exhausted_total", "Repairs that ran out of attempts", Self::get(&self.repair_exhausted));
            line("tcs_repair_skipped_no_schema_total", "Not repaired: no usable schema", Self::get(&self.repair_skipped_no_schema));
            line("tcs_repair_skipped_by_policy_total", "Not repaired: forbidden by policy", Self::get(&self.repair_skipped_by_policy));
            line("tcs_repair_fabricated_total", "Repairs that invented a value", Self::get(&self.repair_fabricated));
            line("tcs_repair_declined_total", "Repairs where the model declined to guess", Self::get(&self.repair_declined));
            line("tcs_upstream_errors_total", "Upstream request failures", Self::get(&self.upstream_errors));
            line("tcs_unauthorized_total", "Requests rejected for missing auth", Self::get(&self.unauthorized));
            line("tcs_unknown_upstream_total", "Requests naming an unregistered upstream", Self::get(&self.unknown_upstream));
        }
        out.push_str(&self.request_latency.prometheus(
            "tcs_request_duration_seconds",
            "End-to-end proxy handling time",
        ));
        out.push_str(&self.repair_latency.prometheus(
            "tcs_repair_duration_seconds",
            "Time spent in the repair loop",
        ));
        out
    }
}

/// `None` when the denominator is zero — an unobserved rate is unknown, not perfect.
fn ratio(num: u64, den: u64) -> Option<f64> {
    if den == 0 {
        None
    } else {
        Some(num as f64 / den as f64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_rates_are_null_not_one() {
        let m = Metrics::default();
        let s = m.snapshot();
        assert!(s["well_formed_rate"].is_null());
        assert!(s["repair_success_rate"].is_null());
        assert!(s["fabrication_rate"].is_null());
    }

    #[test]
    fn repair_success_rate_uses_attempts_as_denominator() {
        let m = Metrics::default();
        // Three malformed calls, but only one was actually attempted (policy
        // blocked the others). Success rate must be 1/1, not 1/3.
        for _ in 0..3 {
            Metrics::inc(&m.malformed);
        }
        Metrics::inc(&m.repair_attempted);
        Metrics::inc(&m.repaired);
        Metrics::inc(&m.repair_skipped_by_policy);
        Metrics::inc(&m.repair_skipped_by_policy);
        let s = m.snapshot();
        assert_eq!(s["repair_success_rate"].as_f64(), Some(1.0));
        assert_eq!(s["repair_skipped_by_policy"].as_u64(), Some(2));
    }

    #[test]
    fn histogram_quantiles() {
        let h = Histogram::default();
        assert!(h.quantile(0.5).is_none());
        for _ in 0..99 {
            h.observe(10);
        }
        h.observe(20_000);
        assert_eq!(h.quantile(0.50), Some(25));
        assert_eq!(h.quantile(0.99), Some(25));
        assert_eq!(h.quantile(1.0), Some(30_000));
    }

    #[test]
    fn quantile_past_the_last_bucket_reports_the_real_max_not_u64_max() {
        // A slow reasoning model can answer well past the 30s top bucket.
        // The quantile used to fall through to u64::MAX (18446744073709551615)
        // for "off the chart" — technically not wrong, but unreadable as a
        // latency number and dishonest for a project whose whole premise is
        // that a dashboard should not report numbers nobody can act on.
        let h = Histogram::default();
        h.observe(5_000);
        h.observe(88_000);
        assert_eq!(h.quantile(0.99), Some(88_000));
        assert_ne!(h.quantile(0.99), Some(u64::MAX));
    }
}
