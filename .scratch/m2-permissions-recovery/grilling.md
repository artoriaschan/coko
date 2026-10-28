# M2 安全与恢复：设计树与采纳记录

Map: [Coko 桌面应用](../desktop-app/map.md) · [里程碑划分](../desktop-app/issues/06-grill-milestone-route.md) · 规格：[spec.md](spec.md)

2026-10-29，planner。按用户常设指示（2026-10-28 goal：讨论问题直接采用推荐答案，优先沿用参考项目决策；packages/agent 参考 pi coding-agent 与 claude-code，apps/desktop 的 UI 参考 deepseek-harness），本文每个问题都由 Agent 给出推荐并**按常设指示采纳**，不是用户逐条确认。参考材料：[claude-code 研究](../desktop-app/research/claude-code-agent-logic.md)、[DSH 研究](../desktop-app/research/dsh-desktop-architecture.md)、[pi 研究](../desktop-app/research/pi-agent-core-and-coding-agent.md)、DSH `packages/sandbox`、`packages/interaction/user-approval`、`permission-presets`、`session/session-checkpoint-policy`，claude-code `src/utils/permissions`，pi v1.4.0 `agent-loop.ts`。

## 已核对的事实

- pi 1.4.0 的工具批次：`beforeToolCall`（prepare）按调用顺序**串行**执行，之后才用 `Promise.all` 并行执行（`agent-loop.ts` executeToolCallsParallel）。因此审批请求天然逐个出现；并发上限必须包住 `execute`，不能放在 beforeToolCall。
- pi Agent 有 `steer()`、`followUp()`、`continue()`；steering 在当前 assistant 的工具全部结束后注入。
- M1 runtime（`packages/agent/src/engine/runtime.ts`）只提交 `message` 与 `run_end` 两种条目，`run_start` 只是 progress；崩溃时没有任何可扫描的"Run 已开始"记录。
- M1 `session_entries` 有拒绝 UPDATE 的触发器（append-only），payload 只做 `as` 断言（评审 A20）。
- DSH 沙箱只约束文件写入（无网络、读取限制）；Seatbelt profile 为 `(allow default) (deny file-write*)` + 可写根（Workspace、`/tmp`、`os.tmpdir()`，全部 realpath）；拒绝签名 `operation not permitted`；sandbox-exec 不可用时 fail-closed。
- DSH 恢复：中断的工具调用记为 `TOOL_OUTCOME_UNKNOWN`，不自动重跑；审批 pending 只在运行时内存中。

## 设计树

```text
M2
├── A 权限
│   ├── A1 模式形状 ──┬── A2 模式档位与沙箱映射 ── A6 文件工具的写入边界
│   │                └── A3 判定顺序 ── A4 规则语法 ── A5 作用域与持久化
│   ├── A7 审批请求状态机 ── A8 拒绝语义 ── A9 无 UI 时 ── A10 变更后重新判定
│   └── A11 受保护路径
├── B 沙箱与 Secrets
│   ├── B1 档位与 fail-closed ── B2 提权阶梯与工具参数
│   └── B3 Secrets 声明与注入 ── B4 泄露总闸
├── C 并发 ── C1 上限与分区
├── D Steering / Interrupt ── D1 追加指令 ── D2 暂停/继续/停止
├── E 恢复与幂等
│   ├── E1 Run 生命周期条目 ── E2 执行记录与幂等键
│   ├── E3 启动扫描与分类 ── E4 结果确认 ── E5 恢复后重新校验
├── F Session Persistence ── F1 payload 注册 ── F2 迁移证据
├── G Checkpoint / Rewind ── G1 追踪范围 ── G2 存储 ── G3 回退语义 ── G4 分叉边界
├── H UI ── H1 审批卡 ── H2 模式选择 ── H3 Permissions 设置 ── H4 rewind 入口 ── H5 运行状态呈现
└── I 交付 ── I1 切片与写范围 ── I2 Carry-overs ── I3 测试接口
```

## 第 1 轮（根节点）

