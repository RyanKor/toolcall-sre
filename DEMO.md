# toolcall-sre 데모 시연 플로우

모델도 GPU도 없이 전체 경로를 시연할 수 있습니다. 목업 업스트림이 콘솔 안에 들어 있어
네트워크 없이 로컬에서 끝납니다.

---

## 0. 이 데모가 증명하려는 것

세 문장으로 끝나야 합니다. 화면은 이 세 문장의 증거일 뿐입니다.

1. **드롭인이다.** 에이전트 코드를 고치지 않는다. `OPENAI_BASE_URL` 한 줄만 바꾼다.
2. **고칠 수 있는 것과 고치면 안 되는 것을 구분한다.** 값이 *있는데* 틀린 것은 고치고,
   값이 *없는* 것은 지어내지 않고 신고한다. 이게 이 프로젝트의 유일한 차별점입니다.
3. **개별 콜이 아니라 업무 한 건 전체를 측정한다.** 콜당 95%는 8스텝이면 66%입니다.
   중요한 숫자는 `전 구간 무결점률`이지 `정상률`이 아닙니다.

> 시연 중 딱 한 장면만 남길 수 있다면 → **§5 클라이맥스**. 나머지는 다 곁가지입니다.

---

## 1. 사전 준비 (T-10분)

터미널 3개. ①②는 데모 내내 살아 있고, ③이 시연용입니다.

```bash
# ① 콘솔 (목업 업스트림 포함) — 먼저 떠야 프록시가 붙을 대상이 생깁니다
cd toolcall-sre/ui && npm install && npm run dev          # http://localhost:3100

# ② 프록시 A — 콘솔이 보는 프록시. contextual = 창작을 드러내는 모드
cd toolcall-sre
cargo build --release
./target/release/toolcall-sre \
  --listen 127.0.0.1:8091 \
  --upstream http://127.0.0.1:3100/api/mock/v1 \
  --repair-policy contextual --repair-streaming --allow-admin --cors \
  --trace-file ./demo-trace.jsonl

# ③ 프록시 B — 기본 정책(syntactic-only). §4 B4의 대조군으로만 씁니다
./target/release/toolcall-sre \
  --listen 127.0.0.1:8092 \
  --upstream http://127.0.0.1:3100/api/mock/v1 \
  --repair-policy syntactic-only
```

**T-3분 점검**

```bash
curl -s localhost:3100/api/mock/v1/models >/dev/null && echo "콘솔 OK"
curl -s localhost:8091/health | jq -r '"프록시A \(.repair_policy) stream_repair=\(.repair_streaming)"'
curl -s localhost:8092/health | jq -r '"프록시B \(.repair_policy)"'
```

브라우저에서 <http://localhost:3100> → 왼쪽 아래 **연결됨** 이면 준비 끝.

> **지표를 깨끗하게 시작하고 싶으면** 프록시 A를 재기동하세요. 계기판의 "관측 전" 표시를
> 보여주려면 오히려 재기동한 직후 상태가 필요합니다(§3 F3).

---

## 2. 시연 구성 — 두 트랙

| | 트랙 F — 프론트엔드 (콘솔) | 트랙 B — 백엔드 (프록시/CLI) |
|---|---|---|
| 무대 | 브라우저 `localhost:3100` | 터미널 + `curl` |
| 청중 | 의사결정자 · 처음 보는 사람 | 엔지니어 · 실제로 붙일 사람 |
| 증명하는 것 | "무엇이 일어나는지 보인다" | "화면이 아니라 시스템이다" |
| 강점 | 창작(보라)과 실패(빨강)의 색 구분이 한눈에 | 헤더 한 줄로 드롭인·SSRF 거절·JSONL 기록 |
| 소요 | 8–12분 | 8–15분 |

**시간별 조합**

| 길이 | 구성 |
|---|---|
| **5분 (엘리베이터)** | F0 → F1의 2쌍만 → §5 클라이맥스 → F3 무결점률 |
| **12분 (표준)** | 트랙 F 전체 (F0→F1→F2→F3→F4) |
| **25분 (기술 세션)** | 트랙 F 전체 → 트랙 B의 B2·B4·B6·B7 → B9 검증 스크립트 |
| **엔지니어 1:1** | 트랙 B 전체. 콘솔은 B4 결과를 눈으로 확인할 때만 잠깐 |

