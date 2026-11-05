# 14: openai-completions 按 pi 目录使用原生写法

**What to build:** openai-completions 的 Provider 打开「加载新工具时保留提示词缓存」后，只有 pi 自带模型目录中标注支持对话中途追加工具的模型使用原生写法：加载工具时发出一条带 `tools` 的 system 消息。匹配用规范化的 Base URL（去掉末尾斜杠、主机名转小写、保留路径）与模型 ID，条目须同时带 `supportsMidConvoSystemMessages` 与 `supportsMidConvoToolAdditions`；pi 1.4.0 中这样的条目有 9 个，都是 Kimi K3。其他模型照常把新工具追加到顶层 tools，请求不报错。开关说明不追加内容。

**规格场景:** [spec](../spec.md) 的 AC-18 中 openai-completions 的部分；对应 TS-23。

**设计依据:** [design.md](../design.md) 第 5 节“各协议的线上写法”；第 6 节“实施时需确认”的第 4 项在本票处理。9 个条目见[程小帮研究](../research/chengxiaobang.md)第三节。

**文档影响:** 承载 Provider 设置的当前文档补充 openai-completions 的判断规则。

**Blocked by:** 12 Provider 开关与 Messages、Responses 的原生写法

**Status:** ready-for-agent

- [ ] 用本地伪造的模型服务记录请求体：Base URL 与模型 ID 命中带两个标识的 pi 条目时，加载以带 `tools` 的 system 消息追加；未命中时追加到顶层 tools，请求不报错；开关关闭时每次请求带完整工具列表。
- [ ] Base URL 的规范化有单测，覆盖末尾斜杠、主机名大小写与路径。
- [ ] 查询 pi 目录用的导出接口记入 Comments；不修改 pi，不按主机名或模型名推断能力。
- [ ] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
