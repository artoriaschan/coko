# 08: 会话中选择推理档位

**What to build:** 在会话的模型选择器中为支持推理的模型选择 Thinking Level：始终有“关闭”，推理开关打开时再列出该模型已配置的档位。新建 Session 默认为“关闭”；档位与模型一起按 Session 保存，切换到不支持当前档位的模型时回到“关闭”。请求按所选档位发送其参数值，“关闭”按协议的默认关闭方式请求。

**Blocked by:** 02

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉沿用现有模型选择器与设计系统菜单组件（源稿未覆盖此处）。

- [ ] MS-34、MS-35 通过
- [ ] 档位与模型一起持久化，Sidecar 重启后读回；Run 进行中不能切换（与切换模型一致）
- [ ] 经回显请求的假服务确认：选 high 时请求带配置的参数值；选“关闭”时按协议默认方式（例如 Responses 的 `effort: "none"`）
- [ ] 未配置的档位与推理开关关闭的模型不出现档位选项
- [ ] 模型选择器的其他交互不变；集成测试可经控制消息直接创建带档位的 Provider，不依赖 06 的界面

## Comments

### 来自票 01

- 数据模型（票 01 已合入）：Provider 没有 kind 与品牌预设，`Provider { id, name, api, baseUrl, models, credential, createdAt, updatedAt }`，ID 由用户输入并作主键，须符合 `PROVIDER_ID_PATTERN`（`^[a-z][a-z0-9-]{0,63}$`）。
- `CatalogModel { id, name, contextWindow, maxTokens, input, reasoning, thinkingLevels }`（`@coko/protocol`）与 agent 的 `ModelSpec` 同形，由编译期断言保证；name 为空表示显示为模型 ID；`thinkingLevels` 按添加顺序保存。默认容量为 `MODEL_CATALOG_DEFAULTS { contextWindow: 128000, maxTokens: 16000 }`。
- Thinking Level：`THINKING_LEVELS` 为 off、minimal、low、medium、high、xhigh、max；`ThinkingLevelConfig` 是 `{ level: 'off' }` 或 `{ level, value }`（value 非空）。registry 的 `thinkingLevelMap` 中已配置档位为其 value，未配置为 null，off 不写入（按协议默认关闭）；`reasoning` 关闭时 pi-ai 只支持 off。
- 迁移 v4 把引用旧 Provider 的 Session 模型字段置空，session `SQLITE_SCHEMA_VERSION` 为 4；新增 Session 字段时迁移从 4 往上走。空模型字段时的重新选择提示归票 04。
