# 05: Seatbelt 沙箱、单次提权与 Secrets 注入

**What to build:** ExecRequest 增加 `sandbox: { mode, writableRoots }`，由 Permission Mode 决定（ADR 0005）；server `adapters/seatbelt.ts` 用 sandbox-exec 包裹命令（profile 与可写根见 [规格](../spec.md#implementation-decisions)），启动探测失败或可执行缺失时受限档位 fail-closed（`sandbox-unavailable`），full-access 不包裹；拒绝检测追加 DSH 拒绝标记与提权提示。bash 增加 `sandbox_permissions` / `justification`（成对、严格更宽、等于当前视为不提权、更窄报错）；kind=escalation 的 Approval Request 只能批准一次或拒绝，替代该次的普通审批；write/edit 越出可写根的写入审批即该次提权（不显示总是允许）。Secrets：工具契约 `secrets`、SecretProvider 端口，只注入该次调用；测试用宿主工具验证。提权卡（审批卡变体）。

**User stories:** 12, 13, 14, 15

**Blocked by:** 03, 04

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/ports/`、`packages/agent/src/policy/sandbox.ts`（新）、`packages/agent/src/policy/`（判定接入可写根）、`packages/agent/src/tools/types.ts`、`packages/agent/src/tools/builtin/bash.ts`、`packages/agent/README.md`、`apps/server/src/adapters/seatbelt.ts`（新）、`apps/server/src/adapters/ripgrep.ts`（createWorkspaceTools）、`apps/server/src/adapters/credentials.ts`、`apps/server/src/runtime/layers.ts`、`apps/server/src/config.ts`、`apps/server/src/application/sessions.ts`、`apps/server/README.md`、`apps/desktop/src/renderer/features/conversation/`、`packages/i18n/src/dictionaries/`、`apps/desktop/e2e/`、`tests/integration/`、`docs/subsystems/permissions.md`、`docs/adr/0005-permission-mode-and-sandbox.md`、`docs/adr/README.md`

- [ ] darwin 集成测试：default 模式下已批准的 `echo x > <Workspace 外临时目录>/f` 失败，结果含拒绝标记与提权提示，文件不存在；Workspace 内与 `/tmp` 写入成功
- [ ] darwin 集成测试：read-only 模式下已批准的命令不能写 Workspace
- [ ] 集成测试：带 `sandbox_permissions: danger-full-access` 与 justification 重试 → escalation 审批卡显示目标档位与理由；批准一次后成功；随后不带参数的同一命令再次被拒；拒绝提权 → 错误文本要求停止并说明
- [ ] 集成测试：只给 justification、目标档位更窄 → 参数错误且不弹审批
- [ ] 集成测试：`COKO_SANDBOX_EXEC` 指向不存在路径 → 受限档位命令返回 sandbox-unavailable 且未执行（标记文件不存在）；full-access 正常
- [ ] 集成测试：accept-edits 下 write 到 Workspace 外 → 询问且无"总是允许"；批准后写入成功、未生成规则
- [ ] 集成测试：声明 `secrets: ['COKO_TEST_SECRET']` 的测试宿主工具在其子进程中拿到值；同一 Session 的 bash `env` 中没有
- [ ] 秘密总闸追加驱动：沙箱拒绝输出与提权流程后仍无明文
- [ ] 产物 smoke：打包产物中受限命令无法写 Workspace 之外
- [ ] ADR 0005 的 partial 说明与 permissions.md 同步

## Comments
- 2026-10-29 lead：规划风险"workspace-write 拒绝写 ~/.npm、~/.cache 导致频繁提权"——参考 DSH sandbox-local 的 Seatbelt profile 处理方式（临时目录与常见包管理缓存是否默认可写），沿用 DSH 的默认可写集合并在票 Comments 列出；不要静默放开整个 HOME。

