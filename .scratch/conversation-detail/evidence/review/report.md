---
kind: evidence
description: "双轴评审四项发现的集中修复、红绿验证与局部视觉刷新。"
lifecycle: active
---

# Review 修复回执

2026-11-04，独立工作树从集成 `e7efe155912791f51647b9bcf9f965d0b2362c75` 干净创建。功能提交 `1194b316fc27514e4f55b16b9fc0879cff1f628b`，最终产品提交 `0cfe838b4291278651286f9d6378b5bdb0269d53`（按新的 Standards 复核将七处同值交叉 role 统一为完整字号/行高 pair）；后续提交仅保存证据和票评论。未推送、PR、合并 main 或发布。13/spec 保持等待 root 独立复核状态。

## Standards

正式 [Standards 报告](standards.md) 与 [全部 token owner](token-owners.md) 共两项：字体/动效主题归属 P2、翻译文本拼接 P3，均接受并处理。八个 CSS owner 使用现有或新增成对档位；主题集中登记 14/24、11/19、12/20 及 flow/shimmer 参数。`useFlowBox` 读取所属元素 computed custom properties，仍160ms、收起阶段50/160与淡出70/160，反向清理/减少动效不变。没有重设全局既有角色或扩展守卫。过程摘要按活动 ID 选择字典 standalone/continuation 片段，中文仅相应稳定类别的双项省略连接词中的已，英文片段显式登记小写；当前可见文案保留，新增 en/zh 组合回归23/23。

## Spec

正式 [Spec 报告](spec.md) 共两项 P2，均接受并处理。长 read/write（8行）及 edit（9行）采用参考 `ReadBlock`/`DiffBlock` 的双向 FoldToggle：预览在头尾之间，全文在底部；切换后聚焦新位置的控件，保留整个工具/body、wrap及真实原文。成功 edit 仅消费真实 `details.diff`，紧凑行与正文共用增删统计；错误、缺失diff不冒充成功统计，不解析独立patch或从参数重建文件。

合计：Standards 2项（最高P2），Spec 2项（最高P2），全部已修复，待独立复核。

## 红绿与最终验证

预先已批准的真实 App/DOM/协议输入及 Electron/Sidecar/工具接缝延用规格。原 [红例](red.log) 为文件9条中2失败：全文后没有收起控件、紧凑 edit 无+2；最小实现后 [9/9](green.log)。强化 edit 的键盘双向、wrap保留、missing/error统计回归，并保持旧选区/复制断言。过程文本改动是保留输出的规范修复，新增双语言组合预期；不把旧实现也会通过的文案回归称为红例。

| 命令与范围 | 实际结果 |
| --- | --- |
| `rtk proxy pnpm install --frozen-lockfile` | 退出0，880 reused/0 downloaded，没有依赖变更 |
| `rtk proxy pnpm run test --project desktop-renderer apps/desktop/src/renderer/features/conversation apps/desktop/src/renderer/features/right-panel apps/desktop/src/renderer/app/app.browser.test.tsx apps/desktop/src/renderer/features/sidebar/conversation-search.browser.test.tsx` | 最终产品树 [41文件357/357](renderer-pairs.log)，退出0 |
| `rtk proxy pnpm run test packages/ui/src/guards/style-guard.test.ts packages/ui/src/app-frame/app-frame.browser.test.tsx packages/ui/src/tool-card/tool-card.browser.test.tsx packages/ui/src/markdown/markdown-renderer.browser.test.tsx packages/i18n/src/index.test.ts packages/i18n/src/domains.test.ts apps/desktop/src/renderer/features/conversation/timeline.test.ts apps/desktop/src/renderer/features/conversation/process-groups.test.ts scripts/browser-deps.test.ts` | [9文件91/91](shared-pairs.log)，退出0；最终成对角色树覆盖共享几何、字典、守卫和实际消费者 |
| `rtk proxy pnpm run typecheck` | [最终类型](types-last.log)退出0 |
| `rtk proxy pnpm run test --project desktop-e2e apps/desktop/e2e/chat.e2e.test.ts -t 'compiled read folding'` | [最终当次构建](native-pairs.log)1通过/7明确跳过，非8全绿；真实read→edit审批、紧凑统计/双向Enter及文件字节通过 |

