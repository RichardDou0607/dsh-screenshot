#!/usr/bin/env bash
# 把 dsh-screenshot 插件挂载到 DeepSeek Harness 桌面剖面的补丁层。
# 幂等：重复执行只会重写本插件自己的块。修改前自动备份 cordis.patch.yml。
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRY="$PLUGIN_DIR/plugins/dsh-screenshot/lib/entry.js"
# 宿主 loader 的条目 id。若某次热挂载后宿主半份始终不激活（该 id 的 ESM 求值错误被进程永久缓存），
# 把下面这行改成新的 id（例如 dsh-screenshot-host2）再执行本脚本即可，无需重启应用。
ENTRY_ID="dsh-screenshot-host2"
PROFILE_DIR="${DSH_SCREENSHOT_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"
MARK_BEGIN="# >>> dsh-screenshot plugin >>>"
MARK_END="# <<< dsh-screenshot plugin <<<"

if [ ! -f "$ENTRY" ]; then
  echo "缺少插件入口：$ENTRY" >&2
  exit 1
fi
if [ ! -f "$PATCH_FILE" ]; then
  echo "缺少剖面补丁文件：$PATCH_FILE" >&2
  exit 1
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
# 去掉块后可能留下的连续空行尾部
awk 'BEGIN { blank = 0 } { if ($0 ~ /^[[:space:]]*$/) { blank += 1; next } while (blank > 0) { print ""; blank -= 1 } print; buffer = 1 }' "$TMP" > "$TMP.trimmed"
mv "$TMP.trimmed" "$TMP"

{
  cat "$TMP"
  printf '\n%s\n' "$MARK_BEGIN"
  printf '%s\n' "- insert:"
  printf '%s\n' "    - id: $ENTRY_ID"
  printf '%s\n' "      name: '$ENTRY'"
  printf '%s\n' "$MARK_END"
} > "$PATCH_FILE"
rm -f "$TMP"

echo "已挂载：$ENTRY"
echo "补丁文件：$PATCH_FILE"
echo "下一步：退出并重新打开 DeepSeek Harness（宿主 loader 只在启动时读取补丁层），然后刷新页面。"
