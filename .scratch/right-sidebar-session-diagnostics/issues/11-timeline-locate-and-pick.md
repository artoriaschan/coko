# 11: 定位到时间线与瞄准

**What to build:**

- **时间线上的身份。** 主时间线的行、过程分组和工具卡暴露诊断用的身份属性：时间线行身份、过程分组 id、Run id、条目 seq 和工具调用 id。它们与对话分组发布的身份是同一个值。时间线另外提供“展开到某个身份”的入口，通过现有的展开状态展开折叠层，不改 DOM 结构。
- **定位。** 在原始数据或对话分组中选中行，或者沿引用跳转时，定位到主区时间线：展开目标所在的折叠层，平滑滚动到目标，然后闪烁一次。高亮画在 body 层的覆盖层上。
  - 目标本来就可见时，只闪烁，不滚动。
  - 系统要求减少动态效果时，立即滚动，不闪烁。
  - 找不到目标时，依次尝试同一 Run 中附近的内容、其他已加载 Run 中的内容；都没有时，高亮当前可见的时间线列，不移动它。
  - 定位不切换页面或 Session。
- **瞄准。** 工具栏的瞄准按钮在时间线上覆盖一层透明蒙层：
  - 悬停时预览；点击后选中当前展示形式中对应的记录，展开它的表格祖先，并打开详情。底下的控件不会被激活，滚轮操作转给时间线。
  - 没有匹配的记录时，给出提示并继续等待选取。
  - 以下情况取消选取：按 Esc、再次点击瞄准按钮、切换展示形式或 Session、隐藏或关闭诊断页、窗口失焦。
  - 同一时刻只有一个选取器有效。瞄准的目标被筛选排除时，先清除筛选。
- **匹配依据。** 只依据身份属性，不比较文本。

**规格场景:** [spec](../spec.md) 的 AC-26、27；AC-24 中“序号与 DOM 身份属性一致”；AC-25 中“同时定位到时间线”。对应 INS-09、10，以及 INS-06、15、16 中与定位相关的部分。

**设计依据:** [design](../design.md) 的“时间线定位接口”模块，以及“对话分组与定位”中的定位与瞄准。“来源与约束”中“过程分组的展开状态可以从时间线外部请求展开”的假设，由本票核对。

**文档影响:** workbench 中时间线的身份属性与展开入口；会话数据诊断当前行为说明中的定位与瞄准。

**Blocked by:** 07 — 诊断页的原始数据；10 — 诊断页的对话分组（对话分组中的行要用投影身份定位）

**Status:** ready-for-agent

**Closed:** true

- [x] 核对“过程分组的展开状态可以从时间线外部请求展开”这个假设，结论和依据记入 Comments。
- [x] 时间线 DOM 上的身份属性与对话分组的序号一致；主时间线现有的交互与测试不受影响。（AC-24）
- [x] 定位符合 INS-09：收起的过程分组被展开，平滑滚动并闪烁；目标本来可见时只闪烁；找不到时按顺序回退；减少动态效果时立即滚动，不闪烁。（AC-26）
- [x] 沿引用跳转时，同时定位到时间线。（AC-25）
- [x] 瞄准符合 INS-10：能反查记录，不激活底下的控件，滚轮转给时间线，没有匹配时给出提示，取消条件与单实例都成立；目标被筛选排除时，先清除筛选。（AC-27）
- [x] 匹配与回退规则有单测。真实 App 的 Browser Mode 覆盖以上场景，包括减少动态效果。
- [x] 按测试约定运行最小相关测试集与类型检查，同步上述文档；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户回复“全部采用推荐”，确认 12 张票及其阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实施：核对原假设不成立；原先只有本地 Run choices、`useProcessDisclosure` 和 reset epoch，没有外部展开 API。现在主时间线拥有 `timeline-reveal.tsx` 请求／订阅范围，沿用 Run、组与成员 setter；外部打开不增加 epoch。React provider 不增加 DOM，投影身份和原节点 key 不重算；同 Session 的回退历史继承 scope，右栏子 Session 不注册。原生 rewound、command／compaction details 沿路径打开。主消息滚动区标记 Session，使空投影也能提示可见列。
- 匹配按精确展示身份、toolCallId、过程组与来源 seq；工具结果保留真实调用 id，进度按原捕获组的 Run／内容块坐标读取已发布身份。找不到时按同 Run 最近来源、其他已加载内容、可见列回退，不切页面或 Session。定位只等待目标及其路径的布局；不可呈现候选继续回退，不被无关组动画或 live 更新拖住。内外滚动分层，显式揭示阶段释放旧阅读意图并接纳新锚点；body 高亮按组、主消息区与视口裁剪，reduced-motion 立即滚动且无闪烁。
- 瞄准是模块范围单实例，只有可见当前主区可拾取；透明 body 蒙层拦截 pointer／mouse 按钮、click／auxclick／dblclick／contextmenu，实际 pointer 点击与原生事件取消断言验证底层控件未激活。悬停预览离开即清除；滚轮优先消耗内层，余量交外层。命中从表格公共请求展开祖先、按需清筛选、选中并建立新面包屑。未命中给出 zh/en 提示继续等待；Esc、toggle、blur、format、hide、close、Session 和 fullscreen／覆盖均取消并清理监听器、RAF 与蒙层。
- TDD：身份模块缺失时先得到导入失败；“精确展示身份优先共享来源 seq”用例先实际失败（text:a 而非 tool:call），调整优先级后通过。真实 App 的空投影最终提示用例先失败，发现空 Session 不挂 TimelineView；在已有主消息滚动根增加 Session 所有者属性后通过。测试仅替代 fixture 网络／模型与真实 Chromium 媒体偏好，store、投影、状态和几何均为实际 App。
- 旧用例迁移：分组懒枚举用例原先选择未完成 read 后只展开诊断树；定位现在按规格自动展开工具，未完成 read 的既有 GenericBody 会显示 JSON 输入。fixture 改为完成的 read（真实来源结果，后续 seq 从 3 改为 4），由文件专用正文渲染；保留全部 getter、枚举次数、分页、循环、错误与缓存断言，避免把工具 JSON 预览计为诊断枚举。本票没有改工具输入序列化行为。

