# 14: openai-completions 按 pi 目录使用原生写法

**What to build:** openai-completions 的 Provider 打开「加载新工具时保留提示词缓存」后，只有 pi 自带模型目录中标注支持对话中途追加工具的模型使用原生写法：加载工具时发出一条带 `tools` 的 system 消息。匹配用规范化的 Base URL（去掉末尾斜杠、主机名转小写、保留路径）与模型 ID，条目须同时带 `supportsMidConvoSystemMessages` 与 `supportsMidConvoToolAdditions`；pi 1.4.0 中这样的条目有 9 个，都是 Kimi K3。其他模型照常把新工具追加到顶层 tools，请求不报错。开关说明不追加内容。

**规格场景:** [spec](../spec.md) 的 AC-18 中 openai-completions 的部分；对应 TS-23。

**设计依据:** [design.md](../design.md) 第 5 节“各协议的线上写法”；第 6 节“实施时需确认”的第 4 项在本票处理。9 个条目见[程小帮研究](../research/chengxiaobang.md)第三节。

**文档影响:** 承载 Provider 设置的当前文档补充 openai-completions 的判断规则。

**Blocked by:** 12 Provider 开关与 Messages、Responses 的原生写法

**Status:** ready-for-agent

**Closed:** true

- [x] 用本地伪造的模型服务记录请求体：Base URL 与模型 ID 命中带两个标识的 pi 条目时，加载以带 `tools` 的 system 消息追加；未命中时追加到顶层 tools，请求不报错；开关关闭时每次请求带完整工具列表。
- [x] Base URL 的规范化有单测，覆盖末尾斜杠、主机名大小写与路径。
- [x] 查询 pi 目录用的导出接口记入 Comments；不修改 pi，不按主机名或模型名推断能力。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实施：`withIncrementalTools` 为 Completions 查询安装的 pi-ai 1.4.0 公共 `@earendil-works/pi-ai/providers/all` 导出 `getBuiltinProviders()`、`getBuiltinModels(provider)`；仅 API 为 openai-completions 且同时带两个支持标识的条目进入候选，按规范化 Base URL 与完整模型 ID 匹配。目录实有 9 个条目，生产代码不维护模型名或主机白名单，不修改 pi。URL 规范化保留路径大小写与查询/片段，只统一主机名大小写并去掉路径末尾斜杠。
- TDD：首个已知 URL/ID 的公开工具传输策略测试先红（原实现返回 undefined compat），后绿；最终纯函数/公开 registry 测试覆盖 9 个已标注条目、错误 URL/路径/协议/模型 ID、原模型不被修改、既有 compat 保留与开关关闭，以及 URL 边界。实际 Sidecar 测试使用原始官方 Provider URL 与真实 pi 目录，只有网络边界经独立进程的测试 preload 转向 loopback，未知外部请求被夹具拒绝；不替换匹配器或目录，不增加产品测试开关。
- AC-18：本地 HTTP 服务记录请求，匹配的 Completions Run 首次顶层 tools 仅常驻工具与 tool_search，加载后顶层不加入 echo，而在 system.tools 中追加；关闭开关、同主机错误路径、同地址未标注模型、同名模型其他主机的 4 个场景均在顶层追加 echo、没有 system.tools，并实际完成真实 stdio MCP echo 调用与成功 Run。测试中的名称与输出期望独立维护，不从实现生成。
- 验证：`rtk pnpm run test packages/agent/src/models/incremental-tools.test.ts packages/agent/src/models/models.test.ts tests/integration/sidecar-completions-incremental-tools.test.ts tests/integration/sidecar-incremental-tools.test.ts` 最终 4 文件 54/54，退出码 0；包括新增 19 个纯函数/registry 用例、5 个 Completions Sidecar 场景和现有 14 个 Messages/Responses 场景。`rtk pnpm run typecheck`、定向 oxfmt/oxlint、`rtk pnpm run check:docs`（396 文件、0 问题）与 `rtk git diff --check` 通过。
- 中间一次扩大检查 52 通过、2 超时，已定位为宿主睡眠：`pmset -g log` 的 21:15:51 Sleep 至 21:20:52 DarkWake 与用例吻合，20 秒 ready 定时器在约 300 秒后才触发。未增加 timeout；仅重跑失败的 2 例在 2.29 秒通过（17 个筛选跳过），随后上述完整相关 54 例在 14.01 秒通过，替换受睡眠影响的证据。类型检查发现的目录联合泛型需显式按 API 收窄，已修正后通过。
- 文档归属为现有 [MCP Provider 工具增量传输](../../../docs/subsystems/mcp.md#provider-的工具增量传输)，补充 Completions 的目录匹配与普通列表后备规则；Headless 与 protocol README 已链接该正文，无新文档或导航路径。已按 AGENTS → docs/README → MCP 正文读回，正式文档不依赖任务材料。界面开关说明保持 TS-27 原文。真实 Provider、缓存命中、Electron 原生层、产物与 CI 未验证；仅本地提交，不推送。
- 实现提交 `40f7efe` 后，将集成分支 `2a2ac6c9`（包含 07 全局开关与 08 乐观加载）合入本票分支，无冲突；合并状态再次执行上述 4 文件 54/54、类型检查和文档检查（396 文件、0 问题）均通过，diff 检查干净。
