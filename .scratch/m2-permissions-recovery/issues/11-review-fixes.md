# 11: M2 两轴评审修复

**What to build:** 处理 [Standards 评审](../review-standards.md)（H*/J*/S*）与 [Spec 评审](../review-spec.md)（F*/P*）中 Lead 指定的项：安全边界（F1 打包产物剥离测试钩子、F2 规则工具名归一、F3 目录工具的读取拒绝过滤、F4 Seatbelt 拒绝受保护子路径、F5 / J1 写入前复核真实路径、J1 / F6 回退时复核真实路径并原子写入、J2 提权须先被沙箱拒绝、F8 Secrets 不返回 Provider Credential）、正确性（F7、J3、J5、J6、F10、P2、P1）、规范（H1–H5）与 S1。其余 S* 与 J4 不做，理由写在评审文件末尾。

**User stories:** 4, 8, 12, 13, 14, 15, 20, 21, 28

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10

**Status:** ready-for-agent

**Write scope:** 评审涉及的全部源码、测试与文档（packages/agent、packages/protocol、apps/server、apps/desktop 的 main / build / renderer / e2e、packages/i18n 字典、tests/integration、docs/adr/0005、0006、docs/subsystems、docs/tech-stack/agent-runtime.md、observability.md、各 README）；两份评审文件末尾的"处理结果"。

- [x] F1：打包的发布构建中 main 不把 COKO_SANDBOX_EXEC、COKO_TEST_*、COKO_FAUX_SCRIPT 交给 Sidecar，并传 --packaged；Sidecar 在 --packaged 且不是测试构建时不读它们；产物 smoke 改用构建期标志 COKO_TEST_BUILD=1 的测试构建（地图 Carry-over 中原定 M6 的一项提前完成）
- [x] F2：规则工具名写入时归一为规范名，未知工具 400 unknown-tool（设置分区行内提示）；库中非规范写法读入时归一；deny bash(rm *) 与 Write(secret.txt) 生效
- [x] F3：grep / find / ls 逐条过滤被 Read 拒绝规则覆盖的路径（选择过滤而不是询问，见 Comments）
- [x] F4：Seatbelt workspace-write 在可写根之后对受保护路径段追加 deny
- [x] F5 / J1（写入侧）：write / edit 执行前按真实路径复核，与判定时不同则重新判定（deny 拒绝、ask 再询问），复核不通过不提交 tool_exec
- [x] J1 / F6（回退侧）：restoreFiles 逐个复核真实路径，不一致的列入 skipped 且不处理；Workspace 外与受保护路径列入 outside，对话框单独列出并警告；写入为临时文件 + rename
- [x] J2：提权只用于重试本 Run 中被沙箱拒绝过的同一命令
- [x] F8：环境变量 SecretProvider 不返回 COKO_CREDENTIAL_* 与各 kind 的 *_API_KEY
- [x] F7：启动恢复失败的 Session 以 409 recovery-failed 拒绝 Run、继续、回退与分叉，下次操作时重试恢复；界面有明确提示
- [x] J3：暂停只改写被暂停取消的审批，规则拒绝的文本保留
- [x] J5：缺少 Secret 时不提交 tool_exec
- [x] J6：待确认状态单一来源，注释与代码一致
- [x] F10：重新判定仍需询问但原因或建议变了时 superseded 并重新询问，不再提供过期的"总是允许"
- [x] P2：最后一条是 assistant 文本时横幅仍提供"继续"
- [x] P1：Sidecar 级的并发屏障观测
- [x] H1–H5、S1
- [x] 两份评审文件末尾追加"处理结果"；ADR 0005 / 0006、permissions.md、recovery.md、README 同步

## Comments

