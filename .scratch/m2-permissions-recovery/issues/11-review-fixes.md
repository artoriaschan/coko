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
