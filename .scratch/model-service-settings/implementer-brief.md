# 模型服务实施者须知

所有实施票共用。Lead 只通过上下文指针沟通，细节读文件。

## 读取

1. [规格](spec.md)（approved）、你的票 `issues/NN-*.md`（含 `## Comments` 中 Lead 追加的“来自票 NN”说明）。
2. 仓库 AGENTS.md 及其触发的文档：TECH_STACK、tech-stack/architecture、agent-runtime、testing；UI 票另读 ui.md 与 ui-design-system.md。
3. GLOSSARY（Provider、Credential、Model Catalog、Thinking Level）与 ADR [0003](../../docs/adr/0003-settings-and-sessions-in-sqlite.md)、[0004](../../docs/adr/0004-model-credentials-safe-storage.md)、[0010](../../docs/adr/0010-provider-one-shot-save.md)；当前行为见 apps/server、@coko/session、@coko/agent 的 README。
4. pi-ai 的 Thinking Level 语义：`node_modules/@earendil-works/pi-ai/dist/providers/model-schema.d.ts`（`MODEL_THINKING_LEVELS`、`ThinkingLevelMap`，null 表示不支持）与 `dist/api/{openai-completions,openai-responses,anthropic-messages}.js` 中 off 的处理。
5. 视觉：Pencil 源稿 `/Users/chenzheng/Desktop/UI/设置-模型服务.pen`（JSON，顶层 `children` 为各画面 frame，按 `name` 找票中列出的画面编号）。行为以规格为准。

## Git 与 worktree

- 集成分支 `model-service`，Lead 的集成 worktree 为 `/Users/chenzheng/Desktop/Work/person/coko-worktrees/model-service`。不要在主仓库 checkout 或集成 worktree 中修改、切换分支或合入。
- 你的 worktree：`/Users/chenzheng/Desktop/Work/person/coko-worktrees/ms-<NN-slug>`，分支 `ms/<NN-slug>`，从集成分支创建：
  `git -C /Users/chenzheng/Desktop/Work/person/coko worktree add -b ms/<NN-slug> ../coko-worktrees/ms-<NN-slug> model-service`
  已存在则复用，并确认基于 `model-service` 最新提交（不是则 `git merge model-service`）。
- 新 worktree 需要 `pnpm install --frozen-lockfile`。
- Conventional Commits；commitlint body 行长 ≤ 100；合并提交用 `chore(merge): ...`。命令链用 `set -e` 或逐步检查退出码。不要用 `--force` 删除 worktree，不要删除 worktree。
- 报告完成前 `git merge model-service` 合入集成分支最新提交并重新验证。

## 环境

- 宿主环境带 `ELECTRON_RUN_AS_NODE=1`：启动 Electron、Playwright 或 `pnpm install` 前 `unset ELECTRON_RUN_AS_NODE`；只在启动 Sidecar 子进程时设置它。
- 依赖保持精确版本；不新增依赖。确需新增时在票 Comments 说明并以 BLOCKED 报告。
- 测试不读写真实 `~/.coko`：用 harness 的临时 `COKO_HOME`。无真实模型密钥：用 faux provider 或本地兼容假服务。
- oxfmt：无分号、单引号、printWidth 160。

## 写范围（建议，非锁）

| 票 | 主要范围 |
| --- | --- |
| 01 | protocol、agent models、session schema 与 repositories、server providers 与 credentials、renderer 设置模型分区的最小调整、测试与 fixture、相关 README |
| 02 | protocol control、desktop main / preload / bridge、server control 与 providers、renderer settings-store、集成与 E2E 测试 |
| 03、04、05、06、07 | renderer 模型服务分区（按票拆子组件文件）、i18n 字典；04 另含 server 删除语义；07 另含 control 与 main / preload 的获取模型通道 |
| 08 | protocol 的 Session 模型字段、session 存储、server sessions、agent runtime、renderer 模型选择器与 chat-store |
| 09 | renderer 设置分区注册表与导航、i18n 字典 |

并行时只修改本票需要的文件；与其他进行中票重叠的共享文件（protocol barrel、i18n 字典聚合、session schema、main / preload / bridge）做最小增量改动，在 Comments 列出，合入时由 merger 解决冲突。

## 做法

- 调用 `tdd` skill，在规格第 7 节与票的验收项上先写失败测试。验证按 `coko-verify`；文档改动按 `coko-docs`（`pnpm run check:docs` 必须通过）。
- `tests/integration/secrets-gate*.test.ts` 必须保持通过；新增密钥输出通道（如 07 的获取模型）时新增 `secrets-gate-<channel>.test.ts` 复用共享 harness。
- 偏离规格或 ADR 时停下，在票 Comments 写明，以 BLOCKED 报告，不静默改验收。
- 完成后在票文件勾选已满足的验收项，在 `## Comments` 追加：覆盖的验收、实际运行的命令与结果（数量）、负向确认（先红或变异）、未验证项、文档影响，以及“供后续票”的约定（导出名、字段、消息类型）。

## 完成报告（必须）

用 send_message 发给 `lead`，**第一行**只写：

```text
MERGE-READY ms/<NN-slug> <最终 commit>
```

之后简短列出：worktree 路径、验收逐项结果、实际运行的命令与结果（数量）、未验证项、越出写范围的改动。未完成或被阻塞时第一行写 `BLOCKED ms/<NN-slug> <原因>`。
