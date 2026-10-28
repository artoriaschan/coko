# 03: 指令文件：加载、作用域、@import 与嵌套按需加载

**What to build:** agent `instructions/rules/`：按 [规格](../spec.md#加载位置与优先级) 读取用户级与仓库根到 Workspace 的 AGENTS.md（缺省 CLAUDE.md），近处优先，组成 `<instructions>` system section（claude-code 前导语，每个文件 `<instruction_file path scope>`）；@import（叶子文本、5 层、防环、文本扩展名、只在仓库根 / Workspace 与 `COKO_HOME` 内，越界记 `import-outside-boundary`）；预算 40 000 / 120 000；子目录指令在 read / write / edit / grep / find / ls 首次触及该目录时追加到 toolResult（afterToolCall hook，每个运行时记已加载集合）。server `application/context/instructions.ts` 实现贡献：systemSections、hooks、report（文件、字符数、截断、诊断），受 `instructions.enabled` 控制；日志 `instructions loaded`。

**User stories:** 1, 2, 3, 4

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/instructions/rules/`、`apps/server/src/application/context/instructions.ts`、`tests/integration/sidecar-instructions.test.ts`（新）、`tests/fixtures/instructions/`（新）、`docs/subsystems/instructions.md`（新）

- [ ] agent 表驱动测试：顺序（用户 → 仓库根 → Workspace）；同目录 AGENTS.md 优先于 CLAUDE.md；没有 `.git` 时只读 Workspace；仓库根不越过家目录；@import 的相对、`~/`、绝对形式，代码块与行内代码中不展开，循环与第 6 层被截断并诊断，缺失文件静默跳过并诊断，越界不展开；单文件与合计预算截断并注明
- [ ] 集成测试（临时 `COKO_HOME`）：faux requestLog 的系统提示含用户级与项目级指令且顺序正确；修改文件后下一次 Run 读到新内容；`.coko/settings.json` 设 `instructions.enabled: false` 后不注入
- [ ] 集成测试：read 子目录 `pkg/a.ts` 后该次 toolResult 末尾附 `pkg/AGENTS.md`，同一运行时第二次触及不重复；条目读回与回放一致
- [ ] 贡献的 `report()` 返回已加载文件与诊断（单元测试；界面由票 10 显示）
- [ ] instructions.md 建立并可达（导航行写在 Comments）；ADR 0009 的证据由票 05 汇总，本票在 Comments 列出自己的测试名；`pnpm run check:docs` 通过

## Comments
