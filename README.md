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

### 方式 A：Harness 插件管理器（推荐）

仓库根就是插件包（声明了 `dsh.bundle` 组合包 + `dsh.client` 浏览器半份），可直接被 Harness 的插件安装器识别：

1. 打开 **设置 → 插件 → 「添加插件」**；
2. 在「包名或地址」里填本仓库地址：`https://github.com/RichardDou0607/dsh-screenshot`
   （等价的简写：`github:RichardDou0607/dsh-screenshot`）；
3. 点「安装」，完成后按提示启用；若菜单里还没出现「截图」，重启一次 Harness；
4. 之后在 **设置 → 插件列表** 中可以看到它的运行状态，并随时启停 / 卸载。

本地开发时，第 2 步改填本机仓库的绝对路径（例如 `/Users/you/dsh-screenshot`），会用软链方式安装，改代码即时生效。

### 方式 B：手动挂载（不经过插件管理器）

    bash scripts/mount.sh      # 备份并写入 ~/.dsh/profiles/desktop/cordis.patch.yml（幂等）
    bash scripts/unmount.sh    # 移除该条目

两种方式**不要同时使用**（会对同一个插件挂载两次）。方式 B 适合不想让插件进入 profile 依赖表的场景。

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
