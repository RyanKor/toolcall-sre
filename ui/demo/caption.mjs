// 자막 오버레이 — 지금 화면에서 무엇을 하고 있는지 국문 한 줄로 띄운다.
//
// 나레이션 없는 녹화 영상용. 커서(cursor.mjs)와 같은 방식으로 React가 관리하는
// body 밖(html 직속)에 두어 hydration과 충돌하지 않는다. 페이지를 이동하면
// DOM이 새로 뜨므로, 이동 직후 다시 cap()을 불러 주면 된다.

/** 페이지에 자막 함수를 만들어 돌려준다. cap('텍스트') 표시, cap() 숨김. */
export function makeCaption(page) {
  return async function cap(text) {
    await page.evaluate((t) => {
      let el = document.getElementById('__tcs_cap');
      if (!el) {
        el = document.createElement('div');
        el.id = '__tcs_cap';
        el.style.cssText =
          'position:fixed;left:50%;bottom:30px;transform:translateX(-50%);' +
          'max-width:74%;padding:.68rem 1.35rem;border-radius:.65rem;' +
          'background:rgba(13,22,27,.88);color:#fff;font-size:1.08rem;line-height:1.55;' +
          'text-align:center;z-index:2147483000;pointer-events:none;' +
          'opacity:0;transition:opacity .35s ease;box-shadow:0 4px 18px rgba(0,0,0,.35);' +
          'font-family:system-ui,-apple-system,"Noto Sans KR",sans-serif';
        document.documentElement.appendChild(el);
      }
      if (!t) { el.style.opacity = '0'; return; }
      el.textContent = t;
      el.style.opacity = '1';
    }, text ?? '');
  };
}
