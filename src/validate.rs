//! JSON-Schema validation of tool-call arguments, plus violation classification.
//!
//! Classification is what keeps the repair loop honest. A schema failure is one
//! of two very different things:
//!
//!  * **Syntactic** — the value is *there*, it is just wrong (bad type, wrong
//!    enum casing, pattern mismatch). Repairing it needs no information the
//!    model does not already hold, so a cheap context-free repair is safe.
//!  * **Fabricating** — the information is *absent* (a required property is
//!    missing). A context-free repair prompt has nothing to work from, so the
//!    model will invent a plausible value. That turns a loud failure into a
//!    silent wrong action.
//!
//! [`Failure::violation`] lets the caller pick a policy per class instead of
//! treating every invalid call the same way.

use jsonschema::Validator;
use jsonschema::error::{ValidationError, ValidationErrorKind};
use serde_json::Value;

/// How a schema violation would have to be repaired.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Violation {
    /// The value exists but is malformed — safe to repair without context.
    Syntactic,
    /// Information is missing — repairing without context invents values.
    Fabricating,
}

impl Violation {
    pub fn as_str(self) -> &'static str {
        match self {
            Violation::Syntactic => "syntactic",
            Violation::Fabricating => "fabricating",
        }
    }
}

/// A validation failure with everything the repair layer needs to decide.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Failure {
    /// Human-readable, joined error string — also fed to the model on repair.
    pub message: String,
    pub violation: Violation,
    /// Required properties that were absent (empty for syntactic failures).
    pub missing: Vec<String>,
}

impl Failure {
    /// A parse failure: the arguments were not JSON at all. The bytes are still
    /// in front of us, so this is recoverable without inventing anything.
    pub fn parse(message: String) -> Self {
        Failure {
            message,
            violation: Violation::Syntactic,
            missing: Vec::new(),
        }
    }
}

/// Compile a JSON Schema (a tool's `function.parameters`) into a validator.
///
/// Returns `None` if the schema itself is not compilable; callers treat that as
/// "no schema available" and skip validation for that tool.
pub fn compile(schema: &Value) -> Option<Validator> {
    jsonschema::validator_for(schema).ok()
}

/// Check an instance against a compiled validator, classifying any failure.
pub fn check(validator: &Validator, instance: &Value) -> Result<(), Failure> {
    if validator.is_valid(instance) {
        return Ok(());
    }

    let mut messages = Vec::new();
    let mut missing = Vec::new();
    for e in validator.iter_errors(instance) {
        messages.push(format!("{} (at `{}`)", e, e.instance_path()));
        collect_missing(&e, &mut missing);
    }
    missing.sort();
    missing.dedup();

    let message = if messages.is_empty() {
        "arguments failed schema validation".to_string()
    } else {
        messages.join("; ")
    };

    let violation = if missing.is_empty() {
        Violation::Syntactic
    } else {
        Violation::Fabricating
    };

    Err(Failure {
        message,
        violation,
        missing,
    })
}

/// Walk an error (and the nested contexts of `anyOf`/`oneOf`) collecting the
/// names of required properties that were absent.
fn collect_missing(e: &ValidationError<'_>, out: &mut Vec<String>) {
    match e.kind() {
        ValidationErrorKind::Required { property } => {
            let name = property
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| property.to_string());
            out.push(name);
        }
        // A failing `anyOf`/`oneOf` hides its real reasons in nested contexts;
        // a missing required property inside one is still a missing property.
        ValidationErrorKind::AnyOf { context }
        | ValidationErrorKind::OneOfNotValid { context }
        | ValidationErrorKind::OneOfMultipleValid { context } => {
            for branch in context {
                for inner in branch {
                    collect_missing(inner, out);
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn weather_schema() -> Value {
        json!({
            "type": "object",
            "properties": {
                "location": {"type": "string"},
                "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}
            },
            "required": ["location", "unit"],
            "additionalProperties": false
        })
    }

    #[test]
    fn wrong_type_is_syntactic() {
        let v = compile(&weather_schema()).unwrap();
        let err = check(&v, &json!({"location": 123, "unit": "celsius"})).unwrap_err();
        assert_eq!(err.violation, Violation::Syntactic);
        assert!(err.missing.is_empty());
    }

    #[test]
    fn bad_enum_is_syntactic() {
        let v = compile(&weather_schema()).unwrap();
        let err = check(&v, &json!({"location": "Seoul", "unit": "C"})).unwrap_err();
        assert_eq!(err.violation, Violation::Syntactic);
    }

    #[test]
    fn missing_required_is_fabricating() {
        let v = compile(&weather_schema()).unwrap();
        let err = check(&v, &json!({"location": "Seoul"})).unwrap_err();
        assert_eq!(err.violation, Violation::Fabricating);
        assert_eq!(err.missing, vec!["unit".to_string()]);
    }

    #[test]
    fn empty_object_against_no_required_is_valid() {
        let schema = json!({"type": "object", "properties": {}, "additionalProperties": false});
        let v = compile(&schema).unwrap();
        assert!(check(&v, &json!({})).is_ok());
    }
}