文档影响：

| 变化 | 所属正文／入口 | 动作与验证 |
| --- | --- | --- |
| 主区身份与外部展开、阅读位置 | `docs/subsystems/workbench.md` | 补作用范围与原状态／epoch 保留，链接诊断正文 |
| 定位、匹配、回退、拾取与取消 | `docs/subsystems/session-diagnostics.md`、`docs/README.md` | 原地补当前行为和测试入口，移除“另行接入”的旧结论；正式文档不依赖任务材料 |
| 假设结果 | `design.md` | 保留原假设语境并记录实际缺口及实现边界，未改变批准状态 |

验证记录（命令均在本票独立 worktree，经 rtk 运行）：

- `pnpm install --frozen-lockfile`：exit 0，使用本 worktree 依赖，没有共享可写 node_modules。
- `pnpm run test apps/desktop/src/renderer/features/session-diagnostics/timeline-matching.test.ts apps/desktop/src/renderer/features/conversation/process-groups.test.ts apps/desktop/src/renderer/features/conversation/timeline.test.ts packages/i18n/src/domains.test.ts packages/ui/src/guards/style-guard.test.ts`：5 文件，62/62，exit 0。另行 `progress-model.test.ts` 与 matcher／style guard 的组合为 3 文件 48/48。
- `pnpm run test apps/desktop/src/renderer/features/session-diagnostics/timeline-navigation.browser.test.tsx apps/desktop/src/renderer/features/conversation/process-groups.browser.test.tsx apps/desktop/src/renderer/features/conversation/reading-position.browser.test.tsx apps/desktop/src/renderer/features/conversation/integrated-detail.browser.test.tsx apps/desktop/src/renderer/features/conversation/history.browser.test.tsx apps/desktop/src/renderer/features/conversation/collaboration.browser.test.tsx`：6 文件，78/78，exit 0，含新增 10 项实际 App 定位／拾取场景与既有过程、阅读、联合详情、历史、协作回归。
- 此前包含 raw-data、live-progress、grouping 的相关组合为 9 文件 92/92，exit 0；新增“同 Run／其他 Run”实际 fallback 场景后，定位文件共 10 项；该新增用例单独先跑 1/1（其余 9 项按测试名未选中），随后在上述 6 文件组合全选 10/10 通过。最终诊断与子 Session 消费者组合结果见下条。
- `pnpm run test apps/desktop/src/renderer/features/session-diagnostics/timeline-navigation.browser.test.tsx apps/desktop/src/renderer/features/session-diagnostics/grouping.browser.test.tsx apps/desktop/src/renderer/features/right-panel/agents-tab.browser.test.tsx apps/desktop/src/renderer/features/right-panel/team-tab.browser.test.tsx`：最终 4 文件 23/23，exit 0；含完整定位 10 项、对象树／引用 7 项和右栏子 Session 消费者。
- `pnpm run typecheck`：exit 0；受影响模块 `pnpm exec oxlint`：exit 0。`pnpm run check:docs`：344 个 Markdown，0 问题，exit 0。没有 `.github/workflows`，未宣称 CI 已运行。
- 从 AGENTS → docs/README → workbench 与 session-diagnostics 正文读回：语义同步、归属与权威、引用方向、当前入口、新会话独立读取、历史保留均通过；本次没有移动／弃用文档，不产生替代链。文档仍将整体批准与本票实施状态分开。
- `git merge codex/right-sidebar-session-diagnostics-integration`：Already up to date（集成基线 `98e95bef`）。本票只提交独立分支，不推送／修改 main。
- 本票未运行 Electron、agent-browser、安装包、真实指针／原生层或真实模型验收；按实施合同由 12 集中执行桌面与产物场景。Browser Mode 的真实 Chromium 交互与 HTML details 不等于 Electron 原生验收。


### 2026-11-05 第 12 票集成回执

[最终证据](../evidence/integrated-acceptance.md) 已实际运行相关真实 Electron、App Browser Mode 与当前产物验证。E1 为 13 文件17项，E2 为最终表头补丁后的3文件3项，均通过且0跳过；B1为46文件459项、B2为原始诊断7项及额外6文件76项通过。上文“本票未运行”保留为当时的历史；本回执补齐原生/资源执行证据，不将源码或 Browser Mode 冒充原生验收。03 的旧 IME组合信号本次未复现；初始新不确定性与真实鼠标/红绿灯/窗口拖拽的后台限制均保留在证据中。
