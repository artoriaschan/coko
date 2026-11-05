# 04: 右栏布局的保存与恢复

**What to build:**

- **保存。** 每个 Session 的 tab 列表与顺序、选中项、展开状态和全屏状态存入 localStorage，每个 Session 一个键。重启或重新加载后，在渲染页面正文之前恢复。
- **读回校验。** JSON 损坏或类型不符时，只清除该 Session 的键，从初始状态开始。未知的页面种类和当前不可用的种类被过滤掉；选中项被过滤掉时，选第一个 tab；列表变空时，回到初始状态。
- **失败。** 写入失败只记录日志，内存中的布局照常使用。
- **不保存的内容。** 页面内部的选择照旧不保存，例如子代理页里选中的子代理。
- **清理。** 永久删除 Session 时，它和子 Session 的键一并清除；归档不清除。

**规格场景:** [spec](../spec.md) 的 AC-14；对应 RP-14。

**设计依据:** [design](../design.md) 的以下部分：“关键路径与接口”中的“恢复”；“状态、持久化与失败”中的布局键、读回规则和删除 Session 时的清理；备选方案中的“布局保存位置”。

**文档影响:** workbench 的右栏保存与恢复。

**Blocked by:** 01 — 右栏改为按 Session 的单格 tab 容器；03 — 宽度、窄窗口与全屏（需要保存全屏状态）

**Status:** ready-for-agent

**Closed:** true

- [x] 重启后回到某个 Session 时，tab 顺序、选中项、展开状态与全屏状态都恢复。恢复在页面正文渲染之前完成，不会先闪现初始状态。（AC-14；实现和原生重启用例已交付，原生执行统一见 12）
- [x] 把一个 Session 的记录改成不合格的内容后重启：只有这个 Session 回到初始状态，它的键被清除，其他 Session 不受影响。记录中含有未知种类时，只过滤掉这个种类，其余照常恢复。（读回与隔离经 Browser Mode；原生重启见 12）
- [x] 窗口窄于 768px 导致的自动全屏不写入全屏状态；只有用户切换全屏时才写入。
- [x] localStorage 写入失败时只记录一次日志，当前布局继续可用。（真实 Chromium 配额失败经 Browser Mode；日志数量的原生用例交 12）
- [x] 永久删除 Session 后，它和子 Session 的键被清除；归档后键保留。
- [x] 读回校验与过滤规则有纯函数单测。真实 Electron E2E 通过重启应用验证恢复，写法参照现有的带重启步骤的 E2E。（用例已交付，执行交 12）
- [x] 按测试约定运行最小相关测试集与类型检查，同步上述文档；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户回复“全部采用推荐”，确认 12 张票及其阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

### 2026-11-05 实施完成

- 独立 worktree `/tmp/coko-right-sidebar-agents/ticket-04`、分支 `codex/right-sidebar-04`，基于集成分支 `33f34989`（01—03 已交付）。本票关闭的是实现、用例与当前文档交付；按集成安排，真实 Electron 执行集中在 12，不把下面未运行的原生场景写成已通过。
- 新增 `layout-persistence.ts`：TypeBox 校验页面列表唯一性、字段类型和选中项成员关系；未知或不可用种类仅过滤，活动项被过滤后选第一项，空列表回到初始收起布局。每个 Session 使用 `coko.right-panel.v1.<sessionId>`，读回损坏只清该键，恢复/过滤不提前重写其他 Session 的记录。
- 布局 store 首次读取同步恢复，用依附 `sessions` 快照的稳定读缓存避免在 React `getSnapshot` 中广播 store 更新。动作把已读缓存采用到新的不可变快照，只持久化本次修改的 Session；`attention`、宽度、自动全屏和页面内部临时选择不保存。`setAvailableRightPanelPages` 给 06 使用：始终保留开始页，过滤已采用的内存布局而不逐个改写存储键，未采用的键仍在读回时过滤，`openPage` 拒绝不可用种类。
- 永久删除使用 API 实际返回的全部 `sessionIds`，包括未加载的子 Session，先清除各版本的布局键再通知订阅者，避免旧键被重新读回；归档不清理。写入失败后仍使用内存布局，当前 renderer 生命周期内只发送一次 `layout persistence failed` warning 到既有 renderer 日志通道。
- TDD 首个真实 App 场景在旧实现中找不到保存的 Plan tab 而失败，恢复实现后通过；页面操作场景先观察到布局键为 null，再由集中保存动作通过；归档/删除场景先观察到删除后旧键仍保留，再由按 API 身份清理通过。额外使用真实 Chromium localStorage 配额耗尽验证失败路径，没有替换存储、store 或布局模型。

