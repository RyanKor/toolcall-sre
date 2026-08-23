#!/usr/bin/env python3
"""Drive every lab scenario through the UI's own API and check the proxy's verdict."""
import json, os, sys, urllib.request

UI = os.environ.get("TCS_UI", "http://127.0.0.1:3100")
DEFAULT = "Weather in Seoul in celsius"
BLIND = "Tell me the temperature"

# (scenario, task, stream, expected action, expect fabricated?)
CASES = [
    ("clean",          DEFAULT, False, "passthrough",    False),
    ("prose",          DEFAULT, False, "recovered",      False),
    ("fenced",         DEFAULT, False, "recovered",      False),
    ("bad-enum",       DEFAULT, False, "repaired",       False),
    ("wrong-type",     BLIND,   False, "repaired",       True),
    ("missing",        DEFAULT, False, "repaired",       False),
    ("missing",        BLIND,   False, "repaired",       True),
    ("garbage",        DEFAULT, False, "repaired",       False),
    ("garbage",        BLIND,   False, "repaired",       True),
    ("object-args",    DEFAULT, False, "passthrough",    False),
    ("empty-args",     DEFAULT, False, "passthrough",    False),
    ("final",          DEFAULT, False, None,             False),
    ("truncated",      DEFAULT, False, None,             False),
    ("stream-clean",   DEFAULT, True,  "passthrough",    False),
    ("stream-prose",   DEFAULT, True,  "recovered",      False),
    ("stream-missing", BLIND,   True,  "repaired",       True),
]

def run(scenario, task, stream):
    body = json.dumps({"scenario": scenario, "task": task, "stream": stream}).encode()
    req = urllib.request.Request(UI + "/api/run", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)

ok = fail = 0
print(f"{'시나리오':<16}{'맥락':<8}{'스트림':<8}{'action':<16}{'창작':<8}결과")
print("-" * 74)
for scen, task, stream, want_action, want_fab in CASES:
    res = run(scen, task, stream)
    if res.get("error"):
        print(f"{scen:<16}ERROR {res['error']}")
        fail += 1
        continue
    ev = res.get("event") or {}
    calls = ev.get("tool_calls") or []
    action = calls[0]["action"] if calls else None
    fab = bool(calls and calls[0].get("fabricated"))
    good = (action == want_action) and (fab == want_fab)

    # extra invariants
    if scen == "truncated" and ev.get("reached_final"):
        good = False
    if scen == "final" and not ev.get("reached_final"):
        good = False

    ok, fail = (ok + 1, fail) if good else (ok, fail + 1)
    ctx = "있음" if task == DEFAULT else "없음"
    print(f"{scen:<16}{ctx:<8}{'yes' if stream else '-':<8}{str(action):<16}"
          f"{'YES' if fab else '-':<8}{'PASS' if good else f'FAIL (기대 {want_action}/{want_fab})'}")

print("-" * 74)
print(f"통과 {ok} / 실패 {fail}")
sys.exit(1 if fail else 0)