---

## 3. 트랙 F — 프론트엔드 시연 플로우

콘솔 화면은 6개지만 **시연 순서는 내비게이션 순서가 아닙니다.** 아래 순서가 이야기입니다.

### F0 · 프록시 연결 `/connections` — 30초

| | |
|---|---|
| **조작** | 좌측 하단 **연결됨** 배지 → `/connections` 진입 |
| **짚을 것** | 상태 `연결됨` · **수리 정책 `contextual`** · 스트리밍 `측정 + 수리` · 런타임 등록 `허용` |
| **말할 것** | "콘솔은 **항상 서버 사이드로** 프록시를 부릅니다. 그래서 프록시에 CORS 설정이 없어도 되고, 다른 장비 GPU 서버에 뜬 프록시도 주소만 넣으면 붙습니다. 지금 보고 있는 건 이 화면이 아니라 저 프록시입니다." |
| **함정** | 정책이 `full` 이면 화면이 보라색으로 경고합니다. 데모는 `contextual` 로 하세요 — 창작을 *드러내되* 통제하는 모드입니다. |

### F1 · 시험대 `/lab` — 5분 ★ 본편

16개 실패 시나리오 버튼 중 **딱 세 쌍**만 누릅니다. 더 누르면 이야기가 흐려집니다.

**1쌍 — 고칠 수 있는 것**

1. `정상` → 통과. "이미 올바른 호출은 **바이트 단위로 그대로** 나갑니다. 키 순서까지.
   프록시가 손대는 건 클라이언트가 애초에 파싱할 수 없었던 것뿐입니다."
2. `프로즈 혼입` → **파서가 복구**. `Sure! {"location":"Seoul","unit":"celsius",}`
   "모델 왕복 0회, 비용 0, 지연 0. 그냥 파서가 건집니다."
3. `enum 밖의 값` → **수리됨**. `"unit":"C"` → `"celsius"`
   "값은 **있습니다**. 오타일 뿐입니다. 고쳐도 아무것도 지어내지 않습니다."

**2쌍 — 고치면 안 되는 것** ★ 여기가 핵심

4. `필수 항목 누락 — 맥락에 답이 있음` (사용자가 "Weather in Seoul in **celsius**" 라고 말함)
   → 수리됨. 결과 `{"location":"Seoul","unit":"celsius"}`
5. `필수 항목 누락 — 맥락에도 답이 없음` (사용자는 "Tell me the temperature" 라고만 함)
   → 수리됨. 결과 **`{"location":"Seoul","unit":"celsius"}` — 완전히 똑같습니다.**

> **여기서 멈추고 3초 침묵.** 두 결과 JSON을 나란히 놓고:
> "출력만 보면 구분할 방법이 없습니다. 그런데 하나에만 **이 값들은 지어낸 것입니다** 라는
> 보라색 경고가 붙어 있습니다. 원래 호출에도, 사용자 요청에도, 직전 도구 결과에도 `celsius`
> 라는 값은 없었습니다. 스키마는 만족시켰지만 **사실을 만들어낸** 겁니다.
> 이게 `delete_*` 나 `send_payment` 였다면 여기서 잘못된 실행이 일어납니다."

**3쌍 — 스트리밍은 더 이상 사각지대가 아니다**

6. `스트리밍 + 인사말 혼입` → 델타를 재조립해 복구하고 정상 SSE로 재발행
   맨 아래 **클라이언트가 실제로 받은 SSE 원문** 을 펼쳐서 보여줍니다.
   "예전엔 스트리밍이면 프록시가 아무 일도 못 했습니다. 지금은 툴콜 응답만 버퍼링합니다 —
   저 델타는 하네스가 파싱하지 사람이 읽지 않으니까, 버퍼링해도 체감 지연이 0입니다.
   **텍스트 응답은 그대로 흘려보냅니다.**"

