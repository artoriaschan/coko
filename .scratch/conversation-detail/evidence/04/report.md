---
kind: evidence
description: "04 命令终端详情的真实 App、Electron/Sidecar、视觉对照、复制权限与清理证据。"
lifecycle: active
---

# 04 命令终端详情

## 验证对象

- 范围：[本票](../../issues/04-terminal-command-details.md)、[规格](../../spec.md) AC-10、AC-12、AC-15、AC-24 的命令场景。
- 分支 `codex/conversation-detail-04`。实现 `48e0fee`，合入最新集成 05 的 `11ca74172dfe2662eafcd7c72b9a9fffaa7064cf` 后形成 `36f67ee`，最终终端文字行槽修正为 `583d3b9`。本记录与截图提交不再修改产品源码。
- 参考提交 `8bd073392eef6f54e921a093b95076248eb08cbb`；使用实际 ToolRow → TerminalBlock 消费者，`maxLines=Infinity`，完整输出在 224px 输出区内滚动。不是 primitive 默认的 16 行截断。
- macOS arm64，Node 26.10.0，pnpm 12.15.0，Electron 41.0.3，Chromium headless / DPR 1；系统字体栈 SF Mono 优先。浏览器按 light/dark、zh/en、主内容 1000px 与 390px 验证。

终端只消费真实命令、partialResult、结果文本与可用的 structuredContent。`ToolResultView.structuredContent?: unknown` 是可选展示投影，不改 payload、数据库或执行协议。已提交消息缺少该字段时，同调用仍存在实时结果可用它补充；实时状态清除后不制造历史退出码。当前运行库提交工具消息时通常丢弃 structuredContent，因此历史非零退出仍通过原文 `Command exited with code …` 检查，缺失时不补造退出码或耗时。状态截图中的 Exit 7 是有实际字段的协议夹具；真实 Sidecar 用例验证历史结果原文，二者不混称。

## 执行记录

TDD 第一条真实 App 用例在实现前因终端不存在失败；加入终端后通过。输出选区用例在按整段文字更新时复现选区被清空；改为稳定输出行后，追加和结算均保留未变动行的选择。原有 Job 浏览器测试同步手动展开新契约，bash 旧断言改为观察终端输出区域。

最终运行时源码 `583d3b9`（并加入 Job 完成态断言）对应的相关检查：

```sh
rtk pnpm run test apps/desktop/src/main/permissions.test.ts apps/desktop/src/main/app-protocol.test.ts apps/desktop/src/renderer/features/conversation/terminal-details.browser.test.tsx apps/desktop/src/renderer/features/conversation/file-tool-details.browser.test.tsx apps/desktop/src/renderer/features/conversation/tool-cards.browser.test.tsx apps/desktop/src/renderer/features/conversation/jobs-timeline.browser.test.tsx apps/desktop/src/renderer/features/conversation/tool-rows.browser.test.tsx apps/desktop/src/renderer/features/conversation/timeline.test.ts packages/ui/src/guards/style-guard.test.ts
rtk pnpm run test apps/desktop/e2e/terminal-details.e2e.test.ts
rtk pnpm run typecheck
```

- 第一条：9 文件 / 118 用例通过，退出 0。包括本票真实 App 8 例、剪贴板边界 12 例，以及合并后的文件详情、工具行、时间线、Job、协议与样式守卫。
- 第二条：真实 Electron + Sidecar + faux 模型、1 用例通过，退出 0，最终耗时 6.68 秒。命令执行没有替换；用文件 watcher/release 屏障产生连续 ANSI 输出，检查原始命令、红色输出、复制、真实非零退出及原文、同一展开终端。第二次提交启动真实 Background Job，chip 的真实 jobId 打开既有 Jobs tab 并读到 `background-real`，同时确认 Job 状态为 completed。
- 第三条：退出 0。
- `rtk pnpm install --frozen-lockfile`：退出 0。新检出 Electron 安装不完整，默认 Node 26 的安装脚本只留下 LICENSE；以 `rtk proxy /Users/artorias_chan/.nvm/versions/node/v24.15.0/bin/node node_modules/electron/install.js` 完成同版本二进制解压后，原 E2E 入口构建与运行通过。未修改依赖或构建逻辑规避。
- 对本票 12 个 TS/TSX 文件执行 `rtk pnpm exec oxlint` 通过；最新终端修正文件另检查通过。对 14 个代码/样式文件执行 `rtk pnpm exec oxfmt` 通过；最终终端两文件另格式化通过。`rtk git diff --check` 通过。
- `rtk pnpm run check:docs`：合并 05 后检查 266 个 Markdown、0 问题、退出 0；本记录与票回执加入后的最终数量见票 Comments。

### 真实剪贴板问题与边界

最初原生复制失败，真实请求观测为 `clipboard-sanitized-write`、`isMainFrame=true`、`requestingUrl=coko-app://app/`。即使 CDP 虚拟焦点使 `document.hasFocus()` 为 true，仍报告 `Write permission denied`；根因是 main 的统一拒绝处理器。没有激活窗口或改变工具执行授权。

