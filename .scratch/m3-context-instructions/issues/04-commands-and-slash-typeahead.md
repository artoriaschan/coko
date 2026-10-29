# 04: 命令注册、提示模板与 / typeahead

**What to build:** agent `instructions/commands/`：发现 `COKO_HOME/commands/**/*.md` 与 `<Workspace>/.coko/commands/**/*.md`（子目录以 `:` 拼名），frontmatter 只认 `description`（缺省首个非空行）与 `argument-hint`（用票 01 的 frontmatter 解析），`parseCommandArgs` / `substituteArgs`（pi，无占位符时追加 `ARGUMENTS: …`），命令注册表与来源接口（内置 > 项目 > 用户 > 其他来源，遮蔽记诊断），内置命令列表（`/compact` 在票 11 接入动作前不列出）。server `context/commands.ts`：expandInput 识别开头的 `/name`，提交 `command` 条目后提交展开文本；steer 同样展开；`commands.enabled` 与 `commands.disabled`；`GET /api/commands`。packages/ui `ComposerTypeahead`（`LexicalTypeaheadMenuPlugin`，规则见 [grilling I1](../grilling.md#第-4-轮)）；renderer `/` 命令菜单（只在草稿开头触发，按来源分组，显示 argument-hint，选中插入 `/name `）；时间线命令 chip（可展开全文）。

**User stories:** 9, 10, 11

**Blocked by:** 02

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/instructions/commands/`、`apps/server/src/application/context/commands.ts`、`apps/server/src/http/routes/commands.ts`、`packages/protocol/src/commands.ts`、`packages/ui/src/composer/`、`packages/ui/src/index.ts`、`apps/desktop/src/renderer/features/conversation/composer.tsx`、`apps/desktop/src/renderer/features/conversation/command-menu.tsx`（新）、`apps/desktop/src/renderer/features/conversation/timeline.ts`、`apps/desktop/src/renderer/features/conversation/timeline-view.tsx`、`apps/desktop/src/renderer/stores/commands-store.ts`（新）、`packages/i18n/src/dictionaries/domains/commands.ts`、`tests/integration/sidecar-commands.test.ts`（新）、`tests/fixtures/commands/`（新）、`apps/desktop/e2e/commands.e2e.test.ts`（新）、`docs/subsystems/commands.md`（新）

- [ ] agent 测试：`substituteArgs` 的 `$1`、`$@`、`$ARGUMENTS`、`${N:-default}`、`${@:N[:L]}`、引号参数、不递归、无占位符时追加；命名空间 `a:b`；同名优先级与遮蔽诊断；frontmatter 缺失与格式错误的诊断
- [ ] 集成测试：`/review src` 提交 `run_start` → `command { name: review, args: src, source: project }` → 展开后的 user message，faux requestLog 只含展开文本；未知 `/xxx` 原样作为普通消息且没有 command 条目；steer 中的模板被展开；`commands.disabled` 中的命令不展开；`GET /api/commands` 返回目录与诊断
- [ ] Browser Mode（ComposerTypeahead）：↑↓、Enter / Tab 确认、Esc 关闭且草稿不变、关闭后同一 token 不再弹出、输入法组合期间不触发、焦点留在编辑区（`aria-activedescendant`）
- [ ] E2E：输入 `/` 看到分组菜单与 argument-hint，键盘选择后发送，时间线显示命令 chip 并可展开全文；菜单不越出窗口、可用指针选择
- [ ] commands.md 建立并可达（导航行写在 Comments）；`pnpm run check:docs` 通过

## Comments
- 2026-10-29 lead：来自票 01——服务端 action 与贡献工具路径目前只在空贡献下运行，本票为命令贡献补集成用例。

