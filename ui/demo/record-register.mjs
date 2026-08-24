// toolcall-sre 데모 녹화 — 모델 등록부터 모델별 툴콜링 테스트까지
//
// 실행: node demo/record-register.mjs   (사전에 콘솔 3100 · 프록시 8091 · Ollama · vLLM 기동,
//        콘솔 설정에서 vllm-qwen38 은 미리 빼둔다 — 등록 장면을 찍기 위해)
//
// 장면 구성
//   1. /models  백엔드 추가 폼에 vLLM 백엔드를 타이핑으로 등록 → 저장 → 연결 확인(프로브)
//   2. /models  백엔드 3종 선택 → 비교 실행 → 비교표가 실시간으로 갱신되는 모습
//   3. /lab     복잡한 schedule_meeting 스키마를 실제 모델 3종으로 각각 실행
//               (Qwen 27B 통과 · FunctionGemma 270M 구조 붕괴 · Llama 3.1 8B blind 수리)
//   4. /models  최종 비교표
//
// 속도: 자연 속도로 녹화하고, 배속은 녹화 후 ffmpeg(setpts)으로 건다 — 모델 응답
// 대기까지 포함해 영상 전체가 균일하게 빨라지게 하기 위해서다.
import { chromium } from 'playwright';
import { CURSOR_SCRIPT, makeMouse } from './cursor.mjs';
import { makeCaption } from './caption.mjs';

const BASE = process.env.TCS_CONSOLE ?? 'http://127.0.0.1:3100';
const OUT  = process.env.TCS_OUT ?? './demo/out';
const W = 1600, H = 900;

const SPEED = Number(process.env.TCS_SPEED ?? 1);
const dt = (ms) => Math.max(1, Math.round(ms / SPEED));
const beat = (p, ms = 2000) => p.waitForTimeout(dt(ms));
const read = (p, ms = 3800) => p.waitForTimeout(dt(ms));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: OUT, size: { width: W, height: H } },
  locale: 'ko-KR',
  deviceScaleFactor: 2,
});
await context.addInitScript(CURSOR_SCRIPT);

const page = await context.newPage();
const m = makeMouse(page, { x: W / 2, y: H / 2 }, { speed: SPEED });
const cap = makeCaption(page);

async function navTo(label) {
  const link = page.locator('.navlink', { hasText: label }).first();
  await m.click(link);
  await page.waitForLoadState('networkidle');
  await beat(page, 1400);
}

/** 라벨 텍스트로 입력 칸을 찾아 커서로 짚고 타이핑한다. */
async function typeInto(fieldLabel, text) {
  const input = page.locator('.field', { hasText: fieldLabel }).locator('input').first();
  await m.click(input);
  await page.keyboard.type(text, { delay: dt(46) });
  await beat(page, 420);
}

/** 시험대 카드 하나를 실행하고 /api/run 응답까지 기다린 뒤 결과를 보여준다. */
async function runComplex(title, { dwell = 5200, extraScroll = 420 } = {}) {
  const card = page.locator('.panel', { hasText: title }).first();
  await m.hover(card.locator('.head'), 700);
  const done = page.waitForResponse(
    (r) => r.url().includes('/api/run') && r.request().method() === 'POST',
    { timeout: 300000 },
  );
  await m.click(card.getByRole('button', { name: '실행' }));
  await done;
  await beat(page, 900);
  const result = page.locator('#result');
  await result.scrollIntoViewIfNeeded();
  await beat(page, 1200);
  await m.scroll(extraScroll);
  await read(page, dwell);
}

/** 시험대 상단의 백엔드 선택 상자를 짚고 값을 바꾼다. */
async function pickBackend(alias) {
  const sel = page.locator('.field', { hasText: '어느 백엔드로 보낼까' }).locator('select');
  await sel.scrollIntoViewIfNeeded();
  await m.hover(sel, 500);
  await sel.selectOption(alias);
  await beat(page, 1500);
}

// ────────────────────────────── 장면 1 · 모델 등록 ──────────────────────────────
await page.goto(`${BASE}/models`, { waitUntil: 'networkidle' });
await m.enter();
await cap('① 모델 등록 — 지금 서빙 중인 vLLM 백엔드(Qwen3.8-27B)를 프록시에 추가한다');
await read(page, 3200);                       // 페이지 헤드 + 등록된 백엔드 5종 (vLLM 없음)
await m.scroll(220);
await beat(page, 1200);

await m.click(page.getByRole('button', { name: '백엔드 추가' }));
await beat(page, 1200);
await cap('별칭·주소·모델 id만 넣으면 끝 — 헤더에 실리는 것은 주소가 아니라 별칭이다 (SSRF 방지)');

await typeInto('별칭', 'vllm-qwen38');
await typeInto('이름', 'vLLM · Qwen3.8-27B (로컬 서빙)');
// 주소 칸은 기본값(http://127.0.0.1:8000/v1)이 이미 맞다 — 짚어만 준다
await m.hover(page.locator('.field', { hasText: 'OpenAI 호환 주소' }).locator('input'), 900);
await typeInto('모델 id', 'qwen3.8-27b');
await typeInto('메모', '이 장비에서 vLLM으로 직접 서빙');

const synced = page.waitForResponse((r) => r.url().includes('/api/models/sync'), { timeout: 30000 });
await m.click(page.getByRole('button', { name: '저장하고 프록시에 등록' }));
await synced;
await beat(page, 1600);                       // 저장 + 프록시 등록 확인 메시지

