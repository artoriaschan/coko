# 07: 获取可用模型

**What to build:** 在新建或编辑表单点击“获取可用模型”，按表单中的协议、地址与 Key 获取候选模型并在弹窗中多选，添加到当前目录草稿。新建时用表单中填写的 Key，只用于这次请求、不保存；编辑时 Key 留空则使用已保存的 Credential。请求经 preload IPC → main → 控制消息由 Sidecar 发出。

**Blocked by:** 02、05

**Status:** ready-for-agent

规格：[模型服务 PRD](../spec.md)；架构：[ADR 0010](../../../docs/adr/0010-provider-one-shot-save.md)、[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)；术语：[GLOSSARY](../../../GLOSSARY.md)。 视觉以 Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen` 为准（画面 07、07A、07B、08）；默认选择按规格为不选中，不按 07 画面的全选；加载、失败与空结果沿用源稿视觉语言。

- [ ] MS-19 至 MS-28 通过
- [ ] 集成测试：新建时的临时 Key 不进入库、日志、CredentialStore 缓存与任何 HTTP 响应；错误文本脱敏
- [ ] 弹窗每行只显示模型 ID，保持返回顺序；按模型 ID 做不区分大小写的按序字符模糊匹配
- [ ] 初次打开不选中；全选只作用于当前搜索结果中可新增的模型；修改搜索保留已选；已在目录的模型禁用且不计数
- [ ] 导入模型显示名称为 ID、容量为默认值、输入类型为文本、推理关闭，按返回顺序追加；添加所选不保存供应商
- [ ] 加载中按钮不可点；15 秒超时；失败显示错误与重试；空结果有说明；关闭弹窗取消请求
- [ ] 切换协议或地址后已获取的候选作废；新建表单地址或 Key 未填时按钮不可点
- [ ] 弹窗焦点管理与键盘操作可用

## Comments

### 来自票 09

- 设置菜单已分组（票 09 已合入）。分类“Models”/“模型”是 `role="group"` 的无障碍名称（`aria-labelledby` 指向分类标题），在设置弹窗内用 `getByLabelText('Models')` 会同时匹配该分组和表单字段。查询表单字段时改用带角色的查询，例如 `getByRole('textbox', { name: 'Models' })`；新增带“Models”/“模型”标签的控件同样按角色查询。
- 打开模型服务分区：菜单项文案为 `settings.nav.models`（“Model services”/“模型服务”），选择器 `[data-section=models]` 未变；分区页标题仍用 `settings.models` 等分区自己的键，与菜单文案分开。
