# toolcall-sre 콘솔

프록시가 **무엇을, 왜** 했는지 눈으로 확인하는 Next.js 대시보드입니다.
목업 업스트림이 이 앱 안에 들어 있어 **모델도 GPU도 없이** 전체 경로를 시험할 수 있습니다.

```
브라우저 → Next(/api/run) → toolcall-sre → Next(/api/mock/v1) → 다시 프록시 → 브라우저
```

---

## 함께 띄우기

터미널 2개면 됩니다.

```bash
# ① UI (목업 업스트림 포함) — 먼저 띄워야 프록시가 붙을 대상이 생깁니다
cd ui
npm install
npm run dev                      # http://localhost:3100

# ② 프록시 — 업스트림을 이 앱의 목업으로 지정
cd ..
cargo run -- \
  --listen 127.0.0.1:8091 \
  --upstream http://127.0.0.1:3100/api/mock/v1 \
  --repair-policy contextual \
  --repair-streaming \
  --allow-admin
```

`--allow-admin` lets the console register backends into the proxy at runtime. It is off
by default because an endpoint that adds new request destinations is an SSRF surface,
and the proxy refuses to start with it enabled on a non-loopback address. Without it
the console still works — it just shows the registry read-only, and you declare
backends up front with `--upstream-alias 별칭=주소`.

브라우저에서 <http://localhost:3100> 을 엽니다. 왼쪽 아래에 **연결됨** 이 뜨면 준비 완료입니다.

### 다른 기기에서 접속할 때

Next는 개발 모드에서 **교차 출처 dev 리소스를 기본 차단**합니다. 증상이 헷갈립니다 — 서버가
200을 주니 화면은 멀쩡히 뜨는데, `/_next/*` 청크와 HMR 소켓이 거부되어 **React가 하이드레이션되지
않아 모든 버튼이 죽습니다.** 콘솔에는 이런 에러만 보입니다:

```
WebSocket connection to 'ws://<IP>:3100/_next/hmr?id=…' failed
```

`next.config.ts` 가 이 머신의 비루프백 IP를 자동으로 감지해 허용하므로 보통은 그냥 됩니다.
도메인이나 다른 호스트로 접속한다면 추가하세요.

```bash
TCS_DEV_ORIGINS='box.example.com,*.example.ts.net' npm run dev
```

> 이 경우에도 프록시 주소는 **콘솔 서버 기준**입니다. 브라우저를 다른 기기에서 열었더라도
> 프록시가 콘솔과 같은 장비에 떠 있다면 `http://127.0.0.1:8091` 이 맞습니다. **프록시 연결**
> 화면의 &ldquo;연결 테스트&rdquo; 버튼이 콘솔 서버 쪽에서 실제로 확인해 줍니다.

### 실제 모델에 붙이기

목업 대신 진짜 백엔드를 쓰려면 `--upstream` 만 바꾸면 됩니다.

```bash
cargo run -- --upstream http://127.0.0.1:8000/v1        # vLLM
cargo run -- --upstream http://127.0.0.1:11434/v1       # Ollama
```

프록시를 다른 포트/호스트에 띄웠다면 **프록시 연결** 화면에서 주소를 추가하면 됩니다.
`ui/.env.local` 의 값은 설정 파일이 아직 없을 때 쓰이는 초기값입니다.

```
TCS_PROXY_URL=http://127.0.0.1:8091     # 최초 실행 시의 기본 프록시
TCS_CONSOLE_CONFIG=./.tcs-console.json  # 설정 파일 위치 (선택)
```

> UI는 항상 **서버 사이드로** 프록시를 호출합니다. 그래서 프록시에 CORS 설정이 없어도 되고,
> 다른 장비에 있는 프록시도 환경변수 하나로 붙습니다. (브라우저에서 직접 붙이고 싶다면
> 프록시에 `--cors` 를 주세요.)

---

## 화면 여섯

**관측**

| 화면 | 무엇을 하나 | 언제 쓰나 |
|---|---|---|
| **계기판** `/` | SLI 타일, 세션 표, 지연 분포를 2초마다 갱신 | 지금 상태를 보고 싶을 때 |
| **시험대** `/lab` | 실패 시나리오 16종을 골라둔 백엔드로 재현 | 패치가 실제로 동작하는지 확인할 때 |
| **엔진 시험** `/inspect` | 모델 없이 파서·검증기·정책만 실행 | 인자 하나를 두고 왜 이렇게 판단하는지 볼 때 |
| **블랙박스** `/trace` | 요청별 판정 기록, 창작만 필터링 | 집계 숫자의 근거를 파고들 때 |

**설정**

| 화면 | 무엇을 하나 | 언제 쓰나 |
|---|---|---|
| **모델** `/models` | 백엔드 등록·연결 확인·일괄 실행·모델별 비교표 | 어느 모델을 쓸지 정할 때 |
| **프록시 연결** `/connections` | 여러 toolcall-sre 인스턴스 등록/전환, 레지스트리 확인·재주입 | 프록시를 옮기거나 재시작했을 때 |

