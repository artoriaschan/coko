---
kind: evidence
description: "对话工作台95条CW验收、当前Electron跨票流程、横切与画布核对及受影响检查。"
lifecycle: active
---

# 对话工作台收尾验收

## 验证对象

- [规格](../spec.md) CW-01～95、13.1、18；[票23](../issues/23-closeout.md)。依赖01～22于集成提交`44b9296`均实际关闭并交付源码和测试，本记录直接对应测试/观测，不把票号索引当证据。
- 本地收尾分支`codex/cw-23-closeout`：夹具`7dc10a14`、移动子菜单Escape修复`7c2fde5a`、欢迎页768px及计划规范路径夹具`519f816`。最终提交与合入另记。
- macOS arm64、Electron41.0.3（内置Node24）、Chromium Browser Mode、pnpm12.15.0、Vitest5.0.3；真实Sidecar/HTTP/SQLite/Git/renderer/IPC，模型为faux。每例独立临时COKO_HOME与数据库。系统文件/目录选择仅注入对话框返回，不代表实际OS对话框、剪贴板或Finder的运行证明。

## 执行记录

| 检查 | 实际结果 |
| --- | --- |
| 当前集成17份Browser/样式文件，命令如下 | 206用例通过，退出0 |
| Escape修复后B-move | 14用例通过，原生四来源菜单的五项、逐层关闭和焦点通过 |
| 宽度修复后的B-new/B-context/样式守卫 | 3文件54用例通过 |
| E-closeout/E-plan/E-context/E-workbench（当前重建测试产物） | 4文件9用例通过，其中E-closeout6项：必需四跨流程、几何/明暗/窄窗口/reduced-motion、已有会话plan/context/自动压缩联合链路 |
| E-closeout、plan、workbench、first-send-worktree、project-delete、images的上一轮 | 当时新增768px断言失败（774.398px），其余9项通过；尺寸修复后由上行重验，未将部分失败运行称全绿 |
| 当前服务端/存储/Finder注入边界，24文件命令如下 | 163用例通过，退出0 |
| 32份继承Electron夹具的隔离矩阵，快照7c2fde5a | 发现失败，修复及最终重验另记；不由局部绿灯替代 |

```sh
pnpm run test apps/desktop/src/renderer/app/app.browser.test.tsx packages/ui/src/app-frame/app-frame.browser.test.tsx apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx apps/desktop/src/renderer/features/sidebar/session-row.browser.test.tsx apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx apps/desktop/src/renderer/features/sidebar/project-row.browser.test.tsx apps/desktop/src/renderer/features/sidebar/project-delete.browser.test.tsx apps/desktop/src/renderer/features/sidebar/session-move.browser.test.tsx apps/desktop/src/renderer/features/sidebar/conversation-search.browser.test.tsx apps/desktop/src/renderer/features/projects/project-form.browser.test.tsx apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx apps/desktop/src/renderer/features/conversation/context-ring.browser.test.tsx apps/desktop/src/renderer/features/conversation/model-picker.browser.test.tsx apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx apps/desktop/src/renderer/features/conversation/branches.browser.test.tsx packages/ui/src/guards/style-guard.test.ts
pnpm run test packages/session/src/memory/memory.test.ts packages/session/src/sqlite/sqlite.test.ts packages/session/src/sqlite/migrate-v10.test.ts packages/session/src/sqlite/migrate-v11.test.ts tests/integration/sidecar-projects.test.ts tests/integration/sidecar-create-project.test.ts tests/integration/sidecar-edit-project.test.ts tests/integration/sidecar-session-pinning.test.ts tests/integration/sidecar-session-rename.test.ts tests/integration/sidecar-delete-session.test.ts tests/integration/sidecar-archive-session.test.ts tests/integration/sidecar-delete-project.test.ts tests/integration/sidecar-session-move.test.ts tests/integration/sidecar-project-permissions.test.ts tests/integration/sidecar-first-send.test.ts tests/integration/sidecar-first-send-worktree.test.ts tests/integration/sidecar-branches.test.ts tests/integration/sidecar-titles.test.ts tests/integration/sidecar-images.test.ts tests/integration/sidecar-context.test.ts tests/integration/sidecar-compaction.test.ts tests/integration/secrets-gate-titles.test.ts apps/server/src/application/context/usage.test.ts apps/desktop/src/main/open-directory.test.ts
pnpm run test apps/desktop/e2e/conversation-workbench-closeout.e2e.test.ts apps/desktop/e2e/plan.e2e.test.ts apps/desktop/e2e/context.e2e.test.ts apps/desktop/e2e/workbench.e2e.test.ts
```

## 画布与横切

Pencil只读打开仓库`docs/ui/双栏布局.pen`，读取/查看`Y5Oqw`、`B1eglK`、`zG8uB`，读取`Z0KqK`和`Y2uwiG`，并读取/查看搜索内框`nQAM6`；未修改画布。大范围visitor两次中断后改用限定节点depth读取，未把失败的读取当证据。

