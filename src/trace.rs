//! In-harness behavior measurement — the "sensor + flight recorder".
//!
//! The proxy already sees every tool call a model emits. A harness drives a task
//! as a *sequence* of `/v1/chat/completions` calls whose `messages` history grows
//! each turn. By correlating those requests into a session, we can measure how the
//! model behaves *inside the harness's loop* — turn count, tool-call sequencing,
//! tool-result errors fed back by the harness, recovery, and how the malformed
//! rate compounds across a multi-turn run.
//!
//! Three things this layer is careful about:
//!
//!  * **Session identity.** Fingerprinting the conversation prefix merges two
//!    runs of the *same* task into one session — which quietly corrupts exactly
//!    the evaluation numbers this tool exists to produce. A run that starts over
//!    (no assistant turns yet, but the live session already has some) forks a new
//!    session instead of joining the old one.
//!  * **Bounded memory.** Sessions are retired by TTL and by capacity, and their
//!    totals are folded into lifetime counters rather than dropped, so retiring a
//!    session never moves a reported rate.
//!  * **Honest denominators.** A session that never called a tool is not a failed
//!    session; it is not a session this metric applies to at all.

use std::collections::{HashMap, VecDeque};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

use crate::validate::Violation;

/// What the proxy actually did with a tool call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    /// Valid on first sight, forwarded byte-for-byte.
    Passthrough,
    /// The model emitted broken JSON (prose, fences, trailing commas) that the
    /// tolerant parser recovered without asking the model anything. The
    /// arguments are rewritten because the raw bytes are not parseable by the
    /// client — that is the whole point — but no repair round-trip was needed.
    Recovered,
    /// Valid on first sight, rewritten as canonical JSON (`--normalize`).
    Normalized,
    /// Invalid, repaired successfully.
    Repaired,
    /// Invalid, repair not permitted by policy — reported, not touched.
    LeftByPolicy,
    /// Invalid, no usable schema — reported, not touched.
    LeftNoSchema,
    /// Invalid, repair attempted and failed.
    RepairFailed,
    /// Invalid, the model declined to guess rather than invent a value.
    Declined,
}

/// Per-tool-call observation within a single request.
#[derive(Debug, Clone, Serialize)]
pub struct ToolCallRecord {
    pub function: String,
    /// Arguments parsed as JSON (possibly after tolerant recovery).
    pub parse_ok: bool,
    /// The raw arguments were not valid JSON and only survived because of
    /// tolerant parsing. Not a schema failure, but still the model emitting
    /// something broken — worth its own number.
    pub recovered: bool,
    /// Arguments validated against the tool's JSON Schema on first sight.
    pub schema_valid: bool,
    /// Whether the failure was a broken value or an absent one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub violation: Option<Violation>,
    /// Required properties that were missing on first sight.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub missing: Vec<String>,
    /// A repair was performed.
    pub repaired: bool,
    /// Fields the repair introduced that appear nowhere in the call or context.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub fabricated: Vec<String>,
    pub action: Action,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ToolCallRecord {
    pub fn is_malformed(&self) -> bool {
        !(self.parse_ok && self.schema_valid)
    }
}

/// How a tool result was judged to be an error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Detection {
    #[default]
    None,
    /// A machine-readable error field was present.
    Structured,
    /// Guessed from the text. Less trustworthy; counted separately.
    Heuristic,
}

/// Summary of tool results the harness fed back *this* turn (results of the
/// previous turn's tool calls).
#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct ToolResultsIn {
    pub count: u32,
    pub errors: u32,
    /// Of `errors`, how many were only a text guess.
    pub errors_heuristic: u32,
}

/// One flight-recorder record per processed request.
#[derive(Debug, Clone, Serialize)]
pub struct RequestEvent {
    pub ts_ms: u128,
    pub session: String,
    /// Turn number as counted by the proxy (authoritative).
    pub turn: u32,
    /// Turn number implied by the message history — informational, and wrong
    /// whenever the harness compacts or rewrites its context.
    pub declared_turn: u32,
    pub model: String,
    /// Which registered upstream served this request.
    pub upstream: String,
    pub dialect: String,
    pub stream: bool,
    pub tool_results_in: ToolResultsIn,
    pub tool_calls: Vec<ToolCallRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<String>,
    /// This response produced a genuine final answer.
    pub reached_final: bool,
    pub duration_ms: u64,
    pub repair_ms: u64,
}

