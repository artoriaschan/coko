# M2 Spec 轴评审（82c34f6...HEAD）

评审范围：`git diff 82c34f6...HEAD -- . ':!pnpm-lock.yaml' ':!.scratch'`（184 个文件，+15045 / -478），对照 [spec.md](spec.md)、[grilling.md](grilling.md) 与 `issues/01`–`10` 的正文和 Comments。只读评审，除本文件外没有修改仓库。各票 Comments 中 Lead 已接受的偏差不再重复报告，除非实现本身有错。

严重度：**hard** 表示违反 spec、ADR 或用户故事的明文；**judgement** 表示 spec 没有写死，但按其意图或安全默认值应该修改。

## 结论

- 判定流水线（`decide`）、审批状态机、提权阶梯、执行记录、恢复分类和回退计划的纯函数都与 spec 一致，单测覆盖充分。我没有发现绕过 `decide()` 直接执行工具调用的代码路径，也没有发现 hook 放行越过拒绝的路径。
- 主要问题在 `decide()` 的输入和边界：规则名写错时拒绝规则悄悄失效（F2）；目录型读取工具不检查目录下被拒绝的文件（F3）；准备阶段判定的路径和执行时实际写入的路径可能不同（F5）；打包产物允许用环境变量替换 sandbox-exec（F1）。
- 恢复不会自动重跑副作用调用。有一个次序缺陷：单个 Session 恢复失败后，该 Session 仍可以开始新 Run（F7）。
- 回退代码可以写回或删除 Workspace 之外、以及受保护路径上的文件，而且不重新检查符号链接（F6）。

## 发现

### F1 打包产物中可以用 `COKO_SANDBOX_EXEC` 等"仅测试"变量替换沙箱（hard）

- 位置：`apps/desktop/src/main/index.ts:119`（`env: process.env` 原样传给 Sidecar）；`apps/server/src/config.ts:55-58`（`COKO_SANDBOX_EXEC`、`COKO_TEST_TOOLS` 只检查格式，不区分是否打包）；`apps/server/src/runtime/layers.ts:79-84`、`:226-229`；`apps/server/src/adapters/seatbelt.ts:29-46`。
- 依据：spec.md:119"测试用 `COKO_SANDBOX_EXEC` 覆盖可执行路径（**仅测试**）"；US 14"不会在我以为受保护时无保护地运行"；ADR 0005"sandbox-exec 不可用时……不在无沙箱下运行"。
- 问题：同一文件中 `COKO_RIPGREP_PATH`、`COKO_SIDECAR_ENTRY` 都用 `development && …` 限定为未打包时生效（index.ts:42、:51），新增的 `COKO_SANDBOX_EXEC` 没有这层限制。只要启动环境里设置了这个变量，指向一个丢掉前 3 个参数再 exec 其余参数的脚本，启动探测就会通过，`wrap()` 之后所有"受限"命令都不受约束地运行。界面仍然显示 default / read-only 模式，用户以为命令在沙箱里。`COKO_TEST_TOOLS` 与 `COKO_TEST_HOLD_*` 在产品中同样能生效（会注册 `secret_probe`、挂起工具结果）。`COKO_FAUX_SCRIPT` 是 M1 就有的同类问题，这次一并处理。
- 修复：在 main 构造 Sidecar 环境时，`app.isPackaged` 为真就删除 `COKO_SANDBOX_EXEC`、`COKO_TEST_*`、`COKO_FAUX_SCRIPT`（或者只保留白名单变量）。Sidecar 侧也可以加一道保护：`sandboxExec` 不等于 `/usr/bin/sandbox-exec` 时记录 warn，并在 `/api/health` 中标出非默认沙箱。补一条打包 smoke 用例：设置这些变量启动打包产物，断言受限命令仍被拒绝。

### F2 规则的工具名大小写不对或写成成员工具名时，拒绝规则静默失效（hard）