- 2026-10-29 implementer（分支 m2/11-review-fixes）：

  **覆盖的验收**：上列各项，逐项的处理与测试位置见 [Standards 评审](../review-standards.md#处理结果) 与 [Spec 评审](../review-spec.md#处理结果) 末尾的"处理结果"。

  **选择与说明**
  - F3 选过滤而不是询问：搜索根下有拒绝规则是常态（例如 `Read(.env)`），每次搜索都询问会让规则失去意义。过滤按结果路径与按搜索根真实路径换算后的路径判定（目录遍历不跟随符号链接）。
  - F1：Carry-over 中原定 M6 的"发布构建关闭测试钩子、产物 smoke 改用测试构建"在本票完成（Lead 可在地图勾除）。构建期标志为 `COKO_TEST_BUILD=1`，E2E globalSetup 打包时设置；手工 `pnpm run package` 不设时为发布构建。打包的发布构建中剥离与忽略的行为由单元测试与 `sidecar-boot.test.ts`（`--packaged`）覆盖，没有为发布构建另打一次包做 E2E。
  - J2 按评审方案 (a) 让代码向 ADR 0005 与 GLOSSARY 看齐，ADR 只追加了实施说明，没有改决定句。模型第一次就带提权参数会得到参数错误，需要先不带参数运行一次。
  - F5：复核在调度器新增的执行前准备（取得执行槽之后、`tool_exec` 之前）中进行，J5 的 Secrets 预检、沙箱档位与读取过滤也移到这里。残留：复核之后放行的写入，Checkpoint 的备份仍是判定时的路径。
  - F6：Workspace 外与受保护路径在对话框中单独列出，并以 alert 警告，没有加勾选确认。
  - H4：fork 移到 `agents/`，并新增 `agents/index.ts`，因此改了 `packages/agent/src/index.ts` 的一行 re-export（原为票 01 独占的装配点；本票串行，没有并行票冲突）。
  - H5：dialog 改为按 key 重新挂载后，StrictMode 会在挂载时同时发出两次预览，旧的 `#exclusively` 让第二次以 session-busy 失败（全量运行中 rewind E2E 两例因此失败）。现在 dry-run 检查同样的前置条件但不登记独占，补了并发预览用例（先确认该用例在修复前失败）。
  - P2：运行时的 continue 不能从 assistant 消息开始，横幅的"继续"在这种情况下提交一条本地化的"继续"用户消息。

  **越界的最小改动**：本票写范围按评审涉及的文件确定；另改了 `apps/desktop/src/renderer/main.tsx`（forkTitle 接线）、`apps/desktop/build/build.ts` 与 `e2e/global-setup.ts`（构建期标志）、`docs/tech-stack/observability.md`（登记 approvalId）。

  **实际运行的命令与结果**（worktree，main ba5a21a 已合入，`git merge main` 为 Already up to date）
  - `pnpm install --frozen-lockfile && pnpm run typecheck && pnpm run lint && pnpm run format:check && pnpm run check:docs && pnpm run test`：退出 0。lint 0 警告 0 错误；check:docs 86 个文件 0 问题；test 107 个文件，822 通过、1 跳过（真实模型，无密钥），含 desktop E2E 与 package-smoke 产物 smoke。
  - 先红：F1 sidecar-env 与 config、F2 decide 与 sidecar-permissions、F3 read-filter、execution-checks 中的 6 例（F3、F5、J5、J2、J3、F10）、F4 seatbelt、J1/F6 rewind、F7 与 F8、P2、H2、S1 message 样例、并发预览，都在实现前确认失败。P1 是对已有行为的补测，没有红阶段。S1 编译期断言以临时改动 protocol 确认 tsc 失败后撤销。

  **未验证项**
  - 打包的发布构建（不设 COKO_TEST_BUILD）没有跑产物 E2E，只有单元测试与 `--packaged` 的 Sidecar 集成测试。
  - Seatbelt 的受保护路径 deny 只在本机 darwin 上验证；非 darwin 平台受限档位本就 fail-closed。
  - 真实模型对话未验证（无密钥）。
  - J4、S2–S5、S7、S10、S11 未做，S6、S8、S9 部分完成，理由见评审文件的"处理结果"。

  **文档影响**：ADR 0005、0006（实施与评审修复说明，决定句未改）、docs/subsystems/permissions.md、recovery.md、docs/tech-stack/agent-runtime.md（目录图）、observability.md、apps/server 与 packages/agent 的 README。
- 2026-10-29 lead：评审后合入 main（09f5193）。接受越界：renderer main.tsx 的 forkTitle 接线、desktop build.ts 与 e2e global-setup 的构建期标志、observability.md 的 approvalId、agent index.ts 一行 agents/ 导出。接受行为变更：首次请求提权且未被沙箱拒绝时返回 invalid escalation。main 上复核：install、typecheck、lint、format:check 退出 0；全量 test 107 文件 822 通过、1 跳过（真实模型），无页面重载；check:docs 86 文件 0 问题；源码中无 .scratch 引用。未验证：不带 COKO_TEST_BUILD 的发布构建产物 E2E。worktree 已清理。

Closed: true
