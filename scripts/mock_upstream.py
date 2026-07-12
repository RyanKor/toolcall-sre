#!/usr/bin/env python3
"""Mock OpenAI-compatible upstream for toolcall-sre end-to-end testing.

- Normal completion request -> returns a tool_call with SCHEMA-INVALID arguments
  (location is a number, required `unit` missing) to force the repair loop.
- Repair request (system prompt mentions repairing JSON) -> returns valid JSON.
"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # quiet

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        messages = body.get("messages", [])
        is_repair = any(
            m.get("role") == "system" and "repair" in str(m.get("content", "")).lower()
            for m in messages
        )

        if is_repair:
            # Corrected, valid arguments.
            payload = {
                "id": "cmpl-repair",
                "object": "chat.completion",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": '{"location": "Seoul", "unit": "celsius"}',
                        },
                        "finish_reason": "stop",
                    }
                ],
            }
        else:
            # Malformed on purpose: wrong type + missing required field,
            # wrapped in prose with a trailing comma.
            bad_args = 'Sure! {"location": 123, }'
            payload = {
                "id": "cmpl-1",
                "object": "chat.completion",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {"name": "get_weather", "arguments": bad_args},
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
            }

        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 11434
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
