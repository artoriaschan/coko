---
kind: evidence
description: "记忆归属、写入与注入的联合验收：跨票联合场景、AC-01—AC-29 的证据映射、与改动前基线的失败测试对比、静默 CDP 桌面检查与未验证范围。"
lifecycle: active
---

# 记忆归属、写入与注入联合验收

## 验证对象

- 规格与场景：[规格](../spec.md) 的 AC-01 至 AC-29、用户故事 1 至 30。
- 实施票与相关决定：[09 号票](../issues/09-integrated-acceptance-and-docs.md)，01—08 号票的逐票检查见各票 Comments；[ADR 0027](../../../docs/adr/0027-memory-follows-project-writes-without-approval.md)。
- 基线与目标：基线为 main 上本工作开始前的 `9fe61757`；目标为集成分支 `feat/memory-scope-and-writes` 的 `0e576705` 加本票改动（联合场景测试与文档），本票提交标识以 Git 记录为准。全部为本地提交，未合入 main、未推送、未发布。
- 环境：macOS arm64（Darwin 25.4.0）；Node 24.15.0；pnpm 12.15.0；Electron 41.0.3。测试只替换模型服务（faux 脚本），Sidecar、SQLite、HTTP / WebSocket 与 Electron 均为真实实现。

## 执行记录

| 命令或步骤 | 覆盖场景 | 实际范围与数量 | 结果 | 日志或产物 |
| --- | --- | --- | --- | --- |
| `npx vitest run tests/integration/sidecar-memory-projects.test.ts -t 联合场景` | 跨票联合场景（见下） | 1 例 | 通过；把 `decide.ts` 中 memory-write 的模式放行临时去掉后该例在 `approval_request` 处超时失败，已恢复 | 本地终端 |
| 集成 A（命令见下） | AC-01—AC-20、AC-25 与回归 | 14 文件 59 例 | 通过 | 本地终端 |
| 单元 B（命令见下） | AC-12—AC-16、AC-18、AC-20—AC-24 | 10 文件 238 例 | 通过 | 本地终端 |
| `npx vitest run apps/desktop/src/renderer/features/settings/memory-section.browser.test.tsx apps/desktop/src/renderer/stores/memory-store.test.ts` | AC-26、AC-27 | 2 文件 8 例 | 通过 | 本地终端 |
| `COKO_E2E_BACKGROUND=1 npx vitest run --project desktop-e2e apps/desktop/e2e/memory.e2e.test.ts` | AC-26、AC-28 | 1 文件 2 例 | 首次在打包阶段 `fetch failed`（网络），重跑通过 | 本地终端 |
| `pnpm run eval` | AC-29 | 2 文件，31 通过、10 跳过 | faux 通过；真实模式 `skipped: no-credentials` | 本地终端 |
| 静默 CDP 手动检查（见下） | AC-26、AC-27、AC-28 | 6 张截图 | 符合预期 | 未入库 |
| `pnpm run typecheck`、`pnpm run check:docs`、改动文件的 `oxfmt` / `oxlint` | 类型、文档链接 | 全仓 | 通过 | 本地终端 |
| 基线对比（见下） | 前置票报告的既有失败 | server + agent 全量；11 个集成文件；6 个设置 Browser Mode 文件 | 基线与目标的失败集合逐条相同，没有回归 | 本地终端 |

集成 A：

```sh
npx vitest run tests/integration/sidecar-memory.test.ts tests/integration/sidecar-memory-projects.test.ts tests/integration/sidecar-memory-search.test.ts tests/integration/secrets-gate-memory.test.ts tests/integration/secrets-gate-memory-search.test.ts tests/integration/sidecar-subagents-permissions.test.ts tests/integration/sidecar-worktrees.test.ts tests/integration/sidecar-teams.test.ts tests/integration/headless.test.ts tests/integration/headless-approvals.test.ts tests/integration/sidecar-delete-project.test.ts tests/integration/sidecar-context-seam.test.ts tests/integration/sidecar-plan.test.ts
```

单元 B：

