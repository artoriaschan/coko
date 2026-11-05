---
kind: index
description: "Coko Tool Search 规格、设计与研究入口：复刻程小帮 v1.10.1 的按需加载、BM25 检索、恢复与原生增量传输，以及来源研究与交付状态。"
lifecycle: active
---

# Tool Search 设计与研究

2026-11-04：已完成公开仓库、Claude Code、本地 Rukie 和程小帮的实现研究。用户进一步指定加载和恢复参考 Rukie、检索采用 BM25，只出设计不写代码，在主仓库 main 提交。

2026-11-05：用户决定复刻程小帮 v1.10.1 的 ToolSearch、复用协议原生增量路径、自研搜索算法，并在访谈中逐项确认结论；随后按 `to-spec` 汇总为规格（approved，Status: ready-for-agent），设计据此只保留实现方式。设计仍为 draft。随后按 `to-tickets` 拆为 15 张实施票，用户确认了拆分与阻塞关系；尚无 ADR，未改变产品行为。

- [Tool Search 规格](spec.md)：主入口；需求 TS-01—TS-27、界面文案与验收场景 AC-01—AC-23。
- [Tool Search 设计](design.md)：实现方式；模块与接口、加载记录与恢复、各协议的原生增量写法、验证映射与待决问题。

- [仓库实现综合对照](research/repository-comparison.md)：追加调研的主入口，比较检索、加载、执行与历史状态，以及 Coko 可借鉴点。
- [公开仓库源码](research/public-repositories.md)：Codex、LangGraph BigTool、FastMCP、Docker Agent，均固定 commit 并追到关键函数和测试。
- [Claude Code](research/claude-code.md)：官方公开契约与本地社区还原版分开核查；代理执行、TF-IDF/关键词和静态风险。
- [Rukie](research/rukie.md)：当前本地源码的完整调用链、名称打分、Harness 加载、恢复与能力探测。
- [程小帮](research/chengxiaobang.md)：当前工程的 Run 内关键词方案、1.9.2 产物的 BM25 与独立发现集存储，以及作为复刻基准的 1.10.1 产物；三者分开核查。

- [实现机制与 Coko 接入建议](research/implementation.md)：综合结论、源码证据、建议的数据流、边界与验证方法。
- [Anthropic 与 MCP 一手资料](research/anthropic-mcp.md)：协议细节、历史保留、版本差异与待实测项。

## 实施票

2026-11-05 按 `to-tickets` 拆分，用户确认了粒度与阻塞关系。01、02 为前置重构；03 打通最小闭环，其中开关暂时默认关闭，11 号票改为默认打开并迁移现有 MCP 测试；15 联合验收与文档同步。各票均为 ready-for-agent，尚未实施。

| 票 | Blocked by |
| --- | --- |
| [01 运行时重建后保留基础提示](issues/01-keep-base-prompt-on-rebuild.md) | 无 |
| [02 上下文用量与模型请求共用一份工具清单](issues/02-shared-tool-accounting.md) | 无 |
| [03 按需加载最小闭环：目录、按确切名称加载与加载记录](issues/03-on-demand-minimal-loop.md) | 01、02 |
| [04 关键词检索、查询语法与可见范围](issues/04-keyword-search-and-scope.md) | 03 |
| [05 目录预算降级与增量公告](issues/05-catalog-budget-and-deltas.md) | 03 |
| [06 MCP Server「始终加载」](issues/06-always-load-servers.md) | 03 |
| [07 全局开关的设置界面与项目收紧](issues/07-global-switch-settings.md) | 03 |
| [08 乐观加载](issues/08-optimistic-loading.md) | 03 |
| [09 重启、重试、压缩与断连后的已加载工具](issues/09-restore-compaction-reconnect.md) | 03 |
| [10 回退、分叉与 Handoff 的加载边界](issues/10-rewind-fork-handoff.md) | 03 |
| [11 默认打开按需加载并迁移现有 MCP 测试](issues/11-default-on-and-test-migration.md) | 03、06 |
| [12 Provider 开关与 Messages、Responses 的原生写法](issues/12-provider-switch-native-transport.md) | 03 |
| [13 原生请求被拒时的开关提示](issues/13-native-rejection-hint.md) | 12 |
| [14 openai-completions 按 pi 目录使用原生写法](issues/14-completions-pi-catalog.md) | 12 |
| [15 联合验收与文档同步](issues/15-integrated-acceptance-and-docs.md) | 04 至 14 |

下一步由用户调用 `/implement` 逐票实施，或调用 `/implement-spec` 并行实施。规格与设计中，已确认的需求与其余工程选择分开标注；保存或提交不等于批准实施。

## 检查与保存状态

- 首轮 `rtk pnpm run check:docs`：检查 291 个 Markdown 文件，0 个问题，退出码 0。首轮相对链接问题已修正；追加调研结果在本轮交付前统一重验。
- 追加调研 `rtk pnpm run check:docs`：检查 295 个 Markdown 文件，0 个问题，退出码 0；`rtk git diff --check` 退出码 0。外部本地源码使用路径与行号文本，公开源码使用固定 commit 链接。
- 设计及程小帮补充研究在 main 目录检查：`rtk pnpm run check:docs` 检查297个 Markdown 文件，0个问题，退出码0。共9个任务 Markdown 文件，均从此入口可达；设计保持 draft，仅 BM25 与 Rukie 参考方向属于用户已指定内容。
- 已从本入口读回各专项和综合正文：官方事实、社区源码观察、旧版记录与工程建议分开；未改变既有规格、ADR 或当前行为；全部材料从此入口可达。
- 前两轮研究最初保存于 detached worktree，未在那里提交；本轮将研究依据一并保存到主仓库 `/Users/artorias_chan/Workspaces/person/coko` 的 main。提交范围仅此任务目录，已有的正式文档修改与 `hand offs/` 不纳入。提交标识以本轮 Git 记录及交付回执为准，不推送远端。
- 未运行真实模型、真实 MCP 联调或产品行为测试；没有 token、延迟或检索准确率的测量结论。
- 2026-11-05：改写设计，补充程小帮研究的 v1.10.1 一节，在 GLOSSARY 增加 On-demand Tool 与 Tool Search。`pnpm run check:docs` 检查 380 个 Markdown 文件，0 个问题，退出码 0。改动只保存在本地工作区，未提交。
- 2026-11-05：按 `to-spec` 新建规格（approved，Status: ready-for-agent）；设计第 3 节的已确认决定移入规格，验证表改为对应规格的验收编号。`pnpm run check:docs` 检查 381 个 Markdown 文件，0 个问题，退出码 0。改动只保存在本地工作区，未提交。
- 2026-11-05：按 `to-tickets` 发布 15 张实施票（Status: ready-for-agent，均未关闭）；规格与设计稿记入已确认的目录预算 token 估算，设计稿“实施时需确认”的五项分配到票。`pnpm run check:docs` 检查 396 个 Markdown 文件，0 个问题，退出码 0；脚本核对 15 张票的票号、标题、状态与阻塞关系和本页表格一致。改动只保存在本地工作区，未提交。
- 2026-11-05：按用户要求，把上面三条记录中尚未提交的改动（规格、设计稿、程小帮研究的 v1.10.1 一节、GLOSSARY 的两个术语与 15 张实施票）一并提交到本地 main，未推送远端；提交标识以 Git 记录为准。