**A1 模式形状**：审批与沙箱做成两个设置（DSH），还是一个模式同时决定两者？
➡️ 一个 Permission Mode 同时决定免审批范围与命令沙箱档位；审批与沙箱叠加。理由：四个可解释档位，避免 DSH 的 custom 组合态。采纳，见 [ADR 0005](../../docs/adr/0005-permission-mode-and-sandbox.md)。

**B1 沙箱档位与 fail-closed**：沿用 DSH 三档 Seatbelt？不可用时怎么办？
➡️ 沿用：read-only / workspace-write / danger-full-access，只约束写入；sandbox-exec 缺失或启动探测失败时，受限档位的命令返回 `sandbox-unavailable` 错误，不无沙箱运行。实现放 apps/server/src/adapters（依赖系统二进制，不进 agent 内置）。采纳。

**C1 并发**：pi 无上限也无依赖，是否改？
➡️ 改。上限默认 10（claude-code 同值）；按工具 effect 分区：read 调用可并行，side-effect 调用是屏障（等前面全部完成，后面等它完成）。同文件写入仍由 file-mutation-queue 串行。包住 execute 实现，不改 pi。采纳。

**D1 Steering**：Run 中发消息是排队到下一 Run（follow-up）还是送进当前 Run？
➡️ 送进当前 Run（pi `steer()`），当前工具批次结束后注入；送达时提交为普通用户消息条目。Run 结束时未送达的追加指令随 run_end 退回输入区。采纳。

**E3 恢复策略**：重启后自动续跑中断的 Run？
➡️ 不自动续跑。启动时把没有 run_end 的 Run 判定为 Interrupted Run，补齐结果后由用户点"继续"。理由：claude-code 与 DSH 都不自动重跑副作用；agent-runtime 约定恢复不能只靠回放。采纳。

**G1 Checkpoint 追踪范围**：文件工具备份（claude-code）还是 Workspace 影子 git？
➡️ 只追踪 write、edit；bash 改动不追踪并在 UI 说明。采纳，见 [ADR 0006](../../docs/adr/0006-file-checkpoints-and-rewind.md)。

**F1 payload 注册**：放 session 还是 agent？
➡️ session 提供注册接口（kind → 版本、schema、逐版迁移），agent 定义 M2 全部 payload，server 装配。写入时校验，不合格拒绝；读取时逐版迁移，仍不合格的条目跳过并记 warn，不影响整个 Session 打开。采纳（ADR 0003 已定方向，不另写 ADR）。

## 第 2 轮

**A2 模式档位**：哪些模式，各放行什么？
➡️ read-only（Workspace 内读取免审批；命令 read-only 沙箱）、default（同上；命令 workspace-write）、accept-edits（另加可写根内 write/edit 免审批）、full-access（除拒绝/询问规则与受保护路径外全部免审批；danger-full-access）。bash 在 full-access 以外的模式都要审批或命中允许规则（沙箱不限网络）。新 Session 默认 default。Plan 模式留给 M4 作为新取值。采纳。

**A3 判定顺序**：
➡️ 拒绝规则 → 询问规则 → 受保护路径 → 越出可写根的文件写入 → 模式放行 → 允许规则 → 询问。纯函数，输入 (调用, 模式, 规则, Workspace)，输出 allow / deny / ask(+ 建议规则)。采纳（claude-code 流水线去掉 auto/classifier）。

**A4 规则语法**：
➡️ `Tool` 或 `Tool(content)`。read 组（read、grep、find、ls）与 edit 组（write、edit）按 gitignore 风格匹配路径（用已选的 ignore 包；相对 Workspace 根，支持绝对路径与 `~/`）；bash 支持精确与尾随 ` *` 前缀；复合命令（`&&`、`||`、`;`、`|`）拆成子命令逐个判断，任一 deny 则 deny，全部 allow 才 allow；命令替换、子命令超过 50 个时一律询问；剥离安全的环境变量前缀（不剥 `LD_*`、`DYLD_*`、`PATH`）。未知宿主工具按名称匹配，默认询问。采纳。

