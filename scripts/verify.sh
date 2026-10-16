#!/usr/bin/env bash
# dsh-screenshot 自检：挂载状态、宿主加载心跳、在线路由、单元测试。
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/plugins/dsh-screenshot"
PATCH="$HOME/.dsh/profiles/desktop/cordis.patch.yml"
MARK="# >>> dsh-screenshot plugin >>>"
HEARTBEAT_LOCAL="$PLUGIN/.host-loaded.json"
HEARTBEAT_HOME="$HOME/.dsh/dsh-screenshot-host.json"
ROUTE="http://127.0.0.1:19387/dsh-screenshot/status"
ok() { printf '  [OK]   %s\n' "$1"; }
bad() { printf '  [FAIL] %s\n' "$1"; }
info() { printf '  [INFO] %s\n' "$1"; }

printf '\n== 1. 插件文件 ==\n'
if [ -f "$ROOT/package.json" ]; then ok "package.json（仓库根 = 插件包清单）"; else bad "package.json 缺失"; fi
for f in lib/entry.js lib/index.js lib/client.js; do
  if [ -f "$PLUGIN/$f" ]; then ok "$f"; else bad "$f 缺失"; fi
done

printf '\n== 2. 剖面补丁层 ==\n'
if [ -f "$PATCH" ]; then
  if grep -qF "$MARK" "$PATCH"; then ok "已挂载（${PATCH}）"; else bad "补丁层中没有 dsh-screenshot 块，先运行 scripts/mount.sh"; fi
  info "条目 id：$(grep -A2 -F "$MARK" "$PATCH" | grep 'id:' | tr -d ' ')"
else
  bad "找不到 ${PATCH}"
fi

printf '\n== 3. 宿主加载心跳 ==\n'
if [ -f "$HEARTBEAT_LOCAL" ]; then
  ok "宿主半份已加载：$(tr -d '\n' < "${HEARTBEAT_LOCAL}")"
elif [ -f "$HEARTBEAT_HOME" ]; then
  ok "宿主半份已加载：$(tr -d '\n' < "${HEARTBEAT_HOME}")"
else
  bad "没有心跳：宿主半份未激活。用新的条目 id 重新挂载（scripts/mount.sh），或 Cmd+Q 重启应用"
fi

printf '\n== 4. 在线路由 ==\n'
ROUTE_BODY="$(curl -s --max-time 5 "$ROUTE" 2>/dev/null || true)"
if [ -n "$ROUTE_BODY" ]; then
  ok "路由可用：${ROUTE_BODY}"
else
  info "路由无响应（宿主半份未激活，或 GUI 端口不是 19387）"
fi

printf '\n== 5. 单元测试 ==\n'
if command -v node >/dev/null 2>&1; then
  if node --test "$ROOT/tests/loader-sim.test.mjs" "$ROOT/tests/host-route.test.mjs" > /tmp/dsh-screenshot-tests.log 2>&1; then
    ok "测试通过：$(grep -c '^✔' /tmp/dsh-screenshot-tests.log) 项"
  else
    bad "测试失败，详见 /tmp/dsh-screenshot-tests.log"
  fi
  if node --check "$PLUGIN/lib/client.js" >/dev/null 2>&1 && node --check "$PLUGIN/lib/index.js" >/dev/null 2>&1 && node --check "$PLUGIN/lib/entry.js" >/dev/null 2>&1; then
    ok "三个文件语法检查通过"
  else
    bad "语法检查失败"
  fi
else
  info "未找到 node，跳过单元测试"
fi

printf '\n== 6. 原生截图与隐藏窗口能力 ==\n'
if [ -x /usr/sbin/screencapture ]; then
  ok "宿主可用 /usr/sbin/screencapture（系统十字光标框选）"
else
  info "未找到 screencapture：客户端将回退到 getDisplayMedia + 应用内裁剪"
fi
if [ -x /usr/bin/osascript ]; then
  ok "宿主可用 /usr/bin/osascript（隐藏/恢复本窗口）"
else
  info "未找到 osascript：没有「隐藏本窗口」菜单项"
fi
case "$ROUTE_BODY" in
  *'"hide":true'*) ok "路由已报告 hide=true，菜单里会出现「截图 · 隐藏本窗口」" ;;
  *'"hide":false'*) info "当前平台/环境不支持隐藏窗口" ;;
  *) info "路由未响应，无法确认 hide 能力" ;;
esac

printf '\n手动验收：刷新页面（Cmd+R）→ 点「＋」→「截图 · 隐藏本窗口」→ 窗口隐藏并出现十字光标 → 框选 → 窗口恢复且图片进入附件轨\n\n'