最初R为353/354，新增统计把+、数字分为未登记的界面文本节点，真实本地化检查报错，见 [原失败](renderer.log)。改用字典格式化+{count}/−{count}，不改断言，后续完整R全绿。该问题与13历史IME/settings/wheel异常没有证明关系；未声称修复其原因。日志原字节保存在仓库外，仅规范化归档日志EOF及红例日志中一个纯空白行尾空格。

原1194当次编译的完整原生组合命令为 `rtk proxy pnpm run test --project desktop-e2e apps/desktop/e2e/reading-position.e2e.test.ts apps/desktop/e2e/chat.e2e.test.ts apps/desktop/e2e/approvals.e2e.test.ts apps/desktop/e2e/terminal-details.e2e.test.ts apps/desktop/e2e/mcp-browser.e2e.test.ts`，实际 [5文件14/14](native-final.log)，退出0。最终0cfe只替换相同数值字号/行高角色引用，原生流程逻辑没有改变；最终重构建1条上述native read/edit用例复核真实消费者，不把不同命令数量相加或称为全仓通过。

## 局部视觉与动效

八环境为 light/dark × en/zh × 主区实际1000/390，1000px主区的视口1280、390px主区视口390；[metrics](metrics.json)逐个记录mainWidth、聚焦、真实+1−1和无页面横溢。16张PNG保存全文前/全文后，展开和重新收起都由Enter驱动。初次捕获误用670px视口时侧栏自动隐藏，发现实测main也是670，已重捕覆盖；不引用那批窄图。工具摘要增删数在截断区之外，暗窄图检查无挤压；已查看亮宽与暗窄实际结果。字体computed code11/19、header11/18、reasoning13/24、run14/24保持已验收值。该图为真实App+受控协议fixture，不称作参考完整Host或实际模型。

[真实WAAPI展开参数](motion.json)与[收起参数](motion-close.json)由MutationObserver在动画建立后读取 `getTiming/getKeyframes`，160、0.3125、0.4375及原easing保持。R同时覆盖反向、完整关闭重开、reduced-motion、sticky/focus等旧场景。主题实值未改变部分复用13原证据，文件双向和紧凑统计的失效部分已刷新；未重跑参考全矩阵。

当前行为仍归 [workbench](../../../../docs/subsystems/workbench.md)，主题归 [设计系统](../../../../docs/tech-stack/ui-design-system.md)。AGENTS→docs/README→正文读回：归属、语义、生命周期、引用方向、导航与历史保留均通过，没有新正式目录/替代链；正式正文不链接具体任务材料。OS真实指针/标题栏、release打包、真实模型与hosted CI仍未验证。

## 清理与保存

命名agent-browser `coko-review-fix` 已实际 Browser closed；两个独立Vite PID16948/53585先核对完整命令再SIGTERM，操作等待返回exit143。64581/65461 listener已消失，当前工作树路径匹配的Electron/Sidecar/Vitest运行资源为空，见 [清理](cleanup.json)。原生测试使用现有harness.dispose等待应用退出并删除独立用户目录；未退出用户原有Coko。工作树和忽略测试产物保留给root合入/最终清理。

最终 `rtk proxy pnpm run check:docs` 283个Markdown、0问题；`rtk proxy git diff 6e57ed0a7605996ec96173c897b1546c57ed42aa...HEAD --check` 与工作区diffcheck通过。源码lint/format与提交hooks通过。此前归档评审的源行链接被错误当Markdown锚点，机械检查报错，已把Markdown链接改回正文路径、保留旁边原行号说明，未改检查器。全部结论仍以最终root复核为准。

## 最终独立复核与交付

上述“等待复核”是本轮修复提交时的状态。两名全新代理随后以实际集成 `28f9b22a` 复核，Standards 与 Spec 各自原2项均解决、剩余0、新增0；只读复核未运行额外测试。当前交付与最后工作树清理见 [最终回执](delivery.md)、[Standards](standards-final.md)、[Spec](spec-final.md) 和 [清理](cleanup-final.md)。原修复过程、失败及证据对象保持。
