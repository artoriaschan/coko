---
kind: index
description: "Coko Tool Search 设计与研究入口：BM25、工具加载、恢复、来源与交付状态。"
lifecycle: active
---

# Tool Search 设计与研究

2026-11-04：已完成公开仓库、Claude Code、本地 Rukie 和程小帮的实现研究。用户进一步指定加载和恢复参考 Rukie、检索采用 BM25，只出设计不写代码，在主仓库 main 提交。当前方案为 draft，未形成已批准规格、实施票或 ADR，未改变产品行为。

- [Tool Search 设计草案](design.md)：本轮主入口；明确范围、Module 与 Interface、BM25 参数、提交屏障、压缩与 Session 派生、验证矩阵和待确认参数。

- [仓库实现综合对照](research/repository-comparison.md)：追加调研的主入口，比较检索、加载、执行与历史状态，以及 Coko 可借鉴点。
- [公开仓库源码](research/public-repositories.md)：Codex、LangGraph BigTool、FastMCP、Docker Agent，均固定 commit 并追到关键函数和测试。
- [Claude Code](research/claude-code.md)：官方公开契约与本地社区还原版分开核查；代理执行、TF-IDF/关键词和静态风险。
- [Rukie](research/rukie.md)：当前本地源码的完整调用链、名称打分、Harness 加载、恢复与能力探测。
- [程小帮](research/chengxiaobang.md)：当前工程的 Run 内关键词方案与1.9.2产物的 BM25/独立发现集存储；两者分开核查。

- [实现机制与 Coko 接入建议](research/implementation.md)：综合结论、源码证据、建议的数据流、边界与验证方法。
- [Anthropic 与 MCP 一手资料](research/anthropic-mcp.md)：协议细节、历史保留、版本差异与待实测项。

后续从设计的待确认项继续；已指定方向与其余提案分开，不把保存或提交等同于批准实施。

## 检查与保存状态

- 首轮 `rtk pnpm run check:docs`：检查 291 个 Markdown 文件，0 个问题，退出码 0。首轮相对链接问题已修正；追加调研结果在本轮交付前统一重验。
- 追加调研 `rtk pnpm run check:docs`：检查 295 个 Markdown 文件，0 个问题，退出码 0；`rtk git diff --check` 退出码 0。外部本地源码使用路径与行号文本，公开源码使用固定 commit 链接。
- 设计及程小帮补充研究在 main 目录检查：`rtk pnpm run check:docs` 检查297个 Markdown 文件，0个问题，退出码0。共9个任务 Markdown 文件，均从此入口可达；设计保持 draft，仅 BM25 与 Rukie 参考方向属于用户已指定内容。
- 已从本入口读回各专项和综合正文：官方事实、社区源码观察、旧版记录与工程建议分开；未改变既有规格、ADR 或当前行为；全部材料从此入口可达。
- 前两轮研究最初保存于 detached worktree，未在那里提交；本轮将研究依据一并保存到主仓库 `/Users/artorias_chan/Workspaces/person/coko` 的 main。提交范围仅此任务目录，已有的正式文档修改与 `hand offs/` 不纳入。提交标识以本轮 Git 记录及交付回执为准，不推送远端。
- 未运行真实模型、真实 MCP 联调或产品行为测试；没有 token、延迟或检索准确率的测量结论。