/// Rolling per-session statistics kept in memory for `/sessions`.
#[derive(Debug, Clone, Default, Serialize)]
pub struct SessionStat {
    /// Most recent model/upstream seen on this session. A session normally stays
    /// on one pair; if a harness switches mid-run the last one wins and the
    /// per-model rollup keeps its own call-level totals regardless.
    pub model: String,
    pub upstream: String,
    pub turns: u32,
    pub declared_turns: u32,
    pub tool_calls: u32,
    pub recovered_calls: u32,
    pub malformed: u32,
    pub malformed_fabricating: u32,
    pub repaired: u32,
    pub fabricated: u32,
    pub tool_results_seen: u32,
    pub tool_result_errors: u32,
    pub tool_result_errors_heuristic: u32,
    pub reached_final: bool,
    /// Ordered names of tools called across the session (the call sequence).
    pub sequence: Vec<String>,
    /// Names dropped from the head of `sequence` once it hit its cap.
    pub sequence_dropped: u32,
    pub first_seen_ms: u128,
    pub last_seen_ms: u128,
    /// Assistant turns present in the last request's history — used to notice a
    /// task being restarted rather than continued.
    #[serde(skip)]
    pub last_assistant_count: u32,
}

impl SessionStat {
    /// End-to-end clean = the model never emitted a malformed/invalid call across
    /// the whole in-harness run. This is the metric that compounds (95%^8 ≈ 66%).
    ///
    /// `None` for a session that never called a tool: the metric does not apply,
    /// and folding those into the denominator would understate every model.
    pub fn end_to_end_clean(&self) -> Option<bool> {
        if self.tool_calls == 0 {
            None
        } else {
            Some(self.malformed == 0)
        }
    }

    fn recovered(&self) -> bool {
        self.tool_result_errors > 0 && self.reached_final
    }
}

/// Reliability totals for one (model, upstream) pair — the comparison view.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ModelStat {
    pub model: String,
    pub upstream: String,
    pub requests: u64,
    pub turns: u64,
    pub tool_calls: u64,
    pub recovered_calls: u64,
    pub malformed: u64,
    pub malformed_fabricating: u64,
    pub repaired: u64,
    pub fabricated: u64,
    pub repair_ms: u64,
    pub duration_ms: u64,
    /// Session-level totals, accumulated as sessions retire; live sessions are
    /// added when the rollup is read so no session is counted twice.
    #[serde(skip)]
    pub retired_sessions: u64,
    #[serde(skip)]
    pub retired_tool_using: u64,
    #[serde(skip)]
    pub retired_clean: u64,
}

/// Totals folded in from sessions that have been retired from memory.
#[derive(Debug, Clone, Copy, Default)]
struct Retired {
    sessions: u64,
    tool_using: u64,
    clean: u64,
    multi_turn: u64,
    turns: u64,
    tool_result_errors: u64,
    recovered: u64,
}

/// Sensor limits.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_sessions: usize,
    pub ttl_ms: Option<u128>,
    pub max_sequence_len: usize,
    /// Distinct (model, upstream) pairs tracked for the comparison rollup.
    pub max_models: usize,
    /// Recent request events kept in memory for `/events`. The flight recorder
    /// file is the durable record; this is the live window a dashboard reads.
    pub max_events: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_sessions: 10_000,
            ttl_ms: Some(3_600_000),
            max_sequence_len: 256,
            max_models: 200,
            max_events: 500,
        }
    }
}

/// The sensor: an optional JSONL writer plus a bounded in-memory session store.
pub struct Recorder {
    file: Mutex<Option<BufWriter<File>>>,
    inner: Mutex<Inner>,
    limits: Limits,
}

#[derive(Default)]
struct Inner {
    sessions: HashMap<String, SessionStat>,
    /// (model, upstream) -> reliability totals. Bounded by `max_models`.
    by_model: HashMap<String, ModelStat>,
    /// Newest-last ring of recent events, for `/events`.
    recent: VecDeque<RequestEvent>,
    /// fingerprint -> currently live session key (for restart detection).
    live: HashMap<String, String>,
    retired: Retired,
    ticks: u64,
}

