#!/usr/bin/env python3
"""Verify the multi-backend registry: register, route by alias, compare.

Drives the console's own APIs, so it checks the same path the browser uses.
"""
import json, os, sys, urllib.error, urllib.request

UI = os.environ.get("TCS_UI", "http://127.0.0.1:3100")
PROXY = os.environ.get("TCS_PROXY", "http://127.0.0.1:8091")
BLIND = "Tell me the temperature"

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"   {detail}" if detail and not cond else ""))


def req(url, body=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


print("\n[1] 콘솔 설정 저장소")
_, cfg = req(f"{UI}/api/config")
check("기본 시뮬레이션 백엔드가 시드로 들어있음", len(cfg["models"]) >= 3, str(len(cfg.get("models", []))))
check("API 키는 브라우저로 내려가지 않음",
      all(m.get("apiKey") in (None, "••••••••") for m in cfg["models"]))

print("\n[2] 프록시 레지스트리에 밀어넣기")
_, sync = req(f"{UI}/api/models/sync", {})
check("콘솔의 모델이 프록시에 등록됨", sync["synced"] == sync["total"] and sync["total"] > 0,
      json.dumps(sync)[:200])
_, ups = req(f"{UI}/api/proxy/upstreams")
aliases = {u["alias"] for u in ups["upstreams"]}
check("등록된 별칭을 프록시가 보고함", {"sim-solid", "sim-flaky", "sim-rough"} <= aliases, str(aliases))
check("다시 밀어넣어도 안전 (멱등)", req(f"{UI}/api/models/sync", {})[1]["synced"] == sync["total"])

print("\n[3] 별칭으로 목적지가 갈림")
_, a = req(f"{UI}/api/run", {"scenario": "sim-solid-8b", "upstream": "sim-solid", "task": BLIND})
_, b = req(f"{UI}/api/run", {"scenario": "sim-rough-3b", "upstream": "sim-rough", "task": BLIND})
check("각 요청이 지정한 백엔드로 감",
      a["event"]["upstream"] == "sim-solid" and b["event"]["upstream"] == "sim-rough",
      f"{a['event']['upstream']} / {b['event']['upstream']}")
check("모델 id가 기록에 그대로 남음",
      a["event"]["model"] == "sim-solid-8b" and b["event"]["model"] == "sim-rough-3b")

print("\n[4] 미등록 별칭은 거절")
status, err = req(f"{PROXY}/v1/chat/completions",
                  {"model": "x", "messages": []})  # sanity: no header works
check("헤더 없으면 기본 백엔드 사용", status == 200, str(status))
r = urllib.request.Request(f"{PROXY}/v1/chat/completions",
                           data=json.dumps({"model": "x", "messages": []}).encode(),
                           headers={"Content-Type": "application/json", "X-TCS-Upstream": "ghost"})
try:
    urllib.request.urlopen(r, timeout=20)
    check("미등록 별칭을 400으로 거절", False, "요청이 통과해버림")
except urllib.error.HTTPError as e:
    body = json.loads(e.read())
    check("미등록 별칭을 400으로 거절 (조용한 폴백 없음)",
          e.code == 400 and body["error"]["type"] == "unknown_upstream", f"{e.code}")

print("\n[5] SSRF 방어")
_, bad = req(f"{UI}/api/proxy/admin/upstreams", {"alias": "x", "base_url": "file:///etc/passwd"})
check("file:// 스킴 거절", "error" in bad, json.dumps(bad)[:120])
_, meta = req(f"{UI}/api/proxy/admin/upstreams", {"alias": "x", "base_url": "http://169.254.169.254/l"})
check("클라우드 메타데이터 주소 거절", "error" in meta, json.dumps(meta)[:120])

print("\n[6] 비교 실행 후 모델별 집계")
for alias, model in [("sim-solid", "sim-solid-8b"), ("sim-flaky", "sim-flaky-7b"), ("sim-rough", "sim-rough-3b")]:
    for _ in range(14):
        req(f"{UI}/api/run", {"scenario": model, "upstream": alias, "task": BLIND,
                              "sessionPrefix": f"bench-{alias}"})

_, rollup = req(f"{UI}/api/proxy/models")
rows = {r["model"]: r for r in rollup["models"] if r["tool_calls"] > 0}
check("세 백엔드가 모두 집계에 나타남",
      {"sim-solid-8b", "sim-flaky-7b", "sim-rough-3b"} <= set(rows), str(sorted(rows)))

if {"sim-solid-8b", "sim-rough-3b"} <= set(rows):
    solid, rough = rows["sim-solid-8b"], rows["sim-rough-3b"]
    check("튼튼한 모델의 정상률이 거친 모델보다 높음",
          (solid["well_formed_rate"] or 0) > (rough["well_formed_rate"] or 0),
          f"solid={solid['well_formed_rate']:.2f} rough={rough['well_formed_rate']:.2f}")
    check("거친 모델에서 창작이 더 많이 발생",
          rough["fabricated"] >= solid["fabricated"],
          f"solid={solid['fabricated']} rough={rough['fabricated']}")
    check("모델별 세션 집계가 붙음", solid["sessions"] > 0 and rough["sessions"] > 0)

    print("\n  모델별 요약")
    print(f"    {'모델':<16}{'툴콜':>6}{'정상률':>9}{'창작':>6}{'무결점':>9}")
    for name in ("sim-solid-8b", "sim-flaky-7b", "sim-rough-3b"):
        r = rows.get(name)
        if not r:
            continue
        wf = f"{r['well_formed_rate']*100:.0f}%" if r["well_formed_rate"] is not None else "—"
        e2e = f"{r['end_to_end_clean_rate']*100:.0f}%" if r["end_to_end_clean_rate"] is not None else "—"
        print(f"    {name:<16}{r['tool_calls']:>6}{wf:>9}{r['fabricated']:>6}{e2e:>9}")

print("\n" + "=" * 66)
print(f"  통과 {len(PASS)} / 실패 {len(FAIL)}")
if FAIL:
    print("  실패:", ", ".join(FAIL))
sys.exit(1 if FAIL else 0)
