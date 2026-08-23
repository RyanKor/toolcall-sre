#!/usr/bin/env python3
"""Verify each patched behavior end-to-end against the running proxy."""
import json, os, sys, time, urllib.request

# Sessions accumulate in the proxy; make every run use fresh ids so the script
# is idempotent against a long-lived process.
RUN = str(int(time.time() * 1000))[-8:]

PROXY = os.environ.get("TCS_PROXY", "http://127.0.0.1:8091")
WEATHER = {"type": "object",
           "properties": {"location": {"type": "string"},
                          "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]}},
           "required": ["location", "unit"], "additionalProperties": False}
NOARG = {"type": "object", "properties": {}, "additionalProperties": False}
TOOLS = [{"type": "function", "function": {"name": "get_weather", "parameters": WEATHER}},
         {"type": "function", "function": {"name": "get_time", "parameters": NOARG}}]

def post(path, body, headers=None):
    req = urllib.request.Request(PROXY + path, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw.decode()

def get(path):
    with urllib.request.urlopen(PROXY + path, timeout=30) as r:
        return json.loads(r.read())

def chat(scenario, user="Weather in Seoul in celsius", session=None, stream=False):
    body = {"model": scenario, "messages": [{"role": "user", "content": user}], "tools": TOOLS}
    if stream:
        body["stream"] = True
    return post("/v1/chat/completions", body,
                {"X-Session-Id": f"{session}-{RUN}"} if session else None)

def stream_args(sse_text):
    """Reassemble tool-call arguments from an SSE body, like a real client does."""
    buf = ""
    for line in sse_text.splitlines():
        if not line.startswith("data:"):
            continue
        payload = line[5:].strip()
        if payload == "[DONE]":
            break
        chunk = json.loads(payload)
        for ch in chunk.get("choices", []):
            for tc in ch.get("delta", {}).get("tool_calls", []) or []:
                buf += tc.get("function", {}).get("arguments", "")
    return buf

def args_of(resp):
    return resp["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"]

PASS, FAIL = [], []
def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"   {detail}" if detail and not cond else ""))

print("\n[1] arguments가 객체로 오는 백엔드 (Ollama 네이티브 형태)")
r = chat("object-args", session="obj")
a = args_of(r)
check("객체 인자를 문자열로 바꾸지 않고 객체 그대로 반환", isinstance(a, dict), f"got {type(a).__name__}: {a!r}")
s = [x for x in get("/sessions")["sessions"] if x["session"] == f"obj-{RUN}"][0]
check("객체 인자를 malformed로 오집계하지 않음", s["malformed"] == 0, f"malformed={s['malformed']}")

print("\n[2] 인자 없는 도구가 arguments:\"\" 로 호출")
r = chat("empty-args", session="empty")
s = [x for x in get("/sessions")["sessions"] if x["session"] == f"empty-{RUN}"][0]
check("빈 인자를 malformed로 오집계하지 않음", s["malformed"] == 0, f"malformed={s['malformed']}")

print("\n[3] 정상 콜은 바이트 보존 / 프로즈는 반드시 재작성")
r = chat("clean", session="clean")
check("이미 정상인 JSON은 바이트 그대로 통과",
      args_of(r) == '{"location":"Seoul","unit":"celsius"}', f"got {args_of(r)!r}")
rp = chat("prose", session="prose")
check("프로즈로 감싸진 인자는 클라이언트가 읽을 수 있게 재작성됨",
      "Sure!" not in args_of(rp) and json.loads(args_of(rp))["unit"] == "celsius", f"got {args_of(rp)!r}")
sp = [x for x in get("/sessions")["sessions"] if x["session"] == f"prose-{RUN}"][0]
check("파서 단독 복구는 malformed가 아니라 recovered로 집계",
      sp["malformed"] == 0 and sp["recovered_calls"] == 1,
      f"malformed={sp['malformed']} recovered={sp['recovered_calls']}")

print("\n[4] 형식 위반(값은 있음) → 맥락 없이 안전하게 수리")
r = chat("bad-enum", session="enum")
s = [x for x in get("/sessions")["sessions"] if x["session"] == f"enum-{RUN}"][0]
check("enum 위반은 syntactic으로 분류되어 수리됨", s["repaired"] == 1, f"repaired={s['repaired']}")

print("\n[5] 정보 결손 → 창작 탐지")
r = chat("missing", user="Tell me the temperature", session="fab")
s = [x for x in get("/sessions")["sessions"] if x["session"] == f"fab-{RUN}"][0]
check("맥락에 없던 값을 채운 수리를 fabricated로 표시", s["fabricated"] == 1, f"fabricated={s['fabricated']}")
r = chat("missing", user="Weather in Seoul in celsius", session="nofab")
s = [x for x in get("/sessions")["sessions"] if x["session"] == f"nofab-{RUN}"][0]
check("맥락에서 회수한 값은 fabricated 아님", s["fabricated"] == 0, f"fabricated={s['fabricated']}")