impl Recorder {
    pub fn new(trace_file: Option<&str>, limits: Limits) -> std::io::Result<Self> {
        let file = match trace_file {
            Some(path) => {
                let f = OpenOptions::new().create(true).append(true).open(path)?;
                Some(BufWriter::new(f))
            }
            None => None,
        };
        Ok(Recorder {
            file: Mutex::new(file),
            inner: Mutex::new(Inner::default()),
            limits,
        })
    }

    /// Decide which session a request belongs to, and how many turns the proxy
    /// has now seen for it.
    ///
    /// An explicit header always wins. Otherwise the conversation prefix is
    /// fingerprinted — and if the incoming request has no assistant turns while
    /// the live session for that fingerprint already has some, this is a *new
    /// run of the same task*, not turn N+1, so it forks.
    pub fn resolve_session(&self, req: &Value, header_val: Option<&str>) -> (String, u32) {
        let assistants = assistant_count(req);

        let key = match header_val.filter(|h| !h.is_empty()) {
            Some(h) => h.to_string(),
            None => {
                let fingerprint = fingerprint(req);
                let mut inner = self.inner.lock().unwrap();
                match inner.live.get(&fingerprint).cloned() {
                    Some(live_key) => {
                        let restarted = inner
                            .sessions
                            .get(&live_key)
                            .map(|s| assistants == 0 && s.last_assistant_count > 0)
                            .unwrap_or(false);
                        if restarted {
                            let n = inner
                                .live
                                .values()
                                .filter(|k| k.starts_with(&fingerprint))
                                .count()
                                + 1;
                            let forked = format!("{fingerprint}#{n}");
                            inner.live.insert(fingerprint, forked.clone());
                            forked
                        } else {
                            live_key
                        }
                    }
                    None => {
                        inner.live.insert(fingerprint.clone(), fingerprint.clone());
                        fingerprint
                    }
                }
            }
        };

        // The proxy counts turns itself; the message history is only a hint.
        let inner = self.inner.lock().unwrap();
        let turn = inner
            .sessions
            .get(&key)
            .map(|s| s.turns)
            .unwrap_or(0);
        drop(inner);
        (key, turn)
    }

    /// Record one processed request: append to the trace file (if enabled) and
    /// fold it into the session store.
    pub fn record(&self, ev: &RequestEvent, assistant_count: u32) {
        {
            let mut inner = self.inner.lock().unwrap();
            inner.ticks += 1;

            let cap = self.limits.max_sequence_len;
            let entry = inner.sessions.entry(ev.session.clone()).or_default();
            if entry.first_seen_ms == 0 {
                entry.first_seen_ms = ev.ts_ms;
            }
            entry.last_seen_ms = ev.ts_ms;
            entry.model = ev.model.clone();
            entry.upstream = ev.upstream.clone();
            entry.last_assistant_count = assistant_count;
            entry.turns += 1;
            entry.declared_turns = entry.declared_turns.max(ev.declared_turn + 1);
            entry.tool_calls += ev.tool_calls.len() as u32;
            entry.recovered_calls += ev.tool_calls.iter().filter(|c| c.recovered).count() as u32;
            entry.malformed += ev.tool_calls.iter().filter(|c| c.is_malformed()).count() as u32;
            entry.malformed_fabricating += ev
                .tool_calls
                .iter()
                .filter(|c| c.violation == Some(Violation::Fabricating))
                .count() as u32;
            entry.repaired += ev.tool_calls.iter().filter(|c| c.repaired).count() as u32;
            entry.fabricated += ev
                .tool_calls
                .iter()
                .filter(|c| !c.fabricated.is_empty())
                .count() as u32;
            entry.tool_results_seen += ev.tool_results_in.count;
            entry.tool_result_errors += ev.tool_results_in.errors;
            entry.tool_result_errors_heuristic += ev.tool_results_in.errors_heuristic;
            entry.reached_final |= ev.reached_final;
            for c in &ev.tool_calls {
                entry.sequence.push(c.function.clone());
            }
            if entry.sequence.len() > cap {
                let excess = entry.sequence.len() - cap;
                entry.sequence.drain(0..excess);
                entry.sequence_dropped += excess as u32;
            }

            // Per-model call-level totals. Session-level ones are folded in at
            // eviction and topped up from live sessions on read.
            let key = crate::upstream::model_key(&ev.model, &ev.upstream);
            if inner.by_model.len() < self.limits.max_models || inner.by_model.contains_key(&key) {
                let m = inner.by_model.entry(key).or_insert_with(|| ModelStat {
                    model: ev.model.clone(),
                    upstream: ev.upstream.clone(),
                    ..Default::default()
                });
                m.requests += 1;
                m.turns += 1;
                m.tool_calls += ev.tool_calls.len() as u64;
                m.recovered_calls += ev.tool_calls.iter().filter(|c| c.recovered).count() as u64;
                m.malformed += ev.tool_calls.iter().filter(|c| c.is_malformed()).count() as u64;
                m.malformed_fabricating += ev
                    .tool_calls
                    .iter()
                    .filter(|c| c.violation == Some(Violation::Fabricating))
                    .count() as u64;
                m.repaired += ev.tool_calls.iter().filter(|c| c.repaired).count() as u64;
                m.fabricated += ev
                    .tool_calls
                    .iter()
                    .filter(|c| !c.fabricated.is_empty())
                    .count() as u64;
                m.repair_ms += ev.repair_ms;
                m.duration_ms += ev.duration_ms;
            }

            inner.recent.push_back(ev.clone());
            while inner.recent.len() > self.limits.max_events {
                inner.recent.pop_front();
            }

            let sweep_due = inner.ticks.is_multiple_of(256);
            if sweep_due || inner.sessions.len() > self.limits.max_sessions {
                self.evict(&mut inner, ev.ts_ms);
            }
        }

        // Append to the flight recorder.
        if let Ok(mut guard) = self.file.lock()
            && let Some(w) = guard.as_mut()
            && let Ok(line) = serde_json::to_string(ev)
        {
            let _ = writeln!(w, "{line}");
            let _ = w.flush();
        }
    }