```sh
npx vitest run packages/agent/src/context/memory packages/agent/src/policy/decide.test.ts apps/server/src/application/context packages/session/src/memory packages/session/src/sqlite/sqlite.test.ts
```

### 跨票联合场景

[`sidecar-memory-projects.test.ts`](../../../tests/integration/sidecar-memory-projects.test.ts) 的“联合场景”一例在同一个数据目录上依次断言：default 模式、没有 `Memory` 规则时模型写入项目记忆，没有审批请求，条目 `source: model` 落在项目主要 Workspace → 同项目另一对话的下一个请求的 Memory 段含该条 → 独立对话（首次发送创建）看不到，移入项目后下一个请求可见 → 用户经 `PUT /api/memories/:id` 修改正文后来源为 user → Sidecar 重启后模型按 id 替换得到 `maintained by the user` 工具错误，条目不变 → 删除项目后原对话的 Memory 段只剩用户级，条目仍在库中 → 用同一文件夹重建项目，新对话看到用户编辑后的条目。faux 脚本在启动时读取，替换需要服务端生成的 id，因此第二段脚本在重启时写入。

### AC 对照

| AC | 证据 |
| --- | --- |
| AC-01、02、03、04、05、06、07、08、11 | `sidecar-memory-projects.test.ts` 第一例（各段注释标明 AC） |
| AC-09 | `sidecar-subagents-permissions.test.ts`（根移到另一项目后子 Session 的段与工具集合） |
| AC-10 | `sidecar-worktrees.test.ts` |
| AC-12、13 | `sidecar-memory.test.ts` 首例（default、read-only 写入与 plan 删除无审批）、联合场景（default）；五种模式的放行在 `decide.test.ts` |
| AC-14 | `sidecar-memory.test.ts`（全局询问规则出审批卡、全局与项目拒绝规则、PreToolUse Hook）、`decide.test.ts` |
| AC-15、16、20 | `sidecar-memory.test.ts` 用户来源、用户编辑与伪造标注的对手用例；联合场景 |
| AC-17 | `headless.test.ts` |
| AC-18、19 | `sidecar-memory.test.ts` 首例（空库的声明与引导、`memory.enabled: false`） |
| AC-21—24 | `packages/agent/src/context/memory/memory.test.ts`；请求中的实际排列在 `sidecar-memory.test.ts` |
| AC-25 | `sidecar-memory.test.ts` 的 `/api/memories` 用例 |
| AC-26、27 | `memory-section.browser.test.tsx`、`memory.e2e.test.ts`、静默 CDP 检查 |
| AC-28 | `memory.e2e.test.ts`、静默 CDP 检查 |
| AC-29 | `pnpm run eval` 的 `remembers-preference`（faux）；真实模式未运行 |

### 静默 CDP 检查

按 AGENTS.md 的 UI 调试约定，以 `COKO_E2E_BACKGROUND=1 pnpm --filter @coko/desktop exec electron-forge start -- --remote-debugging-port=9339` 启动（独立的 `COKO_USER_DATA_DIR`、`COKO_HOME`、`COKO_CHATS_ROOT` 与 faux 脚本，不读写真实数据），`agent-browser connect 9339` 后经 snapshot / eval / click / screenshot 操作；项目经渲染进程同源的 `POST /api/workspaces` 创建（原生目录选择器在后台模式不可用）。

- 项目对话、“Ask for approval”（default）模式发送后：没有审批卡，`memory_write` 工具卡 `done`、标题 Remembered，展开详情显示 Operation created、Scope workspace 与正文。
- 项目对话的设置 Memory 分区：两组 “User” 与 “Project: project”，项目组列出模型写入的条目（Saved by agent），每组一个添加入口；亮色与暗色主题下截图，暗色下分组标题颜色 rgb(249, 250, 251)、页面背景 rgb(21, 21, 23)。
- 独立对话（首次发送创建）的设置 Memory 分区：只有 “User” 一组、只有一个添加入口；亮色与暗色均检查。
- 结束时关闭 agent-browser 会话与应用进程，调试端口已关闭。

