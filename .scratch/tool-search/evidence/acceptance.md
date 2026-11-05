---
kind: evidence
description: "Tool Search 联合验收：AC-01—AC-23、用户故事、传输估算修复、390px 静默 Electron 检查与未验证范围。"
lifecycle: active
---

# Tool Search 联合验收

## 验证对象

- [规格](../spec.md)、[15 号票](../issues/15-integrated-acceptance-and-docs.md)；01—14 号票的逐票命令与红绿证据从[实施入口](../README.md#实施票)访问。
- 集成基线 `1b88e113`，本票基于集成 `10efa3cf`；本票提交标识以 Git 记录为准。两轴 code-review 在本票合入后完成，修复后独立复审两轴均为 0 项未解决问题，见[审查记录](review.md#独立复审与本地交付)。所有代码仅本地，集成分支 `codex/tool-search` 尚未合入 main、未推送、未发布。
- macOS arm64；Electron 41.0.3 / Electron Node 24.14.0；pnpm 12.15.0 / pi-ai 与 pi-agent-core 1.4.0；测试只替换模型服务、外部网络或时钟，真实 Sidecar、MCP stdio、持久化与加载实现保留。
- 首轮两轴审查后的修复与最新定向检查另见[审查记录](review.md)；原命令结果保留当时状态，不能用原绿灯替代修复后的复核。

## 执行记录

| 命令或步骤 | 实际范围与数量 | 结果 |
| --- | --- | --- |
| `rtk pnpm install --frozen-lockfile --offline` | 本票独立 worktree 的依赖安装 | 退出 0 |
| 下列 A 命令 | 12 文件、86 例（新增下面 SQLite 场景前）；实际含 3 协议、拒绝状态、恢复、边界、工具用量、引擎与估算 | 86/86，退出 0 |
| `rtk pnpm run test tests/integration/sidecar-tool-search.test.ts` | 新增真实 SQLite 故障注入后单文件 8 例，补验原全部 7 例 | 8/8，退出 0 |
| 下列 B 命令 | MCP、Provider 与原生拒绝提示的 Browser Mode；3 文件、27 例 | 27/27，退出 0 |
| `rtk pnpm run test packages/agent/src/engine/context-seam.test.ts packages/agent/src/engine/system-message-rebuild.test.ts` | 2 文件、13 例；包括 01 号票发现的两项旧顺序断言 | 13/13，退出 0；context-seam 同时在 A 中重验 |
| `rtk pnpm run typecheck` | 当前项目引用图 | 退出 0 |
| agent-browser + 本票后台 Electron | en/zh × light/dark × MCP 顶部、Server 表单、Provider 表单，390 × 800 CSS px；12 张截图及几何记录 | 目标标签、说明和控件无重叠、无水平裁切；页面宽度均 390；实际保存与回显另由 B 覆盖 |

A：

```sh
rtk pnpm run test tests/integration/sidecar-incremental-tools.test.ts tests/integration/sidecar-completions-incremental-tools.test.ts tests/integration/sidecar-incremental-rejection.test.ts tests/integration/sidecar-tool-search-lifecycle.test.ts tests/integration/sidecar-tool-search-boundaries.test.ts tests/integration/sidecar-tool-search.test.ts tests/integration/sidecar-tool-search-settings.test.ts tests/integration/sidecar-tool-accounting.test.ts packages/agent/src/context/usage/tool-definitions.test.ts packages/agent/src/engine/compaction.test.ts packages/agent/src/engine/context-seam.test.ts apps/server/src/application/context/usage.test.ts
```

B：

```sh
rtk pnpm run test apps/desktop/src/renderer/features/settings/mcp-section.browser.test.tsx apps/desktop/src/renderer/features/settings/models-section.browser.test.tsx apps/desktop/src/renderer/features/conversation/incremental-rejection.browser.test.tsx
```

### 联合验收发现与修复

1. **运行中用量快照。** 在真实 Sidecar 中先搜索并停在 MCP 审批，关闭全局按需开关；同一条目集合的工具分项从 4662 变为 4658，但下一次请求仍按原 Run 快照。新增 retry/continue 两个断言先失败，修复后使用相同准入作用域、模型和 MCP 贡献，再结合已提交加载派生工具；空闲或草稿仍预览下次 Run 当前配置。设置/用量相关 20 例通过。
2. **原生历史定义。** Messages/Responses 移除已加载工具时，旧 schema 仍在原位 `tool_addition` / `additional_tools` 请求中；只算当前执行集合漏计。真实请求先证实差异，再用 pi 公共 `resolveTranscriptTools` 统一显示与自动压缩：changes 模式保留原位历史，Completions additions 模式在最后一次非追加变化处折叠，普通列表只算当前定义一次。规范估算保持 Coko `{ name, description, parameters }` JSON 字符数 / 4；不把协议包装、占位符、schema 默认值转换或真实 tokenizer 当作同一计量。Provider 关闭或未标注 Completions 仍采用普通估算；活动 Run 使用冻结的实际 compat，空闲会话按当前 Provider 设置预览。
3. **压缩准入回归。** 两种原生协议加载一个大型 schema 后停用工具；只看当前集合时低于阈值，但请求保留旧定义。真实 Sidecar 新用例证明自动压缩触发并在折叠后降至阈值以下。暂时恢复“只计当前集合”的旧算法，两例因缺少 compaction 失败；恢复修复后通过。首轮新夹具没有足够最近对话形成切点，已按现有 20k 保留规则补足最近用户内容，没有修改产品阈值或超时。
4. **真实提交失败。** 在空闲的真实 Sidecar 临时 SQLite 库安装只拒绝 `tool_load` INSERT 的触发器；随后正常调用搜索。WebSocket 先收到已提交 toolResult，之后没有加载记录或下一次模型请求，并收到 `run_end` progress 的 `commit_failed`。这延续现有提交失败策略：持久 Run 结束条目不再提交，实时结束状态仍送达。没有模拟 store 或增加产品故障环境变量，补齐 AC-16 的真实 Sidecar 接缝。
5. **既有测试维护。** 01 号票已在旧实现证明两项 context-seam 断言过时。本票再次得到同样失败，只把完整顺序中的 `model_request` 移到对应 assistant 之前，保留全部 before/steer/Run 关联断言；产品顺序不变。

### AC 逐项矩阵

“本地通过”仅指下列真实 Sidecar / 可控模型服务或 Browser Mode，不能推出真实 Provider 的行为与缓存效果。未改动的专项源码复用各实施票当前有效证据；A/B 为本票最终跨功能重验。

| AC | 证据入口 | 当前结论 |
| --- | --- | --- |
| AC-01 | [首次请求与目录](../../../tests/integration/sidecar-tool-search.test.ts)，A | 本地通过：首次 HTTP 工具列表无按需 MCP schema |
| AC-02 | 同上：搜索、加载条目顺序、真实 stdio 调用 | 本地通过；真实 Provider 未验证 |
| AC-03 | [关键词集成](../../../tests/integration/sidecar-tool-search-keywords.test.ts)、[检索单测](../../../packages/agent/src/tools/tool-search/tool-search.test.ts)，04 号票 | select 不受 limit、必需词、常驻/未知/零命中、schema 预算通过 |
| AC-04 | 同上，04 号票 | CJK、英文零命中与子串兜底通过 |
| AC-05 | 同上，04 号票 | deny/Hook/Plan/停用/未批准范围通过；加载不授权 |
| AC-06 | [目录单测](../../../packages/agent/src/tools/tool-search/catalog.test.ts)、[目录集成](../../../tests/integration/sidecar-tool-search-catalog.test.ts)，05 号票 | 60/24 字、统一缩短、最长组名称/计数降级通过 |
| AC-07 | 同上，05 号票 | Added/Removed、去重、压缩与保留旧公告的对话回退后完整重发通过 |
| AC-08 | 同上，05 号票 | 审批期间重连不改变当前目录，下一 Run 可搜索调用通过 |
| AC-09 | [生命周期](../../../tests/integration/sidecar-tool-search-lifecycle.test.ts)、[原生传输](../../../tests/integration/sidecar-incremental-tools.test.ts)，A | 双工具重启/continue/retry/三种压缩及基础提示通过，无业务重跑 |
| AC-10 | [边界集成](../../../tests/integration/sidecar-tool-search-boundaries.test.ts)、[Fork](../../../packages/agent/src/agents/fork.test.ts)，A 与 10 号票 | 对话/文件回退、用户/助手/压缩/再次分叉、Handoff 通过 |
| AC-11 | 生命周期，A | 断连暂不提供、重连恢复、新说明与 schema 通过 |
| AC-12 | [乐观加载](../../../tests/integration/sidecar-tool-search-optimistic.test.ts)、[加载 Runtime](../../../packages/agent/src/engine/tool-loading.test.ts)，08 号票 | 正常链路经 Sidecar；精确中断切点经公开 Runtime commit 接缝通过，未从 Sidecar 注入崩溃 |
| AC-13 | [设置集成](../../../tests/integration/sidecar-tool-search-settings.test.ts)，A | 开关、关闭期间不隐式加载、项目收紧与当前 Run 冻结通过 |
| AC-14 | [始终加载](../../../tests/integration/sidecar-mcp-always-load.test.ts)，06 号票 | 全局/项目/插件、批准摘要不变、空目录通过 |
| AC-15 | 首次请求与目录集成，A | general 与 Teammate 完整允许 MCP 集、无搜索和目录通过 |
| AC-16 | 首次请求与目录集成的 SQLite 触发器场景；加载 Runtime | 真实 Sidecar 提交故障通过：结果已提交、无加载/下一请求、WS commit_failed；公开 commit 端口回归继续保留 |
| AC-17 | [Provider Browser](../../../apps/desktop/src/renderer/features/settings/models-section.browser.test.tsx)，B | 三协议、未设置及升级前配置默认值、随协议变化通过 |
| AC-18 | 原生传输与 [Completions](../../../tests/integration/sidecar-completions-incremental-tools.test.ts)，A | 三协议真实 HTTP 请求体通过；Completions 仅网络边界重定向，真实 pi 目录未替换；真实 Provider 未验证 |
| AC-19 | 原生传输，A | 全局关闭、目录为空、子代理都使用普通写法通过 |
| AC-20 | [拒绝集成](../../../tests/integration/sidecar-incremental-rejection.test.ts)、[提示 Browser](../../../apps/desktop/src/renderer/features/conversation/incremental-rejection.browser.test.tsx)，A/B | 原生 400/422 提示；401/429、普通与未标注 Completions 不提示；请求次数保持原策略 |
| AC-21 | 原生传输，A | 审批等待切换 Provider、下次 Run/retry 生效，加载保留通过 |
| AC-22 | [工具用量](../../../tests/integration/sidecar-tool-accounting.test.ts)、设置集成与原生传输，A | 根/受限子工具、活动快照、原生历史定义、关闭 Provider 后普通估算及自动压缩通过 |
| AC-23 | B 与静默 Electron 12 组合、`layout-390.json` | 本地通过；真实指针和原生层未验证 |

### 用户故事对应

| 用户故事 | 主要 AC |
| --- | --- |
| 1—5 | AC-01、02、03 |
| 6—11 | AC-03、04、05 |
| 12—15 | AC-06、07、09 |
| 16—20 | AC-10、11 |
| 21—25 | AC-12、13、14 |
| 26 | AC-15 |
| 27—32 | AC-17—21 |
| 33 | AC-22 |
| 34—35 | AC-01 空目录、AC-13 与原生 Headless 配置进程场景 |

## 静默桌面资产

通过 `COKO_E2E_BACKGROUND=1` 与独立 `COKO_HOME`、`COKO_USER_DATA_DIR`、`COKO_CHATS_ROOT` 启动本票 Electron Forge，CDP 端口 9222，agent-browser 命名会话 `coko-tool-search-15`。未切前台、未显示 Dock；截图来自 CDP 渲染帧。390 × 800 为 CSS viewport；没有把窗口设置成可接收真实鼠标的可见模式。

截图保存在 `/Users/chenzheng/Documents/Codex/2026-11-05/tool-search/screenshots/`：`{en,zh}-{light,dark}-{mcp,server,provider}-390.png` 共 12 张；同目录上层的 `layout-390.json` 记录标签、控件、说明边界与无页面水平溢出的检查。原始截图逐张读回，目标内容自然换行、开关不挤压说明，长表单保存/取消可经局部滚动到达。设置分区横向导航本身允许局部滚动。初次 CDP `scrollintoview` 把外层 overflow-hidden 容器滚动了 90px，造成调试截图下方透明区域；捕获脚本将该非用户滚动恢复并保留实际内容区滚动后重新取帧，没有改 CSS 或裁剪图片来消除差异。

## 文档影响与 ADR 判断

| 正文变化 | 所属文件与动作 | 检查 |
| --- | --- | --- |
| 子会话绕过父模型的按需子集 | [子代理](../../../docs/subsystems/subagents.md)、导航摘要 | 正文与真实 Sidecar 子/团队证据一致 |
| 当前工具快照与传输定义估算 | [上下文](../../../docs/subsystems/context.md)、[MCP](../../../docs/subsystems/mcp.md)、agent README | 区分普通与原生；不宣称精确 tokenizer 或请求字节数 |
| 目录边界例外 | [ADR 0024](../../../docs/adr/0024-session-state-as-state-updates.md) | 已达到 Tool Search 并入条件；partial 与真实模型门槛保留 |
| 加载事实的理由 | [ADR 0003](../../../docs/adr/0003-settings-and-sessions-in-sqlite.md) | 追加条目、压缩与 Fork 的既有所有权决定；不新建重复 ADR |
| Provider 原生策略 | MCP 的当前传输正文，ADR 0010 继续约束一次保存 | 可撤回的配置策略，不额外建立 ADR |
| 本次材料状态 | README/spec/design/本票与本证据 | 保留原始批准和历史检查；规格 delivered、设计仍 draft；本地交付与合入 main、推送和发布分开 |

ADR 判断：工具加载事实确有长期理由，已补入既有 append-only 存储决定，并链接 Fork 当前规则；目录与 Provider 保存分别由 ADR 0024/0010 继续维护。不用新的 ADR 复制当前机制列表，也不把实现授权改写成设计稿整体获批。

## 结论与限制

- 真实 Provider 的 AC-02、AC-18、缓存命中、费用和延迟：**未验证**。本次没有提供真实测试凭据，未搜取用户存储中的 Key，不把本地协议服务当作真实服务。
- AC-16 已由真实 Sidecar + SQLite 触发器补齐提交失败。乐观加载“结果已提交、加载前崩溃”的精确中断切点仍采用公开 Runtime commit 端口与重建，未从 Sidecar 注入该精确进程崩溃；正常调用走真实 Sidecar。
- 真实鼠标、原生标题栏/红绿灯、发布安装包、CI：**未验证**；本票不运行全仓测试，也没有新增 CI。
- 后台 Electron 与 agent-browser 的清理、文档检查和最终提交以本票 Comments 的最终回执为准。代码、依赖、相关配置或协议版本变化会使对应证据失效。
