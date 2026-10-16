# dsh-screenshot — DeepSeek Harness 截图插件

在 DeepSeek Harness 会话输入框点击「＋」，菜单里出现两个条目：

- **截图** —— 直接框选，画面上会有 Harness 自己的窗口；
- **截图 · 隐藏本窗口** —— 先把 Harness 窗口隐藏起来再框选，截图里只留其他内容，截完自动把窗口恢复并前置。

两种方式截完的图片都**直接进入输入框附件轨**，随消息一起发送给 Agent。

适配目标：DeepSeek Harness Desktop 0.2.0-rc.2（macOS）。只用 Harness 自身的扩展点，
不改 Electron 壳、不重打包应用。

## 两条捕获路径

| 路径 | 触发条件 | 交互 | 说明 |
| --- | --- | --- | --- |
| 原生（默认） | macOS 且宿主半份已激活 | 系统十字光标：拖拽框选区域，按空格切换「窗口」模式，Esc 取消 | 宿主半份调用 /usr/sbin/screencapture -i，能截到应用窗口之外的内容 |
| 兜底 | 宿主路由不可用（非 macOS、宿主半份未激活） | 系统屏幕/窗口选择器 + 应用内裁剪层（拖拽选区、Enter 完成、Esc 取消） | 浏览器半份调用 navigator.mediaDevices.getDisplayMedia |

桌面壳未设置 setDisplayMediaRequestHandler，因此 Electron 下 getDisplayMedia 通常会被拒绝；
原生路径就是为此准备的默认路径。两条路径最终都走同一条注入链路：createDrafts + addFiles，
与拖拽/粘贴图片完全一致。

## 目录结构

    dsh-screenshot/
    ├── package.json          # name + exports["./client"] + dsh.client 声明（宿主扫描用）
    ├── lib/
    │   ├── entry.js          # 挂载点：带 mtime 版本号的动态 import，绕过 ESM 旧构建缓存
    │   ├── index.js          # 宿主半份：加载心跳 + /dsh-screenshot/* 原生截图路由
    │   └── client.js         # 浏览器半份：菜单贡献 + 捕获管线 + 裁剪层 + 注入输入框
    └── .host-loaded.json     # 宿主半份激活后写入的心跳（诊断用）

同级还有：scripts/mount.sh（挂载）、scripts/unmount.sh（卸载）、scripts/verify.sh（一键自检）、
tests/loader-sim.test.mjs（客户端 20 项）、tests/host-route.test.mjs（宿主路由 7 项）。

## 安装与生效

### 方式 A：Harness 插件管理器（推荐）

仓库根声明了组合包（`dsh.bundle`）与浏览器半份（`dsh.client`），所以能走 Harness 自带的安装流程：

1. **设置 → 插件 → 添加插件**；
2. 「包名或地址」填 `https://github.com/RichardDou0607/dsh-screenshot`（或 `github:RichardDou0607/dsh-screenshot`）；
3. 安装完成后启用；菜单里没出现「截图」就重启一次 Harness；
4. **设置 → 插件列表** 里可查看状态、启停与卸载。

本地开发改填本机绝对路径，会以软链安装、改代码即时生效。

### 方式 B：手动挂载

    bash scripts/mount.sh          # 在仓库根目录执行：备份并写入 profile 补丁层
    bash scripts/unmount.sh        # 移除

补丁层条目形如：

    # >>> dsh-screenshot plugin >>>
    - insert:
        - id: dsh-screenshot-host
          name: '<仓库绝对路径>/plugins/dsh-screenshot/lib/entry.js'
    # <<< dsh-screenshot plugin <<<

**生效方式：无需重启。** dsh-hmr 实时监听 cordis.patch.yml，写入后约 1 秒内热挂载宿主半份；
客户端半份刷新页面（Cmd+R）后加载。两种安装方式不要同时使用。

## 使用

1. 输入框点「＋」→「命令」分区里选：
   - 「截图」= 直接框选（英文 Screenshot）；
   - 「截图 · 隐藏本窗口」= 先隐藏 Harness 窗口再框选（英文 Screenshot · hide window）；
2. 出现系统十字光标：拖拽选择区域（按空格切换窗口模式，Esc 取消）；
3. 图片直接出现在输入框上方附件轨，可预览/删除，点发送即随消息进入会话。

### 「隐藏本窗口」怎么工作

宿主半份在截图前后各做一次窗口可见性切换，全程约 1 秒：

1. 隐藏 DeepSeek Harness（优先 System Events，失败则回退 AppKit 的 NSRunningApplication.hide）；
2. 等隐藏动画结束（320ms）再打开十字光标，保证动画过程不会被截进去；
3. 无论框选成功、按 Esc 取消还是报错，**finally 里都必定恢复窗口并置前**（最多重试 3 次，失败再走 AppKit）。

首次使用时 macOS 可能弹出「DeepSeek Harness 想要控制 System Events」的自动化授权；拒绝也不影响
使用——会自动走 AppKit 通道。两条通道都失败时，会按原样截图并提示「未能隐藏…本次截图仍包含本窗口」。

已知行为：窗口处于全屏时隐藏/恢复会伴随一次 Space 切换动画（壳没有暴露窗口 API，只能用系统层实现）。

## 权限（首次使用）

macOS 需要「屏幕录制」权限：系统设置 → 隐私与安全性 → 屏幕录制，勾选 DeepSeek Harness。
未授权时截图可能是黑屏、只有桌面壁纸，或选择器被直接拒绝。

