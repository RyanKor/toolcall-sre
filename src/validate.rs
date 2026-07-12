//! JSON-Schema validation of tool-call arguments.

use jsonschema::Validator;
use serde_json::Value;

/// Compile a JSON Schema (a tool's `function.parameters`) into a validator.
///
/// Returns `None` if the schema itself is not compilable; callers treat that as
/// "no schema available" and skip validation for that tool.
pub fn compile(schema: &Value) -> Option<Validator> {
    jsonschema::validator_for(schema).ok()
}

/// Check an instance against a compiled validator.
///
/// On failure, returns a human-readable, joined error string suitable for
/// feeding back to the model in a repair prompt.
pub fn check(validator: &Validator, instance: &Value) -> Result<(), String> {
    if validator.is_valid(instance) {
        return Ok(());
    }
    let msg = validator
        .iter_errors(instance)
        .map(|e| format!("{} (at `{}`)", e, e.instance_path()))
        .collect::<Vec<_>>()
        .join("; ");
    Err(if msg.is_empty() {
        "arguments failed schema validation".to_string()
    } else {
        msg
    })
}
