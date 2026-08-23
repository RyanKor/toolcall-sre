//! Server-sent-event handling for streaming chat completions.
//!
//! A streaming response is the common case for real harnesses, and the proxy
//! used to hand it straight through — no repair *and no measurement*. Repair
//! genuinely needs the whole response; measurement does not. This module
//! reassembles `delta.tool_calls` fragments as they fly past so the sensor keeps
//! working at zero added latency, and can also re-emit a corrected stream when
//! the operator opts into buffered repair.
//!
//! Tool-call deltas are consumed by the harness's parser, never read by a human,
//! so buffering *those* costs no perceived latency — which is what makes
//! `--repair-streaming` a reasonable thing to offer at all.

use serde_json::Value;

/// One tool call rebuilt from its deltas.
#[derive(Debug, Clone, Default)]
pub struct StreamedCall {
    pub id: String,
    pub name: String,
    /// Concatenated `function.arguments` fragments, exactly as the model emitted.
    pub arguments: String,
}

/// What a finished stream turned out to contain.
#[derive(Debug, Clone, Default)]
pub struct Assembled {
    pub calls: Vec<StreamedCall>,
    pub finish_reason: Option<String>,
    pub content_chars: usize,
    pub id: String,
    pub model: String,
    pub created: u64,
    pub saw_done: bool,
}

/// Incremental SSE reader that rebuilds tool calls from `delta` fragments.
#[derive(Debug, Default)]
pub struct Accumulator {
    /// Bytes of a line not yet terminated by `\n`.
    partial: Vec<u8>,
    /// Tool calls by their `index` within the choice (choice 0 only — a
    /// streaming harness with n>1 is not a thing in practice).
    calls: Vec<StreamedCall>,
    out: Assembled,
}

impl Accumulator {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed raw bytes as they arrive. Safe to call with arbitrary chunk splits.
    pub fn feed(&mut self, bytes: &[u8]) {
        self.partial.extend_from_slice(bytes);
        while let Some(nl) = self.partial.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = self.partial.drain(..=nl).collect();
            let line = String::from_utf8_lossy(&line[..line.len() - 1]);
            self.line(line.trim_end_matches('\r'));
        }
    }

    fn line(&mut self, line: &str) {
        let Some(data) = line.strip_prefix("data:") else {
            return; // comments, event:, id:, blank separators
        };
        let data = data.trim();
        if data == "[DONE]" {
            self.out.saw_done = true;
            return;
        }
        let Ok(chunk) = serde_json::from_str::<Value>(data) else {
            return;
        };

        if self.out.id.is_empty() {
            self.out.id = chunk["id"].as_str().unwrap_or("").to_string();
            self.out.model = chunk["model"].as_str().unwrap_or("").to_string();
            self.out.created = chunk["created"].as_u64().unwrap_or(0);
        }

        let Some(choices) = chunk.get("choices").and_then(Value::as_array) else {
            return;
        };
        for choice in choices {
            if let Some(fr) = choice.get("finish_reason").and_then(Value::as_str) {
                self.out.finish_reason = Some(fr.to_string());
            }
            let delta = &choice["delta"];
            if let Some(c) = delta.get("content").and_then(Value::as_str) {
                self.out.content_chars += c.chars().count();
            }
            let Some(tcs) = delta.get("tool_calls").and_then(Value::as_array) else {
                continue;
            };
            for tc in tcs {
                let idx = tc.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                if self.calls.len() <= idx {
                    self.calls.resize(idx + 1, StreamedCall::default());
                }
                let slot = &mut self.calls[idx];
                if let Some(id) = tc.get("id").and_then(Value::as_str)
                    && !id.is_empty()
                {
                    slot.id = id.to_string();
                }
                let f = &tc["function"];
                if let Some(name) = f.get("name").and_then(Value::as_str)
                    && !name.is_empty()
                {
                    slot.name.push_str(name);
                }
                if let Some(args) = f.get("arguments").and_then(Value::as_str) {
                    slot.arguments.push_str(args);
                }
            }
        }
    }

    /// Finish reading and hand back what the stream contained.
    pub fn finish(mut self) -> Assembled {
        self.out.calls = std::mem::take(&mut self.calls);
        self.out
    }
}