- 位置：`packages/agent/src/policy/decide.ts:171`（`own = rules.filter(rule => rule.tool === tool)`，精确比较）、`:13-24`；`packages/protocol/src/permissions.ts:86-93`（`PermissionRuleInput.tool` 只限制"非空、无括号与空白"）；`apps/desktop/src/renderer/features/settings/permissions-section.tsx:227-233`（`parsePermissionRule` 通过即保存）。
- 依据：US 8"拒绝规则在任何模式下都生效"；ADR 0005"拒绝规则在任何模式下都生效"；grilling A4（规则以组名 `Read` / `Edit` / `Bash` 书写）。
- 实测：我用临时脚本调用 `decide()`，脚本放在 /tmp，已删除。在 full-access 下：`{deny, tool:'bash', content:'rm *'}` 对 `rm -rf x` 的结果是 **allow**；`{deny, tool:'Write', content:'secret.txt'}` 对 write 该文件的结果是 **allow**。设置分区和 `PUT /api/permissions` 都接受这两条规则，并照常显示在"拒绝"组里。
- 修复：在 `decide()` 中不区分大小写地把规则工具名归一到组名（`bash`→Bash，`write`/`edit`→Edit，`read`/`grep`/`find`/`ls`→Read）。或者在 server 的 `/api/permissions`、`…/permission-rules` 中拒绝内置工具的成员名和大小写变体（400），并在设置分区显示行内提示。在 `decide.test.ts` 中补上这几种规则名的表驱动用例。

### F3 目录型读取工具（grep / find / ls）可以读到被 `Read` 拒绝规则覆盖的文件（judgement，偏高）

- 位置：`packages/agent/src/tools/builtin/grep.ts:133`、`find.ts:31`、`ls.ts:29`（subject 只是搜索根，缺省为 `.`）；`packages/agent/src/policy/decide.ts:102-105`（只拿搜索根去匹配规则）。
- 依据：US 8"拒绝规则在任何模式下都生效"；grilling A4"read 组（read、grep、find、ls）……按 gitignore 风格匹配路径"。
- 实测：default 模式下设置 `Read(src/secret.txt)` 为拒绝。`read src/secret.txt` 被拒绝，但 `grep { pattern: '.' }`（搜索根是 Workspace）的判定结果是 **allow**，搜索结果会带出该文件的内容。`Read(~/.ssh/**)` 为拒绝时，`ls ~/.ssh` 也是 allow。
- 修复：把当前生效的 Read 拒绝模式交给 grep / find / ls，作为排除过滤（逐个文件用 `pathMatches` 判断，命中即跳过，并在结果中注明"已按规则排除 N 个"）。或者在判定时发现有拒绝模式位于搜索根之下时，改为询问。补 decide 用例和一条 Sidecar 集成用例。

### F4 workspace-write 档位的命令可以写 Workspace 内的 `.git/`、`.coko/` 等受保护目录（judgement）

- 位置：`apps/server/src/adapters/seatbelt.ts:17-19`（Workspace 整体 `subpath` 可写，没有排除受保护目录）。
- 依据：US 8"写 .git 等受保护路径总要审批"；grilling A11 的例外只写了"full-access 下 bash 不受此检查"，没有写 default / accept-edits 的 bash 也不受检查。spec.md:119 给出的 profile 也没有排除项，因此这里按 judgement 处理。
- 问题：用户保存了 `Bash(npm test *)` 之类的允许规则后，default 模式下命令不经审批就能改写 `.git/hooks/*`、`.git/config`，也能改 `.coko/`、`.vscode/`。这是持久化执行代码的常见手段，而文件工具对同样的路径总会询问，两条路径的保护强度不一致。
- 修复：在 workspace-write 的 profile 中，可写根规则之后追加 `(deny file-write* (subpath "<ws>/.git") (subpath "<ws>/.coko") …)`（SBPL 中后出现的规则优先）。被拒绝后走现有的提权流程。在 `seatbelt.test.ts` 和 `sidecar-sandbox.test.ts` 中补 `echo x > .git/hooks/pre-commit` 被拒的用例。如果决定不改，就在 ADR 0005 和 permissions.md 中明确写出"受限档位的命令可以写 Workspace 内的受保护目录"。

### F5 判定时的路径与执行时的路径可能不同：同一批中先建符号链接，再用 write / edit 越界（judgement）

