# 03: 指令文件：加载、作用域、@import 与嵌套按需加载

**What to build:** agent `instructions/rules/`：按 [规格](../spec.md#加载位置与优先级) 读取用户级与仓库根到 Workspace 的 AGENTS.md（缺省 CLAUDE.md），近处优先，组成 `<instructions>` system section（claude-code 前导语，每个文件 `<instruction_file path scope>`）；@import（叶子文本、5 层、防环、文本扩展名、只在仓库根 / Workspace 与 `COKO_HOME` 内，越界记 `import-outside-boundary`）；预算 40 000 / 120 000；子目录指令在 read / write / edit / grep / find / ls 首次触及该目录时追加到 toolResult（afterToolCall hook，每个运行时记已加载集合）。server `application/context/instructions.ts` 实现贡献：systemSections、hooks、report（文件、字符数、截断、诊断），受 `instructions.enabled` 控制；日志 `instructions loaded`。

**User stories:** 1, 2, 3, 4

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/instructions/rules/`、`apps/server/src/application/context/instructions.ts`、`tests/integration/sidecar-instructions.test.ts`（新）、`tests/fixtures/instructions/`（新）、`docs/subsystems/instructions.md`（新）

- [x] agent 表驱动测试：顺序（用户 → 仓库根 → Workspace）；同目录 AGENTS.md 优先于 CLAUDE.md；没有 `.git` 时只读 Workspace；仓库根不越过家目录；@import 的相对、`~/`、绝对形式，代码块与行内代码中不展开，循环与第 6 层被截断并诊断，缺失文件静默跳过并诊断，越界不展开；单文件与合计预算截断并注明
- [x] 集成测试（临时 `COKO_HOME`）：faux requestLog 的系统提示含用户级与项目级指令且顺序正确；修改文件后下一次 Run 读到新内容；`.coko/settings.json` 设 `instructions.enabled: false` 后不注入
- [x] 集成测试：read 子目录 `pkg/a.ts` 后该次 toolResult 末尾附 `pkg/AGENTS.md`，同一运行时第二次触及不重复；条目读回与回放一致
- [x] 贡献的 `report()` 返回已加载文件与诊断（单元测试；界面由票 10 显示）
- [x] instructions.md 建立并可达（导航行写在 Comments）；ADR 0009 的证据由票 05 汇总，本票在 Comments 列出自己的测试名；`pnpm run check:docs` 通过

## Comments

### 实施者报告（m3/03-instruction-files，2026-10-29）

**覆盖的验收**

1. agent 表驱动（`packages/agent/src/instructions/rules/rules.test.ts`，37 例）："发现与顺序"（用户 → 仓库根 → … → Workspace；AGENTS.md 优先、缺省 CLAUDE.md、大小写不敏感；没有 `.git` 只读 Workspace；`.git` 为文件；家目录有 `.git` 不算仓库、Workspace 即家目录时不读父目录；符号链接按真实路径去重；mtime）；"@import"（`./`、裸路径、绝对、`~/` 越界与指向 COKO_HOME 内两种、`../` 越界；围栏 / 行内代码 / HTML 注释 / 邮件地址不展开；环、菱形不诊断、第 6 层截断、缺失、非文本、经符号链接越界、无 .git 时根为 Workspace）；"预算"（单文件截断并注明、合计从最远处丢弃）；section 格式；嵌套 hook。
2. 集成 `tests/integration/sidecar-instructions.test.ts` 第 1 例：requestLog 的 `sections` 为 `coko.base`、`instructions`，USER → STYLE（import）→ REPO → APP 顺序，越界与代码块中的 import、嵌套 pkg 不在其中；改 CLAUDE.md 后下一个 Run 读到 V2；`.coko/settings.json` 设 `instructions.enabled: false` 后开头系统消息为 `DEFAULT_SYSTEM_PROMPT` 且无 sections；日志 `instructions loaded` 两条（第三个 Run 没有）。
3. 同文件第 2 例：read `pkg/a.ts` 的 toolResult 末块为 `<instruction_file path=".../pkg/AGENTS.md" scope="nested">`（protocol `nestedInstructionPath` 识别）；同 Run 下一批 read `pkg/b.ts` 与下一个 Run 再 read `pkg/a.ts` 不再附加；下一次请求发给模型的 toolResult 含该块；重新订阅（afterSeq 0）读回的条目与实时推送逐项相等。
4. `apps/server/src/application/context/instructions.test.ts`：`report()` 返回文件（path、scope、chars、truncated）、`breakdown.instructions` 与诊断；关闭时无 section、无 hook、report 为空。
5. `docs/subsystems/instructions.md` 新建；`pnpm run check:docs` 107 个文件 0 问题。

**实际运行的命令与结果**（worktree，HEAD 基于 main ffa568b，`git merge main` 为 Already up to date）

- `pnpm install --frozen-lockfile` 0；`pnpm run typecheck` 0；`pnpm run lint` 0 警告 0 错误；`pnpm run format:check` 0；`pnpm run check:docs` 0 问题。
- `pnpm run test`（unset ELECTRON_RUN_AS_NODE）：122 文件通过，953 通过、1 跳过（settings E2E 中已有的跳过），含 desktop E2E 与 `package-smoke.e2e.test.ts`（2 例）；无未处理错误。基线（票 01 报告）116 文件 / 884 通过；票 02 之后的 main 未单独复跑。

**负向确认**（变异后对应用例失败，撤销后通过）

- loader：去掉环检查、去掉真实路径边界检查、深度上限 +1、丢弃改为从最近处 → 各 1 例失败。imports：不去掉代码块 → 1 例失败。discover：家目录边界改为只到 `/` → 1 例失败。nested：去掉同批 pending、去掉 isError 判断 → 各 1 例失败。
- server：`systemSections` 不看 `instructions.enabled` → 单元与集成各 1 例失败。
- 修改前 `sidecar-context-seam.test.ts` 因 COKO_HOME 中的 AGENTS.md 进入系统提示而失败（预期，见越界改动）。

**实现选择（未改变规格语义，供评审）**

- "每个运行时记已加载集合"实现为从当前模型上下文中 toolResult 的嵌套块派生（同一条 assistant 消息的并行调用另经 pending 串行去重）。效果与规格一致：同一会话不重复、压缩或回退移除这些块后重新加载；此外 Sidecar 重启后也不重复（运行时重建时块仍在上下文中）。
- 没有扩展名的 @import 目标不展开（`import-not-text`），按"只接受文本扩展名"从严；缩进代码块不识别（文档已注明）。
- 嵌套加载只受单文件 40 000 限制，不计入 120 000 合计；`report()` 只覆盖 Run 开始时的加载，嵌套加载记日志 `nested instructions loaded`。
- 嵌套 hook 不经权限判定读取 AGENTS.md（与系统级加载相同）。

**未验证项**

- 真实模型：无凭据，未运行。
- 产物 smoke 未传 `COKO_HOME`（文件归票 11）：本票起其 Sidecar 会读真实 `~/.coko/AGENTS.md`；本机不存在该目录，smoke 通过。票 11 扩充 smoke 时应传临时 `COKO_HOME`。

**越出 Write scope 的改动**（请 Lead 裁决）

- `tests/integration/sidecar-context-seam.test.ts`（票 01）：COKO_HOME 中写入的 `AGENTS.md` 改为 `notes.txt`，注释同步。该用例断言"空贡献时请求与 M2 相同"，本票起指令文件会进入系统提示；断言不变。
- `apps/server/src/application/context/instructions.test.ts`（新）：票要求 `report()` 的单元测试，放在被测文件旁。`instructionsContribution` 增加可选第二参数 `{ loader? }` 供注入（签名兼容 `context/index.ts` 的调用）。
- `docs/README.md` "当前行为"增加一行：`- [指令文件](subsystems/instructions.md)：AGENTS.md / CLAUDE.md 的发现顺序、@import、预算、注入格式与嵌套按需加载。`（check:docs 的可达性要求；与并行票冲突时由 Lead 合并）。
- 未改 `packages/protocol/src/instructions.ts`（不在 scope；其注释写"票 03 声明 DTO"）：已加载文件与诊断的形状目前由 server `ContextReport.instructions` / `diagnostics` 承载，票 10 定义上下文用量协议时可在此声明。

**文档影响**：新增 `docs/subsystems/instructions.md`；`packages/agent/README.md` 未改（归 01 → 11），如需列出 `instructions/rules` 导出由后续所有者补充。ADR 0009 的证据（供票 05 汇总）：`tests/integration/sidecar-instructions.test.ts` 的"系统提示含用户级与项目级指令……改文件后下一次 Run 读到新内容……"与"read 子目录 pkg/a.ts 后……"两例。

### 供后续票

- **agent 导出**（经 `@coko/agent`）：`createInstructionLoader({ files, homeDir })` → `load({ cwd, cokoHome })` / `nested({ cwd, cokoHome, targetDir, loaded })`，结果 `LoadedInstructions { files: InstructionFile[]; diagnostics; totalChars }`，`InstructionFile { path, scope: 'user' | 'project' | 'nested', content, chars, truncated, importedBy? }`；`createNodeInstructionFiles()`（`ReadOnlyFiles` + `realpath`）；`formatInstructionsSection`、`formatInstructionFile`、`INSTRUCTIONS_SECTION = 'instructions'`、`INSTRUCTIONS_PREAMBLE`；`nestedInstructionsHook({ loader, cwd, cokoHome, files?, onLoad? })`、`NESTED_TRIGGER_TOOLS`；常量 `INSTRUCTION_FILE_MAX_CHARS`、`INSTRUCTIONS_TOTAL_MAX_CHARS`、`MAX_IMPORT_DEPTH`。
- **票 10（上下文用量）**：`instructions` 贡献的 `report(scope)` → `{ breakdown: { instructions: <section 字符数> }, instructions: { path, scope, chars, truncated }[], diagnostics: ResourceDiagnostic[] }`；诊断代码见 instructions.md。
- **票 11（压缩）**：嵌套指令的"已加载"从模型上下文派生，压缩把 toolResult 换成摘要后自然清空，无需额外重置；若摘要保留了 `<instruction_file … scope="nested">` 开头的 toolResult 文本块，该文件不会重新加载。
- **票 06（File Reference）**：嵌套块与 `<file_reference>` 同为 toolResult / user message 中的独立文本块；renderer 用 protocol `nestedInstructionPath` 识别（agent 内有一份同样的正则 `nestedInstructionBlockPath`，集成测试经 protocol 函数核对）。
