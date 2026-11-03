---
kind: evidence
description: "详细模式、真实 Run 分组、三级折叠、状态计时与焦点的实际应用验收记录。"
lifecycle: active
---

# 03 详细过程与三级折叠

## 对象与范围

[规格](../../spec.md) AC-02—08、22—25；[实施票](../../issues/03-detailed-process-groups-and-folding.md) 与 [显示契约](../../design.md)。起点为 3f853817f6b0286c0d53329afac3e0c54450db63，实施提交 9ce7f99；先合入 04/05 的 7610b5d（合并提交 65420e8），再合入 06 的 694b27ed8fe56817fe821865676d742dc3f0da4e（27ac49f）。最终源码对象为 3ad5caa（阅读位置、每组焦点/门户锁和对应 21 条 App 回归）；其后仅保存验收日志和清理回执。无协议、数据库或权限语义变化。

环境：macOS arm64；Node 26.10.0、pnpm 12.15.0、Vitest 5.0.3、React 19.3.0、Electron 41.0.3 / Node 24.14.0 / Chromium 146.0.7680.80。agent-browser 0.38.2，命名静默会话 `coko-process-03`、`coko-process-reference-03`，DPR 1。Browser Mode 使用现有协议夹具替代外部模型与后端网络，之后保持真实 App、store、投影和组件；Electron 使用真实 Sidecar、SQLite、工具与 faux 模型，无真实模型调用或 CI 结论。

## 实施与红绿证据

- 扁平 `buildTimeline` 继续供审批 `items.find` 等业务消费者使用；来源仅取真实 entry.runId/seq/createdAt 或 live.runId。独立 DisplayRun 读取实际起止、当前运行和授权/确认限制；未知归属独立，未知未结束保留平铺，不猜时长。
- 非空思考/工具同 Run 邻接成组，回复、输入、业务行、不同/未知 Run 截断。完整列表先协调消息身份，再按重叠成员协调组；运行与结算不替换组容器。04 的 structuredContent 提交/实时补充与 05/06 正文实现均在合并时保留。
- 正常完成、有过程且没有中途可见输入才允许整轮默认收起；开场连续输入不阻止，最终答案不是条件，所有回复/输入/状态/业务行保持独立。失败/停止/暂停/中断/审批/结果待确认不伪装正常完成。
- 显式整轮收起通过局部 epoch 重置组、思考和工具详情；共享 ToolCard 新增可选 controlled disclosure，非受控消费者保留原行为。自动完成先判断焦点，手动折叠先还焦点至控制按钮。`useProcessFocusLock(active)` 提供门户交互归属接口，过程外默认为 no-op；图片消费接入与其专门完成/Escape 回归由图片票负责，本记录不冒充已经执行的图片验收。
- 首条 App TDD 测试在无过程容器时失败（0 vs 1），加入稳定投影后通过；整轮入口在未实现前失败，加入后通过。焦点保留后的手动组收起曾无法关闭（true vs false），修复为只在运行→历史转换应用一次后通过。恢复 cap 曾把内部 scrollTop 从 0 跳到 156，增加真实 App 回归并修复后保持 0。两个过程组中只有一组有焦点时，另一组也展开（true/true）的缺陷通过实际 App 红例复现；焦点与门户锁改为同时记录 Run 及所属组，修复后为 false/true。
- 原消费汇总 [初始日志](consumers-initial.log) 为 30 文件 203 用例：202 通过，1 个旧 Job 正文查找失败；明确展开工具后修正。合入 04/05 后 [日志](consumers-after-04-05.log) 为 32 文件 217 用例：211 通过，6 个终端用例直接点击隐藏组内工具失败；统一经局部组展开 helper 进入正文，单文件 8/8 通过。没有放宽正文、状态或几何断言。

## 最终检查

最终精确范围如下；原始日志随本记录保存：

