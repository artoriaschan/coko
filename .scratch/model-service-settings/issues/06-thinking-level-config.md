# 06: 推理档位配置

**What to build:** 在展开的模型选项中，用“推理等级”开关和档位列表为模型配置 Thinking Level 及其 API 参数值。

**Blocked by:** 05

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准（画面 02C、06）。

- [ ] MS-15 至 MS-18、MS-36 通过
- [ ] “添加档位”按 off、minimal、low、medium、high、xhigh、max 顺序补齐最早缺失档位；七档齐全后置灰且文案不变；无顺序或下一档提示
- [ ] 修改某行档位只能选尚未配置的档位；同一模型不出现重复档位
- [ ] off 行参数输入禁用并显示“关闭思考”；其余档位默认参数值等于档位名且可编辑
- [ ] 开关关闭时已填档位仍随草稿保存，重新打开表单时仍在

## Comments

### 来自票 09

- 设置菜单已分组（票 09 已合入）。分类“Models”/“模型”是 `role="group"` 的无障碍名称（`aria-labelledby` 指向分类标题），在设置弹窗内用 `getByLabelText('Models')` 会同时匹配该分组和表单字段。查询表单字段时改用带角色的查询，例如 `getByRole('textbox', { name: 'Models' })`；新增带“Models”/“模型”标签的控件同样按角色查询。
- 打开模型服务分区：菜单项文案为 `settings.nav.models`（“Model services”/“模型服务”），选择器 `[data-section=models]` 未变；分区页标题仍用 `settings.models` 等分区自己的键，与菜单文案分开。