现只允许自有主窗口 webContents、主框架和可信 Coko 协议/host 的该项写权限。读取、其他权限、非自有窗口/子框架、其他或畸形地址仍拒绝；12 个边界用例覆盖。原生 E2E 用实际 Copy 按钮复制，main 读取系统剪贴板独立确认含 ANSI 的原始输出，随后验证网页 `readText()` 返回 NotAllowedError。用 try/finally 恢复测试前的剪贴板，不记录其内容。模型只在外部边界以 faux 控制，其后 Sidecar、存储、执行、Job、IPC 和原生剪贴板均为真实实现。

## 视觉与交互

最终截图在最后一次终端样式修正之后拍摄，所有主题使用同一内容和字体环境。Coko 为真实 App + 已有协议夹具；参考是规格锁定仓库未修改的实际 ToolRow/TerminalBlock/原主题源码，外部展示夹具只设置内容及列宽，不是参考完整 Host/Chat 的回放。参考示例列正常为 680px、390 窗口为 326px，对应 Coko 实际消息列宽。

| 状态 | Coko | 参考 |
| --- | --- | --- |
| light 正常 | [截图](light-normal.png) / [样式](light-normal-metrics.json) | [截图](reference-light-normal.png) / [样式](reference-light-normal-metrics.json) |
| dark 正常 | [截图](dark-normal.png) / [样式](dark-normal-metrics.json) | [截图](reference-dark-normal.png) / [样式](reference-dark-normal-metrics.json) |
| light 390 主内容 | [截图](light-390.png) / [样式](light-390-metrics.json) | [截图](reference-light-390.png) / [样式](reference-light-390-metrics.json) |
| dark 390 主内容 | [截图](dark-390.png) / [样式](dark-390-metrics.json) | [截图](reference-dark-390.png) / [样式](reference-dark-390-metrics.json) |

正常终端实测宽度两者均 676px，窄窗口两者均 322px；R16，外边框 l1，命令栏 padding 9px 14px 9px 30px，分隔线 l2，输出 padding 12px 14px 12px 0。命令 11px/18px；输出文字 11px/16px、行槽 18px，单行输出区 42px，与实际参考一致。参考根节点继承的 16px 不是输出字号，metrics 分别记录 root 与 output。

- 双主题英文长输出：[light](light-390-long-en.png)、[dark](dark-390-long-en.png)，完整原文与末尾第 60 行仍在 DOM 中；[light 样式](light-390-long-en-metrics.json)、[dark 样式](dark-390-long-en-metrics.json) 记录输出 224px、内部 x/y 溢出而整页仍 390px。
- 非零退出、停止、空输出、无结果：[light](light-390-states-en.png)、[dark](dark-390-states-en.png)。无结果没有输出区或猜测的 Exit 0；停止保留原文并无退出胶囊。
- [内部滚动](long-scroll-interaction.json)：scrollTop 180、scrollLeft 250，末尾完整且无整页溢出。[键盘收起](keyboard-interaction.json)：Enter 后焦点仍在摘要，aria-expanded=false。
- agent-browser 实际 Copy 操作观察到 Copied；真实宿主复制由上述 Electron 用例独立证明。
- [运行中 reduced-motion 截图](running-reduced-motion.png)和[计算结果](running-reduced-motion-interaction.json)：实际运行状态、两条连续输出，偏好为 reduce，spinner 的 animationName=none。跨 partialResult/已提交结果的 DOM、选择、滚动和开合稳定另由真实 App 用例证明。

## 文档影响

| 正文变化 | 所属正文 | 引用与入口核对 |
| --- | --- | --- |
| 终端、结构化字段缺失限制、复制和原生权限 | `docs/subsystems/workbench.md` | 保持既有工具详情章节与导航，新增真实测试链接；无反向任务引用 |
| Job chip 在手动展开详情内 | `docs/subsystems/jobs.md` | 同步既有界面段落；不改 Job 身份和接口 |
| 终端代码档位 | `docs/tech-stack/ui-design-system.md` | 记录局部 `text-ui-terminal` 11/18；输出复用 code-small 11/16，其他页面不消费新档位 |

已按 AGENTS → docs/README → 上述正文读回：路径引用、语义同步、归属与权威、引用方向、生命周期、当前入口、新会话读入、历史保留均通过。无移动、弃用、新目录或 ADR；搜索“对话工具摘要与详情”“text-ui-code-small”“在明细中显示 Job chip”后，相关正文/活动票同步，既有历史证据保留当时结论。

## 清理、交付与限制

独立静默会话 `coko-ticket04-visual`、`coko-ticket04-reference` 及最终刷新会话均返回 Browser closed。两轮自有 Coko Vite 与参考 Vite 均经 SIGINT 并等待实际退出 130；端口 64229/64369、49836/49678 均无 listener。临时 HTML/TSX 已删除。E2E 的 teardown 等待 Electron 与实际 Sidecar PID 消失，真实命令正常结束，后台 Job 正常结束；失败诊断轮次亦由相同 teardown 清理，不保留用户数据目录。未停止无关实例。

本票本地实现及必要验收完成，不声称完整 13 票功能已交付。未运行真实模型、发布构建 smoke 或 CI；没有推送或 PR。原生窗口层、真实指针和 OS 前台焦点未验证，所有交互保持静默 CDP；原生剪贴板在 CDP 虚拟文档焦点下执行。最终跨票组合验收与独立 Standards/Spec 评审仍由 13 执行，本票没有把自身基本检查或最终样式截图留给 13。