### 实际验证与未运行项

- `rtk pnpm install --frozen-lockfile`：退出 0。
- 最终命令 `rtk pnpm run test apps/desktop/src/renderer/features/right-panel/layout-persistence.browser.test.tsx apps/desktop/src/renderer/features/right-panel/layout-persistence.test.ts apps/desktop/src/renderer/stores/chat-store-delete.test.ts apps/desktop/src/renderer/stores/chat-store-archive.test.ts apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/settings/archived.browser.test.tsx`：6 文件、70 项通过、0 跳过，退出 0。覆盖同步恢复、Session 切换、损坏隔离与未知种类、不提前重写键、真实配额耗尽、自动与手动全屏保存边界、空间不足的收起写回、归档保留及后代键删除；纯函数校验为 10 项。
- `rtk pnpm run typecheck`：退出 0，包含新增 Electron E2E 源码。`rtk pnpm exec oxlint apps/desktop/src/renderer/features/right-panel/layout-store.ts apps/desktop/src/renderer/features/right-panel/layout-persistence.ts apps/desktop/src/renderer/features/right-panel/layout-persistence.test.ts apps/desktop/src/renderer/features/right-panel/layout-persistence.browser.test.tsx apps/desktop/src/renderer/stores/chat-store.ts apps/desktop/e2e/right-panel-persistence.e2e.test.ts`：退出 0；同一文件清单的 `rtk pnpm exec oxfmt --check` 退出 0。`rtk git diff --check` 通过。
- `rtk pnpm run check:docs`：检查 342 个 Markdown 文件、0 问题，退出 0。
- 新增 `apps/desktop/e2e/right-panel-persistence.e2e.test.ts` 的两个真实 Sidecar/Electron 用例：三个启动周期验证页面排序、活动项和全屏恢复及另一个 Session 的损坏隔离；真实配额耗尽后两个页面动作仍可用，退出后从真实 `desktop.jsonl` 断言只记录一次失败日志。**本票未执行这两个用例**，交 12 批量运行，不以 Browser Mode 或类型检查代替重启和原生日志证据。
- 未运行 agent-browser、原生指针/红绿灯、真实模型或发布安装包验证；本票不修改原生进程、IPC、协议、依赖或构建配置。现有其他设置测试的基线缺口没有扩大到本票修复。

### 文档影响与读回

| 变化 | 所属正文 | 同步与结果 |
| --- | --- | --- |
| 右栏布局持久化、校验、失败、归档/删除与恢复时机 | `docs/subsystems/workbench.md` | 原位替换“目前仅内存”并补充当前契约及 Browser Mode/E2E 源码入口 |

已搜索 `docs`、`.agents`、`.scratch` 中“右栏.*内存/不保存/localStorage”和“布局.*内存/不保存”的消费者。workbench 的旧结论已更新；宽度偏好、计划草稿及 requestId 的内存说明仍然有效；设计/规格中的基线描述、01 票的历史交付范围保留原意，无新正式目录或具体任务反向引用。已从 AGENTS → docs/README → workbench 读回，路径与引用、语义同步、归属与权威、引用方向、生命周期、当前入口、新会话读入和历史保留均通过。文档检查实际结果见最终检查，原生验证缺口如上。