print("\n[6] reached_final 엄격화")
chat("final", session="fin"); chat("truncated", session="trunc"); chat("empty-final", session="emptyfin")
by = {x["session"]: x for x in get("/sessions")["sessions"]}
check("정상 종료한 답변은 완수로 집계", by[f"fin-{RUN}"]["reached_final"] is True)
check("토큰 한도로 잘린 응답은 완수 아님", by[f"trunc-{RUN}"]["reached_final"] is False)
check("빈 응답은 완수 아님", by[f"emptyfin-{RUN}"]["reached_final"] is False)

print("\n[7] 스트리밍: 측정 + 수리")
r = chat("stream-prose", session="stream1", stream=True)
check("스트리밍 응답이 SSE로 돌아옴", isinstance(r, str) and "data:" in r)
sa = stream_args(r)
check("프로즈로 감싸진 인자가 스트림에서 정상 JSON으로 재발행됨",
      "Sure!" not in sa and json.loads(sa)["unit"] == "celsius", f"reassembled={sa!r}")
s = [x for x in get("/sessions")["sessions"] if x["session"] == f"stream1-{RUN}"][0]
check("스트리밍도 세션으로 측정됨 (예전엔 완전 무시)", s["tool_calls"] == 1, f"tool_calls={s['tool_calls']}")
check("파서만으로 복구된 사실이 기록됨 (LLM 왕복 0회)",
      s["recovered_calls"] == 1, f"recovered_calls={s['recovered_calls']}")
r2 = chat("stream-missing", user="Tell me the temperature", session="stream2", stream=True)
s2 = [x for x in get("/sessions")["sessions"] if x["session"] == f"stream2-{RUN}"][0]
check("스트리밍에서도 결손은 수리 대상 (contextual)", s2["repaired"] == 1, f"repaired={s2['repaired']}")
check("스트리밍 수리의 창작도 탐지됨", s2["fabricated"] == 1, f"fabricated={s2['fabricated']}")

print("\n[8] 같은 태스크 재실행 → 세션 병합 방지 (헤더 없이 핑거프린팅)")
base = {"model": "clean", "messages": [
    {"role": "system", "content": "sys"}, {"role": "user", "content": f"unique-task-{RUN}"}], "tools": TOOLS}
post("/v1/chat/completions", base)
cont = json.loads(json.dumps(base))
cont["messages"] += [{"role": "assistant", "content": None}, {"role": "tool", "content": "{}"}]
post("/v1/chat/completions", cont)
post("/v1/chat/completions", base)   # 두 번째 런: 처음부터 다시
sess = [x for x in get("/sessions")["sessions"] if "unique" not in x["session"]]
runs = [x for x in get("/sessions")["sessions"] if x["turns"] in (1, 2) and x["session"].startswith("sess-")]
forked = len([x for x in get("/sessions")["sessions"] if "#" in x["session"]])
check("재실행이 별도 세션으로 분기됨", forked >= 1, f"forked={forked}")

print("\n[9] 지표 위생")
m = get("/metrics?format=json")
check("repair_success_rate 분모 = 시도 횟수", m["repair_attempted"] >= m["repaired"])
check("정책상 건너뛴 건은 실패로 세지 않음", "repair_skipped_by_policy" in m)
check("지연 히스토그램 존재", m["request_latency"]["count"] > 0, str(m["request_latency"]))
check("툴콜 없는 세션이 clean 분모에 안 들어감",
      m["in_harness"]["tool_using_sessions"] < m["in_harness"]["sessions"],
      f"{m['in_harness']['tool_using_sessions']} / {m['in_harness']['sessions']}")

print("\n[10] /debug/inspect — LLM 없이 엔진만 시험")
d = post("/debug/inspect", {"tool": "get_weather", "arguments": 'Sure! {"location":"Seoul",}',
                            "schema": WEATHER})
check("프로즈+콤마 복구", d["parse_ok"] is True and d["recovered_by_tolerant_parse"] is True)
check("누락 필드를 fabricating으로 분류", d["violation"] == "fabricating" and d["missing"] == ["unit"])
d2 = post("/debug/inspect", {"tool": "get_weather", "arguments": '{"location":"Seoul","unit":"C"}',
                             "schema": WEATHER})
check("잘못된 enum은 syntactic으로 분류", d2["violation"] == "syntactic")

print(f"\n{'='*60}\n  통과 {len(PASS)} / 실패 {len(FAIL)}")
if FAIL:
    print("  실패:", ", ".join(FAIL))
sys.exit(1 if FAIL else 0)
