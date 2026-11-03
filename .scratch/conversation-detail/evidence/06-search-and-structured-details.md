---
kind: evidence
description: "搜索、LSP 与 Memory 详情的实际 App、Electron、参考适配器和双主题验证记录。"
lifecycle: active
---

# 06 搜索与结构化工具详情验证

## 验证对象

- [规格](../spec.md)：AC-10、AC-11、AC-18、AC-24；[实施票 06](../issues/06-search-and-structured-details.md)。
- 基线 `11ca74172dfe2662eafcd7c72b9a9fffaa7064cf`，独立工作区 `/tmp/coko-conversation-detail/ticket-06`，分支 `codex/conversation-detail-06`。开始时状态干净，基线为 HEAD 祖先；没有 `.codegraph/`，按指令使用 rg 与直接源码。
- 锁定参考 `/Users/artorias_chan/Workspaces/agent/deepseek-harness`，提交 `8bd073392eef6f54e921a093b95076248eb08cbb`。直接检查 SearchRow → searchCardModel → ToolRow → SearchBlock，以及 DetailsRow → detailsCardModel → controlDetails/lspDetails → ToolDetails 的实际消费者；没有手工缩短 primitive 的 maxLines。
- 环境：macOS arm64、Node 26.10.0、pnpm 12.15.0、Vitest 5.0.3、React 19.3.0、Electron 41.0.3、agent-browser 0.38.2。浏览器为无头 Chromium；Electron 使用项目 harness 的 COKO_E2E_BACKGROUND=1。

## 数据与参考适配

- 参考搜索卡要求 meta.shape/files/paths/total/truncated。Coko grep/find/ls 只记录文本和截断元数据，没有结构化匹配或路径数组；因此使用同一正文几何、标题栏和复制能力展示原始文本，聊天预览首尾共 8 行。没有从冒号、换行或错误文本推导匹配数、文件数、路径、行号或跳转。省略的是没有数据支撑的分组和数量，而非隐藏内容；完整输入/输出及 details 可在独立 disclosure 检查。
- Coko LSP details 的 file/line/character 是请求位置；明确标为请求字段。count/total 仅接受记录中的非负安全整数且 count≤total；原始结果文本保留，诊断未收到仍与空结果区分。当前工具详情无文件打开回调，故没有路径按钮。
- Memory write/delete 直接显示 details.memory 的实际保存正文，不使用未经宿主处理的参数代替保存值；原始参数、完整 receipt 和其他 details 仍保留。memory_list 没有条目数组，继续完整通用详情。
- 未知/MCP、失败、字段缺失、尚无完成结果继续使用 02 的完整通用输入/输出，未新增后端、协议、工具或再次执行入口。
- 文件与搜索工具栏共享 useToolDetailCopy 的剪贴板边界和 Toast；SearchBlock 参考本身使用文字复制按钮，未另画近似图标。

## 执行记录

| 命令或步骤 | 实际范围与数量 | 结果 |
| --- | --- | --- |
| `rtk proxy sh -c 'git merge-base --is-ancestor 11ca74172dfe2662eafcd7c72b9a9fffaa7064cf HEAD && pnpm install --frozen-lockfile'` | 9 workspace，冻结锁文件 | exit 0 |
| `rtk pnpm run test apps/desktop/src/renderer/features/conversation/structured-tool-details.browser.test.tsx` 首次红灯 | 1 用例，缺少搜索正文 | exit 1，预期失败 |
| 同一文件第二个 LSP 红灯 | 2 用例，1 通过 / 1 失败，缺少请求字段适配 | exit 1，预期失败 |
| `rtk pnpm run test apps/desktop/src/renderer/features/conversation/structured-tool-details.browser.test.tsx apps/desktop/src/renderer/features/conversation/file-tool-details.browser.test.tsx apps/desktop/src/renderer/features/conversation/tool-cards.browser.test.tsx packages/ui/src/guards/style-guard.test.ts` | 4 文件 / 65 用例；实际 App 9、文件 6、工具 10、守卫 40 | exit 0，65 通过；后续更大相关集见下文 |
| `rtk pnpm run typecheck` | tsc -b | exit 0；合入 04 后再次通过 |
| `rtk pnpm run test --project desktop-e2e apps/desktop/e2e/search-details.e2e.test.ts apps/desktop/e2e/lsp.e2e.test.ts apps/desktop/e2e/memory.e2e.test.ts` | 真 Electron + 真 Sidecar，3 文件 / 4 用例 | LSP/Memory 3 通过；搜索首次断言错误地期待 JS 错误文本，实际为 rg: regex parse error |
| `rtk pnpm run test --project desktop-e2e apps/desktop/e2e/search-details.e2e.test.ts` | 修正为宿主真实 ripgrep 错误，1 用例 | exit 0 |
| `rtk pnpm run check:docs` | 266 Markdown | exit 0、0 问题；加入本记录后 268 文件再次通过 |

