# 01: 数据模型改为自定义 Provider

**What to build:** Provider 不再有 kind 与品牌预设：协议是 Provider 自身字段，ID 由用户输入并作为主键；Model Catalog 中每个模型可保存显示名称、上下文窗口、最大输出、输入类型、推理开关与各 Thinking Level 的参数值，并据此注册到模型 registry。库迁移清除旧数据。现有设置界面做最小调整（ID 输入、协议下拉、去掉预设选择）以保持可用，后续票再按规格重做界面。这是贯穿 protocol、agent、server、session、renderer 与测试的一次性改动，必须整体落地并保持全部检查通过。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。

- [ ] 用合格 ID、三种协议之一和含容量、输入类型与档位的模型创建 Provider 后，重启 Sidecar 读回完全一致；registry 中的模型带这些能力与 `thinkingLevelMap`
- [ ] ID 不符合 `^[a-z][a-z0-9-]{0,63}$` 或与已有 Provider 重复时被拒绝，库不变
- [ ] 从上一版本库升级：生成备份；旧 Provider、Credential、默认模型设置被清除，引用它们的 Session 模型字段为空，其余 Session 与条目可读
- [ ] 独立运行只读取 `COKO_CREDENTIAL_<PROVIDER_ID>`；按 kind 读取的 `*_API_KEY` 不再被读取或登记脱敏；依赖它们的测试已改写且仍覆盖原意图
- [ ] provider-presets 接口与 kind 相关的类型、字典与编译期断言已删除，代码中不再出现 Provider kind
- [ ] 现有设置界面仍可创建、编辑、删除 Provider 并配置 Key
- [ ] server README 等当前行为文档同步更新；`pnpm run check:docs` 通过