**A5 作用域与持久化**：
➡️ 审批卡提供仅本次 / 本 Session / 本 Workspace / 全局。全局规则存设置键 `permissions.rules`，Workspace 规则存 `permissions.rules.workspace.<id>`，带 revision；Session 规则与模式切换存为 Session Entry（重启回放、分叉继承）。仅本次只体现在审批决定条目里。项目级配置文件（`.coko/settings.json`）不在 M2。不新增表。采纳。

**A6 文件工具的写入边界**：write/edit 在 Sidecar 内，Seatbelt 管不到。
➡️ 权限判断按同一组可写根拦截；越出可写根的写入必须审批，这次批准即这次提权，不能保存为规则（审批卡隐藏"总是"选项）。采纳。

**A7 审批请求状态机**：
➡️ pending → allowed（scope）/ denied（可带反馈）/ cancelled（停止、暂停）/ expired（Sidecar 退出）/ superseded（模式或规则变更后自动判定）。请求与决定各为一条 Session Entry；只能回答一次（再答 409 `approval-not-pending`）；同批多个调用按顺序逐个出现（pi prepare 串行）。没有超时。采纳。

**A8 拒绝语义**：
➡️ 无反馈的拒绝：该调用得到"用户拒绝"错误结果，当前批次结束后 Run 以 aborted 结束（claude-code 拒绝即停，防止模型绕行）。带反馈的拒绝：反馈作为工具错误文本交给模型，Run 继续。采纳。

**B2 提权阶梯**：
➡️ bash 增加可选参数 `sandbox_permissions`（workspace-write / danger-full-access）与 `justification`，必须成对；只能比当前档位严格更宽，等于当前档位视为不提权，更窄报错。被沙箱拒绝时结果追加拒绝标记与提权提示（文本沿用 DSH）。提权请求是 kind=escalation 的 Approval Request，只能"批准一次"或拒绝；它替代该次调用的普通审批（不弹两次）。允许规则不能免掉提权审批。采纳。

## 第 3 轮

**A9 无 UI 时**：headless / 无订阅客户端？
➡️ 请求保持 pending，经协议回答；不自动拒绝。`never` 策略随 M6 headless 定义。子代理冒泡在 M5。采纳。

**A10 变更后重新判定**：等待审批时切到 full-access 或新增规则？
➡️ 模式或规则变更后重新判定所有 pending 请求：变为 allow 或 deny 的请求以 superseded 结束并按结果继续。采纳。

**A11 受保护路径**：
➡️ Workspace 内 `.git/`、`.coko/`、`.vscode/`、`.idea/`，以及任意位置的 `.bashrc`、`.zshrc`、`.profile`、`.bash_profile`、`.zprofile`、`.gitconfig`、`.ssh/`、`.mcp.json`；比较前转小写。写入在任何模式都询问，允许规则不能免掉（claude-code safetyCheck）。full-access 下 bash 不受此检查（路径不可预知），接受。采纳。

**B3 Secrets**：
➡️ 工具契约可声明 `secrets: string[]`（变量名）；宿主的 SecretProvider 只在该次调用的子进程环境中注入这些变量，其余调用（含 bash）环境继续按 HOST_ENV_EXCLUSIONS 剔除。M2 只交付声明、注入接缝与测试工具，真实使用者是 M3 的 MCP。采纳。

**B4 泄露总闸**（M1 retro 第 3 条）：
➡️ 票 01 建 `tests/integration/secrets-gate.test.ts`：唯一标记的 Credential（环境变量模式）+ 同形态的宿主环境变量，经 faux 驱动模型错误、重试、bash `env`、读取失败；扫描全部 WebSocket 帧、HTTP 响应、库文件（含 -wal）、sidecar.jsonl 与快照目录，断言无明文。后续引入新输出通道的票（02 审批卡、05 沙箱、07 快照、08 确认）在同一文件追加驱动步骤。采纳。

