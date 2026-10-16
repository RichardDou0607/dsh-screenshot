#!/usr/bin/env bash
# 把 dsh-screenshot 挂载到桌面剖面补丁层（精确编辑，不动其他条目）。
# 真正的逻辑在 scripts/patch-entry.mjs，避免"标记块整块删除"误伤别人的条目。
set -euo pipefail
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SELF_DIR/patch-entry.mjs" mount "$@"
