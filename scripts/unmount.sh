#!/usr/bin/env bash
# 从剖面补丁层移除 dsh-screenshot 插件块（幂等）。修改前自动备份。
set -euo pipefail

PROFILE_DIR="${DSH_SCREENSHOT_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
MARK_BEGIN="# >>> dsh-screenshot plugin >>>"
MARK_END="# <<< dsh-screenshot plugin <<<"

if [ ! -f "$PATCH_FILE" ]; then
  echo "缺少剖面补丁文件：$PATCH_FILE" >&2
  exit 1
fi

if ! grep -qF "$MARK_BEGIN" "$PATCH_FILE"; then
  echo "补丁层中没有 dsh-screenshot 块，无需处理。"
  exit 0
fi

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$PATCH_FILE.bak-dsh-screenshot-$STAMP"
cp "$PATCH_FILE" "$BACKUP"
echo "已备份：$BACKUP"

TMP=$(mktemp)
awk -v begin="$MARK_BEGIN" -v end="$MARK_END" '
  $0 == begin { skipping = 1; next }
  $0 == end { skipping = 0; next }
  skipping != 1 { print }
' "$PATCH_FILE" > "$TMP"
mv "$TMP" "$PATCH_FILE"

echo "已移除 dsh-screenshot 块。重启 DeepSeek Harness 后生效。"
