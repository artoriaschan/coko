---
kind: evidence
description: "审批、拒绝、无结果及结果确认在三级折叠中的真实 App、Sidecar、Electron 和双主题验证。"
lifecycle: active
---

# 08 审批、拒绝与恢复状态

## 对象与接缝

[规格](../../spec.md) AC-07、13、14、23、24；[实施票](../../issues/08-approval-denial-and-recovery.md)。起点 `38bd45b4b600a0e18a7f7efa896e2f06668fdc78`；本票源码提交 `0481ad2`，合入 07 的 `42ced886e0475ce4741a5e836868f70d0ca7cd6d` 后对象为 `b67cd8225fe9d32fe6dd437fa6cd980292c24311`。后续仅保存本票证据与 tracker 状态。合并保留了 origin、structuredContent、原始 result.content、图片模块与门户锁、条件 scrollbar gutter；没有协议、执行授权、存储或 schema 改动。

采用规格已同意的真实 App + 协议夹具接缝，保留实际 chat/agents stores、时间线投影、三级折叠和卡片；网络边界受控。Sidecar/Electron 使用真实业务、SQLite、工具、权限与进程，只有模型为 faux。未调用真实模型，未推送或创建 PR，未运行发布产物测试或 CI。

环境：macOS arm64；Node 26.10.0、pnpm 12.15.0、Vitest 5.0.3、React 19.3.0；Electron 41.0.3 / Node 24.14.0 / Chromium 146.0.7680.80。新 worktree 冻结安装后 Electron 缺 binary，通过 Node 24.15.0 执行 `node node_modules/electron/install.js` 后实际二进制存在并用于后续真实检查。agent-browser 0.38.2、DPR 1，命名静默会话 `coko-approval-08`。

## 实施与红绿

- 工具状态的共享展示留在 renderer 的 `tool-states.tsx`；等待、审批决定、实际沙箱标记与 Hook 阻断分别显示。普通无结果为“没有已记录的结果”，只有真实 confirmation_request 才标为 Outcome Confirmation。confirmation_answer 是用户所确认的内容，完成/失败仍取实际 toolResult；不补造输出或成功。
- 整轮收起时显示关键状态摘要；整轮打开后由历史组继续显示，避免重复两份整轮/组摘要。普通失败/拒绝不改变正常 completed Run 的整轮折叠资格。展开正文保留完整反馈和已脱敏 Hook 命令；审批/确认卡留在原输入区，不受过程座位开合影响。
- 初始 App 回归在找不到 Outcome unknown 摘要时失败，随后通过。焦点接管回归揭露旧代码在卡片挂载后才更新 autoFocus，而卡片只在挂载时读取该值；改为容器在已提交卡片身份变化后，按输入区/原卡片的焦点归属直接接管与归还。卡片尺寸、结构和业务回调不变；读者在过程等其他区域时不抢焦点。
- 另一条真实 App 红例在已拒绝、结果尚未提交且旧 tool_start 进度仍在时读到 running，修复为 denied/cancelled/expired 的无结果调用保持 pending，不被旧运行进度覆盖。新的结果到达后仍按结果结算。
- App 的 10 条组合覆盖普通无结果与待确认、整轮/组状态、四种主题语言的 390px 长反馈与 Hook 命令、审批键盘一次回答/Inspect 无授权、确认无默认 Enter/Esc 与显式回答/焦点归还、用户已确认但真实结果未到时仍非成功，以及父 Run 已结束且折叠后后台子代理回答仍发往子 Session。原 earliest-child/父级顺序与订阅释放测试同跑。

## 最终检查

原始聚合输出如下，均通过 `rtk proxy` 保存。范围是与本票及合入 07 共享边界有关的最小集合，没有运行全仓测试：