---

## 언어

한국어 · English · 日本語 · 中文 을 지원합니다. 왼쪽 위 **KO / EN / JA / ZH** 버튼으로 바꾸며,
선택은 쿠키에 저장됩니다.

선택 이력이 없으면 브라우저의 `Accept-Language` 로 정합니다. 지원하지 않는 언어면 한국어입니다.

### 구현 메모

**쿠키에 저장하고 서버에서 읽습니다.** `localStorage` 였다면 하이드레이션 이후에야 언어를 알 수
있어, 한국어를 고르지 않은 모든 방문자에게 한국어가 한 번 번쩍이게 됩니다. 레이아웃이 쿠키를
서버에서 읽어 `<html lang>` 까지 맞춰 내려보내므로 첫 페인트부터 올바른 언어입니다.

**누락된 키는 컴파일 에러입니다.** [`lib/i18n/ko.ts`](./lib/i18n/ko.ts) 가 형태의 원본이고
(`export type Dict = typeof ko`), 나머지 세 로케일은 `const en: Dict = {…}` 로 선언됩니다.
키를 빠뜨리거나 오타를 내면 `tsc` 가 잡습니다.

**보간은 템플릿 문법이 아니라 함수입니다.**

```ts
repairSuccessNote: (n: number) => `시도 ${n}건 기준 (malformed 전체가 아님)`,
```

이러면 TypeScript 가 **인자의 개수와 타입까지** 로케일 간에 검사합니다. `{count}` 같은 문자열
치환은 그걸 못 합니다.

**서버 라우트는 문장이 아니라 코드를 반환합니다.** `{ code: "proxy_unreachable", detail: "…" }`
형태로 돌려주고 브라우저가 번역합니다. 서버가 한국어 문장을 만들어 내려보내면 그 부분만 언어가
고정되기 때문입니다. `detail` 은 번역하지 않는 기술 정보(주소, 예외 메시지)입니다.

**모델 출력은 번역하지 않습니다.** 모의 백엔드가 내놓는 응답은 UI 문구가 아니라 데이터라서
영어로 고정입니다. 언어를 바꿨다고 "모델"이 다른 언어로 답하기 시작하면 관측 도구로서 혼란만
줍니다.

**폰트.** IBM Plex 는 한국어·일본어·중국어 계열 서체를 모두 제공하므로 셋을 함께 선언해 어떤
언어에서도 같은 조판을 유지합니다. 브라우저는 실제로 쓰이는 서브셋만 내려받습니다.

### 언어 추가하기

1. `lib/i18n/types.ts` 의 `LOCALES` 에 코드를 넣습니다.
2. `lib/i18n/<코드>.ts` 를 `const x: Dict = {…}` 로 작성합니다 — 빠진 키는 `tsc` 가 알려줍니다.
3. `lib/i18n/index.ts` 의 `DICTS` 에 등록합니다.

---

## 계기판이 지키는 두 가지

**비율에 관측이 없으면 `100%`가 아니라 &ldquo;관측 전&rdquo;** 이라고 씁니다. 분모가 0일 때 만점을
보고하는 대시보드는 기동 직후 상태를 정상으로 오인하게 만듭니다.

**창작(fabricated)은 별도 색(보라)** 을 씁니다. 실패(빨강)와 같은 색을 쓰면 안 됩니다 —
실패는 시끄럽고 안전하지만, 창작은 조용하고 위험합니다. 종류가 다른 사건입니다.

---

## 모델 섹션

### 백엔드는 별칭으로 갈립니다

등록된 백엔드는 프록시 레지스트리에 **별칭**으로 들어가고, 요청 헤더 한 줄이 목적지를 정합니다.

```bash
curl localhost:8091/v1/chat/completions \
  -H 'x-tcs-upstream: vllm-qwen' \
  -d '{"model":"qwen3.6-35b","messages":[…],"tools":[…]}'
```

그래서 **프록시 하나 · 정책 하나 · 지표 하나**로 여러 모델을 비교할 수 있습니다. 헤더가 나르는
것은 주소가 아니라 별칭입니다 — 임의 주소로 전달하는 프록시는 SSRF 도구가 되니까요. 등록되지
않은 별칭은 400으로 거절합니다. 조용히 기본 백엔드로 새면 벤치마크 결과가 엉뚱한 모델에
붙기 때문입니다.

### 콘솔이 원본, 프록시가 런타임

프록시의 레지스트리는 **메모리에만** 있습니다. 콘솔이 목록을 파일(`.tcs-console.json`)로 들고
있다가 저장할 때마다 밀어넣으므로, 프록시 재시작이 사건이 되지 않습니다. 이 분리 덕분에 프록시는
설정 파일 없는 단일 바이너리로 남고, 같은 백엔드 목록을 다른 프록시에 그대로 붙일 수 있습니다.
API 키는 서버 쪽 파일에만 있고 브라우저로는 절대 내려가지 않습니다.

