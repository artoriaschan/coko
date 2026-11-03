---
kind: evidence
description: "历史、嵌套回退、压缩、命令草稿与只读边界的实际 App、Sidecar、Electron 和双主题验证。"
lifecycle: active
---

# 11 历史、回退与只读

## 对象与范围

[实施票](../../issues/11-history-rewind-and-read-only.md)、[规格](../../spec.md) AC-16、17、21、24、25。隔离工作树为 `/tmp/coko-conversation-detail/ticket-11`，分支 `codex/conversation-detail-11`；起点 59552fdb08e1a1ce87010cd60087f56a2856c8fe，先核对 clean 与 ancestry 后 frozen install。合入 10 的 7c649516，再快进到集成分支 7a4363c（后者只规范化 10 的证据日志，产品源码相同）。本票源码及正式文档提交为 74b522629283feb6ac960518256e0c668097b4db；其后只维护本票证据与关闭状态。

环境：macOS arm64；开发 Node 26.10.0、pnpm 12.15.0、Vitest 5.0.3、React 19.3.0、Electron 41.0.3。静默 agent-browser 0.38.2，命名会话 `coko-history-11`，其 headless Chromium 154.0.0.0、DPR 1。初始 Electron 安装缺少 binary，先确认该事实，再复制已验证同版本 ticket 04 缓存的 Electron.app 和 path.txt；未改依赖版本或仓库文件。

## 实施与红绿

- 嵌套被回退区间继承同一 Session 的完整不可变条目、真实 Run 状态和可用 Inspect；各层按自己的成员组织历史，`connected=false` 不给隐藏历史启用实时计时，动作保持只读。原有序号、工具调用 key、Checkpoint 与历史错误不可重试规则保持。去掉历史容器重复叠加的 opacity，避免嵌套历史把文字与代码进一步变淡。
- App 红例先证明 removed worktree 的回退按钮仍 enabled；修复消息动作和 Retry 后通过。另一红例证明嵌套历史没有 Work steps 控件、被显示为 running；传入真实 Run 后通过。打开的回退确认遇到新 Run 原本不关闭，新增红例后按限制关闭并清除打开请求；暂停的 removed worktree 原本仍显示 Continue，新增红例后移除该执行入口。
- 既有 Entry 直接读取：无 Run 归属的调用独立、缺失 run_start 不造耗时，切到 New chat 再重新打开仍可检查原数据；没有迁移、回填、数据库或协议变更。实际订阅是初始 afterSeq=0 和重连 lastSeq 后的尾部，没有向前分页。更早记录组合通过现有 App/store 投影接缝插入受控 earlier snapshot：揭示 Steering 后整轮不再可折叠，原消息、已有组/工具 DOM 与打开内容保持。
- 真正 Electron 命令用例发现回退返回展开模板正文，未返回原始调用。Sidecar 的同一命令 Fork 红例也得到 `Review target and report findings.` 而不是 `/review target`。修复共用 rewindTarget，只读取紧邻目标用户消息、非空同一 Run 的真实 command 元数据；无归属时仍使用真实消息正文，不猜命令。实际文件恢复、源条目完整前缀、命令原始调用及原有未发送草稿均由 Electron 重新读取证明；Sidecar 另验证 Fork 不改源条目与外部文件字节。
- 首轮 Electron 三文件五用例均失败于空 New chat 等待已移除的 ConnectionStatus，按共享原因修复各自就绪条件；不改全局 harness、不放宽业务断言。键盘顺序跟随实际新 Copy 按钮，先 Copy 再 Rewind。归档重载仍在 New chat，先打开持久化 Session 后再验证连接。修复后对应全部通过。

## 最终检查

以下为实际运行结果；无零用例冒充通过。最后对历史测试的 fixture 补全真实 Run 顺序与真正切走再打开后，仅重跑失效的历史文件；格式化不改变行为。

