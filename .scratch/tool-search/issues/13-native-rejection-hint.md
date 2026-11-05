# 13: 原生请求被拒时的开关提示

**What to build:** 使用原生写法的请求被服务端以 400 或 422 拒绝时，Run 的错误信息后追加提示：“如果该服务不支持，请在 Provider 设置中关闭「加载新工具时保留提示词缓存」后重试。”不自动改用完整工具列表重试，也不自动关闭开关。其他错误（例如 401 与 429）按现有方式处理，不附带提示。

**规格场景:** [spec](../spec.md) 的 AC-20；对应 TS-24、27。

**设计依据:** [design.md](../design.md) 第 6 节“失败”。

**文档影响:** 承载 Provider 设置的当前文档补充该提示的触发条件。

**Blocked by:** 12 Provider 开关与 Messages、Responses 的原生写法

**Status:** ready-for-agent

**Closed:** true

- [x] AC-20：使用原生写法的请求分别被以 400、422、401、429 拒绝；400 与 422 的错误信息附带开关提示，不自动改用完整列表重试；401 与 429 不附带提示，处理方式不变。
- [x] 只有本次 Run 实际使用原生写法时才附带提示；发送完整工具列表的请求被 400 拒绝时不附带。
- [x] 提示文案按 TS-27 的中英文表述提供，界面按当前语言显示。
- [x] 测试由本地伪造的模型服务返回各类错误，经真实 Sidecar 验证错误内容。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实施：在运行时的单次原生请求 fetch 边界记录实际 HTTP 状态（SDK 的拒绝不会到达 pi 的 `onResponse`），仅在最终模型错误、实际 compat 启用原生写法且状态为 400/422 时使用 `incremental_tools_rejected`。不解析错误文字，不改重试、请求序列或 Provider 配置；原有 fetch 与 onResponse 继续透传。常规完整列表与未标注能力的 Completions 不进入这条路径。
- 错误条目/进度保留原有 `{ code, message }` 形状和服务端原文，稳定错误码供显示层使用；界面按当前 locale 从 zh/en 字典追加 TS-27 原文提示，Headless 文本输出追加英文提示，结构化输出保留原因与原文，不把会话固定为某种语言。
- TDD：真实 Sidecar + 本地 Messages HTTP400 请求已带 defer_loading，但原实现只给 model_error，新增回归先红后绿。Browser Mode 同一份持久错误在 en/zh 下原先缺提示，先红后绿。Sidecar 矩阵覆盖两协议 400/422/401/429，400/422 不额外重试（1 次），401 保持 1 次、429 保持既有 4 次；关闭增量及开着选项但未标注的 Completions400 均无提示原因。请求内容与真实 HTTP 次数作为外部事实，不伪造内部策略。
- 当前最终验证：`rtk pnpm run test tests/integration/sidecar-incremental-rejection.test.ts tests/integration/sidecar-incremental-tools.test.ts tests/integration/sidecar-completions-incremental-tools.test.ts packages/agent/src/engine/runtime.test.ts apps/server/src/headless/output.test.ts packages/protocol/src/readme.test.ts apps/desktop/src/renderer/features/conversation/incremental-rejection.browser.test.tsx apps/desktop/src/renderer/features/conversation/timeline.test.ts apps/desktop/src/renderer/stores/chat-store.test.ts`：9 文件 99/99，通过；`rtk pnpm run typecheck` 退出 0。新增 Sidecar 4 个用例内含状态矩阵；Browser 2 例、公共 Headless 输出 2 例。新增 Headless 拒绝提示没有另外通过真实 Headless 进程验证，既有真实 Headless 原生配置用例包含在上述集合。
- 定向 oxfmt/oxlint、`rtk pnpm run check:docs`（396 个 Markdown、0 问题）、`rtk git diff --check` 通过。文档影响：MCP 的 Provider 传输说明记录提示条件，Headless 记录文本/结构化差异，agent 与 protocol README/错误码说明同步；从 AGENTS → docs/README → 正文读回，正式文档无任务材料反向依赖。既有 context-seam 两条顺序基线失败见 01，本票未改动该文件。
- 真实 Provider/缓存、Electron 原生层、产物与 CI 未验证；本票只在本地分支提交，未推送。合并最新集成后的结果另记。

- 将最新集成分支 275edee6（含 09/10）合入本票分支后：`rtk pnpm run test tests/integration/sidecar-incremental-rejection.test.ts tests/integration/sidecar-tool-search-lifecycle.test.ts tests/integration/sidecar-tool-search-boundaries.test.ts packages/agent/src/agents/fork.test.ts`：4 文件 32/32，通过；`rtk pnpm run typecheck` 退出 0，`rtk pnpm run check:docs` 为 396 文件 0 问题。合并无冲突，MCP 文档同时保留恢复/分叉说明与错误提示条件。