### 처음 켜면 들어있는 것

모사 백엔드 넷이 시드로 등록돼 있어 실제 모델 없이 바로 비교해볼 수 있습니다.

| 별칭 | 성격 |
|---|---|
| `sim-solid` | 거의 안 틀림 — 프론티어 API에 가까운 거동 |
| `sim-flaky` | 프로즈 혼입과 필수 항목 누락이 섞임 — 전형적인 작은 로컬 모델 |
| `sim-rough` | 절반 넘게 깨짐 — 툴 파인튜닝 안 된 소형 모델 |
| `sim-scenario` | 시험대용. `model` 필드가 실패 유형을 고름 |

**비교 실행**을 누르면 세 백엔드에 같은 과제를 같은 횟수로 던지고, 표가 이렇게 벌어집니다.

```
모델              툴콜   정상률   창작   무결점
sim-solid-8b       15     87%      2      87%
sim-flaky-7b       14     71%      4      71%
sim-rough-3b       15     60%      6      60%
```

### 문맥 토글이 중요한 이유

**문맥에 정답 없음**이 기본입니다. 이 상태에서만 &ldquo;수리는 성공했는데 값은 지어낸&rdquo;
경우가 드러납니다. 정답이 문맥에 있으면 같은 수리도 회수로 분류되어 창작률이 0에 가깝게
나옵니다 — 두 설정을 번갈아 돌려보면 차이가 바로 보입니다.

---

## 프록시 연결 섹션

여러 toolcall-sre 인스턴스를 등록해두고 전환합니다. 콘솔은 **항상 서버 사이드로** 프록시를
호출하므로 프록시에 CORS 설정이 없어도 되고, 다른 장비에 떠 있는 프록시도 주소만 넣으면
붙습니다.

이 화면은 연결 상태 외에 **현재 수리 정책**도 보여줍니다. `full` 로 떠 있으면 보라색으로
경고합니다 — 맥락 없이 무엇이든 고치는 모드라 모델이 값을 지어내기 때문입니다.

## 시험대에서 꼭 눌러볼 것

세 쌍을 나란히 실행하면 이 프로젝트의 핵심 판단이 한눈에 들어옵니다.

1. **`enum 밖의 값`** vs **`필수 항목 누락 — 맥락에도 답이 없음`**
   둘 다 스키마 위반이지만 하나는 안전하게 고쳐지고, 하나는 값을 지어냅니다.
   프록시가 이 둘을 구분한다는 것이 패치의 요점입니다.

2. **`필수 항목 누락 — 맥락에 답이 있음`** vs **`— 맥락에도 답이 없음`**
   결과 JSON은 **완전히 똑같습니다**. 그런데 하나만 창작 경고가 붙습니다.
   출력만 봐서는 절대 구분할 수 없는 차이를, 근거를 따라가서 구분합니다.

3. **`스트리밍 + 인사말 혼입`**
   패치 전에는 스트리밍이면 프록시가 아무 일도 하지 않았습니다.
   지금은 델타를 재조립해 복구하고, 정상 SSE로 다시 발행합니다.
   맨 아래 &ldquo;클라이언트가 실제로 받은 SSE 원문&rdquo; 을 펼쳐서 확인하세요.

---

## 목업 업스트림 직접 호출하기

`model` 필드가 시나리오 선택기입니다. 별도 채널이 필요 없습니다.

```bash
curl -s localhost:3100/api/mock/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"prose","messages":[]}' | jq

# 스트리밍 시나리오
curl -sN localhost:3100/api/mock/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"stream-prose","stream":true,"messages":[]}'
```

성격이 다른 **모사 백엔드**는 별도 경로입니다. 실패를 확률 분포로 내므로 비교용입니다.

```bash
curl -s localhost:3100/api/mock/p/rough/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"model":"sim-rough-3b","messages":[]}' | jq

curl -s localhost:3100/api/mock/p/solid/v1/models | jq   # 연결 확인용
```

시나리오 목록은 [`lib/scenarios.ts`](./lib/scenarios.ts) 한 곳에 있습니다.
새 실패 유형을 추가하려면 거기에 항목을 하나 넣고, 목업 라우트에 대응 응답을 추가하면
시험대에 자동으로 버튼이 생깁니다.

---

## 자동 검증

UI를 거치지 않고 같은 시나리오를 일괄 확인하려면:

```bash
# 프록시 동작 전반 (26개 항목)
python3 ../scripts/verify_behaviors.py

# 시험대 시나리오 전체를 /api/run 으로 (16개)
python3 ../scripts/verify_ui.py

# 다중 백엔드 레지스트리 — 등록·별칭 라우팅·SSRF 방어·비교 집계 (15개)
python3 ../scripts/verify_models.py

# i18n — 하드코딩 잔여·미번역 복붙·언어 협상·시드 언어 (31개)
python3 ../scripts/verify_i18n.py
```
