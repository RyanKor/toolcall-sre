// toolcall-sre 데모 녹화 — 관측 트랙: 계기판 · 블랙박스 · 엔진 시험
//
// 실행: node demo/record-observability.mjs   (사전에 콘솔 3100 · 프록시 8091 · vLLM 기동)
//
// 장면 구성
//   1. 계기판   집계 지표(창작 헤드라인 · 구성 눈금 · 수리 지연)
//   2. 계기판   실제 멀티턴 에이전트 루프를 라이브로 실행 — 도구 오류에서 회복하는
//               세션이 표에 실시간으로 잡힌다 (harness_sim + vLLM Qwen3.8-27B)
//   3. 블랙박스 방금 그 세션의 턴별 판정 기록 → '창작만' 필터 → 원본 JSONL
//   4. 엔진 시험 모델 호출 없이 판정 엔진 단독 실행 — 프리셋 하나, 그리고
//               중첩 스키마 + 프로즈 + 트레일링 콤마 + enum 오타 + 누락 필드 복합 케이스
//   5. 계기판   전 구간 무결점률로 마무리
//
// 배속은 녹화 후 ffmpeg(-itsscale)로 건다. 여기서는 자연 속도로 담는다.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CURSOR_SCRIPT, makeMouse } from './cursor.mjs';
import { makeCaption } from './caption.mjs';

const BASE = process.env.TCS_CONSOLE ?? 'http://127.0.0.1:3100';
const PROXY = process.env.TCS_PROXY ?? 'http://127.0.0.1:8091';
const OUT  = process.env.TCS_OUT ?? './demo/out';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)); // toolcall-sre/
const W = 1600, H = 900;

const SPEED = Number(process.env.TCS_SPEED ?? 1);
const dt = (ms) => Math.max(1, Math.round(ms / SPEED));
const beat = (p, ms = 2000) => p.waitForTimeout(dt(ms));
const read = (p, ms = 3800) => p.waitForTimeout(dt(ms));

// 실전형 멀티턴 과제와 어긋나지 않게, 세션 이름은 화면에서 그대로 읽히는 값으로.
const RUN_TAG = Date.now().toString(36).slice(-4);
const SESS_RECOVERY = `agent-recovery-${RUN_TAG}`;
const SESS_HAPPY = `agent-happy-${RUN_TAG}`;

/** harness_sim 한 판을 백그라운드로 돌린다 (실제 vLLM 모델, 최대 6턴 루프). */
function runHarness(scenario, session) {
  return new Promise((resolve) => {
    const p = spawn(
      'python3',
      ['scripts/harness_sim.py', PROXY, 'qwen3.8-27b', scenario, session],
      { cwd: ROOT, stdio: 'ignore' },
    );
    p.on('close', resolve);
    p.on('error', resolve);
  });
}

const MEETING_SCHEMA = JSON.stringify(
  {
    type: 'object',
    properties: {
      title: { type: 'string' },
      start_time: { type: 'string' },
      duration_minutes: { type: 'integer', minimum: 15, maximum: 480 },
      location: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['video_call', 'in_person'] },
          value: { type: 'string' },
        },
        required: ['kind', 'value'],
        additionalProperties: false,
      },
      attendees: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string', enum: ['required', 'optional'] },
          },
          required: ['name', 'email', 'role'],
          additionalProperties: false,
        },
      },
    },
    required: ['title', 'start_time', 'duration_minutes', 'location', 'attendees'],
    additionalProperties: false,
  },
  null,
  2,
);

// 실제 소형 모델이 저지르는 실수를 한 페이로드에 겹쳐 담았다:
// 인사말 프로즈 + 트레일링 콤마(파서가 복구) · enum 오타(형식 위반) ·
// attendees[0]의 email/role 누락(정보 결손 — 고치려면 지어내야 함)
const BROKEN_ARGS =
  'Sure! Here is the call:\n' +
  '{"title":"Design Review","start_time":"2026-08-25T15:00:00+09:00",' +
  '"duration_minutes":30,"location":{"kind":"video-call",' +
  '"value":"https://meet.example.com/design-review"},' +
  '"attendees":[{"name":"Alice Kim"}],}';

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
  await beat(page, 1200);
}

