#!/bin/sh
# Double-click launcher entry, WSL side (stop half). Windows side:
# windows/lingualeaf-stop.bat. Same explicit node resolution as launch.sh.
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(dirname -- "$(dirname -- "$SCRIPT_DIR")")
# shellcheck disable=SC1091
. "$SCRIPT_DIR/_node.sh"
if ! _node_resolve; then
  echo "stop: 未找到 Node.js >= 22.12(生产入口需要它)。" >&2
  if [ -n "${_NODE_SEEN:-}" ]; then
    echo "发现的 node 都太旧或不合法:" >&2
    printf '%s' "$_NODE_SEEN" >&2
  else
    echo "没有找到任何 node。" >&2
  fi
  echo "修复: nvm install 24 && nvm alias default 24(或安装 Node.js 22.12+ 后重试)。" >&2
  exit 1
fi
exec "$NODE_BIN" "$REPO_ROOT/scripts/launcher/stop.mjs"
