// 가짜 커서 오버레이 + 사람처럼 움직이는 마우스 조작 헬퍼.
//
// 헤드리스 브라우저에는 OS 커서가 없어 녹화 영상에 마우스가 찍히지 않는다.
// 그래서 커서를 페이지 안에 DOM 으로 그려 넣고, 실제 마우스 이벤트를 따라가게 한다.
// 이동은 보간해서 dispatch 하므로 hover 효과도 실제로 켜진다.

/** 모든 문서에 커서 오버레이를 심는다. addInitScript 로 넘겨 쓸 것. */
export const CURSOR_SCRIPT = () => {
  if (window.__tcsCursor) return;
  window.__tcsCursor = true;

  const mount = () => {
    const root = document.documentElement;
    if (!root) return requestAnimationFrame(mount);

    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
    // React 가 관리하는 body 밖(html 직속)에 두어 hydration 과 충돌하지 않게 한다.
    root.appendChild(wrap);

    const dot = document.createElement('div');
    dot.style.cssText =
      'position:absolute;left:0;top:0;width:26px;height:26px;' +
      'will-change:transform;transform:translate(-100px,-100px)';
    dot.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 26 26">' +
      '<path d="M5 3 L5 20 L9.6 15.8 L12.4 22.2 L15.6 20.8 L12.9 14.6 L19 14.2 Z"' +
      ' fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    wrap.appendChild(dot);

    let x = -100, y = -100;
    const draw = () => { dot.style.transform = `translate(${x}px, ${y}px)`; };

    addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; draw(); }, true);

    addEventListener('mousedown', () => {
      const r = document.createElement('div');
      r.style.cssText =
        `position:absolute;left:${x}px;top:${y}px;width:14px;height:14px;margin:-7px 0 0 -7px;` +
        'border-radius:50%;border:2.5px solid #2f6fb8;background:rgba(47,111,184,.22);' +
        'transform:scale(.35);opacity:1;transition:transform .42s ease-out,opacity .42s ease-out';
      wrap.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(3.2)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 500);
    }, true);
  };
  mount();
};

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** 커서 상태. 페이지마다 새로 만든다. */
export function makeMouse(page, start = { x: 800, y: 450 }) {
  const pos = { ...start };

  /** 현재 위치에서 (x, y) 까지 보간 이동. 거리에 비례해 걸음 수를 정한다. */
  async function moveTo(x, y, { speed = 1 } = {}) {
    const dist = Math.hypot(x - pos.x, y - pos.y);
    const steps = Math.max(8, Math.min(46, Math.round(dist / 22))) ;
    for (let i = 1; i <= steps; i++) {
      const t = easeInOut(i / steps);
      await page.mouse.move(pos.x + (x - pos.x) * t, pos.y + (y - pos.y) * t);
      await page.waitForTimeout(Math.round(13 / speed));
    }
    pos.x = x; pos.y = y;
  }

  /** 요소로 이동한 뒤 잠깐 멈췄다가 누른다. */
  async function click(locator, { settle = 320 } = {}) {
    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(220);
    const box = await locator.boundingBox();
    if (!box) throw new Error('요소의 위치를 찾지 못했습니다');
    await moveTo(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(settle);          // 누르기 직전의 호흡
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
  }

  /** 클릭 없이 올려두기만 — 강조하고 싶은 지점에 쓴다. */
  async function hover(locator, hold = 900) {
    await locator.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const box = await locator.boundingBox();
    if (!box) return;
    await moveTo(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(hold);
  }

  /** 뚝뚝 끊기지 않게 조금씩 굴리는 스크롤. */
  async function scroll(total, { chunk = 90, delay = 26 } = {}) {
    const dir = Math.sign(total);
    for (let done = 0; done < Math.abs(total); done += chunk) {
      await page.mouse.wheel(0, dir * chunk);
      await page.waitForTimeout(delay);
    }
    await page.waitForTimeout(320);
  }

  /** 화면에 커서를 처음 등장시킨다. */
  async function enter() {
    await page.mouse.move(start.x, start.y);
    await page.waitForTimeout(260);
  }

  return { moveTo, click, hover, scroll, enter, pos };
}