- `rtk proxy pnpm run test --project desktop-renderer apps/desktop/src/renderer/features/conversation apps/desktop/src/renderer/features/right-panel`：33 文件、228/228 通过、退出 0，包含本票真实 App 21 条；消息、工具、业务行、审批/恢复及右栏消费者见 [最终日志](consumers-final.log)。
- `rtk pnpm run test apps/desktop/src/renderer/features/conversation/timeline.test.ts apps/desktop/src/renderer/features/conversation/process-groups.test.ts packages/ui/src/tool-card/tool-card.browser.test.tsx`：14 条时间线、2 条投影、2 条共享壳检查，共 18 条通过，退出 0。
- `rtk proxy pnpm run test --project desktop-e2e apps/desktop/e2e/chat.e2e.test.ts apps/desktop/e2e/approvals.e2e.test.ts`：真实 Electron/Sidecar 2 文件 9/9 通过、退出 0（[最终 Electron 日志](electron-final-tree.log)），对话、审批、停止、重试、重启历史与几何。初始新工作树缺 Electron binary，安装器返回 0 但未产生执行文件，随后从已验证同版本 04 依赖缓存复制 41.0.3 binary 后运行。空 New chat 不提供 ConnectionStatus，本地 setup 先等真实工作台，发送后仍验证实际连接；未改全局 waitConnected。原几何测试读到空页隐藏 h1，改为建立真实 Session，并分别核对 原有控制条右边界 216、8px 后的可见标题 224、首键 84 和安全区 72；没有修改产品布局。
- `rtk pnpm run typecheck`、`rtk pnpm run check:docs`：类型检查退出 0；文档检查 270 个 Markdown、0 问题、退出 0；没有工作流目录，未声称 CI 通过。

## 双主题视觉和交互

Coko 外部真实 App 夹具保留于 `/tmp/coko-conversation-detail/ticket-03-visual/`，来源为当前工作树；参考为锁定仓库 8bd073392eef6f54e921a093b95076248eb08cbb 的未修改原版 ChatGroupSeat、ChatNodeSeat、ReasoningRow、ToolRow 与原版主题。参考夹具仅在外部提供 hook/data/slot 装配与等价正文，未启动原 Host，不证明其完整 Run 投影或执行业务。

[capture.py](capture.py) 是实际执行命令记录；运行时服务分别打印原子分配端口。28 张最终图包括 Coko 明暗×1000/390 窗口×运行/完成收起/整轮打开组收起/组展开共 16 张，以及参考同环境运行/历史组收起/展开共 12 张。1000 窗口用 zh、390 用 en；App 测试额外覆盖四种主题/语言组合。主区 390 时列为 326（两侧原有 32px 留白），正常列为 680，参考夹具用相同列宽。

[metrics.json](metrics.json) 保存 16 组实际计算值：两端组头均 14px/24px，系统字体首选序列一致；明主题文字 rgb(129,133,140)，暗主题 rgb(173,178,184)；运行 header 几何高 0、cap none、overflow visible；历史展开 header 高 32（24+8）、cap 400、overflow auto。参考 computed font 含重复 fallback 序列，实际首选字体相同，不宣称序列字符串逐字一致。

实际看图核对了正常/窄窗口的运行平铺、完成收起与组展开，组图标使用锁定资产。截图中的外壳、页脚、独立业务内容和参考夹具摆放不同，不将其称为全页面像素一致；本票比较对象是过程组件与原有 Coko 轴线。[键盘与 reduced-motion 记录](keyboard-and-reduced-motion.json)证明 Enter 打开思考、整轮收起重置内部并保留控制项焦点，再次打开时组仍收起；reduced-motion 的 header/control 计算 transitionDuration 均为全局抑制值 1e-05s。原生标题栏/真实鼠标未占用前台，CDP 键盘与 hover 属于渲染帧验证。

## 文档与交付限制

当前行为唯一归 [工作台](../../../../docs/subsystems/workbench.md#详细过程与三级折叠)，总导航摘要已同步。检索含隐藏目录的旧标题/路径/关键结论后，现有任务依赖仍引用有效票；未新建长期 ADR、正式目录或反向任务依赖。从 AGENTS → docs/README → 正文读回，生命周期、归属、摘要、路径、历史保留均一致；已有消费者页面仍准确而保持原链接。

完整长内容/历史锚点与高度运动由后续阅读票承担；此票已覆盖短内容跟随、焦点与 cap 恢复，不声称完成全部长历史验收。图片门户消费回归仍归图片票。未运行真实模型、发布产物 E2E 或 hosted CI；仅本地分支提交，未 push/PR。


清理回执：[cleanup.json](cleanup.json)。两条命名浏览器会话 close 返回 Browser closed、退出 0；App/参考 Vite 会话均实际退出 130。原监听 PID 62393/69838 与端口 49653/49766 在退出后检查均不存在。没有停止任何已有用户应用；原参考仓库 tracked 文件保持未修改（仅既有 codebase-guide/ 未跟踪）。Electron E2E 的应用与 Sidecar 由现有 harness dispose 等待实际退出，临时目录按测试 teardown 清理。

最终文档读回：AGENTS → docs/README → workbench 新章节均可达；活动引用、语义、归属、引用方向、生命周期、当前入口、新会话可读性和历史保留逐项通过。没有移除历史或尚未完成的任务材料。保存状态为本地 codex/conversation-detail-03 的提交，待主任务整合；未推送。
