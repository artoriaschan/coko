# Standards

审查固定于 `e7efe155912791f51647b9bcf9f965d0b2362c75`，命令：`git diff 6e57ed0a7605996ec96173c897b1546c57ed42aa...HEAD`。已核对最终提交清单及 f9→最终 HEAD 的证据/文档增量；产品源码没有变化。

1. **[P2] 字号/行高与动效参数绕过共享 token 归属。** [file-tool-details.css](../../../../apps/desktop/src/renderer/features/conversation/file-tool-details.css#L55) 新增 `font: 11px/19px ...`；[use-flow-box.ts](../../../../apps/desktop/src/renderer/features/conversation/use-flow-box.ts#L75) 新增 `duration: 160` 与字面缓动。相同问题分布于多个新增样式 owner，完整新增行清单见 [补充清单](token-owners.md)。[设计系统](../../../../docs/tech-stack/ui-design-system.md)规定主题是字体和动效数值唯一来源，:36 要求成对字号/行高角色，:197 要求主题登记时长/缓动。这是明确规范违例，当前样式守卫不覆盖。最小修复：保留已实测值，复用现有成对角色；缺失角色与 flow/shimmer 参数仅补入主题，CSS 消费 token，WAAPI 从所属元素读取 computed custom properties；同步规则说明即可，无需改参考几何。

2. **[P3] 过程摘要按翻译内容决定拼接。** [process-timeline.tsx](../../../../apps/desktop/src/renderer/features/conversation/process-timeline.tsx#L19) 使用 `titles.every((title) => title.startsWith('已'))` 后切掉字符，英文分支也直接改写译文首字符。违反 [界面约定](../../../../docs/tech-stack/ui.md)“逻辑判断使用稳定 ID 或枚举，不匹配翻译文本”。译文改词即可改变组合行为。按活动 ID 选择字典中的独立/组合片段或格式器，保留现有可见文案。

以上为 2 项文档标准违例；未另列缺乏可执行证据的 baseline smell。最终证据准确区分实际选中范围、历史失败、未证实异常原因及原生/CI 限制。新高亮器的懒加载、局部主题、过期回调及选区生命周期未发现额外规范问题。本次为只读审查，未运行测试。
