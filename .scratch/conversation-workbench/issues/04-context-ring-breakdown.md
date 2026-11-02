# 04: 上下文环的五类明细

**What to build:** 输入框的上下文环与详情浮层按画布实现，详情的分类明细改为五类：系统、提示词、助手、思考、工具。每项比例以已用 Token 为分母，容量条以模型窗口为分母；不展示指令文件、诊断与“含估算”标记。统计接口的分项随之从六项改为固定的五个键：每类按现有方法估算，有真实 usage 时把已用 Token 按五类估算的比例分配，取整后合计正好等于已用 Token；没有 usage 时已用 Token 就是五类估算之和。已用 Token、窗口、阈值、预警线与压缩触发都不变。

- 行为依据：[规格](../spec.md) CTX-01 至 CTX-04（五类的归类见 CTX-03）、17.2 上下文分项、17.3 ContextBreakdown、13.1 的上下文环行。
- 草稿：现有按 Workspace 的草稿查询保留；独立对话的草稿还没有 Workspace，由 11 只显示轨道。

**User stories:** 52、53

**Blocked by:** 无（可立即开始）

**Status:** ready-for-agent

Closed: true

**Write scope:** packages/protocol 的上下文 DTO；apps/server 的上下文统计（五类归类与按比例分配，原先单独统计的指令文件、Skills 与 Memory 并入系统）；renderer 的 context-ring 与详情浮层；i18n；`docs/subsystems/context.md` 的估算与上下文环一节。

**跨票接口：** 上下文环组件的对外 props 不变，03 把它原样放入工具栏。

- [x] 表驱动单元测试：五类归类与按比例分配，覆盖没有 usage、有 usage 且取整后合计相等、压缩摘要归入提示词、图片按 4800 字符估算、思考块、工具调用的名称与参数归入助手、工具声明与工具结果归入工具。
- [x] Sidecar 协议：含思考、工具调用、工具结果与图片的会话，读回的五类之和等于已用 Token；阈值、预警线与压缩触发与改动前一致，已有压缩用例不改阈值（CW-95）。
- [x] Browser Mode：入口 24px、环 12px，与模型、发送按钮垂直居中；常态、hover、展开、预警、达到阈值与不可用六种状态，不可用时只有轨道、不显示 0%；hover 只显示 Tooltip，点击或键盘打开详情；详情在环上方右对齐、间距 8px、不被裁剪；外部点击与 Escape 关闭并把焦点还给入口；数值列右对齐（CW-89、CW-90）。
- [x] context.md 改为五类口径；`check:docs` 通过。


## Comments

### 2026-11-03 · 实施与验证

- 测试接口沿用规格第 18 节：`contextUsage` 的公开查询、真实 Sidecar 协议、Browser Mode 与已有 Electron 用例。先观察旧六项统计与新五项的归类用例失败（1 failed / 2 passed），实现后通过；比例分配用例也先因旧分项未按 usage 分配而失败，再以最大余数法通过。浏览器先记录旧的内联百分比、warning 颜色与缺少 Tooltip 的三个预期失败，再实现画布入口与详情。
- 协议仅保留 `system / prompt / assistant / thinking / tools` 五个键。系统使用实际装配的全部章节，包含计划、Goal、Todo；用户图片按 4800 字符、压缩摘要归入提示词；正文、思考与工具调用分开，声明与工具结果归入工具。真实 usage 与其后增量的总值计算未改，按估算比例分配整数并补齐余数。
- 画布核对：通过 Pencil 读取 `xcdQk`、`B1eglK` 与 `C782r5`，并查看详情渲染；对应 24px 入口、12px 环（内外半径比 0.7）、348×384/R16 详情、top-end/8px。实际 Browser Mode 检查五类明细、容量条与比例的两种分母、数值右对齐、hover Tooltip、点击与 Enter、Escape/外部点击焦点返回、窗口边缘和 390px 输入区。浅色实际渲染已查看，明暗主题的明细文字对比度均通过。指令、诊断与“含估算”不再出现在详情。
- `pnpm run test apps/server/src/application/context/usage.test.ts tests/integration/sidecar-context.test.ts tests/integration/sidecar-compaction.test.ts apps/desktop/src/renderer/stores/context-store.test.ts apps/desktop/src/renderer/features/conversation/context-ring.browser.test.tsx apps/desktop/src/renderer/features/conversation/warning-text.browser.test.tsx packages/ui/src/guards/style-guard.test.ts`：合入 01/02/03 的集成起点 `88fb961` 后运行，7 文件、72 项通过，退出 0。包括 10 项服务端用例、3 项 Sidecar 用例、4 项既有压缩回归；混合思考、工具调用与图片结果的实际会话五类合计为 12,300，窗口 40,000、阈值 23,000、预警 3,000 不变。用户图片的归类由单元接口覆盖；只有用户图片发送的跨票 E2E 由 19/23 完成。
- `pnpm run test apps/desktop/e2e/context.e2e.test.ts`：真实 Electron + Sidecar，当前构建下 1 项通过，退出 0。验证当前模型名、五类、warning、焦点与窄窗口。旧用例的 520px 窗口测量改为在宽窗口先收起侧栏、缩到 520px，再等主内容的实际宽度达到规格的 390px 下限后测量；保留全部控件宽度、无重叠与无溢出断言，不用固定等待。
- 既有测试调整原因：context-store fixture 使用五键，保留边界 schema 校验；warning-text 不再断言已移除的指令截断和诊断码，改为两主题五类文字对比度；context-ring 不再断言内联百分比和六项，改测画布五类、Tooltip、几何与焦点；Electron context 同步这些可见输出，项目入口适配 01 的“创建项目”，模型名通过列表 store 的独立订阅读取。ContextRingControl 对外 props 未改。
- `pnpm run typecheck`、`pnpm run lint`、`pnpm run check:docs` 与 `git diff --check` 均通过。文档检查为 246 个 Markdown、0 问题。Impeccable detector 对两个上下文环实现运行一次，结果 `[]`。
- 文档：原地更新 `docs/subsystems/context.md` 的估算和上下文环，并同步 `docs/README.md` 摘要。已搜索旧六项/内联百分比/指令展示说法；本轮当前消费者已同步，已关闭的 M3 历史需求与评审材料保留当时事实。从 AGENTS → docs/README → context 正文读回，路径引用、语义、归属、引用方向、生命周期、当前入口、新会话读入与历史保留均通过，无缺口。
- 保存状态：本地票分支，提交后由新的 merger 子代理汇入集成分支；未推送。未运行真实模型、发布产物 smoke 或 CI，本证据不代表这些范围已通过。
