// toolcall-sre 데모 시연 녹화 — Playwright
//
// 실행: node demo/record.mjs   (사전에 콘솔 3100 · 프록시 8091 기동)
// 커서가 화면에 보이며, 시나리오에 따라 실제로 이동하고 클릭하는 과정이 그대로 녹화된다.
import { chromium } from 'playwright';
import { CURSOR_SCRIPT, makeMouse } from './cursor.mjs';

const BASE = process.env.TCS_CONSOLE ?? 'http://127.0.0.1:3100';
const OUT  = process.env.TCS_OUT ?? './demo/out';
const W = 1600, H = 900;

// 장면 사이 호흡. 나레이션 없이도 읽히도록 넉넉하게.
const beat = (p, ms = 2200) => p.waitForTimeout(ms);
const read = (p, ms = 4200) => p.waitForTimeout(ms);

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: W, height: H },
  recordVideo: { dir: OUT, size: { width: W, height: H } },
  locale: 'ko-KR',
  deviceScaleFactor: 2,
});
// 모든 문서에 커서 오버레이를 심는다 (페이지 이동 후에도 유지).
await context.addInitScript(CURSOR_SCRIPT);

const page = await context.newPage();
const m = makeMouse(page, { x: W / 2, y: H / 2 });

/** 왼쪽 메뉴를 커서로 눌러 화면을 이동한다. */
async function navTo(label) {
  const link = page.locator('.navlink', { hasText: label }).first();
  await m.click(link);
  await page.waitForLoadState('networkidle');
  await beat(page, 1600);
}

/** 시나리오 카드로 커서를 옮겨 실행하고, 결과가 뜰 때까지 기다린다. */
async function runScenario(title, { dwell = 4200 } = {}) {
  const card = page.locator('.panel', { hasText: title }).first();
  await m.hover(card.locator('.head'), 650);              // 카드 제목을 먼저 짚는다
  await m.click(card.getByRole('button', { name: '실행' }));
  await page.locator('#result').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#result').scrollIntoViewIfNeeded();
  await read(page, dwell);
}

await page.goto(`${BASE}/connections`, { waitUntil: 'networkidle' });
await m.enter();

// ── 장면 1 · 연결 확인 : 화면이 아니라 실제로 동작 중인 프로그램임을 보여준다
await read(page);
await m.scroll(320);

// ── 장면 2 · 고칠 수 있는 오류
await navTo('시험대');
await runScenario('정상 툴콜', { dwell: 3600 });
await runScenario('인사말 + 트레일링 콤마');
await runScenario('enum 밖의 값');

// ── 장면 3 · 핵심 : 결과가 같은데 판정이 갈린다
await runScenario('필수 항목 누락 — 맥락에 답이 있음', { dwell: 5200 });
await runScenario('필수 항목 누락 — 맥락에도 답이 없음', { dwell: 5200 });
await m.scroll(260);
await read(page, 4200);                                   // 창작 경고에 머무는 시간

// ── 장면 4 · 실시간 응답에서도 작동
await runScenario('스트리밍 + 인사말 혼입', { dwell: 4600 });

// ── 장면 5 · 기록 : 지어낸 것만 골라 보기
await navTo('블랙박스');
const onlyInvent = page.getByRole('button', { name: '창작만' });
if (await onlyInvent.count()) await m.click(onlyInvent.first());
await read(page);
await m.scroll(400);

// ── 장면 6 · 계기판 : 집계된 신뢰성
await navTo('계기판');
await read(page);
await m.scroll(700);
await read(page);

// ── 장면 7 · 실제 오픈소스 모델 비교
//
// 여기 등장하는 것은 모사 백엔드가 아니라 Ollama 로 띄운 진짜 오픈소스 모델이다.
// 측정 자체는 demo/prepare.mjs 로 녹화 전에 끝내 둔다 — 실제 모델은 한 건에
// 수 초~수십 초가 걸려, 녹화 중에 돌리면 화면이 멈춘 것처럼 보이기 때문이다.
await navTo('모델');
await read(page, 4200);                                   // 등록된 실제 모델 목록
await m.scroll(600);
await read(page, 3200);                                   // 비교 실행 · 백엔드 선택
// 비교표를 화면에 확실히 올린다. 등록 백엔드 수에 따라 페이지 길이가 달라지므로
// 고정 스크롤 대신 표를 직접 찾아 맞춘다.
const table = page.locator('.section', { hasText: '모델별 신뢰성' }).first();
await table.scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await read(page, 5200);
await m.scroll(560);                                      // 표 아래쪽 행까지
await read(page, 5600);

await context.close();
await browser.close();
console.log(`녹화 완료 → ${OUT}`);
