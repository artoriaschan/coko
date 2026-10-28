# 地图：Coko 桌面应用

Label: wayfinder:map
Status: open

## Destination

在 macOS arm64 本地构建并运行的 Coko 桌面应用（apps/desktop + apps/server + packages/*），按 [Agent 执行约定](../../docs/tech-stack/agent-runtime.md) 的框架能力分工表实现全部能力；设置与会话存储在 SQLite。地图的终点是：每个里程碑都有可交给 grill-with-docs → to-spec → to-tickets → implement-spec → retro 的明确边界，且路线上已没有待决问题。

## Notes

- 领域：Electron + sidecar 的 coding-agent 桌面应用。每轮先读 [TECH_STACK](../../docs/TECH_STACK.md) 与 [专项导航](../../docs/tech-stack/README.md)。
- 用户常设指示（2026-10-28 goal）：需要讨论澄清的问题**直接采用推荐答案**，优先沿用参考项目的决策；grilling 票由 Agent 写出推荐并按此指示采纳，Answer 中标明"按常设指示采纳"，与用户逐条确认的结论区分。
- 参考：packages/agent 的编码实现优先参考 pi `packages/coding-agent`（/Users/chenzheng/Desktop/Work/open_sources/pi），相关逻辑参考 claude-code（/Users/chenzheng/Desktop/Work/open_sources/claude-code）；apps/desktop 优先参考 deepseek-harness（/Users/chenzheng/Desktop/Work/open_sources/deepseek-harness），尤其 UI 交互与设计系统。
- 执行覆盖：本地图允许把执行带入路线——地图解决后按里程碑逐个走 grill-with-docs → to-spec → to-tickets → implement-spec → retro。每个实施票从 main 拆分支、在 worktree 开发，验收后合入 main 并清理 worktree。
- 仓库无 remote：research 分支与 PR 不可推送，研究结果保存在本目录 research/ 并随 main 提交。
- 环境事实：pnpm 12.15.0 经公司 Artifactory 安装；首次下载 pnpm 二进制需要 `NODE_TLS_REJECT_UNAUTHORIZED=0`（公司证书），之后缓存可用。

## Decisions so far

<!-- 一行一张已解决的票 -->

## Not yet specified

- 各里程碑内部的功能切片与验收场景：等里程碑划分确定后，在各自的 `.scratch/<milestone>/` 中经 grill-with-docs 细化。
- Browser / Computer Use、Code Intelligence（LSP）的具体适配器选择：依赖参考项目研究结论。
- Plugins 的分发来源与安装格式、Agent Teams 的工作区隔离方式。
- 自动更新 feed 与签名/公证：取决于是否有 Apple 开发者证书与发布目的地。
- Evals 的回放数据来源与评测指标。

## Out of scope

- Windows / Linux 构建与发布（TECH_STACK 首发范围仅 macOS arm64）。