- [renderer-final.log](renderer-final.log)：`pnpm run test` 后依次传入 conversation 目录中的 `permission-states.browser.test.tsx`、`approval-bubbling.browser.test.tsx`、`process-groups.browser.test.tsx`、`tool-cards.browser.test.tsx`、`plan.browser.test.tsx`、`timeline.test.ts`、`tool-card-images.browser.test.tsx` 的完整路径。7 文件 79/79、退出 0，精确命令保留在日志首行。包含本票实际 App 10 条，Plan 接管、原审批顺序和图片门户焦点等共享消费者。
- [electron-final.log](electron-final.log)：`pnpm run test apps/desktop/e2e/approvals.e2e.test.ts apps/desktop/e2e/recovery.e2e.test.ts apps/desktop/e2e/sandbox.e2e.test.ts`，3 文件 5/5、退出 0。实际批准后文件内容为 hi；拒绝后文件不存在；实际 macOS Seatbelt 越界拒绝后只有审批提权才写入；SIGKILL 真实 Sidecar 后等待 supervisor 新 PID/重连，确认未生效后继续，done 文件仍不存在。setup 先等真实工作台，Session 建立后才检查连接；恢复用例补上既有完全访问风险确认对话框的明确点击，没有绕过产品确认。
- [sidecar.log](sidecar.log)：`pnpm run test tests/integration/sidecar-recovery.test.ts tests/integration/sidecar-hooks.test.ts tests/integration/sidecar-subagents-permissions.test.ts`，3 文件 25/25、退出 0。真实 Hook exit2/JSON 拒绝、无外部写入、hostBlock 与 hook_run、Hook 不绕过规则、子 Session 审批路由/根作用域、重启待确认与过期审批 409 等协议和外部事实均保留原断言。
- [初次 Sidecar 失败摘录](initial-sidecar-failure.txt)：原聚合 24/25，仅旧迁移测试把版本写为 9，独立读取迁移注册表确认最后一步为 11 后，按主任务明确指示只改测试字面量、标题和注释。备份 v1、旧条目、Provider/Credential 清理断言未放宽；最终 25 条全通过。这个修复没有改变生产迁移。
- `rtk proxy pnpm run typecheck`：合入 07 后退出 0。`rtk proxy pnpm exec oxlint` 对全部本票 TypeScript 生产与测试改动退出 0；提交 hook 的 oxfmt/oxlint 同样退出 0。`git diff --check` 无问题。文档检查和最终读回结果在票 Comments 记录。

## 视觉、键盘与限制

[capture.py](capture.py) 保存实际操作：通过端口 0 启动的外部 App 夹具监听 61571，依次打开完成收起、键盘展开工具、等待审批、Outcome Confirmation。16 张截图覆盖明/暗 × 1000px 中文和 390px 英文 × 四个状态；Browser Mode 另测四种主题语言组合的窄布局。[metrics.json](metrics.json) 保存 16 组实际计算样式和几何。复现用外部装配源码快照见 [fixture-main.txt](fixture-main.txt)、[fixture-server.txt](fixture-server.txt)，不是产品运行入口。

截图已逐类查看：正常消息列为 680px；390px 主区的原有消息列为 326px，整页 scrollWidth 为 390。状态为共享 `text-ui-small` 12px/18px 与 warning-text，浅色 rgb(180,83,9)、深色 rgb(251,191,36)，窄区自然换成两行；反馈全文换行可读。审批卡正常宽 712px、窄宽 358px，高 202px；确认卡随语言和宽度正常换行，窄区高 306px，全部按钮仍位于 900px 窗口内。没有改顶部栏、侧栏或输入框几何。`document.fonts.check` 对 Noto Sans SC 与 JetBrains Mono 返回 true；标准用户/系统附加字体目录可见 JetBrains Mono 文件，但未见 Noto 文件，未证明实际中文 glyph 使用 Noto，可能使用既有系统 fallback。

[键盘操作](keyboard.py) 与 [结果](keyboard.json) 记录真实 agent-browser/CDP 的输入区焦点 → 审批卡焦点 → 连续两次 Enter 只发一次允许 → 提交决定后归还原草稿焦点。这里的网络为 App 夹具；真实文件执行与协议授权证明来自上述 Electron/Sidecar。参考组件版本固定为 `8bd073392eef6f54e921a093b95076248eb08cbb`，过程及工具几何沿用 [03 的同环境原版参考对照](../03/report.md#双主题视觉和交互)；本票新增的是 Coko 专有协议状态，未虚构参考中的审批/恢复字段或声称参考 Host 的业务等价。

视觉使用命名静默 headless agent-browser 操作真实 App 装配，Electron E2E 也为后台模式；没有抢用户前台。真实指针、原生标题栏和真实模型未验证，不声称像素级整页一致或完成 12 的滚动过渡范围。

## 文档和清理

唯一当前行为更新在 [权限](../../../../docs/subsystems/permissions.md#界面) 与 [恢复](../../../../docs/subsystems/recovery.md#activity-与界面)。原导航摘要仍准确，无需新建正式目录、领域术语或 ADR。读回同时修正权限正文遗留的“侧栏审批徽标/上浮”描述，使其与现有 Electron 断言和恢复正文一致，没有改侧栏代码。检索 `.agents`、`docs` 与本功能活动材料的旧结论、正文链接和标题；配置/工作台中的既有链接继续有效，不改写历史证据。

[cleanup.json](cleanup.json)：命名浏览器 close 返回 0；精准核对本票 node 86738 的命令与 61571 listener 后发 SIGTERM，运行会话实际退出 143，再核对 PID 和 listener 均不存在。Electron 与 Sidecar 测试均经既有 teardown 等待退出，所有最终命令已结束。未停止用户另一工作区的 Electron，也未动用户数据。源码提交和证据均只在本地任务分支，等待主任务集成。