| 命令 | 实际范围与结果 |
| --- | --- |
| `rtk pnpm install --frozen-lockfile` | frozen install，退出 0 |
| `rtk proxy pnpm run test apps/desktop/src/renderer/features/conversation/history.browser.test.tsx apps/desktop/src/renderer/features/conversation/process-groups.browser.test.tsx apps/desktop/src/renderer/features/conversation/messages.browser.test.tsx apps/desktop/src/renderer/features/right-panel/agents-tab.browser.test.tsx apps/desktop/src/renderer/features/right-panel/team-tab.browser.test.tsx apps/desktop/src/renderer/features/conversation/timeline.test.ts` | 六文件、60/60，通过，退出 0；随后历史文件最终 fixture 的独立重跑 10/10、退出 0 |
| `rtk proxy pnpm run test tests/integration/sidecar-rewind.test.ts tests/integration/sidecar-compaction.test.ts tests/integration/sidecar-archive-session.test.ts tests/integration/sidecar-worktrees.test.ts packages/agent/src/checkpoints/rewind.test.ts` | 五文件、43/43，通过，退出 0；真实 Sidecar、SQLite、文件、faux、回退三模式、Fork、压缩、归档、worktree 限制和纯边界 |
| `rtk proxy pnpm run test apps/desktop/e2e/rewind.e2e.test.ts apps/desktop/e2e/compaction.e2e.test.ts apps/desktop/e2e/session-archive.e2e.test.ts` | 三文件、6/6，通过，退出 0；真实 Electron/Sidecar、本次源码构建产物 |
| `rtk proxy pnpm run typecheck` | 最终类型检查通过，退出 0 |
| `rtk proxy pnpm exec oxlint apps/desktop/src/renderer/features/conversation/history.browser.test.tsx apps/desktop/src/renderer/features/conversation/conversation-pane.tsx apps/desktop/src/renderer/features/conversation/timeline-view.tsx apps/desktop/e2e/rewind.e2e.test.ts apps/desktop/e2e/compaction.e2e.test.ts apps/desktop/e2e/session-archive.e2e.test.ts packages/agent/src/checkpoints/rewind.ts tests/integration/sidecar-rewind.test.ts` | 八个变更源码/测试，退出 0 |
| `rtk proxy pnpm run check:docs` | 关闭记录与证据保存后执行：274 个 Markdown、0 问题，退出 0 |

没有运行真实模型、发布构建产物 smoke 或 CI。faux 与协议夹具只替换模型或网络边界，之后保持真实 App/store、投影、工具、Sidecar 和持久化。12 的像素锚点、滚动算法和折叠动画不在本票修改或验收声明内。

## 视觉与键盘

[capture.py](capture.py) 保存实际执行步骤；[fixture-main.txt](fixture-main.txt) 与 [fixture-server.txt](fixture-server.txt) 是外部 `/tmp/coko-conversation-detail/ticket-11-visual` 的真实 App 装配。它从本工作树导入产品源码，以既有协议夹具提供 20 个历史调用、两层合法回退、压缩与 removed worktree；未添加产品测试入口或改运行协议。

八张截图覆盖明暗主题 × 1000/390px 主区 × 长历史展开/只读当前内容；[metrics.json](metrics.json) 对四组记录主区 `clientWidth === scrollWidth`、两层历史 open、键盘焦点在 compaction summary、摘要 open、400px 组限高与真实 816px 内容、回退/Fork disabled、无 Retry。捕获时由键盘 Enter 打开两层原生 details 与摘要；工作步骤、组和单条工具通过实际控件打开。手工读回明暗正常/窄图，历史完整、工具原文可检查，嵌套对比度没有重复 opacity 衰减。共享过程与工具的对应参考外观沿用 [03 的锁定基线与证据](../03/report.md)；本票不宣称外壳与参考全页面像素一致。

原生标题栏和真实物理指针未占用前台；本票交互与视觉为静默 Chromium/CDP 渲染帧，另有真实后台 Electron 路径。历史像素阅读位置由 12 单独验证。

## 文档、清理与交付

事实归属为 [工作台历史与只读](../../../../docs/subsystems/workbench.md#历史与只读检查)、[命令](../../../../docs/subsystems/commands.md#界面)和 [Worktree](../../../../docs/subsystems/worktrees.md#界面)，`docs/README.md` 同步工作台摘要。检索旧结论与引用后原页面仍有效，未改路径或 ADR，正式文档没有引用具体任务材料。从 AGENTS → docs/README → 正文读回：生命周期、事实归属、有效引用、摘要同步、无反向依赖和历史保留均通过。

[清理回执](cleanup.json)：命名 browser close 退出 0；Vite 会话实际退出 130，49455 无监听；ps 没有本工作树或 browser 会话残留；Electron/Sidecar 经 harness 的 dispose 等待退出。合并 10 时的唯一 stash 冲突保留双方上下文与历史意图，恢复内容已提交，精确核对后仅删除本票 stash。没有停止用户或其他票的进程。

仅本地分支提交，未 push/PR；待主任务整合与最终总评审。
