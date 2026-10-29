# 05: 模型目录行与容量

**What to build:** 在新建与编辑表单的模型目录中添加模型行（新增后聚焦模型 ID）、填写模型 ID 与显示名称、删除行；展开模型选项后配置上下文窗口、最大输出 token 数与输入类型。目录随供应商一次提交。

**Blocked by:** 03

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准（画面 02A、02B、04、05）。

- [ ] MS-12 至 MS-14 通过
- [ ] 空目录、空模型 ID 或重复 ID 阻止提交并标出出错的行；显示名称留空保存后显示为模型 ID
- [ ] 容量接受纯数字与 K/M（1000 进制），以 token 整数保存并带后缀回显；非正数或最大输出超过上下文窗口时报错；未填用默认 128K / 16K
- [ ] 收起与展开不改变草稿；删除行不额外确认
- [ ] 保存后重新打开表单与 registry 中的模型能力一致
- [ ] 目录不出现“恢复默认模型”

## Comments

### 来自票 09

- 设置菜单已分组（票 09 已合入）。分类“Models”/“模型”是 `role="group"` 的无障碍名称（`aria-labelledby` 指向分类标题），在设置弹窗内用 `getByLabelText('Models')` 会同时匹配该分组和表单字段。查询表单字段时改用带角色的查询，例如 `getByRole('textbox', { name: 'Models' })`；新增带“Models”/“模型”标签的控件同样按角色查询。
- 打开模型服务分区：菜单项文案为 `settings.nav.models`（“Model services”/“模型服务”），选择器 `[data-section=models]` 未变；分区页标题仍用 `settings.models` 等分区自己的键，与菜单文案分开。