// ────────────────────────────── 장면 1 · 계기판 ──────────────────────────────
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await m.enter();
await cap('① 계기판 — 프록시가 지금까지 관측한 툴콜 신뢰성 집계');
await read(page, 4200);                       // 창작 헤드라인 배너
await m.scroll(300);
await cap('정상 · 파서 복구 · 수리 · 창작(보라) · 실패 — 종류가 다른 사건은 다른 색으로 센다');
await read(page, 4600);                       // 신뢰성 타일 + 구성 눈금
await m.scroll(430);
await cap('수리가 더한 지연은 요청 자체의 지연과 따로 보고한다');
await read(page, 3800);                       // 지연 타일

// ─────────────── 장면 2 · 실제 멀티턴 에이전트 루프 (라이브) ───────────────
const sessTable = page.locator('.section', { hasText: '세션' }).last();
await sessTable.scrollIntoViewIfNeeded();
await cap('② 실제 에이전트 루프를 라이브 실행 — 날씨 조회 → 도구 오류 → 재시도 → 리마인더 (Qwen3.8-27B)');
await beat(page, 1200);
const sims = Promise.all([
  runHarness('recovery', SESS_RECOVERY),
  runHarness('happy', SESS_HAPPY),
]);
await m.hover(sessTable.locator('table').first(), 1200).catch(() => {});
await sims;                                   // 보통 10–15초, 그동안 표가 2초마다 갱신된다
await beat(page, 3000);                       // 계기판 폴링 주기 반영
const recoveryRow = page.locator('tr', { hasText: SESS_RECOVERY }).first();
await recoveryRow.scrollIntoViewIfNeeded();
await m.hover(recoveryRow, 1400);
await cap('4턴 세션 — 도구 오류 1건에서 스스로 회복, 판정은 무결점 · 회복');
await read(page, 5200);
const harness = page.locator('.section', { hasText: '하네스 안에서의 행동' }).first();
await harness.scrollIntoViewIfNeeded();
await m.hover(harness.locator('.tiles'), 1200);
await cap('개별 콜이 아니라 업무 한 건 전체가 단위 — 콜당 95%도 8스텝이면 66%다');
await read(page, 4800);

// ────────────────────────────── 장면 3 · 블랙박스 ──────────────────────────────
await navTo('블랙박스');
await cap('③ 블랙박스 — 집계 숫자를 만든 개별 판정을 요청 단위로 되짚는다');
await read(page, 2600);
const filterBox = page.getByPlaceholder('세션 필터…');
await m.click(filterBox);
await page.keyboard.type(SESS_RECOVERY, { delay: dt(42) });
await beat(page, 1400);
await cap('방금 돌린 회복 세션만 필터 — 턴마다 무엇이 들어와 무엇이 나갔는지');
// 최신순 4턴 중 세 번째가 "실패한 도구 결과를 되먹은" 턴이다 (오류 칩이 여기 붙는다)
const evPanels = page.locator('details.panel');
const firstEv = (await evPanels.count()) >= 3 ? evPanels.nth(2) : evPanels.first();
await m.click(firstEv.locator('> summary'));   // 안쪽 '원본 기록' summary와 구분
await beat(page, 1200);
await m.scroll(260);
await read(page, 4200);                       // 되먹은 도구 결과 · 오류 칩
const rawToggle = firstEv.locator('summary', { hasText: '원본 기록' });
if (await rawToggle.count()) {
  await m.click(rawToggle.first());
  await cap('같은 내용이 --trace-file 로 디스크에 JSONL 한 줄씩 남는다');
  await beat(page, 1000);
  await m.scroll(300);
  await read(page, 4200);
}
await m.scroll(-9999);                        // 맨 위로
await m.click(filterBox);
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.press('Backspace');
await m.click(page.getByRole('button', { name: '창작만' }));
await cap('수리가 값을 지어낸 요청만 골라 본다 — 무엇을 지어냈는지 필드 단위로 남는다');
await beat(page, 1400);
const inventEv = page.locator('details.panel').first();
await m.click(inventEv.locator('> summary'));
await beat(page, 1000);
await m.scroll(200);
await read(page, 5000);                       // 지어냄 unit 칩

