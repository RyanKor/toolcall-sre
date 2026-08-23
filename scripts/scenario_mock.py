#!/usr/bin/env python3
"""Scenario-driven mock upstream: the scenario is chosen by the `model` field."""
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer

def tool_call(args, name="get_weather", finish="tool_calls"):
    return {"id": "cmpl", "object": "chat.completion", "model": "mock",
            "choices": [{"index": 0, "finish_reason": finish, "message": {
                "role": "assistant", "content": None,
                "tool_calls": [{"id": "call_1", "type": "function",
                                "function": {"name": name, "arguments": args}}]}}]}

def text(content, finish="stop"):
    return {"id": "cmpl", "object": "chat.completion", "model": "mock",
            "choices": [{"index": 0, "finish_reason": finish,
                         "message": {"role": "assistant", "content": content}}]}

SCENARIOS = {
    "clean":          lambda: tool_call('{"location":"Seoul","unit":"celsius"}'),
    "prose":          lambda: tool_call('Sure! {"location": "Seoul", "unit": "celsius",}'),
    "fenced":         lambda: tool_call('```json\n{"location":"Seoul","unit":"celsius"}\n```'),
    "wrong-type":     lambda: tool_call('{"location": 123, "unit": "celsius"}'),
    "bad-enum":       lambda: tool_call('{"location":"Seoul","unit":"C"}'),
    "missing":        lambda: tool_call('{"location":"Seoul"}'),
    "garbage":        lambda: tool_call('I cannot do that'),
    # arguments as an OBJECT (Ollama native / some gateways)
    "object-args":    lambda: tool_call({"location": "Seoul", "unit": "celsius"}),
    # a no-parameter tool called with ""
    "empty-args":     lambda: tool_call("", name="get_time"),
    "final":          lambda: text("It is 21 degrees in Seoul."),
    "truncated":      lambda: text("It is 21 deg", finish="length"),
    "empty-final":    lambda: text("", finish="stop"),
}

def sse(chunks):
    out = []
    for c in chunks:
        out.append("data: " + json.dumps(c) + "\n\n")
    out.append("data: [DONE]\n\n")
    return "".join(out).encode()

def stream_tool_call(args, name="get_weather"):
    """Split the arguments across several deltas, mid-token."""
    head = {"id": "c1", "created": 1, "model": "mock", "object": "chat.completion.chunk",
            "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]}
    parts = [args[i:i + 7] for i in range(0, len(args), 7)] or [""]
    chunks = [head]
    for i, p in enumerate(parts):
        fn = {"arguments": p}
        if i == 0:
            fn["name"] = name
        d = {"index": 0, "function": fn}
        if i == 0:
            d["id"] = "call_1"; d["type"] = "function"
        chunks.append({"object": "chat.completion.chunk", "choices": [
            {"index": 0, "delta": {"tool_calls": [d]}, "finish_reason": None}]})
    chunks.append({"object": "chat.completion.chunk", "choices": [
        {"index": 0, "delta": {}, "finish_reason": "tool_calls"}]})
    return sse(chunks)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        msgs = body.get("messages", [])
        scenario = body.get("model", "clean")

        is_repair = any(m.get("role") == "system" and "repair" in str(m.get("content", "")).lower()
                        for m in msgs)
        if is_repair:
            declines = any("__unrecoverable__" in str(m.get("content", "")) for m in msgs) and \
                       "DECLINE" in scenario
            payload = text('{"__unrecoverable__": true}') if declines else \
                      text('{"location": "Seoul", "unit": "celsius"}')
            return self._json(payload)

        if body.get("stream"):
            args = {"stream-prose": 'Sure! {"location": "Seoul", "unit": "celsius",}',
                    "stream-clean": '{"location":"Seoul","unit":"celsius"}',
                    "stream-missing": '{"location":"Seoul"}'}.get(scenario,
                                                                  '{"location":"Seoul","unit":"celsius"}')
            data = stream_tool_call(args)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return

        key = scenario.replace("DECLINE-", "")
        return self._json(SCENARIOS.get(key, SCENARIOS["clean"])())

    def _json(self, payload):
        data = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
