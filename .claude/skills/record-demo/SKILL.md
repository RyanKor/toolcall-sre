---
name: record-demo
description: toolcall-sre 콘솔 데모 영상을 Playwright로 녹화한다 — 커서·국문 자막 오버레이가 보이는 실조작을 자연 속도로 담고, 배속(기본 1.5x)은 녹화 후 무손실로 건다. 시연 영상 녹화, 데모 촬영, 배속 영상, 스크린샷 캡처 요청 시 사용.
---

# 데모 영상 녹화 (Playwright)

`ui/demo/`의 스크립트로 콘솔 실조작을 녹화한다. 핵심 원칙 세 가지:

1. **자연 속도로 녹화하고, 배속은 후처리로 건다.** 스크립트의 대기 시간만 줄이면
   모델 응답 대기는 압축되지 않아 배속이 균일하지 않다. `TCS_SPEED=1`(기본)로 찍고
   ffmpeg 타임스탬프 스케일로 전체를 균일하게 빠르게 한다.
2. **화면에 보이는 것만 믿는다.** 녹화 전에 각 장면의 실제 모델 응답·프록시 판정을
   curl로 프로브해서 "그 장면에 그 그림이 나오는지" 먼저 확인한다. 모델 행동은
   확률적이다 — 판정 칩이 선명하게 갈리는 모델 조합을 골라야 한다.
3. **영상 검증은 프레임 추출로 한다.** 완성본을 사람이 재생해 보기 전에, 주요 시점의
   프레임을 뽑아 눈으로 확인한다.

## 구성 요소

| 파일 | 역할 |
|---|---|
| `ui/demo/cursor.mjs` | 가짜 커서 오버레이 + 사람처럼 움직이는 마우스 (`makeMouse(page, start, {speed})`) |
| `ui/demo/caption.mjs` | 하단 국문 자막 오버레이 (`makeCaption(page)` → `cap('텍스트')`, `cap('')`으로 숨김) |
| `ui/demo/record-register.mjs` | 등록 트랙: 백엔드 등록 → 프로브 → 비교 실행 → 복잡한 툴콜링 모델별 |
| `ui/demo/record-observability.mjs` | 관측 트랙: 계기판 → 라이브 멀티턴 회복 루프 → 블랙박스 → 엔진 시험 |
| `ui/demo/shoot-guide.mjs` | 사용자 가이드용 스크린샷 (4개 언어 × 8장, `docs/user-guide/img/`) |
| `ui/demo/prepare.mjs` | 실모델 비교 데이터를 녹화 전에 미리 채우기 |

## 절차

### 1. 사전 기동 확인

```bash
curl -s localhost:3100/api/mock/v1/models >/dev/null && echo "콘솔 OK"
curl -s localhost:8091/health | jq -r .repair_policy      # contextual이어야 창작 경고가 보인다
curl -s localhost:8091/upstreams | jq '.upstreams[].alias' # 등록 백엔드 확인
```

### 2. 장면 프로브 (녹화 전 필수)

등장할 모델·시나리오 조합마다 curl로 한 번씩 돌려 판정을 확인한다:

```bash
curl -s localhost:8091/v1/chat/completions -H 'content-type: application/json' \
  -H 'x-tcs-upstream: <alias>' -H 'x-session-id: probe-<이름>' -d '<요청>' >/dev/null
curl -s 'localhost:8091/events?session=probe-<이름>&limit=1' | jq '.events[0].tool_calls'
```

주의: 어떤 모델(예: llama3.2)은 툴콜을 `tool_calls` 필드가 아니라 **본문 텍스트로**
뱉는다 → "툴콜 없음"으로 판정되어 대비 장면에 못 쓴다. 프로브로 걸러낼 것.

### 3. 준비

- **등록 장면을 찍는다면**: 콘솔 설정 백업 후 해당 백엔드를 임시 제거
  (`.tcs-console.json` 백업 → `/api/config` PUT으로 필터링). 녹화 후 복구.
- **Ollama 모델 웜업**: `curl localhost:11434/api/generate -d '{"model":"<m>","keep_alive":"30m"}'`
- 지표를 0부터 보여주려면 프록시 재기동 (레지스트리는 콘솔이 저장 시 재푸시).

### 4. 녹화

```bash
cd ui && node demo/record-register.mjs        # 또는 record-observability.mjs
```

수 분 걸리므로 백그라운드 실행 권장. 스크립트 작성 시 요령:

- 페이지 이동 후 자막은 리셋된다 → `navTo()` 다음에 `cap()`을 다시 부른다.
- `/api/run` 등 느린 호출은 클릭 **전에** `page.waitForResponse()`를 걸어 둔다.
- `<details>` 패널은 중첩 `<summary>`가 있으니 `locator('> summary')`로 직계만 잡는다.
- 네이티브 `<select>`는 클릭 연출 대신 `hover` 후 `selectOption()`.
- 긴 텍스트 입력은 `fill()`(붙여넣기처럼 보임), 짧은 것은 `keyboard.type(delay: 40~46)`.
- 스크롤은 `scrollIntoViewIfNeeded`가 침묵 실패할 수 있으니 `page.mouse.wheel()`이 확실.
- 버스트 완료는 버튼 텍스트에서 "실행 중"이 사라질 때까지 폴링 (그동안 표에 hover).

### 5. 프레임 검증

```bash
FF=~/.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux   # 버전은 ls ~/.cache/ms-playwright 로
V=$(ls -t ui/demo/out/page@*.webm | head -1)
$FF -i "$V" 2>&1 | grep Duration
for t in 20 60 100 140; do $FF -y -ss $t -i "$V" -frames:v 1 /tmp/frame_$t.png; done
```

프레임을 열어 자막·판정 칩·표 내용이 의도대로인지 확인. 로케이터 오류로 스크립트가
중간에 죽으면 영상이 완결되지 않는다(Duration: N/A) — 고치고 재녹화.

### 6. 배속 인코딩 (무손실)

Playwright 내장 ffmpeg에는 `setpts` 필터가 **없다**. 타임스탬프 스케일로 처리한다:

```bash
# 1.5x = itsscale 1/1.5 = 0.666667  (재인코딩 없음 · 화질 손실 없음)
$FF -y -itsscale 0.666667 -i "$V" -c:v copy -an ui/demo/out/<이름>-1.5x.webm
```

### 7. 마무리

- 임시로 바꾼 콘솔 설정 복구 (백업 파일 되돌리기).
- 산출물 파일명은 내용을 설명하게: `toolcall-sre-demo-<트랙>-1.5x.webm`.
- `ui/demo/out/`은 gitignore 대상 — 영상은 커밋하지 않는다.

## 가이드 스크린샷 갱신

UI가 바뀌면 한 번에 재생성한다 (언어는 `tcs-locale` 쿠키로 서버렌더):

```bash
cd ui && node demo/shoot-guide.mjs   # docs/user-guide/img/{ko,en,ja,zh}/ 32장
```
