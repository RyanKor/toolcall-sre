//! Tolerant parsing and repair-prompt construction for tool-call arguments.

use serde_json::Value;

/// Best-effort parse of a tool-call `arguments` string into JSON.
///
/// Handles the common ways local models mangle JSON:
///  1. Plain valid JSON (fast path).
///  2. Arguments wrapped in a Markdown code fence (```json ... ```).
///  3. Prose around a single JSON object — extract the outermost `{ ... }`.
///  4. Trailing commas before `}` or `]`.
pub fn parse_tolerant(s: &str) -> Result<Value, String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Err("empty arguments".to_string());
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
pub fn canonical(v: &Value) -> String {
    // `to_string` on a Value never fails.
    v.to_string()
}

/// Build a focused repair request body for the upstream.
///
/// We deliberately do NOT reuse the full conversation — a small, zero-temperature
/// prompt asking only for corrected JSON is cheaper and more reliable.
pub fn build_repair_request(
    model: &str,
    function_name: &str,
    invalid_args: &str,
    schema: &Value,
    error: &str,
) -> Value {
    let user = format!(
        "The function `{name}` was called with arguments that are invalid.\n\n\
         Invalid arguments:\n{args}\n\n\
         Validation error:\n{err}\n\n\
         JSON Schema the arguments must satisfy:\n{schema}\n\n\
         Return ONLY a single corrected JSON object for the arguments. \
         No prose, no explanation, no Markdown fences.",
        name = function_name,
        args = invalid_args,
        err = error,
        schema = serde_json::to_string_pretty(schema).unwrap_or_else(|_| schema.to_string()),
    );

    serde_json::json!({
        "model": model,
        "temperature": 0,
        "stream": false,
        "messages": [
            {
                "role": "system",
                "content": "You repair malformed JSON tool-call arguments. Output only a single valid JSON object."
            },
            { "role": "user", "content": user }
        ]
    })
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
}
