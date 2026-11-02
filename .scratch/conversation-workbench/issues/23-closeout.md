# 23: 收尾

**What to build:** 01 至 22 合入后，完成跨票的验证与文档收尾，使规格的验收场景都有对应的证据。

- 跨票的 Electron E2E：创建项目后在其中首次发送，列表、模型标题与归属随之更新（13、12、18）；只发图片后，上下文详情的“提示词”包含图片的估算（19、04）；归档的对话不出现在搜索中（10、22）；会话菜单最终只有重命名、置顶 / 取消置顶、归档、移到项目、删除对话五项（CW-23）。
- 逐条核对横切的验收：键盘、Tooltip 与焦点（CW-42），长列表、长名称、窗口边缘与窄窗口（CW-43），浅色与深色主题及减少动态效果（CW-44），截图、示例与 fixture 的脱敏（CW-45）；对照画布人工核对 13.1 的关键尺寸，在 Comments 记录核对的画面与结果。
- 文档：ADR 0020 的 implementation 改为 implemented 并链接各票的证据（ADR 0021、0022 由 21、15 修改），ADR 索引同步；核对 GLOSSARY 中 Project、Workspace 与 Standalone Session 的定义与实现一致；projects.md、workbench.md 与 docs/README 的入口完整；在规格 16.2 与 20.2 标注实施状态，同步地图与决策票 08 的摘要。
- 按 coko-verify 选择并运行受影响范围的检查，按测试约定区分本地、CI、合并与发布状态报告。

**User stories:** 58、59、60，以及其余故事的跨票验证

**Blocked by:** 01 至 22

**Status:** ready-for-agent

- [x] 跨票 E2E 通过
- [x] 横切验收与画布核对记录在 Comments
- [x] 文档与 ADR 状态更新；`check:docs` 通过
- [x] 检查结果按测试约定报告


## Comments

### 2026-11-03 — 收尾验证进行中

- 在指定worktree的`codex/cw-23-closeout`从最新集成`44b9296`开始，依赖01～22均核对为已关闭并实际交付。使用tdd、coko-docs、coko-verify、domain-modeling与Impeccable；测试seam沿用规格18已批准的Browser、真实Sidecar与Electron，不增加确认步骤。CodeGraph明确返回本managed worktree未索引后改用直接源码，不重建索引。
- [收尾证据](../evidence/23-closeout.md) 已逐条列出CW-01～95的具体测试/人工观测与精确可复现命令，包含CW66/88同一已有Session中计划胶囊、上下文warning/五类与auto compaction、pill关闭和`/plan off`恢复prior的联合实际链路。必需四条Electron跨票链路已通过，未将旧票复选框当证明。
- 已读Pencil实际源稿与渲染：Y5Oqw双栏工作台、B1eglK/z5wvj上下文、zG8uB删除项目、Z0KqK删除对话、Y2uwiG Tooltip、nQAM6搜索。1440px宽实际Electron核对侧栏280（请求H1200被系统限制为viewportH1130，规格不固定真实窗口高度）、安全48、导航/行32、标题13/20、R28、欢迎框768×120、工具栏32、归属28+8间距=36；删除确认480×184/208、详情348×384/R16与top-end/8由源稿和当前Browser核对。搜索640×432/R28/p12、输入40、结果32/R8，21长标题内部滚动；Browser390px与真实最小520px窗口(主内容≥390)均可用。读回明暗、窄深色reduce、图片上下文与plan/context截图，无操作裁断。中性示例及240K/24%五类算术已核对，细项与本机截图位置见证据。
- 红绿：原生移动子菜单Escape后因迟到hover重新打开，先两次失败，再局部修复停留指针的重开抑制，最终四来源菜单五项/焦点及既有B-move14项通过；精确欢迎框宽度先测774.398px失败，再仅欢迎页max768后通过，保留已有Session原宽度轴。错误测试标题超过20字符、错误`/entries`路径仅修正输入和合法协议路径，不放宽产品断言。
- 当前通过：17文件206Browser；宽度修复后相关3文件54；当前重建Electron的closeout/plan/context/workbench4文件9用例；当前Sidecar/存储/迁移/宿主注入24文件163用例；归档设置/上下文对比度/双语4文件21用例。`pnpm run typecheck`、Impeccable目标detector(`[]`)、`pnpm run check:docs`(249 Markdown/0问题)通过。完整命令见证据，最终机械检查随合并后的范围重验。
- 继承原生夹具仍使用已移除“添加工作区”入口：33份前置改用共享当前项目表单，保留原有断言；plugins保留队列，plan明确已有Session和规范文件路径。另有32份继承native矩阵在7c2fde5a只读隔离运行，发现标题匹配/用量/旧交互假设失败，正在由独立修复分支处理；本票此时不标Closed，不把部分通过表述全通过。
- 文档：ADR0020及索引implemented，以源码和各切片测试保存证据，0021/0022 implemented保持；GLOSSARY明确移出后的独立会话沿用原cwd；projects/workbench/README补当前验证入口与欢迎宽度适用范围；规格intro/CTX04/15/16.2/20.2、desktop-app/map和08后续摘要同步当前实施状态，同时保留历史Answer。正式正文不反向依赖具体scratch。