### F2 · 블랙박스 `/trace` — 1분 30초

| | |
|---|---|
| **조작** | 필터를 **창작만** 으로 |
| **짚을 것** | 방금 만든 기록만 남습니다. 칩: `스키마 위반` · `누락 unit` · **`지어냄 unit`** |
| **더 볼 것** | 한 건 펼쳐서 **원본 기록 (JSONL 한 줄)** |
| **말할 것** | "집계 숫자는 여기서 나옵니다. 지표가 이상하면 그 숫자를 만든 **개별 판정**을 찾아갈 수 있어야 합니다. `--trace-file` 을 주면 같은 내용이 디스크에 JSONL로 남습니다 — 프로세스가 죽어도 남는 유일한 기록입니다." |

### F3 · 계기판 `/` — 2분 30초

| | |
|---|---|
| **짚을 것 ①** | **`이 프록시는 값을 N번 지어냈습니다`** 헤드라인. 실패는 빨강, **창작은 보라**. "실패는 시끄럽고 안전합니다. 창작은 조용하고 위험합니다. 종류가 다른 사건이라 색을 다르게 씁니다." |
| **짚을 것 ②** | 아직 관측이 없는 비율 타일은 `100%` 가 아니라 **`관측 전`**. "분모가 0일 때 만점을 보고하는 대시보드는 기동 직후 상태를 정상으로 오인하게 만듭니다." |
| **짚을 것 ③** | **하네스 안에서의 행동** 블록 → **전 구간 무결점**. "위쪽 `정상률`은 콜 단위, 이건 **세션 단위**입니다. 후자가 진짜 숫자입니다 — 콜당 95%도 8스텝이면 66%로 무너지니까요." |
| **짚을 것 ④** | 지연 카드 → `수리가 더한 시간 p95`. "신뢰성을 **얼마의 지연으로 샀는지** 따로 보여줍니다." |
| **더 볼 것** | 하단 세션 표 — `턴`, `호출 순서`, `판정(무결점/오염)`, `회복` 칩 |

### F4 · 모델 `/models` — 2분 30초

| | |
|---|---|
| **조작 ①** | 등록된 모사 백엔드 4종 확인 (`sim-solid` / `sim-flaky` / `sim-rough` / `sim-scenario`) → **연결 확인** |
| **조작 ②** | **문맥에 정답 없음** 토글이 켜져 있는지 확인 → **비교 실행** (백엔드당 5회) |
| **짚을 것** | 표가 벌어집니다. `정상률` 열과 **`전 구간 무결점`** 열의 간격 |
| **말할 것** | "프록시 하나 · 정책 하나 · 지표 하나로 여러 모델을 비교합니다. 헤더가 나르는 건 주소가 아니라 **별칭**입니다 — 임의 주소로 전달하는 프록시는 SSRF 도구가 되니까요. 두 열이 크게 벌어진 모델은 '가끔 틀리는' 게 아니라 **'긴 작업을 못 끝내는'** 겁니다." |
| **보너스** | 토글을 **문맥에 정답 있음** 으로 바꿔 다시 실행 → 같은 수리인데 창작률이 0 근처로 내려갑니다. "같은 모델, 같은 수리, 다른 판정. 문맥이 결정합니다." |

### F5 · 엔진 시험 `/inspect` — 부록 (질문 나올 때만)

"근데 그 판단은 어떻게 하는 겁니까?" 라는 질문이 나오면 여기로.

`{"location": "Seoul", "unit": "C"}` 를 붙여넣고 실행 → **업스트림 호출 없이**
`파싱 → 검증 → 분류(syntactic/fabricating) → 정책 결정`이 즉시 나옵니다.

"엔진을 라이브 실행의 부산물이 아니라 **그 자체로** 시험할 수 있습니다."

---

## 4. 트랙 B — 백엔드 시연 플로우

전부 검증된 명령입니다. 출력은 실제 실행 결과입니다.

### B0 · 드롭인 (30초)

```bash
export OPENAI_BASE_URL=http://127.0.0.1:8091/v1
```

