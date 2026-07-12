#!/usr/bin/env python3
"""Minimal multi-turn harness simulator to exercise toolcall-sre's in-harness
measurement. Drives a real task loop against the proxy WITHOUT a session header,
so session correlation relies on conversation-prefix fingerprinting.

Usage: harness_sim.py <proxy_base_url> <model> <scenario> [session_id]
  scenario = happy | recovery
  session_id (optional) -> sent as X-Session-Id; else the proxy fingerprints
                           the conversation prefix.
"""
import json
import sys
import urllib.request

PROXY, MODEL, SCENARIO = sys.argv[1], sys.argv[2], sys.argv[3]
SESSION_ID = sys.argv[4] if len(sys.argv) > 4 else None

TOOLS = [
    {"type": "function", "function": {"name": "get_weather", "description": "Current weather",
        "parameters": {"type": "object", "properties": {
            "location": {"type": "string"},
            "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}},
            "required": ["location", "unit"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "set_reminder", "description": "Schedule a reminder",
        "parameters": {"type": "object", "properties": {
            "message": {"type": "string"},
            "in_minutes": {"type": "integer", "minimum": 1, "maximum": 1440}},
            "required": ["message", "in_minutes"], "additionalProperties": False}}},
]


def call_proxy(messages):
    body = json.dumps({"model": MODEL, "messages": messages, "tools": TOOLS,
                       "temperature": 0, "max_tokens": 2048}).encode()
    hdrs = {"Content-Type": "application/json"}
    if SESSION_ID:
        hdrs["X-Session-Id"] = SESSION_ID
    req = urllib.request.Request(PROXY + "/v1/chat/completions", data=body, headers=hdrs)
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)


def run_tool(name, args, turn):
    # 'recovery' scenario: the weather tool fails on its first call.
    if SCENARIO == "recovery" and name == "get_weather" and turn == 0:
        return {"error": "weather service timeout", "retryable": True}
    if name == "get_weather":
        return {"location": args.get("location"), "unit": args.get("unit"), "temp": 21}
    if name == "set_reminder":
        return {"status": "scheduled", "in_minutes": args.get("in_minutes")}
    return {"error": f"unknown tool {name}"}


def main():
    task = ("Check the weather in Seoul in celsius, then set a reminder to bring an "
            "umbrella in 60 minutes. Use the tools, one step at a time.")
    messages = [
        {"role": "system", "content": "You are a helpful assistant that uses tools."},
        {"role": "user", "content": task},
    ]
    for turn in range(6):
        resp = call_proxy(messages)
        msg = resp["choices"][0]["message"]
        tcs = msg.get("tool_calls")
        if not tcs:
            print(f"[turn {turn}] FINAL: {str(msg.get('content'))[:120]}")
            break
        # Append the assistant turn and execute each tool call.
        messages.append({"role": "assistant", "content": msg.get("content"),
                         "tool_calls": tcs})
        for tc in tcs:
            name = tc["function"]["name"]
            try:
                args = json.loads(tc["function"]["arguments"])
            except Exception:
                args = {}
            result = run_tool(name, args, turn)
            print(f"[turn {turn}] tool={name} args={args} -> {result}")
            messages.append({"role": "tool", "tool_call_id": tc.get("id", "0"),
                             "content": json.dumps(result)})
    print(f"scenario '{SCENARIO}' done in {turn+1} turn(s)")


if __name__ == "__main__":
    main()