Electron 初次全局构建未进入用例：新安装的 Electron 缺少完整 dist/path.txt。使用 `rtk proxy /Users/artorias_chan/.nvm/versions/node/v24.15.0/bin/node node_modules/electron/install.js` 完成安装后，真实入口运行成功。既有 lsp/memory E2E 在 New chat 阶段改等实际 heading，不再等待尚不存在的 Session 连接状态；后续业务断言保留。

## 视觉与交互资产

- Coko 实际 App 装配：`/tmp/coko-conversation-detail/search-harness/{main.tsx,serve.mjs,capture.py}`，只在外部夹具提供 Session Entry，生产 App、store、时间线与工具分发保持真实装配。
- 参考：`/tmp/coko-conversation-detail/reference-harness/search-main.tsx` 调用未修改的实际 SearchRow 与 DetailsRow，输入为其真实 ToolResultNode/PartialArguments 契约，保留原主题、字典和 SVG sprite。此入口是实际源码消费者的组件参考，未声称参考完整 Host/App。
- 精确命令入口：`rtk proxy node /tmp/coko-conversation-detail/search-harness/serve.mjs`（50250）、`rtk proxy node /tmp/coko-conversation-detail/reference-harness/serve.mjs`（50277）、`rtk proxy python3 /tmp/coko-conversation-detail/search-harness/capture.py`；命名无头会话 `coko-search-06` 与 `coko-search-reference-06`。
- 亮/暗 × zh/en × 消息列 680/390 CSS px。Coko viewport 1000/454 ×1200，真实列宽分别 680/390；参考显式相同列宽。680 是该视口实际 clamp 轴，不使用 748 fallback 替代。搜索正文含 8 行原文加中间展开控制；结构化字段 5.5em/12px 网格、13/20，搜索行 22px、代码 11/19、标题栏 9px 14px，相同代码表面和16px圆角。
- 资产：`search-harness/coko-{light,dark}-{en,zh}-{680,390}.png`、`-bottom.png`、`reference-{light,dark}-{en,zh}-{680,390}.png` 与相应 metrics JSON。底部截图覆盖 Memory receipt、空搜索、失败与未知结果；首屏覆盖搜索和 LSP。图片由内部消息区滚动取得，不把 full-page 截图误认成能展开内部 scroller。
- 手动静默 agent-browser 键盘路径：展开搜索 → focus `.search-detail-expand` → Enter → 原始中间行出现 → focus `[aria-label="Collapse results"]` → Space。首次发现焦点落到 BODY，新增真实 App 回归确认失败；修复后 9 用例全部通过。再次静默 Enter/Space 复验：中间原文可见、收起后回到 Expand 4 more result lines、工具行保持打开。

## 文档影响与读回

| 变化 | 所属文档 | 动作 |
| --- | --- | --- |
| 搜索原文容器、完整 IO、可信字段与无死入口 | `docs/subsystems/workbench.md` | 原地补充工具详情行为 |
| 请求位置和计数与原始结果的界面分工 | `docs/subsystems/lsp.md` | 更新工具卡说明 |
| Memory 已保存正文与参数的区别 | `docs/subsystems/memory.md` | 更新工具详情说明 |
| 实施与验证状态 | 本票 Comments 与本证据 | 保留任务状态，不修改整份规格的 approved |

从 AGENTS → docs/README → 三份当前正文读回；正文 lifecycle 维持 active、没有新目录或替代链、没有正式文档反向依赖具体任务材料，既有语义与状态保留。导航已有三个入口，无需增加任务链接。

## 结论与限制

