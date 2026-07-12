//! In-harness behavior measurement — the "sensor + flight recorder".
//!
//! The proxy already sees every tool call a model emits. A harness drives a task
//! as a *sequence* of `/v1/chat/completions` calls whose `messages` history grows
//! each turn. By correlating those requests into a session, we can measure how the
//! model behaves *inside the harness's loop* — turn count, tool-call sequencing,
//! tool-result errors fed back by the harness, recovery, and how the malformed
//! rate compounds across a multi-turn run.
//!
//! This is additive: it never alters the proxied response. Run with `--no-repair`
//! for a pure measurement of raw in-harness behavior, or with repair on to measure
//! the mitigated behavior.

use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::fs::{File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{BufWriter, Write};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::Value;

/// Per-tool-call observation within a single request.
#[derive(Debug, Clone, Serialize)]
pub struct ToolCallRecord {
    pub function: String,
    /// Arguments parsed as JSON (possibly after tolerant recovery).
    pub parse_ok: bool,
    /// Arguments validated against the tool's JSON Schema on first sight.
    pub schema_valid: bool,
    /// A repair was performed (only when repair is enabled).
    pub repaired: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Summary of tool results the harness fed back *this* turn (results of the
/// previous turn's tool calls).
#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct ToolResultsIn {
    pub count: u32,
    pub errors: u32,
}

/// One flight-recorder record per processed (non-streaming) request.
#[derive(Debug, Clone, Serialize)]
pub struct RequestEvent {
    pub ts_ms: u128,
    pub session: String,
    pub turn: u32,
    pub model: String,
    pub dialect: String,
    pub tool_results_in: ToolResultsIn,
    pub tool_calls: Vec<ToolCallRecord>,
    /// This response produced a final answer (no tool calls).
    pub reached_final: bool,
}

/// Rolling per-session statistics kept in memory for `/sessions`.
#[derive(Debug, Clone, Default, Serialize)]
pub struct SessionStat {
    pub turns: u32,
    pub tool_calls: u32,
    pub malformed: u32,
    pub repaired: u32,
    pub tool_results_seen: u32,
    pub tool_result_errors: u32,
    pub reached_final: bool,
    /// Ordered names of tools called across the session (the call sequence).
    pub sequence: Vec<String>,
}

impl SessionStat {
    /// End-to-end clean = the model never emitted a malformed/invalid call across
    /// the whole in-harness run. This is the metric that compounds (95%^8 ≈ 66%).
    pub fn end_to_end_clean(&self) -> bool {
        self.malformed == 0 && self.tool_calls > 0
    }
}

/// The sensor: an optional JSONL writer plus an in-memory session store.
pub struct Recorder {
    file: Mutex<Option<BufWriter<File>>>,
    sessions: Mutex<HashMap<String, SessionStat>>,
}

impl Recorder {
    pub fn new(trace_file: Option<&str>) -> std::io::Result<Self> {
        let file = match trace_file {
            Some(path) => {
                let f = OpenOptions::new().create(true).append(true).open(path)?;
                Some(BufWriter::new(f))
            }
            None => None,
        };
        Ok(Recorder {
            file: Mutex::new(file),
            sessions: Mutex::new(HashMap::new()),
        })
    }

    /// Record one processed request: append to the trace file (if enabled) and
    /// fold it into the session store.
    pub fn record(&self, ev: &RequestEvent) {
        // Update in-memory session rollup.
        {
            let mut map = self.sessions.lock().unwrap();
            let s = map.entry(ev.session.clone()).or_default();
            s.turns = s.turns.max(ev.turn + 1);
            s.tool_calls += ev.tool_calls.len() as u32;
            s.malformed += ev
                .tool_calls
                .iter()
                .filter(|c| !(c.parse_ok && c.schema_valid))
                .count() as u32;
            s.repaired += ev.tool_calls.iter().filter(|c| c.repaired).count() as u32;
            s.tool_results_seen += ev.tool_results_in.count;
            s.tool_result_errors += ev.tool_results_in.errors;
            s.reached_final |= ev.reached_final;
            for c in &ev.tool_calls {
                s.sequence.push(c.function.clone());
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

    /// Detailed per-session rollup for the `/sessions` endpoint.
    pub fn sessions_json(&self) -> Value {
        let map = self.sessions.lock().unwrap();
        let mut out: Vec<Value> = map
            .iter()
            .map(|(k, s)| {
                serde_json::json!({
                    "session": k,
                    "turns": s.turns,
                    "tool_calls": s.tool_calls,
                    "malformed": s.malformed,
                    "repaired": s.repaired,
                    "tool_results_seen": s.tool_results_seen,
                    "tool_result_errors": s.tool_result_errors,
                    "reached_final": s.reached_final,
                    "end_to_end_clean": s.end_to_end_clean(),
                    "sequence": s.sequence,
                })
            })
            .collect();
        out.sort_by(|a, b| {
            a["session"]
                .as_str()
                .unwrap_or("")
                .cmp(b["session"].as_str().unwrap_or(""))
        });
        Value::Array(out)
    }

    /// Aggregate in-harness behavior summary for `/metrics?format=json`.
    pub fn summary_json(&self) -> Value {
        let map = self.sessions.lock().unwrap();
        let n = map.len() as u64;
        if n == 0 {
            return serde_json::json!({ "sessions": 0 });
        }
        let mut total_turns = 0u64;
        let mut multi_turn_sessions = 0u64;
        let mut clean_sessions = 0u64;
        let mut tool_result_errors = 0u64;
        let mut sessions_with_recovery = 0u64;
        for s in map.values() {
            total_turns += s.turns as u64;
            if s.turns > 1 {
                multi_turn_sessions += 1;
            }
            if s.end_to_end_clean() {
                clean_sessions += 1;
            }
            tool_result_errors += s.tool_result_errors as u64;
            // A session that saw a tool-result error yet still reached a final
            // answer is evidence of harness/model recovery.
            if s.tool_result_errors > 0 && s.reached_final {
                sessions_with_recovery += 1;
            }
        }
        serde_json::json!({
            "sessions": n,
            "multi_turn_sessions": multi_turn_sessions,
            "avg_turns": total_turns as f64 / n as f64,
            "end_to_end_clean_sessions": clean_sessions,
            "end_to_end_clean_rate": clean_sessions as f64 / n as f64,
            "tool_result_errors_observed": tool_result_errors,
            "sessions_with_recovery": sessions_with_recovery,
        })
    }
}

/// Current unix time in milliseconds (0 if the clock is before the epoch).
pub fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Correlate a request into a session.
///
/// Prefers an explicit session header; otherwise fingerprints the conversation
/// prefix (first system + first user message), which is stable across the turns
/// of a single task even as the message history grows.
pub fn session_key(req: &Value, header_val: Option<&str>) -> String {
    if let Some(h) = header_val.filter(|h| !h.is_empty()) {
        return h.to_string();
    }
    let mut hasher = DefaultHasher::new();
    let mut hashed_system = false;
    let mut hashed_user = false;
    if let Some(msgs) = req.get("messages").and_then(Value::as_array) {
        for m in msgs {
            let role = m.get("role").and_then(Value::as_str).unwrap_or("");
            let content = message_text(m);
            if role == "system" && !hashed_system {
                content.hash(&mut hasher);
                hashed_system = true;
            } else if role == "user" && !hashed_user {
                content.hash(&mut hasher);
                hashed_user = true;
                break; // first user message marks the start of a task
            }
        }
    }
    if !hashed_system && !hashed_user {
        "unknown".hash(&mut hasher);
    }
    format!("sess-{:016x}", hasher.finish())
}

/// Which turn of the session this request represents: the number of assistant
/// messages already present in the history (0 for the opening request).
pub fn turn_index(req: &Value) -> u32 {
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
/// messages that appear after the last assistant message — and how many look
/// like errors.
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
            if looks_like_error(&message_text(m)) {
                out.errors += 1;
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

/// Heuristic: does a tool-result payload indicate an error?
fn looks_like_error(content: &str) -> bool {
    let c = content.to_ascii_lowercase();
    c.contains("\"error\"")
        || c.contains("error:")
        || c.contains("exception")
        || c.contains("traceback")
        || c.contains("\"status\":\"error\"")
        || c.contains("failed")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn session_key_stable_across_turns() {
        let t1 = json!({"messages":[{"role":"system","content":"You are helpful"},{"role":"user","content":"do X"}]});
        let t2 = json!({"messages":[
            {"role":"system","content":"You are helpful"},
            {"role":"user","content":"do X"},
            {"role":"assistant","content":null},
            {"role":"tool","content":"{\"ok\":true}"}
        ]});
        assert_eq!(session_key(&t1, None), session_key(&t2, None));
    }

    #[test]
    fn header_overrides_fingerprint() {
        let req = json!({"messages":[]});
        assert_eq!(session_key(&req, Some("abc")), "abc");
    }

    #[test]
    fn turn_index_counts_assistant_turns() {
        let req = json!({"messages":[
            {"role":"user","content":"x"},
            {"role":"assistant","content":null},
            {"role":"tool","content":"r"},
            {"role":"assistant","content":null},
            {"role":"tool","content":"r"}
        ]});
        assert_eq!(turn_index(&req), 2);
    }

    #[test]
    fn tool_results_counts_only_latest_turn() {
        // Two tool results total, but only the one after the last assistant is "new".
        let req = json!({"messages":[
            {"role":"assistant","content":null},
            {"role":"tool","content":"{\"ok\":true}"},
            {"role":"assistant","content":null},
            {"role":"tool","content":"{\"error\":\"boom\"}"}
        ]});
        let r = tool_results_in(&req);
        assert_eq!(r.count, 1);
        assert_eq!(r.errors, 1);
    }
}
