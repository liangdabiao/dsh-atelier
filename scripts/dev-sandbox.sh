#!/bin/sh
# 隔离 DSH_HOME 启动网页版验收，不碰 ~/.dsh。用法：scripts/dev-sandbox.sh [端口]
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="${DSH_SANDBOX:-$ROOT/../.dsh-atelier-sandbox}"
PORT="${1:-4399}"
mkdir -p "$SANDBOX"; SANDBOX="$(cd "$SANDBOX" && pwd)"
cd "$ROOT"
node scripts/build.mjs
unset DSH_SESSION_ID DSH_SHELL DSH_WEB_URL DSH_PROFILE DSH_PROFILE_DIR
export DSH_HOME="$SANDBOX"
dsh plugin --profile web remove dsh-atelier >/dev/null 2>&1 || true
dsh plugin --profile web add "link:$ROOT" >/dev/null
echo "[sandbox] DSH_HOME=$SANDBOX  port=$PORT"
exec dsh --profile web --no-open --port "$PORT"