- 位置：`packages/agent/src/policy/gate.ts:81`（准备阶段做 `resolveTarget`）；`packages/agent/src/tools/builtin/write.ts:34-41`（执行时按原路径 `writeFile`，会跟随符号链接）；edit 同理。tracker 的备份路径也在准备阶段确定（`checkpoints/tracker.ts:135`）。
- 依据：ADR 0005"越出可写根的写入必须审批"；US 8（受保护路径）；票 02 与 07 的 Comments 已确认 pi 会先对整批调用逐个做准备，再执行。
- 场景：accept-edits 模式下，同一批调用是 `[bash "ln -s ~/.zshrc notes.txt", write notes.txt]`。准备阶段 `notes.txt` 还不存在，真实路径落在 Workspace 内，write 不经询问就被放行。bash 由用户批准（或命中允许规则），在沙箱内创建 Workspace 内的链接，这一步沙箱允许。随后 write 跟随链接改写了 `~/.zshrc`，用户没有看到"受保护路径"或"越出可写根"的询问。tracker 记录的是 `absent`，之后回退代码只会删除这个链接，无法恢复 `~/.zshrc`。
- 修复：在 `withContext` 中，对 write / edit 在 execute 之前重新计算 `realLocation`。结果和准备阶段不同时，重新判定（或者直接以"目标在判定后发生变化"阻止这次调用）。或者在 write / edit 中逐级用 `lstat` 检查，拒绝经由符号链接写入。补一条 agent 运行时用例，用 deferred 控制两个调用的交叠顺序。

### F6 回退代码会写回或删除 Workspace 之外和受保护路径上的文件，并且跟随恢复时的符号链接（judgement）

- 位置：`packages/agent/src/checkpoints/rewind.ts:195-217`（`restoreFiles` 直接 `writeFile` / `rm` 记录中的绝对路径，没有边界检查，也不重新解析路径）；`apps/desktop/src/renderer/features/conversation/rewind-dialog.tsx:24-30`（Workspace 之外的路径原样显示为绝对路径，没有额外标记）。
- 依据：ADR 0006"执行前列出将恢复和删除的文件，并标出……不一致的文件"；US 28；US 8 / ADR 0005 中受保护路径"总要审批"的原则。
- 问题：(1) 曾经单次批准过的、写到 Workspace 外的文件（例如 `~/.zshrc`）会出现在恢复或删除清单里。对话框只显示一条绝对路径，这次写回或删除没有经过 `decide()`，也没有醒目的警示。(2) 备份时记录的是真实路径。如果之后 bash（不被追踪）把路径中的某个父目录换成了指向别处的链接，`writeFile` / `rm` 会作用到链接指向的位置；diverged 只比较摘要，照样会恢复。
- 修复：`restoreFiles` 在写入或删除前重新计算 `realLocation(path)`，结果与记录的路径不同时，把该路径归入新的 `skipped`（或 `diverged` 且不恢复）。protocol 的 `RewindResponse` 增加 `outside: Path[]`（Workspace 之外或受保护的路径），对话框单独分组并加警示，需要用户勾选后才执行。补集成用例：恢复 Workspace 外的文件，以及父目录被替换为符号链接的情况。

### F7 单个 Session 启动恢复失败后，该 Session 仍可以开始新 Run（judgement）

- 位置：`apps/server/src/application/sessions.ts:226-229`（失败只记数和日志）；`:502-505`（`#start` 只检查 `#awaitingConfirmation`，不检查未完成的 Run）。
- 依据：grilling E3"启动时把没有 run_end 的 Run 判定为 Interrupted Run，补齐结果后由用户点'继续'"；E4"未配对的 toolCall 会破坏模型请求"。
- 问题：恢复失败（例如 Workspace 记录丢失，或探测时读文件抛出非预期的错误）的 Run 没有 run_end，它的 toolCall 也没有结果。用户在该 Session 中提交新消息时，有效上下文里留着未配对的 toolCall，模型请求会失败。下次启动恢复成功时，`interrupted` 的 run_end 和补齐的 toolResult 会追加在更新的 Run 之后，`lastRunStatus` 被改成 interrupted，补齐的结果出现在错误的位置。这个缺陷不会导致副作用被重跑，但会破坏会话。
- 修复：`recover()` 把失败的 sessionId 记入一个集合，`#start`、rewind、fork 对这些 Session 返回 409（可以复用 `session-busy`，或新增 `recovery-failed`），在下次 `#runtime` 创建时重试恢复。补一条注入失败的集成用例。

### F8 Secrets 端口可以读出 Sidecar 的全部环境，包括 Provider 凭据（judgement，低）

- 位置：`apps/server/src/adapters/credentials.ts:108-110`。
- 依据：US 15"密钥不出现在协议、库、日志与快照中"；grilling B3。
- 问题：工具只要声明 `secrets: ['DEEPSEEK_API_KEY']` 或 `COKO_CREDENTIAL_*`，就能在 `context.secrets` 中拿到模型凭据。M2 只有测试工具声明 secrets，所以目前没有实际影响。M3 接入 MCP 后，工具声明的名字来自外部配置，这个口子就会被利用。
- 修复：`createEnvSecretProvider` 拒绝与 `HOST_ENV_EXCLUSIONS` 中 `COKO_*` 和 Provider kind 密钥变量同名的请求；或者在 M3 改为显式映射之前，先改成白名单。

