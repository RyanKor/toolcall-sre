//! Tolerant parsing, repair-prompt construction, and fabrication detection.

use serde_json::Value;

/// Best-effort parse of a tool-call `arguments` string into JSON.
///
/// Handles the common ways local models mangle JSON:
///  0. Empty/`null` arguments — a no-argument tool. Promoted to `{}` so that the
///     *schema* decides whether that is acceptable; the parser must not make
///     policy decisions of its own.
///  1. Plain valid JSON (fast path).
///  2. Arguments wrapped in a Markdown code fence (```json ... ```).
///  3. Prose around a single JSON object — extract the outermost `{ ... }`.
///  4. Trailing commas before `}` or `]`.
pub fn parse_tolerant(s: &str) -> Result<Value, String> {
    let trimmed = s.trim();

    // 0. A tool with no parameters is commonly called with "" or "null".
    //    Treat it as an empty object and let schema validation rule on it:
    //    if the schema has required properties this still fails, correctly.
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("null") {
        return Ok(Value::Object(Default::default()));
    }

    // 1. Fast path.
    if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
        return Ok(v);
    }

    // 2. Strip a Markdown code fence if present.
    let unfenced = strip_code_fence(trimmed);
    if let Ok(v) = serde_json::from_str::<Value>(unfenced) {
        return Ok(v);
    }

    // 3. Extract the outermost brace-delimited object.
    if let Some(candidate) = extract_braced(unfenced) {
        if let Ok(v) = serde_json::from_str::<Value>(&candidate) {
            return Ok(v);
        }
        // 4. Remove trailing commas and retry.
        let cleaned = strip_trailing_commas(&candidate);
        if let Ok(v) = serde_json::from_str::<Value>(&cleaned) {
            return Ok(v);
        }
    }

    Err(format!(
        "could not parse tool-call arguments as JSON: {}",
        preview(trimmed)
    ))
}

/// Canonicalize a parsed value back into a compact JSON string.
///
/// With `serde_json`'s `preserve_order` feature enabled this keeps the model's
/// original key order, so a normalized call stays byte-comparable to what the
/// model emitted apart from whitespace.
pub fn canonical(v: &Value) -> String {
    v.to_string()
}

/// Conversation context handed to a repair prompt when the missing information
/// cannot be invented safely.
#[derive(Debug, Default, Clone)]
pub struct RepairContext {
    /// The task the user asked for (last `user` message).
    pub user_task: Option<String>,
    /// The most recent tool result the harness fed back.
    pub last_tool_result: Option<String>,
}

impl RepairContext {
    pub fn is_empty(&self) -> bool {
        self.user_task.is_none() && self.last_tool_result.is_none()
    }
}

/// Build a focused repair request body for the upstream.
///
/// For a *syntactic* failure we deliberately do NOT reuse the conversation — the
/// value is already in front of the model and a small, zero-temperature prompt
/// is cheaper and more reliable.
///
/// For a *fabricating* failure (a required property is missing) that same prompt
/// has nothing to work from, so we attach the little context we can see and tell
/// the model explicitly that inventing a value is not acceptable.
pub fn build_repair_request(
    model: &str,
    function_name: &str,
    invalid_args: &str,
    schema: &Value,
    error: &str,
    ctx: &RepairContext,
) -> Value {
    let mut user = format!(
        "The function `{name}` was called with arguments that are invalid.\n\n\
         Invalid arguments:\n{args}\n\n\
         Validation error:\n{err}\n\n\
         JSON Schema the arguments must satisfy:\n{schema}\n\n",
        name = function_name,
        args = invalid_args,
        err = error,
        schema = serde_json::to_string_pretty(schema).unwrap_or_else(|_| schema.to_string()),
    );

    if !ctx.is_empty() {
        user.push_str("Context from the conversation — take missing values from here, not from your imagination:\n");
        if let Some(task) = &ctx.user_task {
            user.push_str(&format!("User's request: {}\n", clamp(task, 1200)));
        }
        if let Some(result) = &ctx.last_tool_result {
            user.push_str(&format!("Most recent tool result: {}\n", clamp(result, 800)));
        }
        user.push_str(
            "\nIf a required value is genuinely not present above, return exactly \
             {\"__unrecoverable__\": true} instead of guessing.\n\n",
        );
    }

    user.push_str(
        "Return ONLY a single corrected JSON object for the arguments. \
         No prose, no explanation, no Markdown fences.",
    );

    serde_json::json!({
        "model": model,
        "temperature": 0,
        "stream": false,
        "messages": [
            {
                "role": "system",
                "content": "You repair malformed JSON tool-call arguments. Output only a single valid JSON object. Never invent a value that is not supported by the information you were given."
            },
            { "role": "user", "content": user }
        ]
    })
}

/// Did the model decline to guess? (see the prompt above)
pub fn is_unrecoverable(v: &Value) -> bool {
    v.get("__unrecoverable__").and_then(Value::as_bool) == Some(true)
}

