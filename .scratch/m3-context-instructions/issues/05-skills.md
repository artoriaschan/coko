# 05: Skills：发现、索引、调用、资源访问与设置分区

**What to build:** agent `instructions/skills/`：按 [规格](../spec.md#加载位置与优先级) 发现四个目录中的 Skill（含 SKILL.md 的目录为根，不再向下，跳过 `.` 目录与 node_modules，真实路径去重），按 [Agent Skills 规范](https://agentskills.io/specification) 校验（name 须等于目录名等），接受 `disable-model-invocation`；`<available_skills>` system section（8000 字符预算）；`skill` 工具（权限类 context-read，规则名 `Skill`）返回正文、基目录、文件清单（≤ 50）与 args；Skill 目录作为额外读取根；向命令目录登记 `/<skill-name>` 来源（展开为 `<skill name location>…</skill>` + args）；`allowed-tools` 只展示（[ADR 0008](../../../docs/adr/0008-project-files-only-tighten.md)）。server `context/skills.ts` 与 `GET /api/skills`，受 `skills.enabled`、`skills.disabled`（全局与项目追加）控制。界面：Skills & Commands 分区（Skill 与命令列表：来源、路径、启停、声明的工具（不授予）、诊断），把注册表中 skills 占位改为可用。

**User stories:** 5, 6, 7, 8

**Blocked by:** 03, 04

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/instructions/skills/`、`apps/server/src/application/context/skills.ts`、`apps/server/src/http/routes/skills.ts`、`packages/protocol/src/skills.ts`、`apps/desktop/src/renderer/features/settings/skills-section.tsx`、`apps/desktop/src/renderer/stores/skills-store.ts`（新）、`packages/i18n/src/dictionaries/domains/skills.ts`、`tests/integration/sidecar-skills.test.ts`（新）、`tests/fixtures/skills/`（新）、`apps/desktop/e2e/skills.e2e.test.ts`（新）、`docs/subsystems/skills.md`（新）、`docs/adr/0008-project-files-only-tighten.md`、`docs/adr/0009-user-authored-resources-as-files.md`

- [ ] agent 表驱动测试：四个目录的发现与优先级、遮蔽诊断；name 不合规、与目录名不同、description 缺失或超长时不加载并诊断；`disable-model-invocation` 不进索引但可显式调用；索引超预算时尾部只列名字并注明数量
- [ ] 集成测试（临时 `COKO_HOME`）：faux 模型调用 `skill { name }`，各模式下都不出现审批请求，结果含正文、基目录与文件清单；随后 read Skill 目录内（Workspace 之外）的参考文件不出现审批；bash 运行其脚本仍出现审批；`Skill(name)` deny 规则拒绝调用
- [ ] 集成测试：`/pdf 参数` 提交 `command { source: skill }` 与 `<skill …>` 展开；被 `skills.disabled`（含项目追加）的 Skill 既不进索引也不能调用；Skill 声明 `allowed-tools: Bash(*)` 时 bash 仍需审批
- [ ] E2E：Skills & Commands 分区列出 Skill 与命令（来源、路径、诊断），停用一个 Skill 后重启 Sidecar 仍停用，且 `COKO_HOME` 下的文件逐字节不变
- [ ] skills.md 建立并可达（导航行写在 Comments）；ADR 0008 记录 allowed-tools 证据；ADR 0009 汇总票 03、04、05 的证据并改 implementation；`pnpm run check:docs` 通过

## Comments
- 2026-10-29 lead：来自票 02——PUT /api/config 整体替换全局值，保存 Skills 开关时须带回其他全局键（以 GET 返回的 global 为基础修改后提交）；诊断类型复用 protocol/config.ts 的 ResourceDiagnostic；scope.config 已是合并后的生效值。