**E1 Run 生命周期条目**：
➡️ 新增 `run_start` 条目（trigger：submit / retry / continue），在第一次模型请求前提交；RunStatus 增加 paused、interrupted。Session DTO 增加派生字段 `activity`：idle / running / awaiting-approval / awaiting-confirmation / paused / interrupted（保留 `running`）。采纳。

**E2 执行记录与幂等键**：
➡️ 工具契约增加 `effect: 'read' | 'side-effect'`（未声明按 side-effect）。side-effect 调用在取得执行槽、真正执行前提交 `tool_exec` 条目（幂等键 = `<sessionId>:<toolCallId>`），提交失败则不执行；read 调用不提交。幂等键经执行上下文交给工具，供以后的外部能力使用。采纳（DSH checkpoint-policy 的"副作用前落盘"）。

**D2 暂停 / 继续 / 停止**：
➡️ 暂停：不再发起新的模型请求，当前工具批次正常完成，不杀进程；pending 审批 cancelled；Run 以 paused 结束。继续：`POST …/continue` 开始新 Run（trigger continue），仅当上一 Run 为 paused 或 interrupted 且没有待确认结果时允许，否则 409。停止：沿用 M1 abort，并取消 pending 审批、退回未送达的追加指令。retry 仍只用于模型错误。采纳。

**E3 启动扫描与分类**：
➡️ 打开存储后、开始监听前扫描有 run_start 而无 run_end 的 Run。对每个没有 toolResult 的 toolCall：pending 审批 → expired，补"未执行"结果；没有 tool_exec → 补"未执行"结果；有 tool_exec 且 effect 为 read → 补"已中断，可重试"；有 tool_exec 的 side-effect → 若工具提供 `probeOutcome`（write 比对内容、edit 检查新旧文本）且结论明确则按结论补结果，否则提交 `confirmation_request` 等待用户。最后提交 run_end interrupted。正常关闭仍走 M1 的 abort + run_end，不进入恢复（地图 Carry-over M1 票 10 在此解决）。采纳。

**E4 结果确认**：
➡️ 确认卡接管 composer：已生效 / 未生效 / 不确定（让 Agent 自行核实）。回答提交 `confirmation_answer` 并补对应 toolResult 文本。存在未回答的确认时 submit、continue、rewind 返回 409 `confirmation-pending`（未配对的 toolCall 会破坏模型请求）。采纳。

**E5 恢复后重新校验**：
➡️ 仅本次授权不跨 Run；expired 请求不复活；"继续"后模型重新发起的调用重新走判定（此时的模式与规则）。Session/Workspace/全局规则每次调用都现算。采纳。

**F2 迁移证据**：ADR 0003 缺"经协议的迁移"测试。
➡️ 票 08 增加迁移 v2：`session_entries(session_id, kind, seq)` 索引，供未完成 Run 查询；集成测试用 v1 库启动 Sidecar，断言备份、数据保留、版本 2。损坏隔离与版本过高经协议的测试放票 01。采纳。

## 第 4 轮

**G2 存储**：
➡️ packages/session 新入口 `@coko/session/blobs`：`<dataDir>/blobs/<前 2 位>/<sha256>`，0700/0600，临时文件 + fsync + rename；超过 10 MiB 不备份（记未追踪）。备份引用为 `file_backup` 条目（anchorSeq、path、blob 或不存在），修改后提交 `file_change`（afterHash）。不新增表；清理随 Session 删除（不在 M2）。采纳。

**G3 回退语义**：
➡️ 三种：对话 / 代码 / 两者。对话：追加 `rewind` 条目（targetSeq），有效上下文跳过 [targetSeq, rewind) 区间，时间线折叠可展开，目标消息文本回到输入区。代码：对 anchor ≥ targetSeq 追踪过的路径恢复最早备份、不存在的删除；先 dry-run 返回将恢复/删除/已在外部改动的文件。Run 进行中、待审批、待确认时 409。回退不可撤销。采纳。

**G4 分叉边界**：地图把 Fork/Handoff 放 M5。
➡️ M2 只交付"从这条消息分叉"：新 Session 复制目标消息之前的有效条目，首条 `fork_origin`，目标文本放入新 Session 输入区，文件不复制。配置与权限继承、Handoff 仍属 M5。采纳。