- 补充当前构建原生验收：`pnpm run test`显式选择projects-migration/create-project/project-edit/session-move/first-send/branches/destination/titles/session-archive/session-delete/model-picker/session-pinning/sidebar-lists的13个e2e完整路径（见证据命令），退出0、16用例通过。
- 已从AGENTS→docs/README→projects/workbench→GLOSSARY/ADR索引/0020～0022独立读回；生命周期八项（路径引用、语义、归属权威、引用方向、生命周期、当前入口、新会话读入、历史保留）通过。消费者搜索中旧01/06/07/12票的partial为历史交付事实予以保留，其他当前摘要已迁移，无正式反向scratch依赖。


### 最终联合验收与关闭

- 已合入最新集成`6babb1b4`形成`c1f59f3b`，解决faux标题匹配抢占、实际请求日志/费用计数，以及首条流式回复的完整前缀和脱敏偏移安全问题。源码/对手回归15文件101通过，协议README完整性2文件6通过；正式workbench/protocol说明已同步。
- 两个新只读验证者在精确干净`c1f59f3b`各重建测试产物并分别跑16份继承native文件，一次运行无重试：A为30通过/1跳过，B为26通过/0跳过；合计32文件56通过/1跳过/0失败。唯一跳过为无`DEEPSEEK_API_KEY`的真实模型用例，不计为通过。分组完整路径、旧失败和日志/报告位置已保存到[收尾证据](../evidence/23-closeout.md)。
- 当前核心24文件163、收尾/plan/context/workbench原生4文件9均通过。随后Browser两次205/206暴露分支子层退出焦点问题，未以隔离或加日志通过掩盖。确定性CSS动画暂停+CDP鼠标回归先红，确认旧radio在退出中夺回焦点后卸载为BODY；同时trace确认叠加子层进入路径被横向grace误关。最终只在ProjectGitMenu添加自身子层relatedTarget包含判断和closed pointer-events important守卫，保留其他离开、所有键盘/检出/失败断言，原用例数量不变。
- 最终无诊断的完整Browser原17文件206/206通过；当前重新package的closeout/branches/first-send-worktree/session-move为4文件9/9通过。旧32矩阵在c1f59f3b的证据不改写成新整仓运行；最后局部delta的直接消费者按此范围重验，其他数据/执行/权限/stream源未改。
- 最终`pnpm run typecheck`、目标`oxlint`、格式整理、固定基线`git diff 44b9296 --check`退出0，ProjectGitMenu detector为`[]`。全部临时DEBUG/重复探针撤销；保留确定性退出指针回归。文档从入口及protocol README读回，路径/语义/权威/引用方向/生命周期/导航/新会话读入/历史八项通过。最终`pnpm run check:docs`退出0，检查249个Markdown文件、0问题。
- 本地实施与全部既定验收完成；尚未进行最终独立评审、main合并、远端push/PR、发布产物或CI。真实模型、实际OS选择器/剪贴板/Finder与跨平台验证范围按证据限制明确区分。

Closed: true
