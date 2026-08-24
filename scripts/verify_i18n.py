#!/usr/bin/env python3
"""Verify the console is genuinely translated, not just wired for translation.

TypeScript already guarantees every locale has every key (each dictionary is
typed as `Dict`). What it cannot catch is a key that was copied across without
being translated, or a page that still renders hardcoded text. Both are checked
here — statically over the sources, and live against the running console.
"""
import json, os, re, subprocess, sys, urllib.request

UI = os.environ.get("TCS_UI", "http://127.0.0.1:3100")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ui")
LOCALES = ["ko", "en", "ja", "zh"]

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"   {detail}" if detail and not cond else ""))


def get(path, locale=None, header=None):
    req = urllib.request.Request(UI + path)
    if locale:
        req.add_header("Cookie", f"tcs-locale={locale}")
    if header:
        req.add_header("Accept-Language", header)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode()


print("\n[1] 소스에 하드코딩된 문자열이 남아있지 않은지")
HANGUL = re.compile(r"[가-힣]")
KANA = re.compile(r"[ぁ-んァ-ン]")
offenders = []
for dirpath, _dirs, files in os.walk(ROOT):
    if "node_modules" in dirpath or ".next" in dirpath or "lib/i18n" in dirpath.replace("\\", "/"):
        continue
    for f in files:
        if not f.endswith((".ts", ".tsx")):
            continue
        path = os.path.join(dirpath, f)
        body = open(path, encoding="utf8").read()
        if HANGUL.search(body) or KANA.search(body):
            offenders.append(os.path.relpath(path, ROOT))
check("페이지·컴포넌트·라우트에 자연어 하드코딩 없음", not offenders, ", ".join(offenders))

print("\n[2] 사전이 서로 실제로 다른지 (복붙 미번역 탐지)")
dicts = {}
for loc in LOCALES:
    src = open(os.path.join(ROOT, "lib", "i18n", f"{loc}.ts"), encoding="utf8").read()
    # collect the string literals that carry copy
    dicts[loc] = re.findall(r'^\s{2,}\w+:\s*"([^"]{4,})"', src, re.M)
    check(f"{loc} 사전에 문구가 충분히 있음", len(dicts[loc]) > 120, f"{len(dicts[loc])}개")

for loc in LOCALES:
    if loc == "ko":
        continue
    shared = set(dicts[loc]) & set(dicts["ko"])
    # Identical entries are legitimate for a handful of technical tokens.
    ratio = len(shared) / max(1, len(dicts[loc]))
    check(f"{loc} 가 한국어 복사본이 아님", ratio < 0.15, f"동일 문구 비율 {ratio:.0%}")

print("\n[3] 타입 검사 — 누락된 키는 컴파일 에러")
tsc = subprocess.run(["npx", "tsc", "--noEmit"], cwd=ROOT, capture_output=True, text=True)
check("모든 로케일이 Dict 형태를 만족", tsc.returncode == 0, tsc.stdout[-400:])

print("\n[4] 서버 렌더가 선택한 언어를 따르는지")
MARKERS = {
    "ko": "실패를 골라서 재현하기",
    "en": "Pick a failure and reproduce it",
    "ja": "失敗を選んで再現する",
    "zh": "挑一种失败，把它复现出来",
}
for loc, marker in MARKERS.items():
    html = get("/lab", locale=loc)
    check(f"{loc} 로케일로 시험대가 렌더됨", marker in html)
    check(f"{loc} html lang 속성", f'lang="{loc}"' in html)

print("\n[5] 다른 언어가 새어나오지 않는지")
# The language switcher deliberately labels each option with its endonym — a
# Japanese speaker looks for 日本語, not "Japanese" — so those are not leaks.
ENDONYMS = ["한국어", "日本語", "中文", "English"]
for loc in ("en", "ja", "zh"):
    html = get("/", locale=loc)
    body = re.sub(r"<script[\s\S]*?</script>", "", html)
    for e in ENDONYMS:
        body = body.replace(e, "")
    leaked = HANGUL.findall(body)
    check(f"{loc} 화면에 한국어 잔여 없음", not leaked, f"{len(leaked)}자: {''.join(leaked[:20])}")

for loc in ("ko", "en", "zh"):
    html = get("/models", locale=loc)
    body = re.sub(r"<script[\s\S]*?</script>", "", html)
    for e in ENDONYMS:
        body = body.replace(e, "")
    leaked = KANA.findall(body)
    check(f"{loc} 화면에 일본어 잔여 없음", not leaked, f"{len(leaked)}자")

print("\n[6] Accept-Language 협상 (선택 저장 전)")
for header, want in [("ja,en;q=0.8", "ja"), ("zh-CN,zh;q=0.9", "zh"), ("en-US,en;q=0.9", "en")]:
    html = get("/", header=header)
    check(f"{header} → {want}", f'lang="{want}"' in html)
html = get("/", header="fr-FR,fr;q=0.9")
check("지원하지 않는 언어는 기본값으로", 'lang="ko"' in html)

print("\n[7] 시드 데이터가 접속 언어로 만들어지는지")
# 시드는 설정 파일이 없을 때만 만들어지므로 이 검사는 파일을 지워야 한다.
# 그 파일에는 사람이 등록해 둔 실제 백엔드 목록이 들어 있으므로, 지우기 전에
# 보관했다가 반드시 되돌려 놓는다. 검사 한 번이 남의 설정을 날리면 안 된다.
cfgfile = os.path.join(ROOT, ".tcs-console.json")
saved = None
if os.path.exists(cfgfile):
    with open(cfgfile, encoding="utf8") as f:
        saved = f.read()

try:
    expect = {"en": "Simulated", "ja": "模擬", "zh": "模拟", "ko": "모사"}
    for loc, marker in expect.items():
        if os.path.exists(cfgfile):
            os.remove(cfgfile)
        req = urllib.request.Request(UI + "/api/config")
        req.add_header("Cookie", f"tcs-locale={loc}")
        with urllib.request.urlopen(req, timeout=30) as r:
            cfg = json.load(r)
        check(f"{loc} 시드 백엔드 라벨", cfg["models"][0]["label"].startswith(marker),
              cfg["models"][0]["label"])
finally:
    if saved is not None:
        with open(cfgfile, "w", encoding="utf8") as f:
            f.write(saved)
    elif os.path.exists(cfgfile):
        os.remove(cfgfile)

print("\n" + "=" * 66)
print(f"  통과 {len(PASS)} / 실패 {len(FAIL)}")
if FAIL:
    print("  실패:", ", ".join(FAIL))
sys.exit(1 if FAIL else 0)