"에이전트 코드는 한 글자도 안 고칩니다. claude-code든 OpenHands든 LangGraph든
OpenAI 호환이면 다 됩니다. 뒤에 붙는 것도 vLLM / Ollama / SGLang / llama.cpp 아무거나."

### B1 · 살아있나 (10초)

```bash
curl -s localhost:8091/health | jq
# {"status":"ok","repair_policy":"Contextual","measure_streaming":true,"repair_streaming":true,"normalize":false}
```

"헬스체크가 **지금 어떤 정책으로 떠 있는지**까지 말합니다. 정책은 이 프록시의 성격이라
운영 중에 모르면 안 되는 값입니다."

### B2 · 엔진만 단독으로 (1분) ★ 모델 없이

```bash
curl -s localhost:8091/debug/inspect -H 'content-type: application/json' -d '{
 "tool":"get_weather",
 "arguments":"Sure! {\"location\": \"Seoul\", \"unit\": \"C\",}",
 "schema":{"type":"object","properties":{"location":{"type":"string"},
   "unit":{"type":"string","enum":["celsius","fahrenheit"]}},
   "required":["location","unit"]}}' | jq
```

```json
{
  "parse_ok": true,
  "recovered_by_tolerant_parse": true,
  "schema_valid": false,
  "error": "\"C\" is not one of \"celsius\" or \"fahrenheit\" (at `/unit`)",
  "violation": "syntactic",
  "missing": [],
  "decision": {
    "action": "repair",
    "with_context": false,
    "reason": "the value is present and merely malformed: safe to correct"
  }
}
```

"업스트림을 **전혀 부르지 않습니다.** 인자 하나와 스키마 하나면 판단 전체를 재현할 수 있고,
그 판단에 **이유가 붙어 나옵니다**."

### B3 · 실제로 고치는 것 (30초)

```bash
TOOLS='[{"type":"function","function":{"name":"get_weather","parameters":{
  "type":"object","properties":{"location":{"type":"string"},
  "unit":{"type":"string","enum":["celsius","fahrenheit"]}},
  "required":["location","unit"]}}}]'

curl -s localhost:8091/v1/chat/completions -H 'content-type: application/json' \
  -d "{\"model\":\"bad-enum\",\"messages\":[{\"role\":\"user\",\"content\":\"Weather in Seoul in celsius\"}],\"tools\":$TOOLS}" \
  | jq -r '.choices[0].message.tool_calls[0].function.arguments'
# {"location":"Seoul","unit":"celsius"}
```

### B4 · 정책 대조 (2분) ★★ 백엔드 트랙의 클라이맥스

**같은 요청**을 두 프록시에 던집니다. 정책만 다릅니다.

```bash
for P in 8092 8091; do
  echo "--- proxy $P ---"
  curl -s localhost:$P/v1/chat/completions -H 'content-type: application/json' \
    -d "{\"model\":\"missing\",\"messages\":[{\"role\":\"user\",\"content\":\"Tell me the temperature\"}],\"tools\":$TOOLS}" \
    | jq -r '"args: \(.choices[0].message.tool_calls[0].function.arguments)"'
  curl -s "localhost:$P/events?limit=1" \
    | jq -r '.events[0].tool_calls[0] | "  action=\(.action) violation=\(.violation) fabricated=\(.fabricated)"'
done
```

```
--- proxy 8092 ---   (syntactic-only, 기본값)
args: {"location":"Seoul"}
  action=left_by_policy violation=fabricating fabricated=null

--- proxy 8091 ---   (contextual)
args: {"location":"Seoul","unit":"celsius"}
  action=repaired violation=fabricating fabricated=["unit"]
```

말할 것:
- "기본 정책은 **고치지 않는 쪽**입니다. `unit` 은 값이 *없는* 겁니다. 고치려면 **지어내야**
  합니다. 그래서 `left_by_policy` — 실패가 아니라 **거부**입니다."
- "`contextual` 로 켜면 고쳐줍니다. 대신 **`fabricated: ["unit"]`** 이 따라옵니다.
  성공한 수리 중 몇 %가 발명이었는지 항상 알 수 있습니다."
