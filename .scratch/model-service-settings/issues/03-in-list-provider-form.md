# 03: 列表内的连接表单

**What to build:** 模型服务页展示供应商列表；在列表底部新建、在列表项内编辑，同一时间只展开一个表单。新建表单含 Provider ID、显示名称、API 地址、API 协议与 API Key；编辑时 ID 为静态文本，Key 空值提示“留空则保留现有 Key”。有未保存修改时关闭或切换会提示“放弃更改？”。状态点以文字区分已配置 / 未配置 Key。

**Blocked by:** 02

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准（画面 01、02、03、02D、04）；确认框与字段错误等源稿未覆盖的状态沿用源稿视觉语言与设计系统已有组件。

- [ ] MS-02 至 MS-11 通过（浏览器测试覆盖交互，Electron E2E 覆盖一次新建与编辑保存）
- [ ] 字段校验：ID 格式与重复（“ID 已被使用”）、显示名称必填、地址须为 http(s)、新建 Key 必填，错误不只靠颜色表达
- [ ] 协议下拉只有三项，默认 OpenAI Chat Completions
- [ ] 按钮文案始终为“编辑”；提交中按钮不可点，失败时表单底部显示错误并保留草稿
- [ ] 键盘可操作，焦点可见，明暗主题正确；几何符合规格第 6 节

## Comments

### 来自票 09

- 设置菜单已分组（票 09 已合入）。分类“Models”/“模型”是 `role="group"` 的无障碍名称（`aria-labelledby` 指向分类标题），在设置弹窗内用 `getByLabelText('Models')` 会同时匹配该分组和表单字段。查询表单字段时改用带角色的查询，例如 `getByRole('textbox', { name: 'Models' })`；新增带“Models”/“模型”标签的控件同样按角色查询。
- 打开模型服务分区：菜单项文案为 `settings.nav.models`（“Model services”/“模型服务”），选择器 `[data-section=models]` 未变；分区页标题仍用 `settings.models` 等分区自己的键，与菜单文案分开。
