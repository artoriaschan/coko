# 04: Sandbox 写根收紧到 work 与 outputs

**What to build:** 独立会话的权限模型从“整个会话根可写”收紧为：权限根仍是会话根，但写根只有 `work/` 与 `outputs/`。Agent 在 `work/` 与 `outputs/` 内写文件不需要额外审批；在会话根其他位置写文件按越界写入处理并走审批。项目会话保持现有行为。

**Blocked by:** 03 独立会话目录与 work/outputs

**Status:** ready-for-agent

- [x] 在 `work/` 与 `outputs/` 内创建、修改、删除文件按当前权限模式正常放行。
- [x] 在会话根其他位置写文件被判定为越界，按现有审批流程处理；只读模式下同样被拒绝。
- [x] 读取边界保持为会话根，Agent 能读取 `work/`、`outputs/` 与会话根内的其他只读内容。
- [x] 项目会话的写根仍是项目根，不出现 `work/`、`outputs/` 的特殊规则。
- [x] 文件 checkpoint 与文件工具在新写根下正常工作；集成测试覆盖允许、拒绝与审批三条路径。
- [x] 写根扩展的决定同步到权限与沙箱的 ADR 或设计说明。


**Closed:** true

## Comments

### 完成依据（2026-11-05）

- 根读取与写入拆分：运行时 `workspaceRoots` 保持会话读取根；`writeRoots` 在托管独立会话中明确设为根内的 `work/`、`outputs/`，不追加临时根。项目、旧会话、full-access 与单次提权保留原有语义。
- 真实 Sidecar red → green：首条用例原先没有根级写入审批而失败，修复后只对根级写入生成单次审批；`outputs/` 回退预览原先误报为 outside，修复后恢复原内容且 outside 为空。读根、write/edit、允许一次、用户拒绝、越界链接均通过实际协议与磁盘核对。
- 只读证据分开：文件工具沿用现有审批机制，测试选择拒绝后没有写入；真实 darwin Seatbelt 测试批准命令后仍以内核只读策略拒绝根写入，不把用户拒绝描述为自动模式拒绝。
- 在 `/tmp` 下创建会话根验证 workspace-write 不会被系统临时目录授权重新拓宽；允许 `work/outputs` 的创建与删除，并拒绝根其他位置。
- `rtk pnpm run test tests/integration/sidecar-standalone-write-roots.test.ts tests/integration/sidecar-project-permissions.test.ts tests/integration/sidecar-sandbox.test.ts tests/integration/sidecar-checkpoints.test.ts tests/integration/sidecar-rewind.test.ts packages/agent/src/policy/execution-checks.test.ts packages/agent/src/policy/escalation.test.ts packages/agent/src/checkpoints/rewind.test.ts apps/server/src/adapters/seatbelt.test.ts`：9 文件、91 项通过（0 跳过，含 darwin 原生 Seatbelt）。后补删除断言后精确重跑 `/tmp` 用例：1 项通过、6 项过滤。
- `rtk pnpm run typecheck` 通过；改动 TypeScript 的 oxfmt/oxlint 通过；`rtk pnpm run check:docs`：378 个 Markdown、0 问题。
- 文档：新增 ADR 0026 局部承接 ADR 0005 的写根决定，同步 ADR 索引、权限与 Worktree 当前契约、Agent 包 README。从 AGENTS → docs/README → 正文读回，链接、根范围、只读与提权语义一致，无正式正文对任务材料的反向依赖。
- 未验证：Windows 实机、真实模型、Electron 前台原生层；本票无 UI 变更，真实进程入口由 Sidecar 覆盖。未运行全仓测试、未推送或发布。
