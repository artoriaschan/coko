# 03: 主输入框与工具栏

**What to build:** 已有对话换成新的主输入框：基准高 120px，底部工具栏从左至右为添加附件、权限模式、计划状态组（仅计划模式）、弹性间距、上下文环、模型与档位、发送；图标、文字与箭头光学居中，hover 与 open 不改变布局。添加附件按钮有 Tooltip，支持系统选择、粘贴与拖入：Workspace 内的文件作为 File Reference 插入（与 @ 相同），Workspace 外的文件以绝对路径插入；图片在 19 合入前一律拒绝并说明原因。权限按钮只显示图标与名称，没有箭头，普通模式与完全访问权限的样式按 PERM-01、PERM-05；菜单直接列出三项（请求批准、帮我批准、完全访问权限），没有顶部说明。read-only 时按钮显示该模式；plan 时按钮显示进入前的模式、右侧显示“计划”胶囊，菜单三项都不勾选，选任意一项直接切换。计划胶囊有开启、hover（灯泡换成圆形关闭图标）与关闭三态，关闭后恢复 prior，不改草稿与其他配置。Run 进行中发送变为停止；现有的暂停与追加指令保留，规格没有要求去掉。不展示语音与帮助入口。

- 行为依据：[规格](../spec.md) NEW-04（主输入框部分）、NEW-05、NEW-06、NEW-07（文件部分）、NEW-09、PERM-01 至 PERM-05、PLAN-01 至 PLAN-04、13.1 的主输入区、输入工具栏与权限行。

**User stories:** 44（文件部分）、45、46、47

**Blocked by:** 无（可立即开始）

**Status:** ready-for-agent

**Write scope:** renderer 的 composer 与工具栏布局、mode-picker、plan-chip、附件处理；packages/ui 中工具栏按钮与菜单的通用部件；i18n；`docs/subsystems/permissions.md` 与 `docs/subsystems/plan-mode.md` 的界面一节，workbench.md 的输入区一节（文件不存在时按 coko-docs 新建）。

**跨票接口：** composer 照旧渲染上下文环（04 拥有）与模型选择组件（05 拥有），不改它们的 props；附件处理留出图片分支，由 19 实现；11 在主输入框上方加归属栏，只在新对话出现。

- [ ] Browser Mode：工具栏顺序与高度（主输入框 120px、工具栏 32px）；权限按钮没有箭头，图标与文字的可见字面垂直居中（比较两者包围盒的垂直中心）；菜单三项含描述与勾选，选择后关闭并把焦点还给按钮，只打开或外部关闭不改变选择；read-only 与 plan 的按钮显示；plan 中选三项之一直接切换；胶囊 hover 换成关闭图标、尺寸与文字位置不变、右侧有效内边距不少于 12px；关闭后恢复 prior，草稿、附件、模型与档位不变，焦点回到编辑区；粘贴与拖入文件后 Workspace 内为 File Reference、Workspace 外为绝对路径，图片被拒绝并说明原因；Run 中发送变为停止，暂停与追加指令仍可用（CW-27、CW-28、CW-91 至 CW-94）。
- [ ] Electron E2E：在已有对话中经菜单切换权限模式，Sidecar 读回的模式一致；`/plan` 进入后胶囊出现，关闭胶囊后回到 prior；附加一个 Workspace 内的文件并发送，用户消息条目中有该 File Reference。
- [ ] 依赖旧 composer 结构的已有用例随之改写，每处在 Comments 写明原因。
- [ ] 文档按 Write scope 更新；`check:docs` 通过。
