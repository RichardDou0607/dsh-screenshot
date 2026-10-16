#!/usr/bin/env bash
# 从桌面剖面补丁层移除 dsh-screenshot 自己的条目（精确匹配，其他条目保持原样）。
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SELF_DIR/patch-entry.mjs" unmount "$@"