## 验证

    bash scripts/verify.sh

自检覆盖：插件文件、补丁层条目、宿主心跳、在线路由（curl /dsh-screenshot/status）、
27 项单元测试、三个文件的语法、原生 screencapture 可用性。

单独排查用：

    curl -s http://127.0.0.1:19387/dsh-screenshot/status
    # 期望 {"ok":true,"native":true,"platform":"darwin","tool":"/usr/sbin/screencapture"}

页面控制台（确认客户端半份已编入引导清单）：

    window.__DSH_BOOT__.modules.find(function (m) { return m.id === "dsh-screenshot"; })

## 卸载

    bash scripts/unmount.sh
    # 约 1 秒后宿主半份热卸载；刷新页面即可

## 故障排查

| 现象 | 原因与处理 |
| --- | --- |
| 菜单里没有「截图」 | 刷新页面；若仍没有，查 /plugins/events 的模块图里有没有 dsh-screenshot 行 |
| 点「截图」提示无法捕获（走了兜底且被拒） | 宿主半份没激活：看 .host-loaded.json 和 /dsh-screenshot/status。未激活时按下面「条目 id」处理 |
| 截图是黑屏 | macOS 屏幕录制权限未授予，见上一节 |
| 选了「隐藏本窗口」但窗口没隐藏 | 提示「未能隐藏…」：自动化和 AppKit 两条通道都被系统拒绝。窗口仍会正常截图，只是包含本窗口 |
| 截完窗口没自己回来 | 恢复最多重试 3 次；仍失败时点一下 Dock 图标即可。请把现场（/status 返回、控制台报错）反馈 |
| 提示「输入框当前不接受新附件」 | 正在发送中，或当前是子代理会话的输入框，稍后重试 |
| 图片过大发送失败 | 走 Harness 原有接纳上限（单图默认 20MB、单条 200MB、单边 8192px），缩小选区即可 |

### 条目 id（唯一需要知道的坑）

host loader 会把**同一个 URL 上一次失败的 ESM 求值结果永久缓存**：如果某个条目 id 在
插件文件尚未写完时就被热挂载过，该 id 就会一直激活失败——换文件 URL、改文件内容都不起作用，
而客户端半份（按包元数据扫描）却照常生效，表现为「菜单能用、但截图走不了原生路径」。

处理方式二选一：

1. 把 cordis.patch.yml 里的条目 id 改成一个新值（例如 dsh-screenshot-host2）后重新执行
   mount.sh——scripts/mount.sh 顶部的 ENTRY_ID 就是为此准备的；
2. 或者 Cmd+Q 完全退出应用后重开（进程重启即清空缓存）。

lib/entry.js 这层引导入口已经用 mtime 版本号隔离了「代码被改过但缓存旧构建」的情况，
只剩下「条目 id 本身被污染」这一种需要换 id。

另外：**改动宿主半份后，光靠改写插件文件不会生效**——profile 补丁层只会重新物化「选项发生变化」
的条目，同名同路径的条目不会重新 apply。要么把条目 id 换成新值（scripts/mount.sh 的 ENTRY_ID），
要么 Cmd+Q 重启应用。改浏览器半份（client.js）则只需刷新页面（bundle 按文件 mtime 重新取）。

## 技术说明（集成的扩展点）

| 用途 | 集成点 |
| --- | --- |
| 「＋」菜单加项 | ctx.commandUi.register({ name, label, description, icon, available, ui: { kind: "action", run } }) |
| 原生截图路由 | 宿主半份 ctx.inject(["webServer"]) → webServer.register({ kind: "prefix", path: "/dsh-screenshot", handler }) |
| 浏览器兜底捕获 | navigator.mediaDevices.getDisplayMedia |
| 图片进输入框 | ctx.sessions.scope(sessionId) → actx.get("conversation") → createDrafts(sessionId, [file]) + conversation.input.for(actx).addFiles([], ids) |
| 提示语 | conversation.input.for(actx).notify(level, text)（error 触发 toast，info 内联提示） |
| 文案 | ctx.locale.register("screenshot", { zh, en }) |
| 客户端 bundle 注入 | package.json 的 dsh.client + exports["./client"]，由 dsh-client-modules 编入 window.__DSH_BOOT__ |
| profile 热挂载 | dsh-hmr 监听 cordis.patch.yml（chokidar），新增 insert 条目即时物化 |

## 路由契约（宿主半份）

| 方法与路径 | 行为 |
| --- | --- |
| GET /dsh-screenshot/status | 返回 { ok, native, hide, platform, tool }，不触发任何截图；`hide` 决定菜单里是否出现「隐藏本窗口」条目 |
| POST /dsh-screenshot/native-region | 打开系统十字光标；成功返回 image/png；用户取消返回 204；非 macOS 返回 501；缺少 x-dsh-screenshot: 1 请求头返回 400；附加 `?hide=1` 时先隐藏应用再截图 |
| 响应头 x-dsh-screenshot-hidden | `ok`（已隐藏）/ `failed`（请求隐藏但失败，窗口仍可见）/ `off`（未请求隐藏） |
| 其它 | 404 |

安全：仅接受同源调用——origin 缺省、dsh-app://app，或 loopback（127.0.0.1/localhost/::1）来源；
自定义请求头会强制浏览器预检，跨站页面拿不到该路由。