// ────────────────────────────── 장면 4 · 엔진 시험 ──────────────────────────────
await navTo('엔진 시험');
await cap('④ 엔진 시험 — 모델을 전혀 부르지 않고 파싱→검증→분류→정책 판단만 단독 실행');
await read(page, 3400);
await m.click(page.getByRole('button', { name: 'enum 밖', exact: true }));
await beat(page, 800);
let verdict = page.waitForResponse((r) => r.url().includes('/debug/inspect'), { timeout: 30000 });
await m.click(page.getByRole('button', { name: '확인', exact: true }));
await verdict;
await beat(page, 1000);
await m.scroll(430);
await cap('"C"는 값이 있고 의도도 명확 — 형식 위반, 지어낼 것 없이 수리 가능');
await read(page, 4800);

// 복합 케이스 — 실전형 중첩 스키마에 실수를 겹쳐 넣는다
await m.scroll(-9999);
await cap('이번엔 복잡한 케이스 — 중첩 객체·배열 스키마에 프로즈·트레일링 콤마·enum 오타·누락 필드를 한꺼번에');
const toolInput = page.locator('.field', { hasText: '도구 이름' }).locator('input');
await m.click(toolInput);
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.type('schedule_meeting', { delay: dt(34) });
const argsBox = page.locator('.field', { hasText: 'function.arguments' }).locator('textarea');
await m.click(argsBox);
await argsBox.fill(BROKEN_ARGS);
await beat(page, 900);
const schemaBox = page.locator('.field', { hasText: 'function.parameters' }).locator('textarea');
await m.click(schemaBox);
await schemaBox.fill(MEETING_SCHEMA);
await beat(page, 900);
verdict = page.waitForResponse((r) => r.url().includes('/debug/inspect'), { timeout: 30000 });
await m.click(page.getByRole('button', { name: '확인', exact: true }));
await verdict;
await beat(page, 1000);
const verdictSec = page.locator('.section', { hasText: '판정' }).last();
await verdictSec.scrollIntoViewIfNeeded();
await cap('프로즈·콤마는 파서가 복구, enum 오타는 형식 위반 — 그러나 email·role은 결손: 고치려면 지어내야 한다');
await beat(page, 1200);
await m.scroll(340);
await read(page, 6400);                       // 판정 타일 + 프록시가 할 일 + 누락 칩
await m.hover(page.locator('.panel', { hasText: '프록시가 할 일' }).first(), 1400).catch(() => {});
await cap('결정에는 이유가 붙는다 — 어떤 오류 경로든 업스트림 호출 없이 즉시 재현 가능');
await read(page, 4600);

// ────────────────────────────── 장면 5 · 마무리 ──────────────────────────────
await navTo('계기판');
const harness2 = page.locator('.section', { hasText: '하네스 안에서의 행동' }).first();
await harness2.scrollIntoViewIfNeeded();
await cap('중요한 숫자는 콜 단위 정상률이 아니라 업무 한 건 단위의 전 구간 무결점률이다');
await beat(page, 1000);
await m.hover(harness2.locator('.tiles'), 1500);
await read(page, 5200);
await cap('');
await beat(page, 800);

await context.close();
await browser.close();
console.log(`녹화 완료 → ${OUT}`);
