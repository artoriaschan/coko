# 12: Provider 开关与 Messages、Responses 的原生写法

**What to build:** Provider 表单的协议选择下方新增「工具搜索」分组，选项为「加载新工具时保留提示词缓存」：anthropic-messages 与 openai-responses 默认开启，升级前已保存的 Provider 也开启；openai-completions 默认关闭，本票只保存它的值，原生写法由 14 号票完成。在开关打开、「按需加载 MCP 工具」已打开、目录里有按需工具、且不是子代理的 Run 中，加载工具时只在加载处追加定义：Messages 用 `tool_addition`，Responses 用 `additional_tools`；其余 Run 照常发送完整工具列表。开关从下一个 Run 生效，重试与继续也算新 Run；进行中的 Run 沿用开始时的设置，已加载的工具不丢。

**规格场景:** [spec](../spec.md) 的 AC-17、AC-19、AC-21，AC-18 中 Messages 与 Responses 的部分，以及 AC-23 中 Provider 表单的部分；对应 TS-21、22、25、27。

**设计依据:** [design.md](../design.md) 第 5 节“各协议的线上写法”；第 6 节“实施时需确认”的第 1、5 项在本票处理；[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)。

**文档影响:** 承载 Provider 设置的当前文档（实施时核实所在页）补充该字段与默认值规则；协议包 README 补充 Provider 字段。

**Blocked by:** 03 按需加载最小闭环：目录、按确切名称加载与加载记录

**Status:** ready-for-agent

- [ ] Provider 新增可选的 `incrementalTools`：缺省时按协议取默认值，经现有的一次性保存写入；Headless Run 的 Provider 配置同样接受。
- [ ] AC-17：新建三种协议的 Provider，另有一个升级前保存的 Messages Provider，表单在协议选择下方显示「工具搜索」分组；前两种协议与升级前保存的 Provider 显示开启，openai-completions 显示关闭；未设置过时按所选协议显示默认值。文案按 TS-27 经 zh/en 字典提供，有 Browser Mode 测试。
- [ ] AC-18 的 Messages 与 Responses 部分，用本地伪造的模型服务记录请求体：关闭时每次请求带完整工具列表；Messages 打开时请求级 tools 为初始工具加 `defer_loading` 占位符，加载以 `tool_addition` 发出，并带 `inline-tools-2026-09-15` beta；Responses 打开时工具在 `additional_tools` 中声明。
- [ ] AC-19：Provider 开关打开时，在「按需加载 MCP 工具」关闭、目录为空、子代理的 Run 中，都发送完整工具列表。
- [ ] AC-21：一个 Run 等待审批时关闭 Provider 开关，该 Run 沿用原写法；下一个 Run 与 retry 发送完整工具列表；已加载的工具仍在请求中。
- [ ] compat 在每个 Run 取得目录之后、`setModel` 之前计算；不修改 pi，不按模型名推断能力。
- [ ] 核实自动压缩丢弃切点之前的工具差异后，那一次请求声明的工具是否少于执行集合：需要时在压缩后补一次声明，或用测试证明不需要。比较 Anthropic 原生模式重启后第一次请求的缓存失效，以及构造时是否只放常驻工具。结论与依据记入 Comments。
- [ ] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；Provider 字段是共享接口，验证范围扩大到受影响的模块。实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