    /// Retire expired and excess sessions, folding their totals into lifetime
    /// counters so no reported rate moves as a result.
    fn evict(&self, inner: &mut Inner, now_ms: u128) {
        let mut doomed: Vec<String> = Vec::new();

        if let Some(ttl) = self.limits.ttl_ms {
            for (k, s) in inner.sessions.iter() {
                if now_ms.saturating_sub(s.last_seen_ms) > ttl {
                    doomed.push(k.clone());
                }
            }
        }

        let over = (inner.sessions.len() - doomed.len()).saturating_sub(self.limits.max_sessions);
        if over > 0 {
            let mut by_age: Vec<(u128, String)> = inner
                .sessions
                .iter()
                .filter(|(k, _)| !doomed.contains(k))
                .map(|(k, s)| (s.last_seen_ms, k.clone()))
                .collect();
            by_age.sort_by_key(|(ts, _)| *ts);
            doomed.extend(by_age.into_iter().take(over).map(|(_, k)| k));
        }

        for key in doomed {
            if let Some(s) = inner.sessions.remove(&key) {
                let r = &mut inner.retired;
                r.sessions += 1;
                r.turns += s.turns as u64;
                if s.turns > 1 {
                    r.multi_turn += 1;
                }
                match s.end_to_end_clean() {
                    Some(true) => {
                        r.tool_using += 1;
                        r.clean += 1;
                    }
                    Some(false) => r.tool_using += 1,
                    None => {}
                }
                r.tool_result_errors += s.tool_result_errors as u64;
                if s.recovered() {
                    r.recovered += 1;
                }

                let key = crate::upstream::model_key(&s.model, &s.upstream);
                if let Some(m) = inner.by_model.get_mut(&key) {
                    m.retired_sessions += 1;
                    match s.end_to_end_clean() {
                        Some(true) => {
                            m.retired_tool_using += 1;
                            m.retired_clean += 1;
                        }
                        Some(false) => m.retired_tool_using += 1,
                        None => {}
                    }
                }
            }
            inner.live.retain(|_, v| v != &key);
        }
    }