**H1 审批卡**：
➡️ 接管 composer（DSH ui-approval）：显示工具、命令或路径、edit/write 的 diff 摘要、提权的目标档位与理由；按钮 拒绝 / 允许一次 / 总是允许（下拉选 Session、Workspace、全局；越界写入与提权不显示）；焦点在详情时 Enter = 允许一次，Esc = 拒绝；拒绝可展开反馈输入；同一请求只答一次；断线重连后从条目恢复。工具卡显示最终决定。采纳。

**H2 模式选择**：
➡️ composer 底栏、模型选择旁；Shift+Tab 在 read-only → default → accept-edits 之间循环，full-access 只能从菜单显式选择并显示警示色。切换立即生效于下一次调用。采纳（claude-code 循环 + DSH 底栏位置）。

**H3 Permissions 设置分区**：
➡️ 设置弹窗新增 Permissions：新 Session 默认模式；全局与当前 Workspace 的规则列表（增删，按允许/询问/拒绝分组）；当前 Session 规则只读可删。采纳。

**H4 rewind 入口**：
➡️ 用户消息气泡的悬停/聚焦动作"回退到此处"与"从这里分叉"；对话框选择模式并展示 dry-run 文件清单与 bash 不追踪的说明。不做双击 Esc。采纳。

**H5 运行状态呈现**：
➡️ Run 中 composer 保持可输入，Enter 发送追加指令（显示为待送达，送达后转为普通消息），停止与暂停按钮并列；侧栏对 awaiting-approval、awaiting-confirmation、interrupted 显示徽标并上浮（IA 决定）；interrupted / paused 会话顶部横幅带"继续"。退出确认把等待审批的 Run 计为活动 Run。采纳。

## 第 5 轮（交付）

**I1 切片与写范围**：
➡️ 10 张垂直切片，主干串行（凡改 renderer 对话区、server sessions.ts、i18n 字典的票），可并行窗口只放写范围不重叠的票：{03, 04}、{06, 07, 10}、{08, 10}、{09, 10}。票 01 先建好按领域拆分的扩展点（protocol 领域文件、agent 领域 barrel、payload 领域文件、通用 RunEntry、SessionService 扩展工厂），之后没有票再改 `packages/protocol/src/index.ts` 与 `packages/agent/src/index.ts`（10 例外，见 spec）。共享装配点的唯一所有者写在 spec "共享装配点"。采纳。

**I2 Carry-overs**：
➡️ M1 票 10 的"崩溃不留 run_end" → 票 08；B1 Provider kind 映射收敛、B3 挂起请求超时收敛、M1 票 08 的"模态框打开时 Toast 动作无法键盘到达" → 票 10。采纳。

**I3 测试接口**：
➡️ 沿用 M1：Sidecar 协议集成测试为主；agent 运行时（faux）、session（SQLite 临时目录）、Electron E2E、产物 smoke；Browser Mode 覆盖审批卡键盘与 composer 追加指令。Seatbelt 用例只在 darwin 运行，其他平台显式跳过。秘密不外泄总闸为票 01 验收。采纳。

**领域术语**：新增 Steering、Interrupted Run、Execution Record、Outcome Confirmation、Checkpoint、Rewind、Fork、Permission Mode、Permission Rule、Approval Request、Sandbox Mode、Escalation、Protected Path；Run 的定义扩到"提交、重试或继续"。已写入 [GLOSSARY](../../GLOSSARY.md)。

**ADR**：满足三条标准的只有 [ADR 0005](../../docs/adr/0005-permission-mode-and-sandbox.md)（模式与沙箱叠加、提权不可保存）与 [ADR 0006](../../docs/adr/0006-file-checkpoints-and-rewind.md)（只追踪文件工具、回退以追加实现）。恢复不自动续跑与 payload 注册已由 agent-runtime 约定与 ADR 0003 覆盖，不另写；并发分区、steering 语义可逆，不写。

frontier 已空。