### F9 分叉标题的后缀固定为英文（judgement，低；Lead 在票 09 要求本评审判断）

- 位置：`apps/server/src/application/sessions.ts:669`。
- 依据：界面约定要求可见文案走 i18n；Sidecar 不知道界面语言。
- 结论：需要改，但不阻塞合入。修复：`ForkRequest` 增加可选的 `title`，由 renderer 按当前语言生成（例如"<原标题>（分叉）"）；Sidecar 只在没有传入时使用固定后缀。

### F10 重新判定后仍显示旧的"总是允许"建议（judgement，低）

- 位置：`apps/server/src/application/sessions.ts:571-578`（`suggestions` 取自请求刚提出时的条目）；`packages/agent/src/policy/gate.ts:103-108`（重新判定仍需询问时，不更新建议）。
- 依据：grilling A6"越出可写根的写入……不能保存为规则（审批卡隐藏'总是'选项）"。
- 问题：default 模式下，Workspace 内的 write 正在等待审批（有 `Edit(...)` 建议），此时切到 read-only。重新判定的结果是 ask（outside-writable-roots），请求继续等待，但卡片上仍有"总是允许"。用户选择后会保存一条 Edit 允许规则并放行这次写入，相当于在 read-only 下批准了越界写入。
- 修复：重新判定仍为 ask 且原因或建议发生变化时，以 superseded 结束旧请求并按新判定重新发起，或者至少在 server 中拒绝原因已变为 outside-writable-roots 的保存请求。

## 缺失或部分实现

- **P1** spec.md:145 要求经 Sidecar 协议"并发观察"。`tests/integration/sidecar-concurrency.test.ts` 只断言了 tool_exec 的次序，并行上限和屏障只在 agent 层（`scheduler.test.ts`）验证过。票 04 的验收没有要求这一项，属于测试缺口（judgement，低）。修复：用 faux 发出两个 read 和一个 bash，借助 `requestLog` 或 `tool_start` / `tool_end` 进度事件的时间顺序断言屏障。
- **P2** US 20"中断的会话显示'上次运行已中断'并可继续"：如果崩溃发生在最后一条 assistant 文本提交之后、run_end 之前，横幅会出现，但 `canContinue` 为 false（`apps/desktop/src/renderer/stores/chat-store.ts:174-183`），横幅上没有"继续"。这个行为与运行时一致，但横幅文案没有说明原因（judgement，低）。修复：这种情况下横幅改为"上次运行已在结束前中断，可直接发送新消息"。
- 其余用户故事 1–33 都能在代码和测试中找到对应实现。我抽查了 US 2、5、6、9、10、11、17–19、21–23、27–31 的实现路径，没有发现其他缺口。

## 范围之外的改动

- 没有发现 Lead 未接受的范围外功能。F1 中提到的测试开关（`COKO_TEST_HOLD_AFTER_TOOL`、`COKO_TEST_HOLD_BEFORE_CHECKPOINT`、`secret_probe`）已经得到批准。问题只在于它们没有和产品构建隔离，所以归入 F1，不作为范围外改动另报。

## 对重点关注项的回答

1. **有没有路径不经过 `decide()` 就执行工具调用？** 代码路径上没有。server 总会传入 `permissions`（`sessions.ts:753-756`）；gate 位于 hook 链首（`runtime.ts:278`）；未知工具归入 other，默认询问；提权检查在拒绝规则之后，而且只会替换掉询问，不会替换掉拒绝；恢复、确认、回退和分叉都不执行工具。不过 `decide()` 收到的输入和执行时的事实可能不一致，见 F2（规则名）、F3（目录工具）、F5（判定与执行之间路径被替换）。库调用方不传 `permissions` 时不做判定，这是文档写明的约定。
2. **hook 放行能否越过拒绝？** 不能。`composeBeforeToolCall` 只有"第一个阻止生效"的语义，没有放行结果（`extensions/hooks.ts:15-24`）。gate 先运行，它阻止之后，后面的 hook 不会执行。
3. **Seatbelt profile 的可写根**：与 spec.md:119 一致，即 Workspace 真实路径、`/private/tmp`、`realpath(tmpdir())` 和 `/dev/null`；read-only 档位没有可写根；danger-full-access 不包裹。问题见 F1（可执行文件可被替换）和 F4（受保护目录可写）。
4. **恢复会不会自动重跑副作用调用？** 不会。`planRecovery` 只读取条目，只调用 `probeOutcome` 读文件，从不执行工具（`recovery/plan.ts:82-124`）。"继续"必须由用户触发，而且在有待确认的结果时返回 409。被中断的 read 调用由模型决定是否重试。我注意到的风险是 F7（恢复失败后条目的次序）。
5. **回退会不会恢复 Workspace 之外的文件？** 会，前提是这些文件曾经由经过审批的 write / edit 改动过。恢复时没有边界检查，也不重新检查符号链接，见 F6。F5 还会让本应恢复的外部文件只记录为 absent，因而无法恢复。