    /// Detailed per-session rollup for the `/sessions` endpoint.
    ///
    /// Snapshots under the lock and serializes after releasing it, so polling
    /// this endpoint cannot stall request handling.
    pub fn sessions_json(&self, limit: usize, offset: usize) -> Value {
        let (rows, total) = {
            let inner = self.inner.lock().unwrap();
            let total = inner.sessions.len();
            let mut rows: Vec<(String, SessionStat)> = inner
                .sessions
                .iter()
                .map(|(k, s)| (k.clone(), s.clone()))
                .collect();
            rows.sort_by(|a, b| b.1.last_seen_ms.cmp(&a.1.last_seen_ms).then(a.0.cmp(&b.0)));
            (
                rows.into_iter().skip(offset).take(limit).collect::<Vec<_>>(),
                total,
            )
        };

        let sessions: Vec<Value> = rows
            .into_iter()
            .map(|(k, s)| {
                serde_json::json!({
                    "session": k,
                    "model": s.model,
                    "upstream": s.upstream,
                    "turns": s.turns,
                    "declared_turns": s.declared_turns,
                    "tool_calls": s.tool_calls,
                    "recovered_calls": s.recovered_calls,
                    "malformed": s.malformed,
                    "malformed_fabricating": s.malformed_fabricating,
                    "repaired": s.repaired,
                    "fabricated": s.fabricated,
                    "tool_results_seen": s.tool_results_seen,
                    "tool_result_errors": s.tool_result_errors,
                    "tool_result_errors_heuristic": s.tool_result_errors_heuristic,
                    "reached_final": s.reached_final,
                    "recovered": s.recovered(),
                    "end_to_end_clean": s.end_to_end_clean(),
                    "sequence": s.sequence,
                    "sequence_dropped": s.sequence_dropped,
                    "first_seen_ms": s.first_seen_ms,
                    "last_seen_ms": s.last_seen_ms,
                })
            })
            .collect();

        serde_json::json!({
            "total": total,
            "offset": offset,
            "limit": limit,
            "sessions": sessions,
        })
    }

    /// Recent request events, newest first, optionally filtered to one session.
    ///
    /// The per-call detail — which action was taken, whether the failure was a
    /// broken value or an absent one, which fields a repair invented — only
    /// exists here and in the trace file. A dashboard needs it to explain a
    /// number rather than just show it.
    pub fn events_json(&self, session: Option<&str>, limit: usize) -> Value {
        let inner = self.inner.lock().unwrap();
        let events: Vec<&RequestEvent> = inner
            .recent
            .iter()
            .rev()
            .filter(|e| session.is_none_or(|s| e.session == s))
            .take(limit)
            .collect();
        serde_json::json!({
            "kept": inner.recent.len(),
            "capacity": self.limits.max_events,
            "events": events,
        })
    }

    /// Reliability broken down by (model, upstream) — the comparison view.
    ///
    /// Call-level totals come from the running counters; session-level ones from
    /// retired sessions plus the live ones, so a session is counted exactly once
    /// whether or not it has been evicted.
    pub fn models_json(&self) -> Value {
        let inner = self.inner.lock().unwrap();

        let mut rows: HashMap<String, (ModelStat, u64, u64, u64)> = inner
            .by_model
            .iter()
            .map(|(k, v)| (k.clone(), (v.clone(), v.retired_sessions, v.retired_tool_using, v.retired_clean)))
            .collect();

        for s in inner.sessions.values() {
            let key = crate::upstream::model_key(&s.model, &s.upstream);
            let slot = rows.entry(key).or_insert_with(|| {
                (
                    ModelStat {
                        model: s.model.clone(),
                        upstream: s.upstream.clone(),
                        ..Default::default()
                    },
                    0,
                    0,
                    0,
                )
            });
            slot.1 += 1;
            match s.end_to_end_clean() {
                Some(true) => {
                    slot.2 += 1;
                    slot.3 += 1;
                }
                Some(false) => slot.2 += 1,
                None => {}
            }
        }

        let mut out: Vec<Value> = rows
            .into_values()
            .map(|(m, sessions, tool_using, clean)| {
                let well_formed = m.tool_calls.saturating_sub(m.malformed);
                serde_json::json!({
                    "model": m.model,
                    "upstream": m.upstream,
                    "requests": m.requests,
                    "tool_calls": m.tool_calls,
                    "well_formed": well_formed,
                    "recovered_calls": m.recovered_calls,
                    "malformed": m.malformed,
                    "malformed_fabricating": m.malformed_fabricating,
                    "repaired": m.repaired,
                    "fabricated": m.fabricated,
                    "sessions": sessions,
                    "tool_using_sessions": tool_using,
                    "end_to_end_clean_sessions": clean,
                    // Same rule as everywhere else: an unobserved rate is null.
                    "well_formed_rate": rate(well_formed, m.tool_calls),
                    "fabrication_rate": rate(m.fabricated, m.repaired),
                    "end_to_end_clean_rate": rate(clean, tool_using),
                    "mean_ms": rate(m.duration_ms, m.requests),
                    "mean_repair_ms": rate(m.repair_ms, m.requests),
                })
            })
            .collect();
        out.sort_by(|a, b| {
            b["tool_calls"]
                .as_u64()
                .cmp(&a["tool_calls"].as_u64())
                .then_with(|| a["model"].as_str().cmp(&b["model"].as_str()))
        });

        serde_json::json!({ "models": out, "tracked": inner.by_model.len(), "capacity": self.limits.max_models })
    }

