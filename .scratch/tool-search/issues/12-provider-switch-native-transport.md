# 12: Provider 开关与 Messages、Responses 的原生写法

**What to build:** Provider 表单的协议选择下方新增「工具搜索」分组，选项为「加载新工具时保留提示词缓存」：anthropic-messages 与 openai-responses 默认开启，升级前已保存的 Provider 也开启；openai-completions 默认关闭，本票只保存它的值，原生写法由 14 号票完成。在开关打开、「按需加载 MCP 工具」已打开、目录里有按需工具、且不是子代理的 Run 中，加载工具时只在加载处追加定义：Messages 用 `tool_addition`，Responses 用 `additional_tools`；其余 Run 照常发送完整工具列表。开关从下一个 Run 生效，重试与继续也算新 Run；进行中的 Run 沿用开始时的设置，已加载的工具不丢。

**规格场景:** [spec](../spec.md) 的 AC-17、AC-19、AC-21，AC-18 中 Messages 与 Responses 的部分，以及 AC-23 中 Provider 表单的部分；对应 TS-21、22、25、27。

**设计依据:** [design.md](../design.md) 第 5 节“各协议的线上写法”；第 6 节“实施时需确认”的第 1、5 项在本票处理；[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)。

**文档影响:** 承载 Provider 设置的当前文档（实施时核实所在页）补充该字段与默认值规则；协议包 README 补充 Provider 字段。

**Blocked by:** 03 按需加载最小闭环：目录、按确切名称加载与加载记录

**Status:** ready-for-agent

**Closed:** true

