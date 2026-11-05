# 07: 诊断页的原始数据

**What to build:** 诊断页的“原始数据”可以完整使用。

- **行与列。** 表格每行是一条已加载的 Session Entry。列依次为：序号、类型（message 条目附上角色；表头的筛选见 08）、Run、UTC 毫秒时间和摘要。
- **分组。** 同一 Run 的条目组成一组，`run_start` 作为吸顶组头。不属于任何 Run 的条目，以及缺少组头的条目，作为根行。seq 的空缺不补造。
- **工具栏。** 显示行数和“跟踪最新”，不提供“加载更早”；瞄准按钮见 11。
- **跟随。** 表格离底部 40px 以内时跟随新行。向上滚动或手动折叠后暂停跟随，被点击的组头保持在原来的屏幕位置。
- **详情面板。** 选中行后，在表格下方打开详情面板：默认占 40% 高度，可以拖动，也可以用键盘在 15%～80% 之间调整，切换记录时保留高度。内容是默认全部展开、可以逐层收起的 JSON 树。记录无法序列化时，只在面板内报错；记录已经移除时，给出提示。
- **数据范围。** 诊断页只读取界面已经收到的条目，沿用现有的脱敏，不提供导出。
- **移植。** 移植 DeepSeek Harness 中不依赖其数据类型的表格模型、吸顶与跟随布局、摘要格式及其单测，按 Coko 的命名、注释与测试约定改写。按技术栈选定的版本安装 `@tanstack/react-virtual`。
- **第三方声明。** 新增第三方声明，保留 DeepSeek Harness 的版权行与完整的 MIT 许可文本，随安装包分发。

**规格场景:** [spec](../spec.md) 的 AC-19、22、23、28、30；对应 INS-01—05、INS-08、INS-11、INS-12，以及 SEC-01、LIC-01。

**设计依据:** [design](../design.md) 的“诊断功能模块”与“第三方声明”两个模块；备选方案中的“虚拟列表”：已经确认 `anchorTo` 和 `scrollEndThreshold` 在 virtual-core 3.18.0 中可用。

**文档影响:** 新增会话数据诊断的当前行为说明，按文档体系确定归属并加入导航；TECH_STACK 标记 `@tanstack/react-virtual` 已经安装；delivery 记录第三方声明的打包方式。

**Blocked by:** 06 — 开发者开关与诊断页外壳

**Status:** ready-for-agent

**Closed:** true

- [x] 行、列、分组、吸顶组头和 seq 空缺的处理符合 INS-03、11、12。（AC-19）
- [x] 跟随、暂停与“跟踪最新”符合 INS-04、05。（AC-22）
- [x] 详情面板的高度调整、JSON 树、序列化错误和已移除提示符合 INS-08、11。（AC-23）
- [x] 用户自己输入的文本照原样显示，登记过的 Secret 显示为替换后的标记，与主时间线一致。诊断页不发出新的数据请求，也没有导出。（AC-28）
- [x] 移植的纯逻辑连同单测一起移植。DeepSeek Harness 中运行在 jsdom 里的组件测试，改写为 Browser Mode 测试。真实 App 的 Browser Mode 覆盖以上场景，包括 390px 宽度、明暗主题和 zh/en。
- [ ] 安装包中有第三方声明，内容包含版权行与完整的许可文本。（AC-30）
- [x] 按测试约定运行最小相关测试集与类型检查，同步上述文档；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户回复“全部采用推荐”，确认 12 张票及其阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

### 2026-11-05 实施完成

- 独立 worktree `/tmp/coko-right-sidebar-agents/ticket-07`、分支 `codex/right-sidebar-07`，以集成提交 `19578a20` 为基线；最终合并最新集成分支报告 already up to date。未使用或复用其他子代理。
- `raw-model.ts` 只读取当前 Session 已加载的真实条目，按 seq 排序；真实 run_start 占组的位置，组内按 seq，缺失组头和非 Run 条目保持根行，seq 空缺不补造。Run 编号按已加载条目中身份首次出现从 1 起；完整条目进入 JSON 详情，payload 生成有界摘要。
- 从 DeepSeek Harness `8bd073392eef6f54e921a093b95076248eb08cbb` 移植独立的层级、固定行高布局、摘要与安全 JSON 逻辑和对应纯测试，去掉其 ObservableSnapshot、Node/Location 及分页依赖，事件摘要改用 Coko assistant_delta。来源版权注释与完整 MIT 正文保留于根 `THIRD_PARTY_NOTICES.md`。
- 新增 `DiagnosticTable`：真实 Tanstack 虚拟化、30px 表头／行、祖先吸顶、40px 尾部跟随、上滚和折叠暂停、折叠组头锚定、数据末尾留白与“跟踪最新”；`RecordDetails` 默认 40%，真实指针拖动与键盘调整范围 15%～80%，换记录保留高度。JSON 默认全展开、逐层收起，循环、bigint、失败与移除状态均有处理；序列化错误不暴露异常详情或关闭表格。
- 首个原始模型与真实 App 表格 tracer 均先观察缺失模块／缺失表格失败后通过。另补独立 red→green：参考摘要的 primitive 路径会超过 240 字符（301 实际对 240 预期），统一在公开格式化出口截断后通过。真实 App 验证 100 行虚拟化与吸顶坐标、手动折叠锚定／尾部留白、进度到达后的暂停、完整 JSON 展开收起、默认高度、真实 Chromium 拖动及键盘限幅、错误恢复，以及 390px en/light、zh/dark 的归档只读 Session。
- 迁移 `developer.browser.test.tsx` 首个开发者场景的旧“无记录”断言：该场景的默认 s-1 fixture 本就有条目，原始数据交付后应断言表格存在；没有保留空数据来满足旧外壳期待。其他开发者测试保持。
- 精确安装 `@tanstack/react-virtual@3.14.14`，实际锁文件和已安装 `@tanstack/virtual-core@3.18.0` 的 d.ts 均验证 `anchorTo`、`scrollEndThreshold` 与 `scrollToEnd` 存在，组件直接使用类型，无兼容性强转。Browser Mode optimizeDeps 加入实际导入，避免首次运行重载页面。

