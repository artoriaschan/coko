# 05: Seatbelt 沙箱、单次提权与 Secrets 注入

**What to build:** ExecRequest 增加 `sandbox: { mode, writableRoots }`，由 Permission Mode 决定（ADR 0005）；server `adapters/seatbelt.ts` 用 sandbox-exec 包裹命令（profile 与可写根见 [规格](../spec.md#implementation-decisions)），启动探测失败或可执行缺失时受限档位 fail-closed（`sandbox-unavailable`），full-access 不包裹；拒绝检测追加 DSH 拒绝标记与提权提示。bash 增加 `sandbox_permissions` / `justification`（成对、严格更宽、等于当前视为不提权、更窄报错）；kind=escalation 的 Approval Request 只能批准一次或拒绝，替代该次的普通审批；write/edit 越出可写根的写入审批即该次提权（不显示总是允许）。Secrets：工具契约 `secrets`、SecretProvider 端口，只注入该次调用；测试用宿主工具验证。提权卡（审批卡变体）。

**User stories:** 12, 13, 14, 15

**Blocked by:** 03, 04

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/ports/`、`packages/agent/src/policy/sandbox.ts`（新）、`packages/agent/src/policy/`（判定接入可写根）、`packages/agent/src/tools/types.ts`、`packages/agent/src/tools/builtin/bash.ts`、`packages/agent/README.md`、`apps/server/src/adapters/seatbelt.ts`（新）、`apps/server/src/adapters/ripgrep.ts`（createWorkspaceTools）、`apps/server/src/adapters/credentials.ts`、`apps/server/src/runtime/layers.ts`、`apps/server/src/config.ts`、`apps/server/src/application/sessions.ts`、`apps/server/README.md`、`apps/desktop/src/renderer/features/conversation/`、`packages/i18n/src/dictionaries/`、`apps/desktop/e2e/`、`tests/integration/`、`docs/subsystems/permissions.md`、`docs/adr/0005-permission-mode-and-sandbox.md`、`docs/adr/README.md`

- [x] darwin 集成测试：default 模式下已批准的 `echo x > <Workspace 外临时目录>/f` 失败，结果含拒绝标记与提权提示，文件不存在；Workspace 内与 `/tmp` 写入成功
- [x] darwin 集成测试：read-only 模式下已批准的命令不能写 Workspace
- [x] 集成测试：带 `sandbox_permissions: danger-full-access` 与 justification 重试 → escalation 审批卡显示目标档位与理由；批准一次后成功；随后不带参数的同一命令再次被拒；拒绝提权 → 错误文本要求停止并说明
- [x] 集成测试：只给 justification、目标档位更窄 → 参数错误且不弹审批
- [x] 集成测试：`COKO_SANDBOX_EXEC` 指向不存在路径 → 受限档位命令返回 sandbox-unavailable 且未执行（标记文件不存在）；full-access 正常
- [x] 集成测试：accept-edits 下 write 到 Workspace 外 → 询问且无"总是允许"；批准后写入成功、未生成规则
- [x] 集成测试：声明 `secrets: ['COKO_TEST_SECRET']` 的测试宿主工具在其子进程中拿到值；同一 Session 的 bash `env` 中没有
- [x] 秘密总闸追加驱动：沙箱拒绝输出与提权流程后仍无明文
- [x] 产物 smoke：打包产物中受限命令无法写 Workspace 之外
- [x] ADR 0005 的 partial 说明与 permissions.md 同步

## Comments
- 2026-10-29 lead：规划风险"workspace-write 拒绝写 ~/.npm、~/.cache 导致频繁提权"——参考 DSH sandbox-local 的 Seatbelt profile 处理方式（临时目录与常见包管理缓存是否默认可写），沿用 DSH 的默认可写集合并在票 Comments 列出；不要静默放开整个 HOME。
- 2026-10-29 implementer（m2/05-seatbelt-sandbox-and-secrets）：
  - **默认可写集合（回应 Lead）。** 读 DSH `packages/sandbox/sandbox/src/roots.ts` 与 `sandbox-local/src/profiles.ts`：workspace-write 的可写根为 Workspace、`/tmp`、`os.tmpdir()`（均 realpath），profile 另放行 `/dev/null`；`additionalWritableRoots` 默认空。DSH 不默认放开 `~/.npm`、`~/.cache` 或 HOME，沿用之。写这些位置的命令被拒后走提权或切模式；ADR 0005 与 permissions.md 已写明。
  - **越出写范围的改动（请裁决）。** `packages/agent/src/engine/runtime.ts`：最小接入，含执行上下文补充（沙箱策略按执行时模式现算、已批准提权按 toolCallId 取用、Secrets 解析）、`secrets` 选项、给 gate 的 `grantEscalation`。ToolExecutionContext 由运行时构造，不改它无法把档位交给 bash。06 之前没有并行票写 engine。新文件 `apps/server/src/adapters/test-tools.ts`（secret_probe，仅 `COKO_TEST_TOOLS=1` 注册）、`adapters/seatbelt.test.ts`，以及相邻测试 `apps/server/src/config.test.ts`、`packages/agent/src/tools/builtin/bash.test.ts`、`packages/agent/src/ports/local-exec.test.ts`。新导出（SandboxPolicy、LocalSandbox、SandboxUnavailableError、SecretProvider 等）经 `policy/index.ts` barrel 导出，未改 `packages/agent/src/index.ts`。`tests/integration/sidecar-harness.ts` 只给 `ApprovalRequestEntry` 加了可选的 `targetMode`、`justification`。
  - **判断点。** 无反馈拒绝提权：Run 在本批结束后以 aborted 结束（与 US 4 一致），模型收到 DSH 文本"stop and explain"。提权请求不参与 reevaluate（只能允许一次或拒绝）。档位等于当前档位时不需要理由；不在 enum 内的档位由 pi 参数校验拒绝。Secrets 来源：`createEnvSecretProvider` 按声明的名字读 Sidecar 自身的环境（M3 再定真实映射），值只进 `context.secrets`。
  - **行为变化。** 没有 LocalSandbox 时受限档位一律 fail-closed，因此 `policy/approvals.test.ts` 改用不做限制的替身沙箱；`sidecar-session.test.ts` 的租约夺取用例要写 Workspace 外的 coko.db，改在 full-access 下运行。非 darwin 平台上 default / accept-edits / read-only 的 bash 一律 `sandbox-unavailable`（ADR 0005 已接受）。
  - **覆盖与命令。** `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run lint`（0 / 0）、`pnpm run format:check`、`pnpm run check:docs`（82 文件 0 问题）均通过；`pnpm run test`（含 desktop E2E、package 产物 smoke）：80 个文件，658 通过，1 跳过（真实 DeepSeek 凭据用例，本机无密钥）。新增：`tests/integration/sidecar-sandbox.test.ts`（7 个用例，覆盖本票前 6 条验收）、`secrets-gate.test.ts` 第二个用例（darwin：沙箱拒绝输出、escalation、secret_probe 后仍无明文）、`apps/desktop/e2e/sandbox.e2e.test.ts`（提权卡）、`package-smoke.e2e.test.ts`（产物中受限命令无法写 Workspace 之外）。变异检查：把 Seatbelt 包裹改为空前缀后，4 个依赖 Seatbelt 的集成用例失败。
  - **未验证。** 非 darwin 平台（Seatbelt 用例显式 skipIf；fail-closed 路径用 COKO_SANDBOX_EXEC 在本机验证）；真实模型对话（无凭据）。
  - **文档。** ADR 0005 → implemented（附实现与验证证据），`docs/adr/README.md` 对应行，`docs/subsystems/permissions.md` 新增"命令沙箱与提权"一节，`packages/agent/README.md`、`apps/server/README.md`；关于页安全说明与模式说明文案已更新（zh / en）。TECH_STACK 未改（无新依赖，sandbox-exec 为系统自带）。