    /// Aggregate in-harness behavior summary for `/metrics?format=json`.
    pub fn summary_json(&self) -> Value {
        let inner = self.inner.lock().unwrap();
        let r = inner.retired;

        let mut sessions = r.sessions;
        let mut tool_using = r.tool_using;
        let mut clean = r.clean;
        let mut multi_turn = r.multi_turn;
        let mut turns = r.turns;
        let mut tool_result_errors = r.tool_result_errors;
        let mut recovered = r.recovered;

        for s in inner.sessions.values() {
            sessions += 1;
            turns += s.turns as u64;
            if s.turns > 1 {
                multi_turn += 1;
            }
            match s.end_to_end_clean() {
                Some(true) => {
                    tool_using += 1;
                    clean += 1;
                }
                Some(false) => tool_using += 1,
                None => {}
            }
            tool_result_errors += s.tool_result_errors as u64;
            if s.recovered() {
                recovered += 1;
            }
        }

        serde_json::json!({
            "sessions": sessions,
            "live_sessions": inner.sessions.len(),
            "retired_sessions": r.sessions,
            "multi_turn_sessions": multi_turn,
            "avg_turns": if sessions == 0 { None } else { Some(turns as f64 / sessions as f64) },
            // Denominator is sessions that actually called a tool. A chat-only
            // session is not a failed session.
            "tool_using_sessions": tool_using,
            "end_to_end_clean_sessions": clean,
            "end_to_end_clean_rate": if tool_using == 0 { None } else { Some(clean as f64 / tool_using as f64) },
            "tool_result_errors_observed": tool_result_errors,
            "sessions_with_recovery": recovered,
        })
    }
}

/// `None` for a zero denominator — an unobserved rate is unknown, not perfect.
fn rate(num: u64, den: u64) -> Option<f64> {
    if den == 0 {
        None
    } else {
        Some(num as f64 / den as f64)
    }
}

/// Current unix time in milliseconds (0 if the clock is before the epoch).
pub fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// FNV-1a. Unlike `DefaultHasher` this is stable across builds, which matters
/// because session ids are written into trace files that outlive the process.
fn fnv1a(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    hash
}

/// Fingerprint the conversation prefix (first system + first user message),
/// which is stable across the turns of a single task as the history grows.
pub fn fingerprint(req: &Value) -> String {
    let mut seed = String::new();
    let mut has_system = false;
    let mut has_user = false;
    if let Some(msgs) = req.get("messages").and_then(Value::as_array) {
        for m in msgs {
            let role = m.get("role").and_then(Value::as_str).unwrap_or("");
            if role == "system" && !has_system {
                seed.push_str(&message_text(m));
                seed.push('\u{1}');
                has_system = true;
            } else if role == "user" && !has_user {
                seed.push_str(&message_text(m));
                has_user = true;
                break; // first user message marks the start of a task
            }
        }
    }
    if !has_system && !has_user {
        seed.push_str("unknown");
    }
    format!("sess-{:016x}", fnv1a(seed.as_bytes()))
}

/// Assistant turns present in the request history.
pub fn assistant_count(req: &Value) -> u32 {
    req.get("messages")
        .and_then(Value::as_array)
        .map(|msgs| {
            msgs.iter()
                .filter(|m| m.get("role").and_then(Value::as_str) == Some("assistant"))
                .count() as u32
        })
        .unwrap_or(0)
}