## 验证

- 读了代码：policy 全部文件（decide / gate / broker / rules / paths / sandbox）、`engine/runtime.ts`、`tools/scheduler.ts`、`tools/types.ts`、`ports/exec.ts`、`ports/local-exec.ts`、`ports/secrets.ts`、`bash.ts`、`timeout.ts`、`extensions/hooks.ts`、`recovery/plan.ts`、`checkpoints/tracker.ts`、`checkpoints/rewind.ts`，以及 write / edit / read / grep / find / ls 的 diff；server 的 `sessions.ts`、`permissions.ts`、`layers.ts`、`seatbelt.ts`、`checkpoints.ts`、`test-tools.ts`、`ripgrep.ts`、`config.ts`、`credentials.ts:55-110`，以及 `http/app.ts`、`settings.ts`、`errors.ts` 的 diff；protocol 的 `permissions.ts`、`checkpoints.ts`、`runs.ts`；session 的 `payloads.ts`、`sqlite/recovery.ts`、`blobs/store.ts`，以及 `schema.ts`、`repositories.ts`、`open.ts` 的 diff；renderer 的 `rewind-dialog.tsx`、`approval-panel.tsx`、`confirmation-panel.tsx`，以及 `sidebar.tsx`、`tool-cards.tsx` 的 diff，还有 `chat-store.ts`、`conversation-pane.tsx`、`permissions-section.tsx` 的片段；ADR 0005、0006。
- 运行了测试：`unset ELECTRON_RUN_AS_NODE && pnpm exec vitest run packages/agent/src/policy packages/agent/src/recovery packages/agent/src/checkpoints`，退出码 0，9 个文件、151 个用例全部通过。
- 写了一个临时探测脚本：用 `node --experimental-strip-types` 直接调用 `decide()`，得到 F2、F3 的结论。脚本放在 /tmp，运行后已删除。
- F1、F4、F5、F6、F7 来自读代码时的推导，没有在真实 Sidecar 或 sandbox-exec 上复现。
- 没有运行：集成测试、Electron E2E、Browser Mode、产物 smoke、typecheck、lint。

## 没有读或只抽样的部分

- renderer：只用 grep 定位了 `chat-store.ts`（+410 行），没有通读；`composer.tsx`、`mode-picker.tsx`、`timeline.ts`、`timeline-view.tsx`、`conversation-pane.tsx` 只看了片段；`settings-store.ts`、`settings-dialog.tsx`、`client/api.ts`、`chat-failure.ts` 没有读。
- packages/ui：`approval-card.tsx`、`confirmation-card.tsx`、`dialog.tsx`、`sonner.tsx`、`composer-editor.tsx`、`tool-card.tsx` 没有读，审批卡的键盘行为只依据票内记录和测试名称。
- i18n 字典（en / zh 各 +158 行）没有读。
- desktop main：`credentials.ts`、`sidecar-process.ts` 的票 10 收敛没有读，只用 grep 查了 env 的传递。
- agent：`models/registry.ts`、`session-entries/*`、`engine/types.ts`、`index.ts` 的导出没有读；`tools/builtin/edit.ts` 只读了 probe 部分。
- protocol：`control.ts` 的 `createRequestTracker`、`entries.ts`、`http.ts`、`ws.ts` 没有读。
- session：`memory/`、`repository-contract.ts`、`internal.ts`、`types.ts`、README 没有读。
- 全部测试文件（包括 `tests/integration/*.test.ts` 和 E2E）只看了文件名和票内记录，没有逐条核对断言。
- 文档：`docs/subsystems/permissions.md` 只用 grep 查了几处，`docs/subsystems/recovery.md`、各 README 没有读。
