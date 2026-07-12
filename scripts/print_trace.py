#!/usr/bin/env python3
"""Pretty-print a toolcall-sre flight-recorder trace (JSONL)."""
import json
import sys

for line in open(sys.argv[1]):
    e = json.loads(line)
    if e["tool_calls"]:
        calls = ", ".join(
            "{}(ok={},valid={},repaired={})".format(
                c["function"], c["parse_ok"], c["schema_valid"], c["repaired"]
            )
            for c in e["tool_calls"]
        )
    else:
        calls = "FINAL"
    ri = e["tool_results_in"]
    print(
        "sess={} turn={} results_in(count={},errors={}) final={} | {}".format(
            e["session"], e["turn"], ri["count"], ri["errors"], e["reached_final"], calls
        )
    )