- [x] Provider 新增可选的 `incrementalTools`：缺省时按协议取默认值，经现有的一次性保存写入；Headless Run 的 Provider 配置同样接受。
- [x] AC-17：新建三种协议的 Provider，另有一个升级前保存的 Messages Provider，表单在协议选择下方显示「工具搜索」分组；前两种协议与升级前保存的 Provider 显示开启，openai-completions 显示关闭；未设置过时按所选协议显示默认值。文案按 TS-27 经 zh/en 字典提供，有 Browser Mode 测试。
- [x] AC-18 的 Messages 与 Responses 部分，用本地伪造的模型服务记录请求体：关闭时每次请求带完整工具列表；Messages 打开时请求级 tools 为初始工具加 `defer_loading` 占位符，加载以 `tool_addition` 发出，并带 `inline-tools-2026-09-15` beta；Responses 打开时工具在 `additional_tools` 中声明。
- [x] AC-19：Provider 开关打开时，在「按需加载 MCP 工具」关闭、目录为空、子代理的 Run 中，都发送完整工具列表。
- [x] AC-21：一个 Run 等待审批时关闭 Provider 开关，该 Run 沿用原写法；下一个 Run 与 retry 发送完整工具列表；已加载的工具仍在请求中。
- [x] compat 在每个 Run 取得目录之后、`setModel` 之前计算；不修改 pi，不按模型名推断能力。
- [x] 核实自动压缩丢弃切点之前的工具差异后，那一次请求声明的工具是否少于执行集合：需要时在压缩后补一次声明，或用测试证明不需要。比较 Anthropic 原生模式重启后第一次请求的缓存失效，以及构造时是否只放常驻工具。结论与依据记入 Comments。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；Provider 字段是共享接口，验证范围扩大到受影响的模块。实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实施：`incrementalTools` 贯穿协议、Provider 草稿/一次保存、模型配置与 Headless 配置导入及失败补偿。SQLite 前向迁移 13 使用可空布尔列，旧 Provider 保持缺省，内存存储沿原字段保存路径读写。表单文案按 TS-27，缺省跟随所选协议，手动选择后保持该值。
- 原生传输按 Run 的目录、根/子会话与 Provider 值确定；Messages/Responses 通过 pi compat 接入，不改 pi。真实 Sidecar + loopback HTTP/SSE 测试观察首次/加载请求、关闭开关、全局关闭、空目录、子代理、审批期间改值、下一 Run 与 retry。另经真实 Headless 进程及 Provider 启动文件验证同一传输路径。
- 自动压缩已复现：pi 在 prepareRequest 之前提交工具声明，切点丢弃它后，同一次模型 HTTP 请求缺少已加载 schema（两协议均红）。修复以 pi 的 `getCurrentTools` / `createInitialSystemMessage` 把丢弃前缀的状态折入未持久化的开头基线，保留区间的差异仍按原位置回放；两协议均绿。不增加第二条持久化声明，不修改 pi。
- Anthropic 重启比较已复现：构造时把已加载工具纳入开头 tools 会改变请求级前缀。改为只以常驻工具构造初始基线，已加载名单在发请求前恢复执行集合，定义仍在历史 tool_addition 中回放；重启前后请求级 tools 相同的 HTTP 回归通过。这里证明请求前缀稳定，不证明真实服务的 cacheRead。
- 验证：`pnpm run test tests/integration/sidecar-incremental-tools.test.ts` 首轮 4/4、扩展生命周期 13/13；最终扩展与合并后的结果见下一条记录。`pnpm run test apps/desktop/src/renderer/features/settings/models-section.browser.test.tsx` 15/15；Provider/草稿/迁移补充 4 文件 20/20。`pnpm run typecheck` 与 `pnpm run check:docs`（396 Markdown，0 问题）通过。
- 共享回归首轮 17 文件 139 例中 132 通过、7 失败。独立临时 worktree 在本票基线 dddf4dd2 执行 `pnpm run test packages/session/src/sqlite/migrate-v4.test.ts packages/session/src/sqlite/migrate-v5.test.ts tests/integration/sidecar-settings-credentials.test.ts`，同样 7 通过/7 失败，确认是既有旧断言：Session 精确对象缺少现有 Project/目录/归档字段、Model 列表缺 input、凭据扫描不递归目录，以及空 argv 如今有默认目录而不会 fatal。保持完整精确断言补全现有字段，扫描改递归，缺参场景改为路径选项缺值；迁移列清单加入本票列。修正后上述文件加 Provider 单测 4 文件 28/28，通过；原断言均未放宽。临时基线 worktree 已移除。
- Browser helper 原先等待全部动画，会等 fixture 对话的无限 spinner 到超时才在卸载时恢复；改为只等待有限动画，不增加 timeout。键盘测试新增开关的 Tab 停靠断言，现有创建行为继续完整验证。
- 文档归属：MCP 当前说明维护 Provider 工具传输与重建行为；Headless 当前说明与 protocol README 引用该正文；上下文说明补充压缩工具基线，导航同步。正式文档不依赖任务材料。真实 Provider 缓存、Electron 原生层、产物与 CI 未验证。

- 合并集成分支 0fc671ba 后最终验证：`pnpm run test tests/integration/sidecar-incremental-tools.test.ts tests/integration/sidecar-tool-search.test.ts tests/integration/sidecar-compaction.test.ts packages/agent/src/engine/compaction.test.ts apps/server/src/application/providers.test.ts packages/session/src/sqlite/migrate-v4.test.ts packages/session/src/sqlite/migrate-v5.test.ts packages/session/src/sqlite/migrate-v12.test.ts packages/session/src/sqlite/migrate-v13.test.ts tests/integration/sidecar-settings-credentials.test.ts`：10 文件 72/72，通过（其中原生传输 14 例）。`pnpm run test apps/desktop/src/renderer/features/settings/models-section.browser.test.tsx apps/desktop/src/renderer/features/settings/provider-draft.test.ts apps/desktop/src/renderer/stores/settings-store.test.ts`：3 文件 27/27，通过。类型检查退出 0，文档检查 396 文件 0 问题；staged TypeScript 经 oxfmt / oxlint 通过。从 AGENTS → docs/README → MCP/上下文/Headless/包 README 读回，导航包含工具搜索及 Provider 传输，正式正文无任务材料反向引用。集成合并只出现导航冲突，保留两方入口；05 的 contextWindow 与 11 的默认开启均保留。
