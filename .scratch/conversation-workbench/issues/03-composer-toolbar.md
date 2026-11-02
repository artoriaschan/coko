# 03: 主输入框与工具栏

**What to build:** 已有对话换成新的主输入框：基准高 120px，底部工具栏从左至右为添加附件、权限模式、计划状态组（仅计划模式）、弹性间距、上下文环、模型与档位、发送；图标、文字与箭头光学居中，hover 与 open 不改变布局。添加附件按钮有 Tooltip，支持系统选择、粘贴与拖入：Workspace 内的文件作为 File Reference 插入（与 @ 相同），Workspace 外的文件以绝对路径插入；图片在 19 合入前一律拒绝并说明原因。权限按钮只显示图标与名称，没有箭头，普通模式与完全访问权限的样式按 PERM-01、PERM-05；菜单直接列出三项（请求批准、帮我批准、完全访问权限），没有顶部说明。read-only 时按钮显示该模式；plan 时按钮显示进入前的模式、右侧显示“计划”胶囊，菜单三项都不勾选，选任意一项直接切换。计划胶囊有开启、hover（灯泡换成圆形关闭图标）与关闭三态，关闭后恢复 prior，不改草稿与其他配置。Run 进行中发送变为停止；现有的暂停与追加指令保留，规格没有要求去掉。不展示语音与帮助入口。

- 行为依据：[规格](../spec.md) NEW-04（主输入框部分）、NEW-05、NEW-06、NEW-07（文件部分）、NEW-09、PERM-01 至 PERM-05、PLAN-01 至 PLAN-04、13.1 的主输入区、输入工具栏与权限行。

**User stories:** 44（文件部分）、45、46、47

**Blocked by:** 无（可立即开始）

**Status:** ready-for-agent

**Write scope:** renderer 的 composer 与工具栏布局、mode-picker、plan-chip、附件处理；packages/ui 中工具栏按钮与菜单的通用部件；i18n；`docs/subsystems/permissions.md` 与 `docs/subsystems/plan-mode.md` 的界面一节，workbench.md 的输入区一节（文件不存在时按 coko-docs 新建）。

**跨票接口：** composer 照旧渲染上下文环（04 拥有）与模型选择组件（05 拥有），不改它们的 props；附件处理留出图片分支，由 19 实现；11 在主输入框上方加归属栏，只在新对话出现。

- [x] Browser Mode：工具栏顺序与高度（主输入框 120px、工具栏 32px）；权限按钮没有箭头，图标与文字的可见字面垂直居中（比较两者包围盒的垂直中心）；菜单三项含描述与勾选，选择后关闭并把焦点还给按钮，只打开或外部关闭不改变选择；read-only 与 plan 的按钮显示；plan 中选三项之一直接切换；胶囊 hover 换成关闭图标、尺寸与文字位置不变、右侧有效内边距不少于 12px；关闭后恢复 prior，草稿、附件、模型与档位不变，焦点回到编辑区；粘贴与拖入文件后 Workspace 内为 File Reference、Workspace 外为绝对路径，图片被拒绝并说明原因；Run 中发送变为停止，暂停与追加指令仍可用（CW-27、CW-28、CW-91 至 CW-94）。
- [x] Electron E2E：在已有对话中经菜单切换权限模式，Sidecar 读回的模式一致；`/plan` 进入后胶囊出现，关闭胶囊后回到 prior；附加一个 Workspace 内的文件并发送，用户消息条目中有该 File Reference。
- [x] 依赖旧 composer 结构的已有用例随之改写，每处在 Comments 写明原因。
- [x] 文档按 Write scope 更新；`check:docs` 通过。


Closed: true

## Comments

### 2026-11-03 实施与验证

