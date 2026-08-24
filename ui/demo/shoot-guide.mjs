// 사용자 가이드용 스크린샷 일괄 캡처 — 4개 언어 × 콘솔 6화면
//
// 실행: node demo/shoot-guide.mjs   (사전에 콘솔 3100 · 프록시 8091 기동,
//        계기판/비교표가 비어 보이지 않도록 측정 데이터가 어느 정도 쌓인 상태 권장)
//
// 결과: ../docs/user-guide/img/<locale>/<screen>.jpg
// 언어는 콘솔이 쿠키(tcs-locale)로 서버렌더하므로, 쿠키만 심으면 첫 페인트부터 맞다.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BASE = process.env.TCS_CONSOLE ?? 'http://127.0.0.1:3100';
const ROOT = fileURLToPath(new URL('../..', import.meta.url)); // toolcall-sre/
const OUT = `${ROOT}docs/user-guide/img`;
const LOCALES = ['ko', 'en', 'ja', 'zh'];
// 엔진 시험의 "확인" 버튼 라벨 (i18n common.check)
const CHECK = { ko: '확인', en: 'Check', ja: '確認', zh: '检查' };

const browser = await chromium.launch();

for (const locale of LOCALES) {
  const dir = `${OUT}/${locale}`;
  await mkdir(dir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN' }[locale],
  });
  await context.addCookies([
    { name: 'tcs-locale', value: locale, url: BASE },
  ]);
  const page = await context.newPage();
  const shot = (name) =>
    page.screenshot({ path: `${dir}/${name}.jpg`, type: 'jpeg', quality: 84 });
  const go = async (path) => {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
  };

  // 계기판 — 상단(창작 헤드라인·신뢰성 타일) + 하네스/세션 블록
  await go('/');
  await shot('dashboard');
  await page.mouse.wheel(0, 850);              // 하네스 안에서의 행동 + 세션 표
  await page.waitForTimeout(500);
  await shot('dashboard-sessions');

  // 시험대 — 백엔드 선택 + 시나리오 카드, 그리고 복잡한 도구 그룹
  await go('/lab');
  await shot('lab');
  await page.locator('section.section').last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot('lab-complex');

  // 엔진 시험 — 기본 프리셋(prose)을 그대로 검사해 판정까지 담는다
  await go('/inspect');
  const verdict = page.waitForResponse((r) => r.url().includes('/debug/inspect'), {
    timeout: 30000,
  });
  await page.getByRole('button', { name: CHECK[locale], exact: true }).click();
  await verdict;
  await page.waitForTimeout(600);
  await page.locator('section.section').last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot('inspect');

  // 블랙박스 — 첫 기록을 펼친 상태로
  await go('/trace');
  const first = page.locator('details.panel').first();
  if (await first.count()) {
    await first.evaluate((d) => { d.open = true; });
    await page.waitForTimeout(400);
  }
  await shot('trace');

  // 모델 — 레지스트리 상단 + 모델별 신뢰성 비교표
  await go('/models');
  await shot('models');
  await page.locator('section.section').nth(2).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot('models-compare');

  // 프록시 연결
  await go('/connections');
  await shot('connections');

  await context.close();
  console.log(`${locale}: 8장 저장 → ${dir}`);
}

await browser.close();
console.log(`완료 → ${OUT}`);
