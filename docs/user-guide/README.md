# User guide · 사용자 가이드 · ユーザーガイド · 用户指南

How to use the `toolcall-sre` web console, with per-language screenshots of every screen.

| Language | Guide |
|---|---|
| 한국어 | [guide.ko.md](./guide.ko.md) |
| English | [guide.en.md](./guide.en.md) |
| 日本語 | [guide.ja.md](./guide.ja.md) |
| 中文 | [guide.zh.md](./guide.zh.md) |

The console itself renders in the same four languages (KO / EN / JA / ZH, top-left
switcher; stored in a cookie, server-rendered from the first paint).

## Regenerating the screenshots

Screenshots live in `img/<locale>/` and are captured with Playwright straight from a
running console, one full set per language:

```bash
# prerequisites: console on :3100, proxy on :8091, some traffic recorded
cd ui
node demo/shoot-guide.mjs
```

Related Playwright automation in `ui/demo/`:

- `shoot-guide.mjs` — the 4-language screenshot set for this guide
- `record-register.mjs` — demo video: register a backend → probe → live comparison run →
  complex tool-calling per model (Korean captions)
- `record-observability.mjs` — demo video: dashboard → live multi-turn agent loop with
  recovery → flight recorder → engine inspection (Korean captions)
