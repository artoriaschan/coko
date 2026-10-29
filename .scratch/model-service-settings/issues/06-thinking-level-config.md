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