本地实际 App 与真实 Sidecar/Electron 在可控 faux 模型输入下覆盖搜索、空结果、错误、LSP 与 Memory。没有验证真实模型或真实第三方语言服务器；没有远程 CI、推送或 PR。静默 CDP 不覆盖真实鼠标/原生标题栏，属于范围外。本提交已合入当时最新集成 `7610b5d0da2c2b1d0f7896b6c10cd1a58158cd7e`（含 01/02/04/05 与类型基线修复）；06 仅依赖 02，不以尚未交付的 03 阻塞自身闭环。整轮分组联合作用由 03 在集成 06 后运行聚合消费者检查。

## 最新对象与最终检查

- `rtk pnpm run test apps/desktop/src/renderer/features/conversation/structured-tool-details.browser.test.tsx apps/desktop/src/renderer/features/conversation/file-tool-details.browser.test.tsx apps/desktop/src/renderer/features/conversation/tool-cards.browser.test.tsx apps/desktop/src/renderer/features/conversation/terminal-details.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：合入 04 后 5 文件 / 73 用例通过（06 实际 App 9、文件 6、工具 10、终端 8、守卫 40），exit 0。
- `rtk pnpm run test --project desktop-e2e apps/desktop/e2e/search-details.e2e.test.ts apps/desktop/e2e/lsp.e2e.test.ts apps/desktop/e2e/memory.e2e.test.ts`：合入 04 后 3 文件 / 4 用例通过，exit 0。
- 新增真实系统剪贴板断言后，`rtk pnpm run test --project desktop-e2e apps/desktop/e2e/search-details.e2e.test.ts`：1 文件 / 1 用例通过，原始完整 12 行已由 main 的系统剪贴板读回核对；测试在 finally 恢复先前剪贴板。
- 为避免将来正常整轮收起的竞态，LSP E2E 在结束后再展开；`rtk pnpm run test --project desktop-e2e apps/desktop/e2e/lsp.e2e.test.ts`：1 文件 / 1 用例通过。
- `rtk pnpm run typecheck`：最终 TypeScript 源码及 E2E 变更后通过，exit 0。
- `rtk pnpm exec oxlint apps/desktop/src/renderer/features/conversation/structured-tool-details.tsx apps/desktop/src/renderer/features/conversation/structured-tool-details.browser.test.tsx apps/desktop/src/renderer/features/conversation/tool-detail-copy.ts apps/desktop/src/renderer/features/conversation/file-tool-details.tsx apps/desktop/src/renderer/features/conversation/tool-cards.tsx apps/desktop/e2e/search-details.e2e.test.ts apps/desktop/e2e/lsp.e2e.test.ts apps/desktop/e2e/memory.e2e.test.ts`：exit 0；相关源码由 oxfmt 格式化。
- 代表性明暗主题正常/390 列截图直接读图，保留的数据适配差异如上；[暗色中文 390 首屏](06/coko-dark-zh-390.png)、[同场景底部](06/coko-dark-zh-390-bottom.png)、[实际参考适配器](06/reference-dark-zh-390.png)。全部 24 PNG 与 16 metrics JSON 已保存至本仓库 `evidence/06/`，不只依赖 /tmp 资产。
- 实际比较读回：两侧消息列均 390，搜索容器均 386；标题文字均 13px/20px 系统 sans，正文均 11px/19px SF Mono 优先，正文 padding 均 8px 14px 12px 0。原参考 font 字符串重复了栈但实际字体相同。metrics 中 headerFont 是标题栏容器的继承值，实际文字的 13/20 另由源代码和直接 computedStyle 读回核对。

## 资源清理

- `rtk proxy agent-browser --session coko-search-06 close` 与 `--session coko-search-reference-06 close` 均 exit 0 / Browser closed。
- 先以 lsof 确认监听端口 50250/50277 的 PID 为 5242/8622，再以 `rtk proxy ps -p 5242,8622 -o pid=,ppid=,command=` 确认均为本票两个 serve.mjs 入口，随后 `rtk proxy kill -TERM 5242 8622`。
- 两个原始命令会话分别通过 write_stdin 观察到退出 143；随后的 `rtk proxy lsof -nP -iTCP:50250 -iTCP:50277 -sTCP:LISTEN` 与 `rtk proxy ps -p 5242,8622 -o pid=,command=` 均 exit 1 / 无结果，端口与 PID 已实际退出。
- Electron 测试通过 harness.dispose 等待实际 Electron/Sidecar 退出，临时用户目录由 onTestFinished 清理；没有停止无关实例或删除用户数据。
- 参考仓库复核仍为 master，只有原有未跟踪 codebase-guide/，没有修改锁定参考源代码。