- 按规格第 18 节已确认的 Browser Mode、真实 Sidecar/Electron 与共享编辑器接口执行 TDD：先观察 120px 高度、plan 按钮 prior、胶囊几何、退出失败保持 plan、附件插入、12px 提示内边距的回归失败，再逐片实现。没有增加测试接口或更改验收口径。
- 主输入框为 120px、R28、12px 内边距、32px 底栏；附件、权限、计划状态组、弹性间距、上下文、模型与发送按序排列。运行中停止居右，保留暂停与追加指令。新 `permissionControl` 插槽将权限和原有模型 `accessory` 分开，不改变 ContextRingControl 与 ModelPicker props。
- 权限快捷菜单只有三项，无标题说明区和按钮箭头；read-only 如实显示，plan 显示 prior 且三项无勾选。普通图标为手掌 / 盾牌终端组合；危险模式保留警示。界面与 Tooltip 不再显示快捷键。共享 PlanModePill 提供固定几何、灯泡 / 圆形关闭替换、至少 12px 右内边距和无 hover 设备的关闭入口；服务端确认退出后才关闭，失败保留 plan，成功回到编辑区。
- 新增受控 pickFiles IPC（只接受应用主窗口主框架）及 preload webUtils 路径解析；系统选择、粘贴、拖入均插入真实 File Reference 或外部绝对路径，不复制文件。图片目前明确拒绝，后续图片票接管该分支。引用沿用 EditorState 草稿保存。
- 已有测试调整：context-ring 的 390px 装配改用独立权限插槽和当前主输入框，不再覆盖旧横排样式；plan browser / Electron 由已移除的菜单“规划”入口改为 /plan，并验证 prior、草稿、附件与模型保留；permissions E2E 增加协议读回，references-drafts E2E 增加系统选择与真实磁盘 File 经过 webUtils 的粘贴。历史已交付的 m4 Plan Mode 票与规格保留当时结论，当前正式文档已同步。
- `pnpm install --frozen-lockfile`：退出 0。
- `pnpm run test packages/ui/src/guards/style-guard.test.ts scripts/browser-deps.test.ts apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx apps/desktop/src/renderer/stores/chat-store-permissions.test.ts apps/desktop/src/renderer/features/conversation/context-ring.browser.test.tsx packages/ui/src/composer/composer-editor.browser.test.tsx`：7 文件、85 用例通过；覆盖两主题权限字形与图标中心、菜单和焦点、胶囊、文件三入口、运行控制、390px 布局、共享编辑器与样式守卫。
- `pnpm run test apps/desktop/e2e/permissions.e2e.test.ts apps/desktop/e2e/plan.e2e.test.ts apps/desktop/e2e/references-drafts.e2e.test.ts`：3 文件、7 用例通过；真实 Electron + 本次构建 Sidecar，模型为 faux。验证实际模式和消息记录、原生文件路径、模型收到引用、计划审阅闭环、草稿恢复。
- 原生截图首轮发现浏览器默认内层编辑器焦点描边，已在主输入框局部改为 outline-hidden（高对比保留 outline），不改变其他编辑器。随后只重跑失效范围：`pnpm run test apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx apps/desktop/src/renderer/features/conversation/context-ring.browser.test.tsx packages/ui/src/guards/style-guard.test.ts` 为 3 文件、56 用例通过，`pnpm run test apps/desktop/e2e/plan.e2e.test.ts` 为 1 文件、1 用例通过。
- `pnpm run typecheck`、`pnpm run lint`、`pnpm run check:docs`、`git diff --check` 均退出 0；文档检查 245 个 Markdown 文件、0 问题。Impeccable detector 对四个改动 UI 目标返回空发现。
- coko-docs：新增 workbench.md 输入区与文件附件正文及 docs/README 导航；更新 permissions.md、plan-mode.md 的现有界面与进入说明，并登记共享工具栏尺寸。已按 AGENTS → docs/README → 正文读回；路径、语义、归属、引用方向、生命周期、当前入口、新会话读入与历史保留均通过。
- 未验证真实模型服务、生产签名发布包、CI；没有推送或创建 PR。当前为本地任务分支，等待汇入集成分支。

- 合入集成分支 `d74d831`（02 号外壳导航）：仅 workbench.md 与 docs/README 文档冲突，已保留外壳导航、输入区与附件正文及两组验证入口；没有丢弃任一票行为。
- 集成后的旧 app.browser 窄窗口断言同步：侧栏 data-sidebar 已为 rail 时 grid 列宽仍可能在过渡，改为轮询可观察的无溢出布局；编辑区现在独占上方整行，短 placeholder 不再必然溢出，保留单行、ellipsis 样式、边界和对比度断言，去掉旧横排布局的“必须溢出”要求。没有延长 timeout 或固定 sleep。
- 原生明暗主题截图确认完成；主输入框内层浏览器描边已消失，暗色键盘 focus 显示胶囊圆形关闭图标与 Tooltip，几何与文字位置保持。临时截图保存在仓库外，不加入产品资产。
- 与 02 集成后的复核：`pnpm run typecheck`、`pnpm run lint`、`pnpm run check:docs` 退出 0；`pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx packages/ui/src/app-frame/app-frame.browser.test.tsx` 为 4 文件、62 用例通过；`pnpm run test apps/desktop/e2e/plan.e2e.test.ts apps/desktop/e2e/workbench.e2e.test.ts` 为 2 文件、2 用例通过。文档合并后已从导航读回，外壳和输入区两节均可达。
