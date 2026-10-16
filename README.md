# dsh-screenshot — DeepSeek Harness 截图插件

在 DeepSeek Harness 的会话输入框点「＋」，菜单里选「截图」（或「截图 · 隐藏本窗口」），
框选屏幕后图片**直接进入输入框附件轨**，随消息一起发给 Agent。

- 适配：DeepSeek Harness Desktop 0.2.0-rc.2（macOS）
- 形态：Harness 双半份客户端插件（宿主 node 半份 + 浏览器半份），**不改 Electron 壳、不重打包应用、零第三方依赖**
- 规模：插件本体约 1000 行 + 测试/脚本约 650 行，38 项单元测试

## 功能

| 能力 | 说明 |
| --- | --- |
| 「＋」菜单集成 | 通过 Harness 的 ctx.commandUi.register 注册两个条目：截图 / 截图 · 隐藏本窗口 |
| 原生框选 | 宿主半份调用 macOS /usr/sbin/screencapture -i，系统十字光标直接框选（空格切窗口模式，Esc 取消） |
| 隐藏本窗口 | 截图前隐藏 Harness 窗口（System Events 优先、AppKit 回退），截完必定恢复并置前 |
| 图片入框 | conversation.createDrafts + shell.addFiles，与拖拽/粘贴图片完全同一条链路，发送时自动上传与图片接纳 |
| 兜底路径 | 宿主路由不可用时回退到 getDisplayMedia + 应用内裁剪层（浏览器打开 GUI 时可用） |

## 仓库结构

    .
    ├── plugins/dsh-screenshot/          插件本体
    │   ├── package.json                 dsh.client 声明 + exports["./client"]
    │   ├── lib/entry.js                 挂载入口（mtime 版本号动态 import，绕开 ESM 旧构建缓存）
    │   ├── lib/index.js                 宿主半份：心跳 + /dsh-screenshot/* 路由 + 隐藏窗口
    │   ├── lib/client.js                浏览器半份：菜单贡献 + 捕获管线 + 裁剪层 + 注入输入框
    │   └── README.md                    详细说明书（安装、使用、权限、排障、路由契约）
    ├── scripts/
    │   ├── mount.sh / unmount.sh        写入/移除 profile 补丁层条目（幂等 + 自动备份）
    │   ├── verify.sh                    一键自检（文件、挂载、心跳、在线路由、38 项测试）
    │   └── verify-host-resolution.mjs   复核宿主扫描前置条件
    ├── tests/
    │   ├── loader-sim.test.mjs          客户端半份 27 项（模拟 loader、捕获管线、入框链路、地理计算）
    │   └── host-route.test.mjs          宿主路由 11 项（越权来源、方法、守卫头、AppleScript 辅助函数）
    └── 开发规划.md                       可行性分析、集成点考证、开发计划与实施状态

## 安装

    bash scripts/mount.sh          # 备份并写入 ~/.dsh/profiles/desktop/cordis.patch.yml
    # 生效：host 侧由 dsh-hmr 热挂载（约 1 秒）；页面刷新（Cmd+R）加载客户端半份

自检：

    bash scripts/verify.sh
    curl -s http://127.0.0.1:19387/dsh-screenshot/status
    # {"ok":true,"native":true,"hide":true,"platform":"darwin","tool":"/usr/sbin/screencapture"}

卸载：

    bash scripts/unmount.sh

## 网络与加速（可选）

插件本身不联网。只有在克隆/推送本仓库、或 Harness 内使用 GitHub 相关能力时，才可能需要网络加速。

Watt Toolkit（原 Steam++）的 GitHub 加速采用「hosts 指向 127.0.0.1 + 本地 80/443 反代」，
**不是 HTTP 代理模式**，因此不需要给 git 配置 http.proxy，直连即可走加速：

    git ls-remote origin          # 加速开启后应当立即返回

反过来，若曾为 GitHub 配过 HTTP 代理（例如 Clash 的 127.0.0.1:7897），该配置会让 git **绕开** hosts 加速，
代理没开时直接失败，建议移除：

    git config --global --unset http.https://github.com/.proxy
    git config --global --unset http.https://gist.github.com/.proxy

另外注意：Node 不读取 macOS 钥匙串的根证书，在 hosts 劫持下 Node 发起的抓取可能报
证书错误（UNABLE_TO_VERIFY_LEAF_SIGNATURE），可用 NODE_EXTRA_CA_CERTS 指向加速工具的根证书解决。

## 实现要点

- **加号菜单**是 Harness 的斜杠命令菜单，客户端插件用 ctx.commandUi.register({ name, label, icon, available, ui: { kind: "action", run } }) 就能加条目。
- **图片入框**复刻了 Harness 内置「上传文件 / 拖拽」路径：ctx.sessions.scope(sessionId) → actx.get("conversation") → createDrafts(sessionId, [file]) → conversation.input.for(actx).addFiles([], ids)，失败则 releaseDraftAttachments。
- **原生截图**在宿主半份用 webServer.register 暴露 /dsh-screenshot/* 路由；浏览器半份拿不到子进程能力，只能经这条回环路由取 PNG 字节。
- **隐藏本窗口**壳里没有任何窗口 IPC，因此用系统层实现：System Events 的 set visible of process + AppKit 的 NSRunningApplication.hide 双通道，screen capture 期间隐藏，finally 必定恢复（最多 3 次重试）。

## 已知边界

- 原生框选目前仅 macOS；Windows/Linux 需在宿主半份补对应实现（/native-region 契约可原样复用）。
- 桌面壳未设置 setDisplayMediaRequestHandler，因此 Electron 内的兜底路径会被拒绝——这正是原生路径作为默认的原因；浏览器打开 GUI 时兜底路径正常工作。
- 需要 macOS「屏幕录制」权限（首次会提示）；「隐藏本窗口」首次可能提示自动化授权，拒绝会自动走 AppKit 通道。

## 许可

MIT（见 plugins/dsh-screenshot/package.json）。
