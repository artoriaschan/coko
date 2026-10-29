# 05: Skills：发现、索引、调用、资源访问与设置分区

**What to build:** agent `instructions/skills/`：按 [规格](../spec.md#加载位置与优先级) 发现四个目录中的 Skill（含 SKILL.md 的目录为根，不再向下，跳过 `.` 目录与 node_modules，真实路径去重），按 [Agent Skills 规范](https://agentskills.io/specification) 校验（name 须等于目录名等），接受 `disable-model-invocation`；`<available_skills>` system section（8000 字符预算）；`skill` 工具（权限类 context-read，规则名 `Skill`）返回正文、基目录、文件清单（≤ 50）与 args；Skill 目录作为额外读取根；向命令目录登记 `/<skill-name>` 来源（展开为 `<skill name location>…</skill>` + args）；`allowed-tools` 只展示（[ADR 0008](../../../docs/adr/0008-project-files-only-tighten.md)）。server `context/skills.ts` 与 `GET /api/skills`，受 `skills.enabled`、`skills.disabled`（全局与项目追加）控制。界面：Skills & Commands 分区（Skill 与命令列表：来源、路径、启停、声明的工具（不授予）、诊断），把注册表中 skills 占位改为可用。

**User stories:** 5, 6, 7, 8

**Blocked by:** 03, 04

**Status:** ready-for-agent（实施完成，待 Lead 合入）

**Write scope:** `packages/agent/src/instructions/skills/`、`apps/server/src/application/context/skills.ts`、`apps/server/src/http/routes/skills.ts`、`packages/protocol/src/skills.ts`、`apps/desktop/src/renderer/features/settings/skills-section.tsx`、`apps/desktop/src/renderer/stores/skills-store.ts`（新）、`packages/i18n/src/dictionaries/domains/skills.ts`、`tests/integration/sidecar-skills.test.ts`（新）、`tests/fixtures/skills/`（新）、`apps/desktop/e2e/skills.e2e.test.ts`（新）、`docs/subsystems/skills.md`（新）、`docs/adr/0008-project-files-only-tighten.md`、`docs/adr/0009-user-authored-resources-as-files.md`

- [x] agent 表驱动测试：四个目录的发现与优先级、遮蔽诊断；name 不合规、与目录名不同、description 缺失或超长时不加载并诊断；`disable-model-invocation` 不进索引但可显式调用；索引超预算时尾部只列名字并注明数量
- [x] 集成测试（临时 `COKO_HOME`）：faux 模型调用 `skill { name }`，各模式下都不出现审批请求，结果含正文、基目录与文件清单；随后 read Skill 目录内（Workspace 之外）的参考文件不出现审批；bash 运行其脚本仍出现审批；`Skill(name)` deny 规则拒绝调用
- [x] 集成测试：`/pdf 参数` 提交 `command { source: skill }` 与 `<skill …>` 展开；被 `skills.disabled`（含项目追加）的 Skill 既不进索引也不能调用；Skill 声明 `allowed-tools: Bash(*)` 时 bash 仍需审批
- [x] E2E：Skills & Commands 分区列出 Skill 与命令（来源、路径、诊断），停用一个 Skill 后重启 Sidecar 仍停用，且 `COKO_HOME` 下的文件逐字节不变
- [x] skills.md 建立并可达（导航行写在 Comments）；ADR 0008 记录 allowed-tools 证据；ADR 0009 汇总票 03、04、05 的证据并改 implementation；`pnpm run check:docs` 通过

## Comments
- 2026-10-29 lead：来自票 02——PUT /api/config 整体替换全局值，保存 Skills 开关时须带回其他全局键（以 GET 返回的 global 为基础修改后提交）；诊断类型复用 protocol/config.ts 的 ResourceDiagnostic；scope.config 已是合并后的生效值。
- 2026-10-29 lead：来自票 09 的发现——默认启用的贡献工具（memory_*、skill、mcp__*）会让每个 Session 的第一个 Run 多提交一条带 toolsAdded 的 system 条目，导致 12 个 M2 精确序列断言失败。统一修法（由票 09 实施，越出写范围已授权）：apps/server/src/application/sessions.ts 的 #createRuntime 在 createAgentRuntime 之前调用一次 runContext.tools.set(await this.#context.tools(runContext.scope))，使贡献工具进入首条 system message，只有之后的配置变化才产生 system 条目。本票遇到同样失败时复用这一修法，不另行修改；若本票先于票 09 合入，按同一写法实现，合并时由 Lead 去重。


### 实施者报告（m3/05-skills，2026-10-29）

**覆盖的验收**

1. agent：`packages/agent/src/instructions/skills/skills.test.ts`（28）：四个位置与优先级（项目 .coko > 项目 .agents > COKO_HOME/skills > COKO_HOME 同级 .agents/skills）、`shadowed` 诊断、Skill 根不再向下、跳过 . 目录与 node_modules、符号链接按真实路径去重；不合规 15 例（缺 name、无 frontmatter、name 字符 / 连字符 / 长度、与目录名不同 `name-mismatch`、description 缺失 / 空白 / 超 1024、YAML 错误、compatibility、metadata、allowed-tools、disable-model-invocation 类型）均不加载并诊断；可选字段；read-failed；mtime；索引格式与转义、`disable-model-invocation` 不进索引、8000 预算的两级截断（尾部只列名字并注明数量 / 名字也放不下时注明其余数量）；skill 工具的正文、基目录、文件清单（≤ 50，截断注明）、args、未知名字；`/<name>` 展开（disable-model-invocation 可显式调用）。`policy/decide.test.ts` +1：规则名 `Skill` 与按内容的 deny / ask。
2. 集成：`tests/integration/sidecar-skills.test.ts`（5，夹具 `tests/fixtures/skills/`）：四种模式下 `skill { name }` 都无 approval_request，结果含正文、基目录与文件清单；faux requestLog 中的 `<available_skills>`（pdf、notes、lint；deploy / 不合规 / 被遮蔽的不列）与 skill 工具；default 下 read COKO_HOME 中 Skill 的参考文件（Workspace 之外）无审批；bash 运行其脚本审批；项目 Skill `allowed-tools: Bash(*)` 时 bash 仍审批；`Skill(notes)`（项目设置）与 `skill(pdf)`（Workspace 规则，PUT 后归一为 `Skill`）在 full-access 下拒绝；`/pdf report.pdf` → `command { pdf, report.pdf, skill }` 与 `<skill …>` 展开，模型只收到展开文本；`/deploy` 显式调用；全局 `skills.disabled: [notes]` 与项目追加 `[lint]` 的 Skill 不进索引、工具调用报 Unknown skill、`/notes` 原样；`skills.enabled=false` 时无 section、无工具；`GET /api/skills` 列表、诊断（name-mismatch、shadowed）、命令目录中的 Skill 来源与 argument-hint、修改 SKILL.md 与用户级命令模板后下一次读取得到新内容、400 / 404。
3. E2E：`apps/desktop/e2e/skills.e2e.test.ts`（1）：分区列出 4 个 Skill（来源、路径含 .agents、声明的工具 + "只展示，不授予"、只能显式调用）与用户命令 /hello（来源、路径）、诊断（name-mismatch、shadowed，含路径）；停用 notes 后 SIGKILL Sidecar，supervisor 重启后重新打开分区仍停用；COKO_HOME、其同级 .agents、Workspace .coko / .agents 下的文件 sha256 逐个不变。另在 E2E 中截图核对了分区的实际渲染（亮色）。
4. 文档：新增 `docs/subsystems/skills.md`；ADR 0008 补 allowed-tools 证据并改 implemented（三条证据齐备）；ADR 0009 汇总票 03、04、05 证据并改 implemented；`pnpm run check:docs` 111 个文件 0 问题。

**实际运行的命令与结果**（worktree，已 `git merge main`（7068503，含票 08））

- `pnpm install --frozen-lockfile` 0；`pnpm run typecheck` 0；`pnpm run lint` 0 警告 0 错误；`pnpm run format:check` 0；`pnpm run check:docs` 0 问题。
- `pnpm run test`：149 个文件通过，1109 通过、1 跳过（settings E2E 中已有的跳过），含 desktop E2E 16 个文件与产物 smoke（`package-smoke.e2e.test.ts` 2 个）。
- 合并 main 前另跑 `--project integration --project agent --project server`：71 文件 647 通过（确认没有用例读到真实的 ~/.agents/skills；本机该目录有 10 余个 skill）。

**负向确认**

- 先红：agent skills 测试（28 个全部因模块缺失失败）、decide.test 的 `canonicalRuleTool('Skill')`（返回 undefined）均先失败后实现。
- 变异：把 `readRoots` 改为空数组 → 集成用例在 read Skill 参考文件处出现审批而失败，撤销后通过。
- 集成用例最初两处失败均为测试自身问题（脚本中引用未初始化的目录；"不含 /pdf"误判了 SKILL.md 路径中的 `skills/pdf/`），已改为断言展开文本不以 `/` 开头。

**未验证项**

- 真实模型：无凭据，未运行。
- 暗色主题与窄窗口下的分区只做了亮色截图检查，没有自动化断言。
- Windows / Linux 上的路径与符号链接去重未运行（只在 darwin）。

**越出 Write scope 的改动**（请 Lead 裁决）

- `packages/agent/src/policy/decide.ts`（票 01 共享装配点）：`RULE_ALIASES` 加 `['skill', 'Skill']` 一项。原因：skill 工具按 Run 贡献，不在宿主基础工具名中，`PUT /api/permissions` 写 `Skill(pdf)` 会以 400 `unknown-tool` 拒绝；票头要求规则名 `Skill`。只影响规则名归一，判定本来就不区分大小写。`decide.test.ts` 加 1 例。
- `apps/desktop/src/renderer/features/settings/sections.ts`：skills 分区 `available: true`（文件注释写明由各票这样做，与 07、09 相同）；`sections.browser.test.tsx` 的"唯一占位为 skills"断言改为用合成注册表测占位行为，并断言导航含 Skills & Commands。
- 文档：`docs/README.md` 当前行为加 Skills 一行（命令之后）；`docs/adr/README.md` 的 0008、0009 行改 implemented；`docs/subsystems/commands.md` 的"目前没有来源登记"改为指向 skills.md；`docs/subsystems/permissions.md` 两处补 `Skill` 规则名。
- `packages/agent/README.md` 仍写 `instructions/{rules,commands,skills}` 为空 barrel（已过时），归 01 → 11，本票未改。

### 供后续票

- **用户级 .agents/skills 的位置**：`skillLocations({ cwd, cokoHome })` 取 `dirname(cokoHome)/.agents/skills`（缺省即 `~/.agents/skills`），不读 `os.homedir()`，使所有设置了临时 `COKO_HOME` 的测试不读真实家目录。若规格本意为始终读 `~/.agents`，需要另一种测试隔离（harness 的 HOME），请 Lead 裁决。
- **skill 工具**只在本次 Run 至少有一个可由模型调用的启用 Skill 时注册；没有 Skill 时工具清单与 M2 相同（不影响已有精确序列断言）。
- **上下文报告（票 10）**：Skills 贡献的 `report()` 给出 `breakdown.skills`（`<available_skills>` 字符数）与 Skill 诊断。
- **压缩（票 11）**：skill 工具结果的 `details = { name, path, baseDir, files, filesTruncated }`，可从 toolResult 中取 `name` 汇总 `invokedSkills`。
- 导出：`@coko/agent` 新增 `createSkillLoader`、`skillLocations`、`skillsSection`、`createSkillTool`、`expandSkillInvocation`、`formatSkillBlock`、`parseSkillFile` 等（经 `instructions/skills` barrel，无需改 index.ts）；protocol `skills.ts` 新增 `SkillInfo`、`SkillListResponse`、`skillPaths`（index.ts 已 re-export）。
- 2026-10-29 lead：评审后合入 main（2f0992c）。接受越界：decide.ts RULE_ALIASES 的 skill → Skill 与用例、sections.ts 开启 Skills 分区及其测试、docs/README、adr/README、commands.md 与 permissions.md 各一行。裁决：用户级 .agents/skills 从 dirname(COKO_HOME)/.agents/skills 读取，默认即 ~/.agents/skills，使临时 COKO_HOME 的测试不读真实目录——接受，已写入 skills.md。lead 更新 agent README 中 barrel 的状态。main 上复核（与票 06 合并后一并，见票 06）。worktree 已清理。

Closed: true