| 项目 | 本次核查 |
| --- | --- |
| 基准工作台 | Y5Oqw1440×1200、侧栏280；Electron请求1440×1200后系统实际viewport为1440×1130（DPR2截图2880×2260，规格不固定真实窗口高度），实测侧栏280、安全区48、导航和列表H32、文字13/20、R28、欢迎输入框768×120、工具栏32、归属28+8间距=36。输入框首次测774.398px，局部修欢迎页轴后精确通过；已有Session轴保持。 |
| 上下文 | B1eglK/z5wvj源稿348×384/R16、top-end/8，B-context实测几何与避让。z5wvj示例5K+35K+100K+60K+40K=240K，240K/1M=24%；分项分母240K：2.08/14.58/41.67/25/16.67%；容量条分母1M。E-closeout图像/plan明细确认。 |
| 删除 | Z0KqK480×184、zG8uB480×208、padding24；B-menu/B-delete-project验证两主题/390px、文案、焦点、取消/关闭/Escape、提交失败重试。 |
| 搜索 | nQAM6源稿640×432/R28/p12、输入40、结果H32/R8；元数据及截图标题示例对话A01～B10，项目canvas-demo/orbit-demo/studio-demo。E-closeout实测640×432，21长标题仅结果滚动；B-search390×300实测358×268且菜单边缘可达。 |
| CW-42 | B-menu/row/form/search/context/model/plan/branches覆盖Tab、方向键、Enter、IME、外部关闭/Escape、子层保留及焦点返回；B-app区分设置Escape与停止。原生四来源最终菜单逐层关闭。Tooltip有本地化名称且不印快捷键。 |
| CW-43 | Browser390px/短窗口、五条独立分页、长名全文可访问/滚动渐隐、菜单/详情边缘避让通过；真实Electron最小520×820，收起侧栏后主内容≥390、输入框无横向溢出。未把最小原生窗口伪称390px。 |
| CW-44 | Browser两主题及模型粒子右向左/数量速度/关闭隐藏/off/reduced-motion通过；原生light/dark+reduce仍可操作，实际读图未见表单/操作裁断。共享样式守卫通过。 |
| CW-45 | 本次截图仅Example/示例、临时example-project和Faux。检查renderer fixture及HTML预览：/Users/me、/Users/demo/Projects/*-demo为中性虚构目录，无个人用户名、账号或真实路径。品牌既有brand/rukie-avatar.png，图标Lucide；未发布临时截图日志。 |

已实际读图：本机`/tmp/coko-cw23-workbench-{light,dark}.png`、`/tmp/coko-cw23-search-{light,dark}.png`、`/tmp/coko-cw23-narrow-dark-reduced.png`、`/tmp/coko-cw23-image-context.png`、`/tmp/coko-cw23-plan-context.png`。临时产物不提交，可重跑E-closeout重建；`.vitest/cw*`为忽略的Browser截图。

## 验收与测试位置

下列缩写直接链接当前测试，不是票号转引。CW66和88由同一个E-closeout最终用例联合验证已有会话无归属栏、计划prior、五类明细、warning与auto compaction；Run停止另由B-app/B-composer和原生chat停止用例证明。

| 缩写 | 当前测试文件 |
| --- | --- |
| B-app | [apps/desktop/src/renderer/app/app.browser.test.tsx](../../../apps/desktop/src/renderer/app/app.browser.test.tsx) |
| B-frame | [packages/ui/src/app-frame/app-frame.browser.test.tsx](../../../packages/ui/src/app-frame/app-frame.browser.test.tsx) |
| B-lists | [apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx](../../../apps/desktop/src/renderer/features/sidebar/sidebar-lists.browser.test.tsx) |
| B-row | [apps/desktop/src/renderer/features/sidebar/session-row.browser.test.tsx](../../../apps/desktop/src/renderer/features/sidebar/session-row.browser.test.tsx) |
| B-menu | [apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx](../../../apps/desktop/src/renderer/features/sidebar/session-menu.browser.test.tsx) |
| B-project | [apps/desktop/src/renderer/features/sidebar/project-row.browser.test.tsx](../../../apps/desktop/src/renderer/features/sidebar/project-row.browser.test.tsx) |
| B-delete-project | [apps/desktop/src/renderer/features/sidebar/project-delete.browser.test.tsx](../../../apps/desktop/src/renderer/features/sidebar/project-delete.browser.test.tsx) |
| B-move | [apps/desktop/src/renderer/features/sidebar/session-move.browser.test.tsx](../../../apps/desktop/src/renderer/features/sidebar/session-move.browser.test.tsx) |
| B-search | [apps/desktop/src/renderer/features/sidebar/conversation-search.browser.test.tsx](../../../apps/desktop/src/renderer/features/sidebar/conversation-search.browser.test.tsx) |
| B-form | [apps/desktop/src/renderer/features/projects/project-form.browser.test.tsx](../../../apps/desktop/src/renderer/features/projects/project-form.browser.test.tsx) |
| B-new | [apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx](../../../apps/desktop/src/renderer/features/conversation/new-chat.browser.test.tsx) |
| B-composer | [apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx](../../../apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx) |
| B-context | [apps/desktop/src/renderer/features/conversation/context-ring.browser.test.tsx](../../../apps/desktop/src/renderer/features/conversation/context-ring.browser.test.tsx) |
| B-model | [apps/desktop/src/renderer/features/conversation/model-picker.browser.test.tsx](../../../apps/desktop/src/renderer/features/conversation/model-picker.browser.test.tsx) |
| B-plan | [apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx](../../../apps/desktop/src/renderer/features/conversation/plan.browser.test.tsx) |
| B-branches | [apps/desktop/src/renderer/features/conversation/branches.browser.test.tsx](../../../apps/desktop/src/renderer/features/conversation/branches.browser.test.tsx) |
| E-closeout | [apps/desktop/e2e/conversation-workbench-closeout.e2e.test.ts](../../../apps/desktop/e2e/conversation-workbench-closeout.e2e.test.ts) |
| E-plan | [apps/desktop/e2e/plan.e2e.test.ts](../../../apps/desktop/e2e/plan.e2e.test.ts) |
| E-context | [apps/desktop/e2e/context.e2e.test.ts](../../../apps/desktop/e2e/context.e2e.test.ts) |
| E-workbench | [apps/desktop/e2e/workbench.e2e.test.ts](../../../apps/desktop/e2e/workbench.e2e.test.ts) |
| S-projects | [tests/integration/sidecar-projects.test.ts](../../../tests/integration/sidecar-projects.test.ts) |
| S-create | [tests/integration/sidecar-create-project.test.ts](../../../tests/integration/sidecar-create-project.test.ts) |
| S-edit | [tests/integration/sidecar-edit-project.test.ts](../../../tests/integration/sidecar-edit-project.test.ts) |
| S-pin | [tests/integration/sidecar-session-pinning.test.ts](../../../tests/integration/sidecar-session-pinning.test.ts) |
| S-rename | [tests/integration/sidecar-session-rename.test.ts](../../../tests/integration/sidecar-session-rename.test.ts) |
| S-delete | [tests/integration/sidecar-delete-session.test.ts](../../../tests/integration/sidecar-delete-session.test.ts) |
| S-archive | [tests/integration/sidecar-archive-session.test.ts](../../../tests/integration/sidecar-archive-session.test.ts) |
| S-delete-project | [tests/integration/sidecar-delete-project.test.ts](../../../tests/integration/sidecar-delete-project.test.ts) |
| S-move | [tests/integration/sidecar-session-move.test.ts](../../../tests/integration/sidecar-session-move.test.ts) |
| S-permissions | [tests/integration/sidecar-project-permissions.test.ts](../../../tests/integration/sidecar-project-permissions.test.ts) |
| S-first | [tests/integration/sidecar-first-send.test.ts](../../../tests/integration/sidecar-first-send.test.ts) |
| S-worktree | [tests/integration/sidecar-first-send-worktree.test.ts](../../../tests/integration/sidecar-first-send-worktree.test.ts) |
| S-branches | [tests/integration/sidecar-branches.test.ts](../../../tests/integration/sidecar-branches.test.ts) |
| S-title | [tests/integration/sidecar-titles.test.ts](../../../tests/integration/sidecar-titles.test.ts) |
| S-images | [tests/integration/sidecar-images.test.ts](../../../tests/integration/sidecar-images.test.ts) |
| S-context | [tests/integration/sidecar-context.test.ts](../../../tests/integration/sidecar-context.test.ts) |
| S-compact | [tests/integration/sidecar-compaction.test.ts](../../../tests/integration/sidecar-compaction.test.ts) |
| S-title-secret | [tests/integration/secrets-gate-titles.test.ts](../../../tests/integration/secrets-gate-titles.test.ts) |
| U-usage | [apps/server/src/application/context/usage.test.ts](../../../apps/server/src/application/context/usage.test.ts) |
| U-finder | [apps/desktop/src/main/open-directory.test.ts](../../../apps/desktop/src/main/open-directory.test.ts) |

| 场景 | 实际验证入口/观测 | 已验证的外部结果 |
| --- | --- | --- |
| CW-01 | B-app, B-frame, E-workbench, E-closeout | 双栏、四角圆角、顶部三个导航项与固定用户区正确，无专家 / 远程控制 / 更多 / 帮助 |
| CW-02 | B-app, B-frame, E-workbench, E-closeout | 收起侧栏、后退、前进顺序与位置符合源稿，禁用态可识别 |
| CW-03 | B-lists, S-projects | 左边缘正确，标题同为 13/20；展开折叠文字不放大 |
| CW-04 | B-lists, S-projects | 展开 hover 显示向下箭头；折叠后向右箭头常驻；右端操作只在适用状态显示 |
| CW-05 | B-lists, S-projects | 只有标题旁展开收起箭头，没有右端更多、拖拽或新建 |
| CW-06 | B-lists, S-projects | 按约定完成分类排序，不误开菜单；只能调换对话与项目，置顶固定在最上方（LIST-04） |
| CW-07 | B-lists, S-projects | 三类展开状态独立，项目行下方展示所属会话 |
| CW-08 | B-lists, S-projects | H32；列表 R8、整行背景，标题与行尾按钮不跳动 |
| CW-09 | B-lists, S-projects | 显示“暂无对话”；首个会话建立后以会话项替换空状态 |
| CW-10 | B-lists, S-projects | 两个单选项、勾选、列表顺序和关闭行为正确 |
| CW-11 | B-form, S-create | 目录逐项展示，主要标记、移除和继续添加入口正确 |
| CW-12 | B-form, S-create | 不创建空项目，不改变已保存项目和本机源文件 |
| CW-13 | B-project, B-form, S-edit, S-pin | 更多、新对话按钮和详情卡片出现；卡片包含数量、完整路径和编辑入口 |
| CW-14 | B-project, B-form, S-edit, S-pin | 均位于对应行右侧，间距 2px、顶部偏移 0px（有足够空间） |
| CW-15 | B-project, B-form, S-edit, S-pin | 名称、完整目录及主要标记回填；保存更新原对象，取消保留原值 |
| CW-16 | B-new, B-project, B-move, S-first | 欢迎页打开、项目预选、输入框聚焦，不切换项目展开状态 |
| CW-17 | B-row, B-menu, S-pin | 两种卡片显示完整标题、时间及正确归属；行尾 pin 和更多出现 |
| CW-18 | B-row, B-menu, S-pin | 在对应整行右侧、2px、顶对齐；不出现在按钮下方 |
| CW-19 | B-row, B-menu, S-pin | 右、双侧、左渐隐依次正确；图标按钮固定，全文可读 |
| CW-20 | B-row, B-menu, S-pin | 原对话分类移除，置顶显示同一对象且有聊天图标，无重复 |
| CW-21 | B-project, B-form, S-edit, S-pin | 会话关联保留，项目树迁移，单独置顶的会话不重复 |
| CW-22 | B-project, B-form, S-edit, S-pin | 恢复原分类与展开 / 选择状态，当前对话内容保留 |
| CW-23 | E-closeout, B-menu | 仅有重命名、置顶 / 取消置顶、归档、移到项目、删除对话五项，无导出为 MD、在飞书中继续、小窗打开或快捷键 |
| CW-24 | B-move, S-move, E-closeout | 子菜单在触发项右侧紧贴、间距 0px、顶对齐，向右箭头可见，父菜单仍在；关闭后焦点回到移到项目项 |
| CW-25 | B-new, B-project, B-move, S-first | 项目、分支和工作树草稿清空；归属显示聊天图标 + 对话 |
| CW-26 | B-new, B-project, B-move, S-first | 使用 brand 资产；无四个快捷按钮、语音或帮助；归属栏在上，工具栏在输入框底部 |
| CW-27 | B-composer, B-plan, B-new, E-plan | 主输入框 120px、工具栏 32px；权限图标与文字光学居中，权限按钮没有箭头 |
| CW-28 | B-composer, B-plan, B-new, E-plan | 无顶部说明，三项含描述和勾选，按钮同步并关闭；默认不是示例强制全权限 |
| CW-29 | B-model | 先显示详情，有模型图标、名称、档位、拉条，无两角按钮 |
| CW-30 | B-model | 详情关闭、分组列表打开；选择后列表关闭并返回详情，只有一个模型浮层 |
| CW-31 | B-model | 仅选择配置的有效档位，松开吸附，详情保持，填充覆盖节点隐藏 |
| CW-32 | B-model | 粒子始终右向左，数量和流速递增；最大档明显快于低档 |
| CW-33 | B-model | 粒子停止，档位选择仍正常 |
| CW-34 | B-new, B-project, B-move, S-first | 菜单在归属栏上方 6px，选中勾选正确并回填项目 |
| CW-35 | B-new, B-project, B-move, S-first | 图标变关闭按钮，名称不跳动；恢复独立并清除项目 Git 草稿 |
| CW-36 | B-branches, S-branches, S-worktree | 独立时选项待选择；有项目后按能力启用；无环境选项 |
| CW-37 | B-branches, S-branches, S-worktree | 仅改变新对话配置，不立即创建工作树 |
| CW-38 | B-branches, S-branches, S-worktree | 搜索、列表、当前项和创建入口完整；子层高于父层并重叠，归属栏在下方 |
| CW-39 | B-branches, S-branches, S-worktree | 出现明确校验，主按钮禁用，弹窗几何不跳动 |
| CW-40 | B-branches, S-branches, S-worktree | 成功回显，失败保留名称和旧选择，无重复提交 |
| CW-41 | B-new, S-first | 空输入禁用；失败保留草稿；成功只创建一个会话并归入正确分类 |
| CW-42 | B-app, B-menu, B-move, B-form, B-search, B-context, B-model, B-plan, B-branches, E-closeout | 名称、Tooltip、焦点、逐层关闭和返回正确，界面无快捷键展示 |
| CW-43 | B-frame, B-row, B-project, B-menu, B-move, B-search, B-context, B-model, E-closeout | 操作可达、浮层避让、不裁断；主内容宽度验收沿用 UI 约定 |
| CW-44 | B-lists, B-model, B-plan, B-context, B-search, E-closeout | 共享 token 可读、焦点可见；浅色菜单白色不透明，动效遵从偏好 |
| CW-45 | 人工核查：本节「画布与横切」 | 无参考图个人信息、真实路径或账号；图标、品牌和示例数据来源可追溯 |
| CW-46 | B-search, B-menu, E-closeout | 搜索浮层打开并聚焦输入，默认只有最近对话，不创建 Session，无 Tabs、建议操作或快捷键 |
| CW-47 | B-search, B-menu, E-closeout | 前者按标题匹配并高亮，后者不会仅因标签 / 正文命中而返回 |
| CW-48 | B-search, B-menu, E-closeout | 每个 Session 只有一行，项目标签与归属正确 |
| CW-49 | B-search, B-menu, E-closeout | 先展示无匹配状态，清空后恢复最近对话；输入框保持可见 |
| CW-50 | B-search, B-menu, E-closeout | 浮层关闭并打开同一个已有会话，项目与置顶关系不变 |
| CW-51 | B-search, B-menu, E-closeout | 组合期间不误确认；未选择时关闭不改变当前内容，焦点回到搜索按钮 |
| CW-52 | B-search, B-menu, E-closeout | 无最近项时显示专属空状态；长列表内部滚动，无正文摘要、Tabs 或额外操作 |
| CW-53 | 人工核查：Pencil nQAM6 与 B-search 中性 fixture | 统一中性“示例对话”名称，匹配高亮中不残留参考图会话标题 |
| CW-54 | B-menu, B-search, S-delete, S-rename | 打开相同更多菜单，锚点随鼠标变化；不出现原生菜单、不切换会话；点击更多仍为行右侧 2px |
| CW-55 | B-search, B-menu, E-closeout | 菜单对应正确 Session，当前浮层层级正确且边缘可达 |
| CW-56 | B-menu, B-search, S-delete, S-rename | 先出现明确永久删除及子智能体影响的确认弹窗，尚未移除数据；无快捷键 |
| CW-57 | B-search, B-menu, E-closeout | 目标及子会话保持，恢复原触发上下文；搜索关键词与结果保留 |
| CW-58 | B-menu, B-search, S-delete, S-rename | 成功后目标及子会话同步从列表和搜索消失；失败不虚报成功，不删除源目录和工作文件 |
| CW-59 | B-form, S-create, E-closeout | 不新增项目；打开已有项目的新对话界面并给出 Toast；表单内容不并入已有项目 |
| CW-60 | S-archive, B-search, E-closeout；archived.browser当前重验 | 从列表、搜索和置顶中移出；打开时只读；恢复后回到原分类，不恢复置顶 |
| CW-61 | S-archive, B-search, E-closeout；archived.browser当前重验 | 拒绝并说明原因，会话不变 |
| CW-62 | B-new, B-project, B-move, S-first | 修改与草稿都保留；首次发送成功后清空 |
| CW-63 | B-composer, S-images, E-closeout | 前者可以发送；后者被拒绝并说明原因 |
| CW-64 | B-branches, S-branches, S-worktree | 拒绝切换并说明原因，原分支不变 |
| CW-65 | S-worktree | 不留下会话；未改动的 worktree 与分支被移除 |
| CW-66 | E-closeout, B-app, B-composer, B-lists；原生chat停止用例 | 使用同一主输入框且无归属栏，Run 中可停止；会话行没有状态点和分支 chip |
| CW-67 | B-form, S-create | 右侧移除按钮前显示“设为主要”；normal 时隐藏且不挤动内容，主要行仅显示主要标记 |
| CW-68 | B-form, S-create | 草稿中只有一个主要标记并移到目标行；保存采用该选择，取消恢复原数据，跨项目唯一性校验保持有效 |
| CW-69 | S-permissions | 读取不询问；写入按模式询问；批准后 bash 能写入该文件夹；受保护路径照常询问 |
| CW-70 | S-permissions | 本次 Run 不变，下一个 Run 按新列表生效 |
| CW-71 | B-project, B-form, S-edit, S-pin | 下一个文件夹成为主要；冲突时保存失败并指出项目 |
| CW-72 | B-delete-project, S-delete-project, S-delete | 出现指定标题和说明的确认弹窗；确认后项目移除，对话及子智能体记录保留，归属转为独立对话，源文件夹与 worktree 不变 |
| CW-73 | B-delete-project, S-delete-project, S-delete | 项目删除先停止运行再移除，停止失败时不移除项目；单条对话删除仍按 CHAT-15 拒绝并说明原因 |
| CW-74 | B-search, B-menu, E-closeout | 默认 10 个最近对话；有关键词时列出全部标题匹配 |
| CW-75 | S-title, S-title-secret, B-menu, E-closeout | 先显示第一条消息的标题，随后换成模型标题；手动改名后不再被覆盖 |
| CW-76 | S-title, S-title-secret, B-menu, E-closeout | 保留第一条消息生成的标题，对话照常进行 |
| CW-77 | B-branches, S-branches, S-worktree | 名称预填前缀；列表只有本地分支，当前分支在最前 |
| CW-78 | B-move, S-move, E-closeout | 都有“选择文件夹…”；仅有实际项目归属时显示“移出项目”，置顶不改变该条件 |
| CW-79 | B-move, S-move, E-closeout | 打开创建弹窗，成功后同一对话归属新项目，仍置顶，无副本或额外新 Session |
| CW-80 | B-move, S-move, E-closeout | 不提前改变原归属；已创建项目而移动失败时明确提示，不虚报成功 |
| CW-81 | B-move, S-move, E-closeout | 前者进入独立对话列表，后者留在置顶分类；均清空项目归属且工作目录、worktree 不变 |
| CW-82 | B-move, S-move, E-closeout | 不新增重复项目，不进入新对话页；将原对话移入已有目标并保留置顶状态 |
| CW-83 | B-menu, B-search, S-delete, S-rename | 所有前导图标槽为 14px、中心对齐，文字起点一致，斜图钉无旋转偏移 |
| CW-84 | B-new, B-project, B-move, S-first | 两者名称后都用弱化文字显示主要文件夹的目录名；名称不重复的项目不显示 |
| CW-85 | S-permissions | 读取不询问，写入按模式询问；会话的工作目录仍是原来的专属目录 |
| CW-86 | B-delete-project, S-delete-project, S-delete | 项目、会话归属和执行状态不变，焦点返回触发入口 |
| CW-87 | B-delete-project, S-delete-project, S-delete | 保留当前会话内容，归属显示对话；各列表与搜索同步移除项目引用 |
| CW-88 | E-closeout, E-plan, E-context, B-plan, S-compact | 权限模式右侧显示“计划”胶囊，上下文环按 CTX-01 至 CTX-04 显示；关闭胶囊或 `/plan off` 恢复 prior；自动压缩照常触发 |
| CW-89 | B-context；Pencil z5wvj示例算术核查 | 详情在环上方右对齐、无裁剪；hover 不直接打开，外部点击与 Escape 可关闭并返回入口焦点 |
| CW-90 | B-context；Pencil z5wvj示例算术核查 | 入口几何稳定，预警和阈值颜色清楚；五项示例合计 240K、24%，比例分母正确，不可用时不伪造用量 |
| CW-91 | B-composer, B-plan, B-new, E-plan | 胶囊在权限模式右侧，显示“计划”；hover 后灯泡切为圆形关闭按钮，背景变浅灰，尺寸和文字位置不变 |
| CW-92 | B-composer, B-plan, B-new, E-plan | 胶囊与分隔线移除，恢复 prior；草稿及其他输入配置不变，焦点回到编辑区 |
| CW-93 | B-composer, B-plan, B-new, E-plan | 权限按钮均无箭头，权限文字至分隔线 12px；请求批准使用手掌，帮我批准使用盾牌终端组合，普通模式图文为中性灰色 |
| CW-94 | B-composer, B-plan, B-new, E-plan | 胶囊右端圆弧完整，文字右侧有效留白至少 12px、内容不溢出；对话图标与文字可见字面垂直居中，hover 不跳动 |
| CW-95 | U-usage, S-context, S-compact, E-closeout | 五类按 CTX-03 归类，合计等于已用 Token；不出现指令文件、诊断与“含估算”标记；阈值与压缩触发和改动前一致 |

## 缺陷与回归

- 移动子菜单Escape关闭后指针仍停在触发项，迟到hover又打开子层；原生两次看到data-state由closed再open。只抑制这次指针停留期间的重开，移出/显式点击或键盘后恢复。修前失败，修后四来源原生与B-move14项通过，无焦点/定位断言放宽。
- 基准欢迎框774.398px而非768：新增精确断言先失败，欢迎页局部max768后绿；已有Session列轴不变。
- 继承33份原生夹具前置入口改为共享真实创建项目表单；plugins保留多选择队列。计划场景明确建既有Session，避免配置动作创建空Session；附件fixture用与realpath项目相同的规范路径，保留原有文件/草稿/计划断言。
- 新跨流程测试最初使用超过20字符的标题期望及错误`/entries`路径，均修正输入/合法协议路径，不改产品标题上限或放宽断言。

## 文档影响

| 变化 | 所属正文及消费者 | 动作 |
| --- | --- | --- |
| Project组织与固定cwd/移出后的Standalone | GLOSSARY、ADR0020、ADR索引、projects | 定义补充与当前实现证据；ADR用源码/测试独立链接，不依赖具体scratch |
| 工作台完整入口与欢迎页宽度 | workbench、docs/README | 增加跨功能Electron验证与宽度适用范围 |
| approved/实施/验证区分 | spec16.2/20.2、desktop-app/map/08 | 保留历史Answer，修正后续摘要与“均未实施”等过时声明 |

按文档生命周期从AGENTS→docs/README→正文读回；最终机械检查与逐项读回见票Comments。

## 结论与限制

本地源码/测试构建证据不表示真实模型API、生产签名发布包、CI、远端推送、PR、合并main、Windows/Linux或实际OS选择器/剪贴板/Finder通过。当前无CI工作流；测试未向子进程传入真实外部模型凭据。32份继承原生矩阵的修复/重验、最终机械检查和关闭状态见后续章节。

## 补充检查

当前归档设置、上下文警示对比度、双语字典入口由 `pnpm run test apps/desktop/src/renderer/features/settings/archived.browser.test.tsx apps/desktop/src/renderer/features/conversation/warning-text.browser.test.tsx packages/i18n/src/index.test.ts packages/i18n/src/domains.test.ts` 检查，退出0，4文件21用例通过。


## 项目与会话原生验收补充

`pnpm run test apps/desktop/e2e/projects-migration.e2e.test.ts apps/desktop/e2e/create-project.e2e.test.ts apps/desktop/e2e/project-edit.e2e.test.ts apps/desktop/e2e/session-move.e2e.test.ts apps/desktop/e2e/first-send.e2e.test.ts apps/desktop/e2e/branches.e2e.test.ts apps/desktop/e2e/destination.e2e.test.ts apps/desktop/e2e/titles.e2e.test.ts apps/desktop/e2e/session-archive.e2e.test.ts apps/desktop/e2e/session-delete.e2e.test.ts apps/desktop/e2e/model-picker.e2e.test.ts apps/desktop/e2e/session-pinning.e2e.test.ts apps/desktop/e2e/sidebar-lists.e2e.test.ts`：当前519f816源码经globalSetup重新打包测试产物，退出0，13文件16用例通过。补足真实旧库升级、创建/编辑/移动、独立与项目首次发送、分支、标题、归档恢复/删除、模型、置顶与列表重启，不以这些源码测试代替原生结果。

## 文档消费者与读回

搜索包含隐藏目录的 `0020.*partial`、`项目删除仍待实施`、`均未实施`、`生产界面尚未实施`、`本轮交付为画布 UI`、运行时统计尚未实施等结论：当前ADR0020、ADR索引、规格intro/CTX04/15/16.2/20.2、desktop-app/map与08均已同步。01/06/07/12已关闭票的partial是当时历史交付记录，保留；其他ADR的历史分阶段实施记录与本任务无关，保留，不把历史条目改写为当前结论。

从AGENTS→docs/README→projects/workbench→GLOSSARY/ADR索引/0020～0022读回：路径与引用、语义同步、归属与权威、引用方向、生命周期、当前入口、新会话读入、历史保留八项均通过。没有新正式目录，没有改变历史批准主体或ADR局部替代范围，0021/0022仍为implemented；正式正文独立引用代码和测试。规格和tracker继续指向本任务证据，正式正文无具体scratch反向依赖。


## 继承原生矩阵的失败与修复

只读隔离快照`7c2fde5a`：A组16文件31用例，22通过/8失败/1真实模型凭据用例跳过；B组16文件26用例，20通过/6失败。合计32文件57用例，42通过/14失败/1跳过；该运行明确是失败，未作为最终通过证据。失败为settings/commands/provider-delete的标题请求计数、goal的Session费用包含title、open-session/schedules/subagents/subagent-notifications的faux标题匹配抢占普通回复、chat首条流式观察，以及permissions/references-drafts/teams的旧夹具假设。

UI夹具修复`aa647da0`，仅改3份测试，无产品改动或放宽断言：

- permissions先等实际首条Coko回复，确保已有Session已建立后再测四步Shift+Tab；每步等待预期模式，保留焦点、full-access告警、协议模式与无审批写入断言。
- references-drafts的临时根与选择文件使用realpath；第二条Session从项目的新对话入口创建，保留README所在Workspace。保留picker/preload/粘贴/协议请求/切换重启/清空/损坏JSON断言。
- teams在单次Escape返回设置前，等已经closed的portalled Tooltip退出动画卸载，避免它的DismissableLayer消费该按键。保留团队状态、审批、运行计数、真实文件、成员只读、明暗对比及键盘断言。

`COKO_E2E_BACKGROUND=1 pnpm exec vitest run --project desktop-e2e apps/desktop/e2e/permissions.e2e.test.ts apps/desktop/e2e/references-drafts.e2e.test.ts apps/desktop/e2e/teams.e2e.test.ts --reporter=default`：修复前3文件7用例4失败/3通过；修复后同命令7/7通过，当前源码globalSetup重建Electron测试产物。该局部修复通过不替代合并后的32文件矩阵。


## 联合提交的最终原生矩阵

两个新只读验证者在干净的精确提交`c1f59f3b9f03820206c128c63614e27c3c2b16df`分别运行16份分组，构建前后确认SHA及工作区未变；每组一次调用，无重试、断言修改或新增超时。globalSetup各自重新执行测试构建package。A为16文件30通过/1跳过/0失败，B为16文件26通过/0跳过/0失败；合计32文件56通过/1跳过/0失败。唯一跳过是settings中的真实DeepSeek凭据场景，`DEEPSEEK_API_KEY`未配置，明确未验证真实模型。

精确可复现选择：

```sh
COKO_E2E_BACKGROUND=1 pnpm exec vitest run --project desktop-e2e apps/desktop/e2e/approvals.e2e.test.ts apps/desktop/e2e/commands.e2e.test.ts apps/desktop/e2e/config.e2e.test.ts apps/desktop/e2e/dock.e2e.test.ts apps/desktop/e2e/handoff.e2e.test.ts apps/desktop/e2e/jobs.e2e.test.ts apps/desktop/e2e/mcp-browser.e2e.test.ts apps/desktop/e2e/memory.e2e.test.ts apps/desktop/e2e/permissions.e2e.test.ts apps/desktop/e2e/provider-delete.e2e.test.ts apps/desktop/e2e/references-drafts.e2e.test.ts apps/desktop/e2e/ripgrep-logging.e2e.test.ts apps/desktop/e2e/sandbox.e2e.test.ts apps/desktop/e2e/settings.e2e.test.ts apps/desktop/e2e/subagent-notifications.e2e.test.ts apps/desktop/e2e/teams.e2e.test.ts
COKO_E2E_BACKGROUND=1 pnpm exec vitest run --project desktop-e2e apps/desktop/e2e/chat.e2e.test.ts apps/desktop/e2e/compaction.e2e.test.ts apps/desktop/e2e/context.e2e.test.ts apps/desktop/e2e/goal.e2e.test.ts apps/desktop/e2e/hooks.e2e.test.ts apps/desktop/e2e/lsp.e2e.test.ts apps/desktop/e2e/mcp.e2e.test.ts apps/desktop/e2e/open-session.e2e.test.ts apps/desktop/e2e/plugins.e2e.test.ts apps/desktop/e2e/recovery.e2e.test.ts apps/desktop/e2e/rewind.e2e.test.ts apps/desktop/e2e/run-control.e2e.test.ts apps/desktop/e2e/schedules.e2e.test.ts apps/desktop/e2e/skills.e2e.test.ts apps/desktop/e2e/subagents.e2e.test.ts apps/desktop/e2e/trace.e2e.test.ts
```

本机保留`/tmp/coko-native-final-results-a.md`、`/tmp/coko-native-final-results-b.md`、两组`/tmp/coko-native-final-{a,b}.{log,json}`及原失败报告；逐文件选择与分组文件表一致，无零选中。当前收尾分支在同一联合源码另跑E-closeout/plan/context/workbench：4文件9通过；当前Sidecar/存储/迁移/Finder注入24文件163通过。

## 标题与首次发送流式修复

联合提交包含`6babb1b4`：faux标题请求只消费显式`match: COKO_SESSION_TITLE`，不消费正文中同词的普通回复；所有实际标题调用仍写入requestLog/requestDetailsLog。命令/凭据用例分别断言实际title和普通请求；Goal额外显式15 tokens标题费用，Session合计包含title，Run和Goal原断言保留。

首次发送保留接受Run身份，并以每块offset0及连续UTF-16偏移证明完整前缀；不同Run、迟到缺头和偏移缺口等待完整assistant条目。正常中途打开和重连保留安全行为，Secret流脱敏器按实际发出的替换后文本重算偏移。新增晚订阅、缺口、多块、emoji、旧Run及脱敏偏移回归均先红后绿；当前原生chat仍断言首条回复至少两份不同partial、Markdown、工具卡、实际文件和会话身份，没有放宽流式断言。

修复者最终聚焦门禁：`pnpm exec vitest run apps/desktop/src/renderer/stores/chat-store*.test.ts packages/agent/src/engine/runtime.test.ts packages/protocol/src/ws.test.ts packages/protocol/src/readme.test.ts apps/server/src/adapters/faux.test.ts apps/server/src/application/secret-redaction.test.ts`，15文件101通过；标题与秘密Sidecar2文件12通过。最初协议README完整性2失败后按真实API_ROUTES/ErrorCode补表，未修改完整性守卫。协议README与workbench当前正文补充可选图片提交、操作原因及偏移的安全边界，最终读回和机械检查另记。


## 最后分支焦点回归

联合`c1f59f3b`上的17文件Browser先两次为205通过/1失败，均在`branches.browser.test.tsx`的异步检出后`toHaveFocus`断言，最终焦点为BODY。之前206通过属于先前快照；不能覆盖这两次失败。隔离原例、受控checkout完成点、8次诊断重复以及加日志的整组分别通过，均只作诊断，不作为修复证明；所有临时重复/日志已撤销，最终仍为原4个分支用例/全组206个。

因果回归沿用原Browser seam：暂停实际CSS退出动画，等父触发项焦点返回，以CDP真实鼠标移动经过仍在退出的旧radio，再完成动画，保留原焦点断言。修复前稳定重现旧radio重新获得焦点、卸载后BODY。Radix子层退出时仍挂载且不执行默认焦点恢复；普通pointer utility被DismissableLayer的inline auto覆盖。加入important guard后，还捕获到叠加布局中从trigger移入portal子层触发横向grace失配，父menu被聚焦并过早关闭子层，原本退出中的内容仍可被点击掩盖了该路径。

最终仅`ProjectGitMenu`局部修复：直接移入自身portal子层的pointerleave保留上下文；其他父项或外部目标仍走Radix原处理。`data-[state=closed]:pointer-events-none!`使已关闭子层退出期间不接收指针，并在回归中断言实际computed pointerEvents=none。保留全部检出、dirty/busy、失败、base branch与键盘断言；补普通离开到父worktree项仍关闭子层且保留父菜单。未修改共享UI/全局CSS、超时、守卫或断言标准。

32份native矩阵保留精确`c1f59f3b`结果；最终新增产品delta只在分支配置子菜单命中/离开，不修改这32份矩阵所测的数据、权限、Run/stream等源代码。该delta的直接消费者另用当前构建的branches、first-send-worktree、session-move及E-closeout验证，最终结果在下行/票Comments记录，不将旧矩阵改称新的整仓运行。


## 最终结果与读回

- 上述分支局部修复完成后，按原始17文件完整命令运行，退出0，17文件206用例通过（含原4个分支用例，新增确定性时序步骤与原断言并存）。普通离开/键盘/移到项目/搜索/菜单消费者全部在此组。日志本机`/tmp/cw23-browser-verified.log`。调试重复、加日志的绿灯不替代本次无诊断运行，临时DEBUG代码已全部移除。
- `pnpm run test apps/desktop/e2e/conversation-workbench-closeout.e2e.test.ts apps/desktop/e2e/branches.e2e.test.ts apps/desktop/e2e/first-send-worktree.e2e.test.ts apps/desktop/e2e/session-move.e2e.test.ts`：按最终源码重新package，4文件9用例通过，退出0。E-closeout包含全部必需跨票、画布关键几何、明暗窄窗口reduce与CW66/88联合链路；直接分支/工作树/移动入口通过。
- `pnpm run typecheck`、两份分支TS/TSX的`oxlint`与格式整理、最终固定基线`git diff 44b9296 --check`均退出0；Impeccable对最终ProjectGitMenu运行一次返回`[]`。最终`pnpm run check:docs`退出0，检查249个Markdown文件、0问题。
- `pnpm run test packages/protocol/src/readme.test.ts packages/protocol/src/ws.test.ts`：2文件6用例通过。补入的图片提交、项目/Session操作、归档/Git错误和UTF-16脱敏偏移与真实schema/registry一致；没有更改守卫。AGENTS→docs/README→workbench/projects→ADR索引/0020～0022/GLOSSARY，以及所链接protocol README已读回；八项生命周期检查通过，正式正文不依赖具体scratch。0021已实施边界的旧将来时语句同步为当前实施表述，保留决定本义。
- 所有95条CW验收均有本记录中的具体测试或实际人工观测。票23关闭只表示本地实施与既定验收已完成，后续独立评审、集成分支合入、main合并、推送、PR与发布仍分别报告。

保留限制：真实外部模型因无凭据跳过，实际OS选择器/剪贴板/Finder不在已证明范围；Electron为测试构建而非发布签名产物；无CI工作流、未进行Windows/Linux或远端发布验证。历史失败均保留并与最终有效通过区分。