// 방금 등록한 행에서 연결 확인 — 콘솔 서버가 백엔드를 실제로 두드린다
await cap('연결 확인 — 콘솔 서버가 백엔드를 실제로 호출해 응답 시간과 모델 목록을 검증');
const row = page.locator('tr', { hasText: 'vllm-qwen38' }).first();
await row.scrollIntoViewIfNeeded();
await m.click(row.getByRole('button', { name: '확인' }));
await row.locator('text=도달').waitFor({ timeout: 20000 });
await m.hover(row, 800);
await read(page, 3600);                       // "도달 Nms · 모델 N개" 칩

// ────────────────────────── 장면 2 · 모델별 비교 실행 ──────────────────────────
const burst = page.locator('.section', { hasText: '비교 실행' }).first();
await burst.scrollIntoViewIfNeeded();
await cap('② 모델별 비교 — 체급이 다른 실제 모델 3종(270M · 8B · 27B)에 같은 과제를 4회씩');
await beat(page, 1000);

// 느린 추론 모델은 빼고, 체급이 다른 3종을 고른다
await m.click(burst.getByRole('button', { name: 'Ollama · QwQ 32B' }));          // 해제
await m.click(burst.getByRole('button', { name: 'Ollama · gpt-oss 20B' }));      // 해제
await m.click(burst.getByRole('button', { name: 'Ollama · FunctionGemma 270M' }));
await m.click(burst.getByRole('button', { name: 'vLLM · Qwen3.8-27B (로컬 서빙)' }));
await beat(page, 800);

// 백엔드당 4회
const runsInput = burst.locator('.field', { hasText: '백엔드당 요청' }).locator('input');
await m.click(runsInput);
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type('4', { delay: dt(60) });
await beat(page, 600);

// 이번 라운드는 문맥에 정답이 있는 과제로 — 모델이 실제로 툴콜을 내는지를 잰다
await m.click(burst.getByRole('button', { name: '문맥에 정답 없음' }));
await beat(page, 800);

const runBtn = page.getByRole('button', { name: '실행', exact: true });
await m.click(runBtn);
await beat(page, 1500);

// 도는 동안 비교표로 내려가 숫자가 실시간으로 바뀌는 것을 지켜본다 (3초마다 갱신)
await cap('12건을 라이브로 실행 중 — 아래 비교표가 3초마다 갱신된다');
const table = page.locator('.section', { hasText: '모델별 신뢰성' }).first();
await table.scrollIntoViewIfNeeded();
await beat(page, 800);
const t0 = Date.now();
for (;;) {
  const busy = await page
    .getByRole('button', { name: /실행 중/ })
    .count()
    .catch(() => 0);
  if (!busy && Date.now() - t0 > 4000) break;
  if (Date.now() - t0 > 300000) break;
  const rows = table.locator('tbody tr');
  const n = await rows.count().catch(() => 0);
  if (n > 0) await m.hover(rows.nth(Math.floor((Date.now() / 4000) % n)), 400).catch(() => {});
  await page.waitForTimeout(dt(1800));
}
await cap('정상률만이 아니라 창작률 · 전 구간 무결점까지 — 프록시 하나, 잣대 하나');
await read(page, 3000);                       // 완료된 비교표
const tiles = page.locator('.tiles').last();
await m.hover(tiles, 1200).catch(() => {});
await m.scroll(320);
await read(page, 4200);

// ─────────────────── 장면 3 · 복잡한 툴콜링, 실제 모델별로 ───────────────────
await navTo('시험대');
await cap('③ 복잡한 툴콜링 — 중첩 객체·배열·enum이 섞인 schedule_meeting 스키마를 실제 모델로');
await pickBackend('vllm-qwen38');
await m.hover(page.locator('.usingbar').first(), 1200);   // "실제 모델" 배지 + 모델 id
await beat(page, 1000);

// 중첩 객체 + 배열 + 2단계 enum 스키마 — 27B는 구조를 그대로 유지한다
const complexSection = page.locator('.section', { hasText: '복잡한 도구' }).first();
await complexSection.scrollIntoViewIfNeeded();
await beat(page, 1400);
await cap('Qwen3.8-27B — 중첩 구조를 그대로 유지하며 통과하는지 본다');
await runComplex('복잡한 일정 예약 — 정보 충분', { dwell: 5600 });

// 같은 과제를 270M 초소형 모델에게 — 구조가 무너지고 수리 루프가 개입한다
await cap('같은 과제를 FunctionGemma 270M에게 — 초소형 모델은 이 구조를 지킬 수 있을까');
await pickBackend('ollama-fgemma');
await runComplex('복잡한 일정 예약 — 정보 충분', { dwell: 5600 });

// 8B 모델 + 정보가 빠진 과제 — 수리는 되지만 그 판정이 화면에 남는다
await cap('Llama 3.1 8B + 정보가 빠진 과제 — 수리는 되지만, 지어낸 값은 판정에 남는다');
await pickBackend('ollama-llama31');
await runComplex('복잡한 일정 예약 — 참석자 정보 누락', { dwell: 6400, extraScroll: 520 });

// ────────────────────────────── 장면 4 · 마무리 ──────────────────────────────
await navTo('모델');
await cap('모델을 갈아 끼워도 잣대는 하나 — 등록·측정·비교가 이 화면에서 끝난다');
const finalTable = page.locator('.section', { hasText: '모델별 신뢰성' }).first();
await finalTable.scrollIntoViewIfNeeded();
await beat(page, 1000);
await read(page, 5200);
await m.scroll(300);
await read(page, 3600);
await cap('');
await beat(page, 700);

await context.close();
await browser.close();
console.log(`녹화 완료 → ${OUT}`);