/// Render a complete SSE body for a tool-call response whose arguments have been
/// corrected. Emitted as: role delta → one delta per tool call carrying the full
/// arguments → finish_reason → `[DONE]`.
pub fn render_tool_call_stream(a: &Assembled, corrected: &[StreamedCall]) -> String {
    let id = if a.id.is_empty() { "chatcmpl-tcs" } else { &a.id };
    let mut out = String::new();

    let head = serde_json::json!({
        "id": id, "object": "chat.completion.chunk", "created": a.created, "model": a.model,
        "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": Value::Null}]
    });
    out.push_str(&format!("data: {head}\n\n"));

    for (i, c) in corrected.iter().enumerate() {
        let chunk = serde_json::json!({
            "id": id, "object": "chat.completion.chunk", "created": a.created, "model": a.model,
            "choices": [{
                "index": 0,
                "delta": {"tool_calls": [{
                    "index": i,
                    "id": if c.id.is_empty() { format!("call_{i}") } else { c.id.clone() },
                    "type": "function",
                    "function": {"name": c.name, "arguments": c.arguments}
                }]},
                "finish_reason": Value::Null
            }]
        });
        out.push_str(&format!("data: {chunk}\n\n"));
    }

    let reason = a.finish_reason.clone().unwrap_or_else(|| "tool_calls".into());
    let tail = serde_json::json!({
        "id": id, "object": "chat.completion.chunk", "created": a.created, "model": a.model,
        "choices": [{"index": 0, "delta": {}, "finish_reason": reason}]
    });
    out.push_str(&format!("data: {tail}\n\n"));
    out.push_str("data: [DONE]\n\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const STREAM: &str = concat!(
        "data: {\"id\":\"c1\",\"created\":7,\"model\":\"qwen\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\"},\"finish_reason\":null}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"function\":{\"name\":\"get_wea\",\"arguments\":\"{\\\"loc\"}}]},\"finish_reason\":null}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"ther\",\"arguments\":\"ation\\\": 123, }\"}}]},\"finish_reason\":null}]}\n\n",
        "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n",
        "data: [DONE]\n\n",
    );

    #[test]
    fn reassembles_split_tool_call_deltas() {
        let mut acc = Accumulator::new();
        acc.feed(STREAM.as_bytes());
        let a = acc.finish();
        assert_eq!(a.calls.len(), 1);
        assert_eq!(a.calls[0].name, "get_weather");
        assert_eq!(a.calls[0].arguments, r#"{"location": 123, }"#);
        assert_eq!(a.finish_reason.as_deref(), Some("tool_calls"));
        assert_eq!(a.model, "qwen");
        assert!(a.saw_done);
    }

    #[test]
    fn survives_arbitrary_chunk_boundaries() {
        // Byte-by-byte is the worst case a real network can produce.
        let mut acc = Accumulator::new();
        for b in STREAM.as_bytes() {
            acc.feed(&[*b]);
        }
        let a = acc.finish();
        assert_eq!(a.calls[0].name, "get_weather");
        assert_eq!(a.calls[0].arguments, r#"{"location": 123, }"#);
    }

    #[test]
    fn counts_text_and_detects_truncation() {
        let mut acc = Accumulator::new();
        acc.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"hello\"},\"finish_reason\":null}]}\n\n");
        acc.feed(b"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n\n");
        let a = acc.finish();
        assert_eq!(a.content_chars, 5);
        assert_eq!(a.finish_reason.as_deref(), Some("length"));
        assert!(a.calls.is_empty());
    }

    #[test]
    fn rendered_stream_round_trips() {
        let mut acc = Accumulator::new();
        acc.feed(STREAM.as_bytes());
        let a = acc.finish();
        let fixed = vec![StreamedCall {
            id: "call_1".into(),
            name: "get_weather".into(),
            arguments: r#"{"location":"Seoul","unit":"celsius"}"#.into(),
        }];
        let body = render_tool_call_stream(&a, &fixed);

        let mut acc2 = Accumulator::new();
        acc2.feed(body.as_bytes());
        let b = acc2.finish();
        assert_eq!(b.calls.len(), 1);
        assert_eq!(b.calls[0].arguments, r#"{"location":"Seoul","unit":"celsius"}"#);
        assert_eq!(b.finish_reason.as_deref(), Some("tool_calls"));
        assert!(b.saw_done);
    }
}