/// Fields the repair *introduced* whose values do not appear anywhere in the
/// original arguments or the conversation context — i.e. values the model made
/// up rather than recovered.
///
/// This is a heuristic, deliberately biased toward reporting: an operator needs
/// to know what share of "successful" repairs were actually inventions.
pub fn fabricated_fields(
    raw_before: &str,
    before: Option<&Value>,
    after: &Value,
    ctx: &RepairContext,
) -> Vec<String> {
    let Some(after_obj) = after.as_object() else {
        return Vec::new();
    };

    // The repair prompt shows the model the *raw* arguments, so a value it can
    // read out of that text is recovered, not invented — this matters most when
    // the payload never parsed and `before` is therefore None.
    let mut haystack = String::from(raw_before);
    if let Some(b) = before {
        haystack.push(' ');
        haystack.push_str(&b.to_string());
    }
    if let Some(t) = &ctx.user_task {
        haystack.push(' ');
        haystack.push_str(t);
    }
    if let Some(r) = &ctx.last_tool_result {
        haystack.push(' ');
        haystack.push_str(r);
    }
    let haystack = haystack.to_lowercase();

    let before_obj = before.and_then(Value::as_object);

    let mut out = Vec::new();
    for (key, val) in after_obj {
        // Only fields the repair added or changed can be inventions.
        let unchanged = before_obj
            .and_then(|b| b.get(key))
            .map(|old| old == val)
            .unwrap_or(false);
        if unchanged {
            continue;
        }
        // Booleans, nulls and small numbers carry too little signal to judge.
        let needle = match val {
            Value::String(s) if s.len() >= 2 => s.to_lowercase(),
            Value::Number(n) => n.to_string(),
            _ => continue,
        };
        if !haystack.contains(&needle) {
            out.push(key.clone());
        }
    }
    out.sort();
    out
}

fn clamp(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect::<String>() + "…"
    }
}

fn strip_code_fence(s: &str) -> &str {
    let s = s.trim();
    if let Some(rest) = s.strip_prefix("```") {
        // Drop an optional language tag on the first line.
        let rest = match rest.find('\n') {
            Some(idx) => &rest[idx + 1..],
            None => rest,
        };
        return rest.trim().trim_end_matches("```").trim();
    }
    s
}

/// Extract the substring from the first `{` to its matching `}` (brace-aware,
/// string-literal aware).
fn extract_braced(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let start = s.find('{')?;
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escaped = false;
    for i in start..bytes.len() {
        let c = bytes[i] as char;
        if in_string {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        match c {
            '"' => in_string = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(s[start..=i].to_string());
                }
            }
            _ => {}
        }
    }
    None
}

/// Remove commas that immediately precede a closing `}` or `]` (ignoring
/// whitespace), which serde_json rejects but many models emit.
fn strip_trailing_commas(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_string = false;
    let mut escaped = false;
    let chars: Vec<char> = s.chars().collect();
    for i in 0..chars.len() {
        let c = chars[i];
        if in_string {
            out.push(c);
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_string = false;
            }
            continue;
        }
        if c == '"' {
            in_string = true;
            out.push(c);
            continue;
        }
        if c == ',' {
            // Look ahead past whitespace for a closing bracket.
            let mut j = i + 1;
            while j < chars.len() && chars[j].is_whitespace() {
                j += 1;
            }
            if j < chars.len() && (chars[j] == '}' || chars[j] == ']') {
                continue; // drop this comma
            }
        }
        out.push(c);
    }
    out
}

fn preview(s: &str) -> String {
    const MAX: usize = 160;
    if s.chars().count() <= MAX {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(MAX).collect();
        format!("{truncated}…")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_plain_json() {
        let v = parse_tolerant(r#"{"a": 1}"#).unwrap();
        assert_eq!(v["a"], 1);
    }

    #[test]
    fn parses_fenced_json() {
        let v = parse_tolerant("```json\n{\"a\": 1}\n```").unwrap();
        assert_eq!(v["a"], 1);
    }

    #[test]
    fn parses_with_prose_and_trailing_comma() {
        let v = parse_tolerant("Sure! Here you go: {\"a\": 1, \"b\": 2,}").unwrap();
        assert_eq!(v["b"], 2);
    }

    #[test]
    fn rejects_garbage() {
        assert!(parse_tolerant("not json at all").is_err());
    }

    #[test]
    fn empty_arguments_become_empty_object() {
        // A no-parameter tool is legitimately called with "" — not malformed.
        assert_eq!(parse_tolerant("").unwrap(), json!({}));
        assert_eq!(parse_tolerant("   ").unwrap(), json!({}));
        assert_eq!(parse_tolerant("null").unwrap(), json!({}));
    }

    #[test]
    fn key_order_is_preserved() {
        let v = parse_tolerant(r#"{"zebra": 1, "apple": 2}"#).unwrap();
        assert_eq!(canonical(&v), r#"{"zebra":1,"apple":2}"#);
    }

    #[test]
    fn detects_an_invented_value() {
        let ctx = RepairContext::default();
        let before = json!({"location": 123});
        let after = json!({"location": "Seoul", "unit": "celsius"});
        let f = fabricated_fields(r#"{"location": 123}"#, Some(&before), &after, &ctx);
        assert_eq!(f, vec!["location".to_string(), "unit".to_string()]);
    }

    #[test]
    fn value_recovered_from_context_is_not_fabrication() {
        let ctx = RepairContext {
            user_task: Some("Check the weather in Seoul in celsius".to_string()),
            last_tool_result: None,
        };
        let before = json!({"location": "Seoul"});
        let after = json!({"location": "Seoul", "unit": "celsius"});
        assert!(fabricated_fields(r#"{"location":"Seoul"}"#, Some(&before), &after, &ctx).is_empty());
    }

    #[test]
    fn unparseable_payload_still_credits_what_it_contained() {
        // The repair model can read values straight out of the broken text.
        let ctx = RepairContext::default();
        let raw = "Sure, weather in Seoul in celsius: {broken";
        let after = json!({"location": "Seoul", "unit": "celsius"});
        assert!(fabricated_fields(raw, None, &after, &ctx).is_empty());

        // Nothing to read: everything in the result was invented.
        let after2 = json!({"location": "Seoul", "unit": "celsius"});
        let f = fabricated_fields("I cannot do that", None, &after2, &ctx);
        assert_eq!(f, vec!["location".to_string(), "unit".to_string()]);
    }
}