- "그리고 `--no-fabricate-for 'send_*,delete_*'` — 되돌릴 수 없는 도구는 정책과 무관하게
  절대 값을 못 받습니다."

### B5 · 스트리밍 (1분)

```bash
curl -sN localhost:8091/v1/chat/completions -H 'content-type: application/json' \
  -d "{\"model\":\"stream-prose\",\"stream\":true,\"messages\":[{\"role\":\"user\",\"content\":\"Weather in Seoul in celsius\"}],\"tools\":$TOOLS}"
```

```
data: {"choices":[{"delta":{"role":"assistant"}...}]}
data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"get_weather",
       "arguments":"{\"location\":\"Seoul\",\"unit\":\"celsius\"}"}}]}...}]}
data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}
```

"업스트림은 인사말이 섞인 조각난 델타를 보냈습니다. 클라이언트는 **정상 SSE**를 받습니다.
`--measure-streaming` 은 기본 켜짐이고 스트림을 **한 바이트도 건드리지 않고** 측정만 합니다.
수리까지 하려면 `--repair-streaming` 을 켭니다."

### B6 · 하네스 안에서의 측정 (2분) ★ 이 도구의 두 번째 얼굴

```bash
python3 scripts/harness_sim.py http://127.0.0.1:8091 clean happy    task-happy
python3 scripts/harness_sim.py http://127.0.0.1:8091 clean recovery task-recovery

curl -s 'localhost:8091/sessions?limit=3' | jq '.sessions[0]'
```

```json
{
  "session": "task-happy", "turns": 6, "tool_calls": 6,
  "malformed": 0, "repaired": 0, "fabricated": 0,
  "tool_result_errors": 0, "recovered": false,
  "end_to_end_clean": true,
  "sequence": ["get_weather", "get_weather", ...]
}
```

```bash
curl -s 'localhost:8091/metrics?format=json' | jq '.in_harness'
# { "sessions": 3, "avg_turns": 2.67,
#   "end_to_end_clean_sessions": 1, "end_to_end_clean_rate": 0.33,
#   "tool_result_errors_observed": 0, "sessions_with_recovery": 0 }
```

> **시연 주의.** 목업 업스트림은 시나리오 재생기라 최종 답변을 내지 않고 `get_weather` 를
> 계속 반복합니다. 그래서 `recovery` 세션도 `tool_result_errors=1` 은 뜨지만
> `recovered=false`, `reached_final=false` 로 나옵니다 — 목업의 한계지 프록시 문제가
> 아닙니다. **회복(recovered=true)까지 보여주려면 실제 모델을 붙이세요.**
> vLLM + Qwen3.6-35B 로는 `turns=4`, `sequence=[get_weather, get_weather, set_reminder]`,
> `tool_result_errors=1`, `reached_final=true` 가 나옵니다.

말할 것:
- "BFCL이나 tau-bench는 모델의 **맨몸** 툴콜을 잽니다. 그건 **내 하네스 안에서** 그 모델이
  어떻게 행동하는지는 못 알려줍니다. 하네스가 툴 포맷, 멀티턴 컨텍스트, 오류 복구를
  통제하니까 같은 모델도 하네스마다 점수가 다릅니다."
- "프록시는 이미 툴콜 경계에 앉아 있으니 **공짜로** 측정합니다. 하네스가 협조할 필요가 없습니다.
  세션 헤더를 안 보내도 대화 프리픽스를 지문으로 상관시킵니다."
- "`--repair-policy off` 로 돌리면 **날것**의 행동을, 켜고 돌리면 **완화된** 행동을 잽니다.
  같은 파서·같은 검증기로요."

### B7 · 여러 백엔드 · 하나의 잣대 (1분 30초)

```bash
curl -s localhost:8091/upstreams | jq
# 헤더 한 줄로 목적지가 갈립니다
curl -s localhost:8091/v1/chat/completions -H 'x-tcs-upstream: sim-flaky' -d '{…}'
curl -s localhost:8091/models | jq            # (모델, 백엔드) 쌍별 신뢰성
```

