# 03: 权限模式、规则作用域与 Permissions 设置

**What to build:** 四种 Permission Mode（read-only、default、accept-edits、full-access）的判定（ADR 0005 表，不含沙箱执行）；规则语法与匹配（grilling A4：read / edit 组 gitignore 风格路径、bash 精确与前缀、复合命令拆分、命令替换与超 50 个子命令询问、安全 env 前缀剥离）；作用域 once / session / workspace / global 与持久化（Session 规则与模式为条目，Workspace 与全局为带 schema 的设置键，默认模式 `permissions.defaultMode`）；审批卡的"总是允许"下拉；模式或规则变更后重新判定 pending 请求（superseded）。server：`PUT …/permission-mode`、`GET/PUT /api/permissions`、`POST/DELETE …/permission-rules`。renderer：composer 模式选择（Shift+Tab 循环前三档，full-access 显式选择并有警示）、设置弹窗 Permissions 分区。

**User stories:** 5, 6, 7, 8, 9

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/policy/`（不含 `sandbox.ts`）、`packages/agent/src/session-entries/permissions.ts`、`packages/protocol/src/permissions.ts`、`apps/server/src/application/`（不含 `providers.ts`）、`apps/server/src/http/app.ts`、`apps/server/README.md`、`apps/desktop/src/renderer/features/conversation/`、`apps/desktop/src/renderer/features/settings/settings-dialog.tsx`、`apps/desktop/src/renderer/features/settings/permissions-section.tsx`（新）、`apps/desktop/src/renderer/stores/`、`packages/ui/src/`（不含 `components/sonner.tsx`、`components/dialog.tsx`）、`packages/i18n/src/dictionaries/`、`apps/desktop/e2e/permissions.e2e.test.ts`（新）、`tests/integration/sidecar-permissions.test.ts`（新）、`docs/subsystems/permissions.md`、`docs/adr/0005-permission-mode-and-sandbox.md`、`docs/adr/README.md`

- [x] agent 表驱动测试：四种模式 × 工具类型的判定；规则匹配（`Bash(npm test)`、`Bash(git *)`、`git status && rm -rf x` 拆分后 deny、`$(…)` 询问、`FOO=1 npm test` 剥前缀、`LD_PRELOAD=… npm test` 不剥、`Edit(src/**)`、`Read(~/x)`）；拒绝规则在 full-access 下仍生效；受保护路径不被允许规则免除
- [x] 集成测试：选"本 Workspace 总是允许"后同类调用不再询问；重启 Sidecar 后规则与模式仍生效；Session 规则只影响该 Session
- [x] 集成测试：等待审批时切到 full-access → 请求以 superseded 结束并执行；新增拒绝规则 → superseded 并拒绝
- [x] 集成测试：新 Session 的初始模式取 `permissions.defaultMode`；非法设置值经 `/api/permissions` 被 400 拒绝；通用设置接口不能写 `permissions.*`
- [x] Electron E2E：Shift+Tab 循环三档且不进入 full-access；菜单选 full-access 后有警示样式；Permissions 分区增删全局规则并在下一次调用生效
- [x] 总是允许下拉不对越界写入显示（越界写入由 05 定义为提权，本票先对"Workspace 外写入"隐藏）
- [x] permissions.md 与 ADR 0005 同步

## Comments

### 2026-10-29 实施者（分支 m2/03-permission-modes-and-rules）

**覆盖的验收（全部 7 项）**
- agent 表驱动：`policy/decide.test.ts`（42 例，含四种模式 × 9 类调用的表、full-access 下拒绝 / 询问规则、受保护路径不被允许规则免除）与 `policy/rules.test.ts`（42 例：`Bash(npm test)`、`Bash(git *)`、`git status && rm -rf x` 拆分后 deny、`$(…)` / 反引号 / 进程替换 / 子 shell 询问、超过 50 个子命令询问、`FOO=1 npm test` 剥前缀、`LD_PRELOAD` / `DYLD_*` / `PATH` 不剥、`Edit(src/**)`、`Read(~/x)`、绝对路径与大小写变体）。`policy/reevaluate.test.ts`（4 例）覆盖运行时上的 superseded。
- 集成 `tests/integration/sidecar-permissions.test.ts`（5 例）：本 Workspace 总是允许后同 Workspace 另一 Session 不再询问；Session 规则只影响该 Session；SIGTERM 停止再启动后 Workspace 规则、Session 规则与 accept-edits 模式仍生效；等待审批时切到 full-access → superseded 并执行；新增全局拒绝规则 → superseded 并以规则拒绝、Run 继续；新 Session 初始模式取 `permissions.defaultMode`；非法值 400、revision 冲突 409、Workspace 不存在 404；通用设置接口写 `permissions.*` 400；受保护路径的请求选"总是允许"400 且请求仍在等待。
- Electron E2E `apps/desktop/e2e/permissions.e2e.test.ts`（3 例）：Shift+Tab 循环 default → accept-edits → read-only → default，焦点留在编辑区，不进入 full-access；菜单选 full-access 后 `data-warning` 与计算颜色变化，bash 不经审批；Permissions 分区添加全局规则后下一次调用不询问、删除后再次询问（含非法规则的行内提示）；越界写入的审批卡没有"总是允许"，Workspace 内命令选"本工作区"后工具卡显示决定、同类调用不再询问。
- Browser Mode：`approval-card.browser.test.tsx` 新增 3 例（菜单选范围只回答一次、菜单内 Enter / Esc 不触发卡片的允许与拒绝、无 allowAlways 不显示）；store 测试 `chat-store-permissions.test.ts`（5 例：乐观切换与撤回、按序发送、草稿模式在创建后提交前生效、Session 规则回放）。
- 秘密总闸：`secrets-gate.test.ts` 的 bash `env` 改为以"本 Workspace 总是允许"回答（规则写入设置），并读回 `/api/permissions`、Session 规则与 `/api/settings`；仍无明文。
- 文档：`docs/subsystems/permissions.md` 重写为当前契约（模式表、规则语法、作用域与持久化、重新判定、协议、界面、验证）；ADR 0005 实施进度与剩余项更新（仍为 partial，剩 Seatbelt 与提权）；`apps/server/README.md` 更新路由与限制。`docs/adr/README.md` 的 0005 行无需变化。

**实现要点（供 Lead 与 05）**
- 重新判定不改 `engine/runtime.ts`（票 04 的写范围）：`ApprovalAnswer` 增加 `{ decision: 'reevaluate' }`，broker 调用 gate 登记的重算函数，结论为 allow / deny 时以 superseded 结束；server 在模式、规则变更或以保存作用域回答后对受影响 Session 的 `kind: 'tool'` 待审批请求发出它。HTTP 的 `AnswerApprovalRequest` 不接受 reevaluate。05 的 escalation 请求目前不参与重新判定（broker 对没有重算函数的请求不做任何事）。
- 新 Session 创建时总是提交一条 `permission_mode`（runId 为 null），按规格"含新 Session 初始模式"。因此既有测试中从 seq 1 断言完整条目序列的地方都多了这一条（见越界 4）。
- `PUT /api/permissions` 一次修改一项（`target: defaultMode | global | workspace`，各自 expectedRevision），避免多键非原子写。另加了 `GET /api/sessions/:id/permission-rules`（读回当前模式与 Session 规则，测试与秘密总闸使用）。
- `PermissionService` 由 `SessionService` 在构造时创建（可注入），以 `app.sessions.permissions` 暴露，不改 `runtime/layers.ts` 与 `Application`。
- 不剥离的 env 名单在 LD_* / DYLD_* / PATH 之外加了 BASH_ENV、ENV、IFS、NODE_OPTIONS、PYTHONPATH 等会改变被执行程序的变量（列表见 permissions.md）。
- 建议规则：根目录下的文件以 `./` 锚定（gitignore 不含斜杠的模式匹配任意深度）；复合命令每个未允许的子命令一条；不能可靠拆分的命令没有建议，因此不显示"总是允许"。
- 窄宽度：模式选择在主区 < 560px 时只显示图标（名称在 aria-label 与 Tooltip 中）；composer 行允许换行、编辑区 basis-0。原因：`app.browser.test.tsx` 的 390px 用例在侧栏 300ms 过渡中测量（主区瞬时约 112px），加入模式选择后 composer 最小宽度超出。

**越出 Write scope 的改动**（均为最小改动，请 Lead 裁决）
1. `apps/desktop/src/renderer/client/api.ts`：`setPermissionMode`、`removeSessionRule`、`getPermissions`、`updatePermissions`。
2. `apps/desktop/src/renderer/app/settings-dialog-store.ts`：SettingsSection 加 `permissions`；`app/chat-failure.ts`：failure kind `permissions`。
3. `apps/desktop/src/renderer/testing/fake-settings.ts`、`fixture-chat.ts`：对应桩。
4. 既有集成测试的条目序列加首条 `permission_mode`：`sidecar-session.test.ts`（2 处，另把 runId 断言改为跳过首条）、`sidecar-storage.test.ts`、`sidecar-approvals.test.ts`、`sidecar-concurrency.test.ts`（票 04 新文件，合并 main 后同样调整，runId 改为取 run_start 的）；`sidecar-approvals.test.ts` 中"scope global 被 400"改为非法 scope `forever`（global 现在合法）。
5. `tests/integration/secrets-gate.test.ts`：追加驱动步骤（须知要求）。
6. `packages/protocol/src/permissions.test.ts`（新，规则文本解析）：与领域文件同目录。

**实际运行的命令与结果**（worktree，已 `git merge main`（含票 04），`unset ELECTRON_RUN_AS_NODE`）
- `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run lint`（0 警告 0 错误）、`pnpm run format:check`、`pnpm run check:docs`（82 个文件 0 问题）：全部退出 0。
- `pnpm run test`：73 个文件，607 通过、1 跳过（settings.e2e 中的真实模型用例），含 desktop E2E 7 个文件与产物 smoke。
- 负向确认：rules / 模式表测试在实现前 22 例失败；reevaluate 测试在 broker 改动前 3 例失败；allowAlways 的 Browser Mode 用例在实现前失败；集成测试抓到 Workspace 规则缓存读回旧值的缺陷后修复。store 测试与实现同时写，未先观察失败。permissions.e2e 连续运行 2 次通过；渲染器 Browser Mode 修复后连续 3 次通过。
- 视觉检查：临时 E2E 截取浅色 / 深色、1100px 与 520px 下的模式选择、full-access 警示、审批卡"总是允许"菜单与 Permissions 分区，截图未入库。

**未验证**：真实模型（无密钥）；CI；非 darwin 平台；产物 smoke 未新增模式相关步骤（票验收未要求）；未订阅会话的 activity 仍只在列表重新加载时更新（票 02 已知）。

**文档影响**：见上；GLOSSARY 已有 Permission Mode、Permission Rule 等术语，未改；TECH_STACK 无新增依赖。