/// Count the tool results the harness fed back *this* turn — the `role: "tool"`
/// messages that appear after the last assistant message — and how many are errors.
pub fn tool_results_in(req: &Value) -> ToolResultsIn {
    let Some(msgs) = req.get("messages").and_then(Value::as_array) else {
        return ToolResultsIn::default();
    };
    let last_assistant = msgs
        .iter()
        .rposition(|m| m.get("role").and_then(Value::as_str) == Some("assistant"));
    let start = last_assistant.map(|i| i + 1).unwrap_or(0);
    let mut out = ToolResultsIn::default();
    for m in &msgs[start..] {
        let role = m.get("role").and_then(Value::as_str).unwrap_or("");
        if role == "tool" || role == "function" {
            out.count += 1;
            match classify_tool_result(&message_text(m)) {
                Detection::Structured => out.errors += 1,
                Detection::Heuristic => {
                    out.errors += 1;
                    out.errors_heuristic += 1;
                }
                Detection::None => {}
            }
        }
    }
    out
}

/// Extract a text view of a message's `content`, which may be a string or an
/// array of content parts.
fn message_text(m: &Value) -> String {
    match m.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(" "),
        _ => String::new(),
    }
}

/// Does a tool-result payload indicate an error?
///
/// Structured evidence first. Substring matching is a last resort and is
/// reported separately, because a tool that answers `"0 failed tests"` is not
/// reporting a failure — and counting it as one inflates the recovery metric.
pub fn classify_tool_result(content: &str) -> Detection {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Detection::None;
    }

    if let Ok(v) = serde_json::from_str::<Value>(trimmed)
        && let Some(obj) = v.as_object()
    {
        let truthy_error = |v: &Value| match v {
            Value::Null => false,
            Value::Bool(b) => *b,
            Value::String(s) => !s.is_empty(),
            _ => true,
        };
        if obj.get("error").map(truthy_error).unwrap_or(false)
            || obj.get("isError").and_then(Value::as_bool).unwrap_or(false)
            || obj.get("is_error").and_then(Value::as_bool).unwrap_or(false)
            || obj.get("ok").and_then(Value::as_bool).map(|b| !b).unwrap_or(false)
            || obj
                .get("success")
                .and_then(Value::as_bool)
                .map(|b| !b)
                .unwrap_or(false)
        {
            return Detection::Structured;
        }
        if let Some(status) = obj.get("status").and_then(Value::as_str) {
            let s = status.to_ascii_lowercase();
            if s == "error" || s == "failed" || s == "failure" {
                return Detection::Structured;
            }
        }
        // Parsed cleanly and said nothing about an error: trust it.
        return Detection::None;
    }

    // Not JSON. Narrow, anchored heuristics only.
    let lower = trimmed.to_ascii_lowercase();
    let hit = lower.starts_with("error")
        || lower.starts_with("exception")
        || lower.starts_with("traceback")
        || lower.contains("traceback (most recent call last)");
    if hit { Detection::Heuristic } else { Detection::None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn rec() -> Recorder {
        Recorder::new(None, Limits::default()).unwrap()
    }

    fn event(session: &str, tool_calls: Vec<ToolCallRecord>) -> RequestEvent {
        RequestEvent {
            ts_ms: 1_000,
            session: session.to_string(),
            turn: 0,
            declared_turn: 0,
            model: "m".into(),
            upstream: "default".into(),
            dialect: "generic".into(),
            stream: false,
            tool_results_in: ToolResultsIn::default(),
            reached_final: tool_calls.is_empty(),
            tool_calls,
            finish_reason: Some("stop".into()),
            duration_ms: 1,
            repair_ms: 0,
        }
    }

    fn call(name: &str, ok: bool) -> ToolCallRecord {
        ToolCallRecord {
            function: name.into(),
            parse_ok: true,
            recovered: false,
            schema_valid: ok,
            violation: if ok { None } else { Some(Violation::Syntactic) },
            missing: vec![],
            repaired: false,
            fabricated: vec![],
            action: if ok { Action::Passthrough } else { Action::RepairFailed },
            error: None,
        }
    }

    #[test]
    fn fingerprint_stable_across_turns() {
        let t1 = json!({"messages":[{"role":"system","content":"You are helpful"},{"role":"user","content":"do X"}]});
        let t2 = json!({"messages":[
            {"role":"system","content":"You are helpful"},
            {"role":"user","content":"do X"},
            {"role":"assistant","content":null},
            {"role":"tool","content":"{\"ok\":true}"}
        ]});
        assert_eq!(fingerprint(&t1), fingerprint(&t2));
    }

    #[test]
    fn header_overrides_fingerprint() {
        let r = rec();
        let req = json!({"messages":[]});
        assert_eq!(r.resolve_session(&req, Some("abc")).0, "abc");
    }

    #[test]
    fn rerunning_the_same_task_forks_a_new_session() {
        let r = rec();
        let turn0 = json!({"messages":[
            {"role":"system","content":"sys"},{"role":"user","content":"task"}
        ]});
        let turn1 = json!({"messages":[
            {"role":"system","content":"sys"},{"role":"user","content":"task"},
            {"role":"assistant","content":null},{"role":"tool","content":"{}"}
        ]});

        let (s0, t0) = r.resolve_session(&turn0, None);
        r.record(&event(&s0, vec![call("a", true)]), assistant_count(&turn0));
        assert_eq!(t0, 0);

        let (s1, t1) = r.resolve_session(&turn1, None);
        r.record(&event(&s1, vec![call("b", true)]), assistant_count(&turn1));
        assert_eq!(s1, s0, "turn 2 of the same run must join the session");
        assert_eq!(t1, 1, "the proxy counts turns itself");

        // A second run of the identical task starts over: no assistant turns.
        let (s2, t2) = r.resolve_session(&turn0, None);
        assert_ne!(s2, s0, "a re-run must not merge into the first run");
        assert_eq!(t2, 0);
    }

    #[test]
    fn tool_results_counts_only_latest_turn() {
        let req = json!({"messages":[
            {"role":"assistant","content":null},
            {"role":"tool","content":"{\"ok\":true}"},
            {"role":"assistant","content":null},
            {"role":"tool","content":"{\"error\":\"boom\"}"}
        ]});
        let r = tool_results_in(&req);
        assert_eq!(r.count, 1);
        assert_eq!(r.errors, 1);
        assert_eq!(r.errors_heuristic, 0);
    }

    #[test]
    fn zero_failed_tests_is_not_an_error() {
        // The old substring rule counted this as a tool failure.
        assert_eq!(
            classify_tool_result(r#"{"summary":"12 passed, 0 failed"}"#),
            Detection::None
        );
        assert_eq!(classify_tool_result("Error: connection refused"), Detection::Heuristic);
        assert_eq!(classify_tool_result(r#"{"ok":false}"#), Detection::Structured);
        assert_eq!(classify_tool_result(r#"{"status":"error"}"#), Detection::Structured);
        assert_eq!(classify_tool_result("all 3 checks failed to be needed"), Detection::None);
    }

    #[test]
    fn chat_only_sessions_do_not_drag_the_clean_rate() {
        let r = rec();
        r.record(&event("with-tools", vec![call("a", true)]), 0);
        r.record(&event("chat-only", vec![]), 0);
        let s = r.summary_json();
        assert_eq!(s["sessions"].as_u64(), Some(2));
        assert_eq!(s["tool_using_sessions"].as_u64(), Some(1));
        assert_eq!(s["end_to_end_clean_rate"].as_f64(), Some(1.0));
    }

    #[test]
    fn eviction_preserves_the_clean_rate() {
        let limits = Limits { max_sessions: 2, ttl_ms: None, max_sequence_len: 8, max_models: 20, max_events: 50 };
        let r = Recorder::new(None, limits).unwrap();
        for i in 0..8 {
            let mut ev = event(&format!("s{i}"), vec![call("a", i % 2 == 0)]);
            ev.ts_ms = 1000 + i as u128;
            r.record(&ev, 0);
        }
        let s = r.summary_json();
        assert_eq!(s["sessions"].as_u64(), Some(8), "retired sessions still count");
        assert_eq!(s["tool_using_sessions"].as_u64(), Some(8));
        assert_eq!(s["end_to_end_clean_rate"].as_f64(), Some(0.5));
        assert!(s["live_sessions"].as_u64().unwrap() <= 2, "memory stays bounded");
    }

    #[test]
    fn sequence_is_capped() {
        let limits = Limits { max_sessions: 10, ttl_ms: None, max_sequence_len: 3, max_models: 20, max_events: 50 };
        let r = Recorder::new(None, limits).unwrap();
        for i in 0..10 {
            r.record(&event("s", vec![call(&format!("t{i}"), true)]), 0);
        }
        let out = r.sessions_json(10, 0);
        let seq = out["sessions"][0]["sequence"].as_array().unwrap();
        assert_eq!(seq.len(), 3);
        assert_eq!(out["sessions"][0]["sequence_dropped"].as_u64(), Some(7));
    }
}