**SSRF 방어를 반드시 같이 보여주세요.**

```bash
curl -s -w "\nHTTP %{http_code}\n" localhost:8091/v1/chat/completions \
  -H 'x-tcs-upstream: nope' -d '{"model":"clean","messages":[]}'
# {"error":{"message":"unknown upstream alias `nope`; registered: default, …",
#           "type":"unknown_upstream"}}
# HTTP 400
```

"헤더가 나르는 건 **별칭**이지 주소가 아닙니다. 부르는 쪽이 지정한 아무 주소로나 전달하는
프록시는 SSRF 도구입니다. 그리고 등록 안 된 별칭은 **조용히 기본 백엔드로 흘리지 않고 400**
입니다 — 조용히 새면 A 모델 결과가 B 모델에 붙어버리니까요.
런타임 등록(`--allow-admin`)은 비루프백 주소와는 **아예 같이 안 뜹니다.**"

### B8 · 디스크에 남는 기록 (30초)

```bash
python3 scripts/print_trace.py ./demo-trace.jsonl | tail -5
# sess=task-happy turn=1 results_in(count=1,errors=0) final=False | get_weather(ok=True,valid=True,repaired=False)
```

"`/metrics` 는 단일 프로세스·메모리입니다. **JSONL 트레이스가 durable한 기록**입니다 —
프록시 여러 대는 공유 메트릭 스토어가 아니라 이 파일들로 합산합니다."

### B9 · 신뢰 자산 (1분) — 기술 청중이면 반드시

```bash
cargo test                            # 40개 유닛 테스트
python3 scripts/verify_behaviors.py   # 26개 end-to-end 동작 단언
python3 scripts/verify_ui.py          # 16개 시나리오를 콘솔로 구동
python3 scripts/verify_models.py      # 15개 — 멀티백엔드 레지스트리 + SSRF 방어
python3 scripts/verify_i18n.py        # 31개 — 4개 언어 콘솔
```

"리서치 단계에서 공개 처리량 수치의 절반이 SEO 순환인용이나 벤더 마케팅으로 기각됐습니다.
그래서 **재현 가능성 자체를 무기로** 씁니다. 128개 단언 전부 GPU 없이 돌아갑니다."

---

## 5. 클라이맥스 — 딱 한 장면만 남긴다면

시연 전체에서 이 30초가 프로젝트를 설명합니다. `/lab` 에서 두 버튼을 **연달아** 누르세요.

```
필수 항목 누락 — 맥락에 답이 있음     →  {"location":"Seoul","unit":"celsius"}
필수 항목 누락 — 맥락에도 답이 없음   →  {"location":"Seoul","unit":"celsius"}   ⚠ 창작
```

> "결과 JSON이 **완전히 같습니다.** 어떤 후처리 검사로도 구분할 수 없습니다.
> 스키마 검증기를 통과시키면 둘 다 통과합니다.
>
> 차이는 **정보가 어디서 왔는가** 하나뿐입니다. 하나는 사용자가 말한 걸 옮겼고,
> 하나는 모델이 지어냈습니다.
>
> 스키마 위반을 한 종류로 취급하면, 신뢰성 도구가 **시끄럽고 안전한 실패를
> 조용하고 위험한 잘못된 실행으로 바꾸는** 장치가 됩니다. 그래서 기본 정책이
> `syntactic-only` 입니다 — **깨진 값은 고치되, 없는 값은 만들지 않습니다.**"

---

## 6. 예상 질문 & 답

