# 23: 收尾

**What to build:** 01 至 22 合入后，完成跨票的验证与文档收尾，使规格的验收场景都有对应的证据。

- 跨票的 Electron E2E：创建项目后在其中首次发送，列表、模型标题与归属随之更新（13、12、18）；只发图片后，上下文详情的“提示词”包含图片的估算（19、04）；归档的对话不出现在搜索中（10、22）；会话菜单最终只有重命名、置顶 / 取消置顶、归档、移到项目、删除对话五项（CW-23）。
- 逐条核对横切的验收：键盘、Tooltip 与焦点（CW-42），长列表、长名称、窗口边缘与窄窗口（CW-43），浅色与深色主题及减少动态效果（CW-44），截图、示例与 fixture 的脱敏（CW-45）；对照画布人工核对 13.1 的关键尺寸，在 Comments 记录核对的画面与结果。
- 文档：ADR 0020 的 implementation 改为 implemented 并链接各票的证据（ADR 0021、0022 由 21、15 修改），ADR 索引同步；核对 GLOSSARY 中 Project、Workspace 与 Standalone Session 的定义与实现一致；projects.md、workbench.md 与 docs/README 的入口完整；在规格 16.2 与 20.2 标注实施状态，同步地图与决策票 08 的摘要。
- 按 coko-verify 选择并运行受影响范围的检查，按测试约定区分本地、CI、合并与发布状态报告。

**User stories:** 58、59、60，以及其余故事的跨票验证

**Blocked by:** 01 至 22

**Status:** ready-for-agent

- [ ] 跨票 E2E 通过
- [ ] 横切验收与画布核对记录在 Comments
- [ ] 文档与 ADR 状态更新；`check:docs` 通过
- [ ] 检查结果按测试约定报告