未验证：真实指针（后台模式窗口不接收鼠标，点击经 CDP 派发）与原生层（红绿灯、原生目录选择器）。

### 基线对比

在 `9fe61757` 的独立 worktree 与目标上分别运行同一批命令，用 JSON reporter 比较失败用例的完整名称：

| 批次 | 基线失败 | 目标失败 | 差异 |
| --- | --- | --- | --- |
| `npx vitest run --project server --project agent` | 6：`host-stop` ×2、`approvals`、`gate-hooks`、`session-entries`、`instructions/shared` 默认配置 | 同 6 例 | 无 |
| `sdk-library`、`sidecar-approvals`、`sidecar-recovery`、`sidecar-storage`、`sidecar-storage-paths`、`sidecar-hooks-lifecycle`、`sidecar-lsp`、`sidecar-lsp-process`、`sidecar-attachments`、`sidecar-teams-restart`、`sidecar-delete-project` | 10：`sdk-library`、`sidecar-approvals` ×2、`sidecar-attachments`、`sidecar-hooks-lifecycle`、`sidecar-lsp` ×2、`sidecar-recovery`、`sidecar-storage`、`sidecar-teams-restart` | 同 10 例 | 无；`sidecar-delete-project` 两边都通过 |
| 设置目录 6 个 Browser Mode 文件（sections、plugins-section、delete-provider、thinking-levels、model-catalog、fetch-models） | 24 | 同 24 例 | 无 |

结论：前置票报告的这些失败在改动前的 main 上已存在，与记忆无关，本票不处理。

## 文档影响

| 行为或正文变化 | 所属文档 | 受影响引用、摘要与入口 | 已完成动作 | 检查结果与缺口 |
| --- | --- | --- | --- | --- |
| 联合场景测试 | [Memory](../../../docs/subsystems/memory.md) | 验证段 | 修改；description 补上项目归属、不经审批与两级预算 | 已读回 |
| Memory 摘要 | [文档导航](../../../docs/README.md) | Memory 一行 | 修改 | 已读回 |
| 删除项目用例的措辞 | [项目与会话列表](../../../docs/subsystems/projects.md) | 测试清单 | “Workspace 记忆”改为主要 Workspace 上的项目记忆 | 已读回 |
| ADR 落地 | [ADR 0027](../../../docs/adr/0027-memory-follows-project-writes-without-approval.md)、[ADR 索引](../../../docs/adr/README.md) | implementation、决定段语气、实现与验证链接、来源与后继 | not-started → implemented，写明未满足的验证条件 | 已读回 |
| 规格状态 | [规格](../spec.md) | frontmatter 与实施状态、实施票段 | approved → delivered | 已读回 |
| 权限、Plan Mode、无界面运行、子代理、上下文、追踪 | `docs/subsystems/` 各页 | 01—08 号票已改 | 核对一致，无需再改 | 没有“memory-write 在 default 与 read-only 询问”“另一个 Workspace 只有用户级”等旧说法；“自动提取记忆尚未实现”仍属实 |

按[生命周期流程](../../../docs/DOCUMENT_LIFECYCLE.md)从 AGENTS.md → docs/README.md → Memory 与 ADR 索引 → ADR 0027 读回；正式文档不链接 `.scratch/`，`pnpm run check:docs` 通过。

## 结论与限制

- 已满足：AC-01 至 AC-28 有自动化测试证据，AC-26 至 AC-28 另有静默 CDP 检查；AC-29 的 faux 模式通过；跨票联合场景有真实 Sidecar 用例。
- 未验证：AC-29 的真实模式（本机没有 `COKO_EVAL_PROVIDER_CONFIG` 与凭据，记为 `skipped: no-credentials`），即写入引导对真实模型的效果；需要真实指针或原生层的桌面交互；全量 `pnpm run test` 未运行，只运行了上列批次。
- 失效条件：Memory 段文本、权限判定、项目归属解析或设置分区的改动需要重跑对应批次。
- 状态：本地提交，集成分支未合入 main，未推送、未发布；CI 未运行。