### 验证结果与边界

- 最终命令 `rtk pnpm run test apps/desktop/src/renderer/features/session-diagnostics apps/desktop/src/renderer/features/settings/developer.browser.test.tsx apps/desktop/src/renderer/app/app.browser.test.tsx packages/ui/src/guards/style-guard.test.ts scripts/browser-deps.test.ts packages/i18n/src/domains.test.ts packages/i18n/src/index.test.ts`：12 文件、146 项全部通过、0 跳过，退出 0。包含真实 App Browser Mode、30 项诊断纯测试、40 项样式守卫与 i18n／依赖配置检查。
- `rtk pnpm run typecheck`、`rtk pnpm run build:desktop`、`rtk pnpm install --frozen-lockfile`、定向 `rtk pnpm exec oxlint` 与 `rtk pnpm exec oxfmt --check` 均退出 0；构建保留既有大 chunk 提示，不将其称作发布包验证。`rtk git diff --check` 通过。
- `rtk pnpm run check:docs`：344 Markdown 文件、0 问题，退出 0。
- Forge extraResource 已加入根声明文件，新增 `apps/desktop/e2e/third-party-notices.e2e.test.ts` 对当前包 Resources 声明逐字比较并核对完整许可的关键段。按集成安排，本票未执行该 Electron／产物 E2E、静默 agent-browser 或原生层验证；实际随包声明验收框保留未勾选，交 12 批量构建后执行。本票不宣称签名发布、真实模型或原生鼠标／红绿灯已经验证。真实 worktree 移除后的诊断交互亦留集成核对；归档只读场景已通过真实 App 测试。
- 未实现后续票的筛选、实时增量、对话分组、定位或瞄准；展示形式中的对话分组保留空外壳，由 10 接入。

### 后续接口与文件归属

- `table-model.ts` 是无 React 的共享输入：`DiagnosticRow {key,parent?,depth,disclosure?}`、`DiagnosticRecord {type,identity,location,time?,value,summary?,collapsedSummary?}`、`DiagnosticModel {rows,records}`。`raw-model.ts` 的 `buildRawRecords(entries)` 返回这一输入，原始行 key 为 `entry:<seq>`。
- 08 在 `diagnostic-table.tsx` 接入筛选，候选读取完整 model.rows/records，确认后重置选中／折叠／留白；筛选上下文必须忽略手动折叠，强制展开。
- 09 在 raw-model 侧扩展实时行，保持 chat-store 无新增缓存；表格的 disclosure 生命周期、collapsedSummary 和多层吸顶已可用。
- 10 接入真实主时间线投影及对象树；`RecordDetails` 的 children 路径跳过 JSON 序列化，可放运行时对象树而不执行 getter。当前表格只拥有本地交互；后续引用定位可扩展其公开输入。SessionDiagnostics 用 Session+展示形式 key 重置视图状态。

### 文档影响与读回

| 变化 | 所属正文 | 动作 |
| --- | --- | --- |
| 已加载条目、Run 分组、虚拟化、锚定、JSON 与数据范围 | `docs/subsystems/session-diagnostics.md` | 新增当前契约，链接源码与真实测试 |
| 导航与开发者外壳的已失效摘要 | `docs/README.md`、`docs/subsystems/workbench.md` | 加入新正文入口，替换“仅外壳”的当前描述 |
| 虚拟化的实际安装版本 | `docs/TECH_STACK.md` | 标记已安装与实际 core 版本 |
| 完整许可与随包路径 | `THIRD_PARTY_NOTICES.md`、`docs/subsystems/delivery.md` | 保留完整上游 MIT，写入 Forge Resources 机制与产物测试入口 |
| 30px 表格、列宽、吸顶底色与详情几何 | `docs/tech-stack/ui-design-system.md` | 原位补充，不新增全局几何或色彩 token |

从 AGENTS → docs/README → 当前诊断正文、workbench、delivery，以及专项导航 → UI 设计系统和 TECH_STACK 读回。搜索“会话数据诊断”“react-virtual”“THIRD_PARTY_NOTICES”“当前页面外壳”覆盖 docs、.agents、当前任务目录：旧外壳正文已替换；已关闭 06 与 spec/design 的阶段历史保留原意。路径、语义同步、职责与权威、引用方向、生命周期、当前入口、新会话读入和历史保留均通过；没有新增目录类别或替代／归档链。正式正文不依赖具体任务材料，后续票的任务入口仍有效。实际包装与原生限制见上。