| 질문 | 답 |
|---|---|
| "제약 디코딩(guided_json)으로 애초에 안 깨지게 하면 되지 않나?" | 맞습니다 — 그게 M1 로드맵입니다. 지원하는 백엔드에 위임할 겁니다. 다만 ① 모든 백엔드가 지원하지 않고 ② 스키마를 만족해도 **틀린 값**은 여전히 나옵니다. 창작 탐지는 제약 디코딩이 못 하는 일입니다. |
| "지연이 얼마나 늘어나나?" | 정상 호출은 **바이트 패스스루**라 사실상 0. 스트리밍 측정도 0. 수리가 붙은 요청만 모델 왕복 1–2회가 붙고, 그 시간은 `수리가 더한 시간 p95` 로 **따로** 보고합니다. |
| "프록시가 SPOF 아닌가?" | 단일 Rust 바이너리(axum+tokio), 런타임 의존성 없음. 상태는 메모리 + JSONL이라 수평 확장이 가능하고, 합산은 트레이스 파일로 합니다. 다만 현재 메트릭은 단일 프로세스라는 게 알려진 한계입니다. |
| "우리 하네스에서도 되나?" | OpenAI 호환이면 됩니다. 하네스가 협조할 필요가 없다는 게 설계 요점입니다 — 세션 헤더를 안 보내면 대화 프리픽스로 지문을 뜹니다. |
| "지어낸 값을 아예 못 쓰게 할 수 있나?" | 기본값(`syntactic-only`)이 이미 그겁니다. 정책을 열더라도 `--no-fabricate-for 'send_*,delete_*'` 로 도구 단위 차단이 됩니다. |
| "실제 모델로도 돌려봤나?" | vLLM + Qwen3.6-35B-A3B-AWQ 로 end-to-end 검증했습니다. `/sessions` 에 `turns=4`, `tool_result_errors=1`, `reached_final=true` — 하네스 루프 안에서 도구 오류로부터 회복한 세션입니다. |

---

## 7. 장애 대응 (플랜 B)

| 증상 | 원인 | 대응 |
|---|---|---|
| 화면은 뜨는데 **버튼이 전부 죽음** | 다른 기기/도메인 접속 → Next dev가 교차 출처 리소스를 차단, React 하이드레이션 실패 | `TCS_DEV_ORIGINS='호스트명' npm run dev` 로 재기동. 또는 그냥 로컬에서 시연 |
| 좌하단 **연결 안 됨** | 프록시가 안 떴거나 주소 불일치 | `/connections` 의 **연결 테스트** — 콘솔 서버 쪽에서 실제로 확인해 줍니다 |
| 백엔드 목록이 비어 있음 | 프록시 재기동 (레지스트리는 메모리) | `/models` 에서 저장 한 번 → 콘솔이 다시 밀어넣습니다. 이건 버그가 아니라 설계입니다 |
| 창작 경고가 안 뜸 | 정책이 `syntactic-only` 거나 `문맥에 정답 있음` 토글이 켜짐 | 프록시 A(8091, contextual) 인지 확인 + 토글을 **문맥에 정답 없음** 으로 |
| 브라우저가 죽음 | — | **트랙 B로 전환.** §4 B2 → B4 만으로 이야기가 온전히 섭니다 |
| 네트워크가 없음 | — | 상관없습니다. 목업이 앱 안에 있고 전부 로컬입니다 |

---

## 8. 리허설 체크리스트

- [ ] `cargo build --release` 가 끝나 있다 (첫 빌드 중에 시연 시작 금지)
- [ ] `npm install` 이 끝나 있다
- [ ] 프록시 A `8091` = **contextual + repair-streaming + allow-admin + trace-file**
- [ ] 프록시 B `8092` = **syntactic-only** (B4 대조군)
- [ ] 브라우저 좌하단 **연결됨**
- [ ] `/lab` 의 두 `필수 항목 누락` 버튼 위치를 손이 기억한다 (§5는 더듬으면 안 됨)
- [ ] `/models` 토글이 **문맥에 정답 없음**
- [ ] `TOOLS` 셸 변수를 미리 export 해뒀다 (B3 이후 계속 씀)
- [ ] 터미널 폰트 크기 ↑, 브라우저 확대 ↑
- [ ] 언어 — 청중에 맞춰 좌상단 **KO / EN / JA / ZH** 중 선택 (쿠키 저장, 서버 렌더라 첫 페인트부터 맞음)
- [ ] 지표를 0에서 시작하려면 프록시 A 재기동 (계기판의 **관측 전** 표시가 보고 싶다면 필수)
