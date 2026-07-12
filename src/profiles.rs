//! Model dialect profiles.
//!
//! Different model families emit tool calls with different quirks. The tolerant
//! parser in [`crate::repair`] handles most of these generically, but the
//! dialect label is recorded for telemetry and is the natural extension point
//! for family-specific handling (custom parsers, prompt shaping, grammars).

/// A coarse family label for an incoming model id.
pub fn detect(model: &str) -> &'static str {
    let m = model.to_ascii_lowercase();
    if m.contains("qwen") {
        "qwen"
    } else if m.contains("llama") {
        "llama"
    } else if m.contains("mistral") || m.contains("mixtral") || m.contains("nemo") {
        "mistral"
    } else if m.contains("hermes") {
        "hermes"
    } else if m.contains("command") {
        "command-r"
    } else if m.contains("solar") {
        "solar"
    } else {
        "generic"
    }
}
