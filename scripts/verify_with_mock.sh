#!/usr/bin/env bash
# Run the whole verification suite against a proxy wired to the scenario mock.
#
# The mock is test fixture, not demo furniture: the suites need failures they
# can predict, and real models do not oblige. So the demo stack stays pointed
# at real backends and verification gets its own proxy on another port.
#
# The console-driven suites go through whichever proxy the console is pointed
# at, so this flips that pointer for the duration and puts it back — including
# when a suite fails or you interrupt it.
#
# Usage:  scripts/verify_with_mock.sh [verification-proxy-port]
set -uo pipefail

PORT="${1:-8093}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROXY="http://127.0.0.1:${PORT}"
UI="${TCS_UI:-http://127.0.0.1:3100}"
CFG="${ROOT}/ui/.tcs-console.json"
BIN="${ROOT}/target/release/toolcall-sre"
MOCK="${UI}/api/mock"

started_proxy=""
saved_cfg=""

cleanup() {
  if [ -n "$saved_cfg" ]; then
    printf '%s' "$saved_cfg" > "$CFG"
    echo "  콘솔 설정 복원됨"
  fi
  if [ -n "$started_proxy" ]; then
    kill "$started_proxy" 2>/dev/null
    echo "  검증용 프록시 종료됨 (:${PORT})"
  fi
}
trap cleanup EXIT INT TERM

# 검증용 프록시가 없으면 띄운다. 데모 스택(기본 8091)은 건드리지 않는다.
if ! curl -sf -o /dev/null "${PROXY}/health"; then
  echo "  검증용 프록시 기동 :${PORT}"
  "$BIN" --listen "127.0.0.1:${PORT}" \
    --upstream "${MOCK}/v1" \
    --upstream-alias "sim-solid=${MOCK}/p/solid/v1" \
    --upstream-alias "sim-flaky=${MOCK}/p/flaky/v1" \
    --upstream-alias "sim-rough=${MOCK}/p/rough/v1" \
    --upstream-alias "sim-scenario=${MOCK}/v1" \
    --repair-policy contextual --repair-streaming --allow-admin --cors \
    >/dev/null 2>&1 &
  started_proxy=$!
  for _ in $(seq 1 40); do
    curl -sf -o /dev/null "${PROXY}/health" && break
    sleep 0.25
  done
fi

# 콘솔이 검증용 프록시를 보도록 잠시 돌려놓는다. 원본은 그대로 되돌린다.
if [ -f "$CFG" ]; then
  saved_cfg="$(cat "$CFG")"
  python3 - "$CFG" "$PORT" <<'PY'
import json, sys
path, port = sys.argv[1], sys.argv[2]
cfg = json.load(open(path, encoding="utf8"))
url = f"http://127.0.0.1:{port}"
cfg.setdefault("proxies", [])
if not any(p.get("url") == url for p in cfg["proxies"]):
    cfg["proxies"].append({"id": "verify", "label": "검증용 프록시", "url": url})
cfg["activeProxyId"] = next(p["id"] for p in cfg["proxies"] if p.get("url") == url)
json.dump(cfg, open(path, "w", encoding="utf8"), ensure_ascii=False, indent=2)
PY
  echo "  콘솔을 검증용 프록시로 전환"
fi

fail=0
for s in verify_behaviors verify_ui verify_models verify_i18n; do
  echo
  echo "──────── ${s} ────────"
  TCS_PROXY="$PROXY" TCS_UI="$UI" python3 "${ROOT}/scripts/${s}.py" | tail -3
  [ "${PIPESTATUS[0]}" -eq 0 ] || fail=1
done

echo
[ "$fail" -eq 0 ] && echo "전체 통과" || echo "실패한 스위트가 있습니다"
exit "$fail"
