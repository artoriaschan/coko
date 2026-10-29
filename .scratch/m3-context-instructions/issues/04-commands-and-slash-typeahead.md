# 04: 命令注册、提示模板与 / typeahead

**What to build:** agent `instructions/commands/`：发现 `COKO_HOME/commands/**/*.md` 与 `<Workspace>/.coko/commands/**/*.md`（子目录以 `:` 拼名），frontmatter 只认 `description`（缺省首个非空行）与 `argument-hint`（用票 01 的 frontmatter 解析），`parseCommandArgs` / `substituteArgs`（pi，无占位符时追加 `ARGUMENTS: …`），命令注册表与来源接口（内置 > 项目 > 用户 > 其他来源，遮蔽记诊断），内置命令列表（`/compact` 在票 11 接入动作前不列出）。server `context/commands.ts`：expandInput 识别开头的 `/name`，提交 `command` 条目后提交展开文本；steer 同样展开；`commands.enabled` 与 `commands.disabled`；`GET /api/commands`。packages/ui `ComposerTypeahead`（`LexicalTypeaheadMenuPlugin`，规则见 [grilling I1](../grilling.md#第-4-轮)）；renderer `/` 命令菜单（只在草稿开头触发，按来源分组，显示 argument-hint，选中插入 `/name `）；时间线命令 chip（可展开全文）。

**User stories:** 9, 10, 11

**Blocked by:** 02

**Status:** ready-for-agent（实施完成，待 Lead 合入）

**Write scope:** `packages/agent/src/instructions/commands/`、`apps/server/src/application/context/commands.ts`、`apps/server/src/http/routes/commands.ts`、`packages/protocol/src/commands.ts`、`packages/ui/src/composer/`、`packages/ui/src/index.ts`、`apps/desktop/src/renderer/features/conversation/composer.tsx`、`apps/desktop/src/renderer/features/conversation/command-menu.tsx`（新）、`apps/desktop/src/renderer/features/conversation/timeline.ts`、`apps/desktop/src/renderer/features/conversation/timeline-view.tsx`、`apps/desktop/src/renderer/stores/commands-store.ts`（新）、`packages/i18n/src/dictionaries/domains/commands.ts`、`tests/integration/sidecar-commands.test.ts`（新）、`tests/fixtures/commands/`（新）、`apps/desktop/e2e/commands.e2e.test.ts`（新）、`docs/subsystems/commands.md`（新）

- [x] agent 测试：`substituteArgs` 的 `$1`、`$@`、`$ARGUMENTS`、`${N:-default}`、`${@:N[:L]}`、引号参数、不递归、无占位符时追加；命名空间 `a:b`；同名优先级与遮蔽诊断；frontmatter 缺失与格式错误的诊断
- [x] 集成测试：`/review src` 提交 `run_start` → `command { name: review, args: src, source: project }` → 展开后的 user message，faux requestLog 只含展开文本；未知 `/xxx` 原样作为普通消息且没有 command 条目；steer 中的模板被展开；`commands.disabled` 中的命令不展开；`GET /api/commands` 返回目录与诊断
- [x] Browser Mode（ComposerTypeahead）：↑↓、Enter / Tab 确认、Esc 关闭且草稿不变、关闭后同一 token 不再弹出、输入法组合期间不触发、焦点留在编辑区（`aria-activedescendant`）
- [x] E2E：输入 `/` 看到分组菜单与 argument-hint，键盘选择后发送，时间线显示命令 chip 并可展开全文；菜单不越出窗口、可用指针选择
- [x] commands.md 建立并可达（导航行写在 Comments）；`pnpm run check:docs` 通过

## Comments
- 2026-10-29 lead：来自票 01——服务端 action 与贡献工具路径目前只在空贡献下运行，本票为命令贡献补集成用例。


### 实施者报告（m3/04-commands-and-slash-typeahead，2026-10-29）

**覆盖的验收**

1. agent：`instructions/commands/args.test.ts`（28：`$1`、`$@`、`$ARGUMENTS`、`${N:-default}`、`${@:-default}`、`${@:N}`、`${@:N:L}`、`${@:0}`、引号参数、不递归（参数与默认值）、无占位符时追加 `ARGUMENTS: <原始参数文本>`、调用识别与 `/usr/bin` 等非调用）；`commands.test.ts`（6：递归发现与 `a:b` 命名空间、frontmatter 只认 description / argument-hint、缺省描述取首个非空行（60 字符截断）、`invalid-frontmatter` / `invalid-value` / `invalid-name` / `empty-template` / `read-failed`、mtime 缓存、同名优先级与 `shadowed` 诊断、启停）。
2. 集成：`tests/integration/sidecar-commands.test.ts`（5，夹具 `tests/fixtures/commands/`）：`/review src` → `run_start`、`command { review, src, project }`、展开后的 user message，faux requestLog 只含展开文本且不含 `/review`；用户级命令与 `/git:commit`；未知 `/xxx` 原样、无 command 条目；steer 中 `/hello Bob` 展开且 command 条目紧接其 user message；`commands.disabled` 与 `commands.enabled=false` 不展开（停用的仍以 `enabled: false` 列出）；`GET /api/commands` 的目录、诊断（`invalid-frontmatter`、`shadowed`）、sessionId / workspaceId 等价、400 / 404。另：`apps/server/src/application/context/commands.test.ts`（2）补了票 01 留下的服务端动作路径——内置命令展开为动作并调用、Run 进行中 409 `run-in-progress`、steer 中 400 `bad-request`；Skill 来源命令的展开、条目与来源抛出的 AppError（400）；未接入动作的内置命令与不合格的来源条目不进目录。
3. Browser Mode：`packages/ui/src/composer/composer-typeahead.browser.test.tsx`（8）：↑↓ 循环、Enter / Tab 确认插入 `/name ` 且不提交、Esc 关闭且草稿不变（不触发编辑区 Esc）、关闭后同一 token 继续输入不再弹出、删掉后重新输入再弹出、非开头的 `/` 与无匹配不打开且 Enter 照常提交、输入法组合期间不打开（Chromium CDP `Input.imeSetComposition`）、组合中的 Enter（isComposing 与 keyCode 229）不确认、焦点留在编辑区与 `aria-activedescendant`、菜单打开后连续输入再 Enter 时整个 token 被替换、指针选择与定位（在编辑区上方、不越出窗口）。
4. E2E：`apps/desktop/e2e/commands.e2e.test.ts`（2）：分组（项目 / 用户）与 argument-hint、菜单几何（不越出窗口、在输入区上方）、键盘选择后发送、时间线命令 chip 显示 `/review src` 并可展开全文、requestLog 只含展开文本；Esc 关闭草稿不变、指针选择且焦点留在编辑区。
5. `docs/subsystems/commands.md` 建立；`docs/README.md` 当前行为导航已加一行（合并 main 时与票 03 的"指令文件"一行冲突，两行都保留，命令在后）；`pnpm run check:docs` 109 个文件 0 问题。

**实际运行的命令与结果**（worktree，已 `git merge main`（7dea20f，含票 03、09），最终 HEAD 见下）

- `pnpm install --frozen-lockfile` 0；`pnpm run typecheck` 0；`pnpm run lint` 0 警告 0 错误；`pnpm run format:check` 0；`pnpm run check:docs` 0 问题。
- `pnpm run test`：132 个文件通过，1023 通过、1 跳过（settings E2E 中已有的跳过），含 desktop E2E 14 个文件与产物 smoke（`package-smoke.e2e.test.ts` 2 个）。
- 清空 `node_modules/.vite` 后 `--project ui-browser --project desktop-renderer`：15 文件 92 通过，无预构建重载。

**负向确认**

- 集成：把 `expandInput` 的调用识别改为恒 undefined → `sidecar-commands` 4 个展开用例失败（目录用例照常通过），撤销后通过。
- typeahead：去掉输入法守卫 → 输入法用例失败；去掉 Esc 的已关闭 token 记忆 → Esc 用例失败；去掉 `editor.isComposing()` 检查 → 输入法用例失败（最初用合成 composition 事件时该变异没被抓到，改用 CDP 真实组合后才抓到）。
- 先红：agent 两个测试文件、timeline 命令用例、"连续输入再 Enter"用例均先失败后实现。ComposerTypeahead 的其余 Browser 用例写在实现之后，以上变异作为替代证据。
- E2E 首次运行发现真实缺陷：菜单打开后快速输入 `rev` 再 Enter 得到 `/re/review `（插件按上一次渲染的匹配切分节点），已修复并加 Browser 回归用例。

**未验证项**

- 真实模型：无凭据，未运行。
- Safari / WebKit 的输入法行为只按 keyCode 229 的合成事件验证；只在 Chromium（Browser Mode 与 Electron）运行。
- Skill 与 MCP 来源、内置命令（/compact）在真实 Sidecar 上尚无实例，只由 server 单元测试经假贡献覆盖。

**越出 Write scope 的改动**（请 Lead 裁决）

- `apps/server/src/application/context/index.ts`（票 01 文件，已关票）：`createContributions` 把组合后的数组以 `siblings` 传给命令贡献，使其读取其余领域的 `commandSources` 与 `actions`（5 行）。不改则票 05、08 的来源与票 11 的 /compact 无法进入目录。
- `apps/desktop/src/renderer/features/conversation/conversation-pane.tsx`：给 Composer 传 `commandTarget`（当前会话或 Workspace 草稿，useMemo，约 6 行）。
- `packages/ui/src/components/dropdown-menu.tsx`：导出既有的 `menuSurface`（样式守卫只允许该文件使用菜单材质；typeahead 复用它而不复制）。
- 新测试文件：`apps/server/src/application/context/commands.test.ts`；修改 `apps/desktop/src/renderer/features/conversation/timeline.test.ts`（新增命令用例）。
- `docs/README.md`：只加本票一行。

**文档影响**：新增 `docs/subsystems/commands.md`；README 导航一行。TECH_STACK 未改（本票未新增依赖；Lexical typeahead 与 Radix Popper 已在已装包内，Popper 经 `radix-ui/internal`，dialog.tsx 已有先例）。ADR 0009 的证据归票 05 汇总：用户级与项目级命令以临时 `COKO_HOME` 经真实 Sidecar 加载（`sidecar-commands.test.ts`），修改文件后下一次读取生效（`commands.test.ts` 的 mtime 用例；目录每次请求重新列出）。

### 供后续票

- **命令来源（票 05 Skill、票 08 MCP）**：`commandSources: [{ source: 'skill' | 'mcp', list(scope) }]` 的元素为 `SourcedCommand`（`apps/server/src/application/context/commands.ts`）：`{ name, description, argumentHint?, source, path?, enabled?, expand(args, scope): Promise<string> }`。`expand` 返回展开文本，命令贡献负责提交 `command { name, args, source }` 条目；缺必填参数等抛 `AppError('bad-request', …)`，提交以该错误失败。Skill 的停用（skills.disabled）经 `enabled: false` 给出；`commands.enabled` / `commands.disabled` 作用于模板与 MCP 提示模板，不作用于 Skill。不合 `isSourcedCommand` 的元素与 `list` 抛错只记 warn。
- **内置命令（票 11）**：在 `packages/agent/src/instructions/commands/builtin.ts` 的 `BUILTIN_COMMANDS` 加 `{ name: 'compact', description, argumentHint?, action: 'compact' }`；只有某个贡献的 `actions` 含 `compact` 时才进入目录。展开为 `{ kind: 'action', name: 'compact', args }`；动作路径的 409 / 400 已有 server 单元测试，票 11 在 Sidecar 上补集成用例。
- **设置分区（票 05）**：`GET /api/commands?workspaceId` 返回全部命令（含 `enabled: false`）与诊断；renderer `stores/commands-store.ts` 的 `createCommandsStore` / `httpFetchCommands` 可复用。启停写 `commands.disabled`（经 PUT /api/config，带回其他全局键）。
- **typeahead（票 06 `@` 文件菜单）**：`ComposerTypeahead` 放在 `ComposerEditor` 的 children 中；`position: 'word'` 已实现（词首触发）但只有 `'start'` 有测试。`getItems(query)` 同步返回候选（为空时菜单不出现）；`onSelect(item)` 返回替换 token 的文本。选项 id 为 `typeahead-item-<index>`、容器 id 为 `typeahead-menu`（Lexical 插件固定），同一页面同时打开两个菜单会冲突。插件挂载时就在 body 放一个空 listbox 容器，组件在关闭时把它设为 aria-hidden 并本地化名称。
- **时间线**：`TimelineItem` 的 user 项新增可选 `command`（CommandPayload）与 `invocation`（`/name 参数`，回退时放回输入区）。
