# 04: 新建时返回相近条目

**What to build:** Agent 新记一条记忆时会被告知已经有相近的条目，可以更新旧的而不是再添一条重复的。存储层增加“按文本查找相近条目”的能力：把文本切成三字符片段，按与条目正文重合的片段排序，低于阈值的不算相近；工具端口相应提供这项能力，可见范围与列表、检索相同。`memory_write` 不带 `id` 时照常保存，然后在本次 Run 可见的其他条目中查找相近的，至多 3 条，在结果里列出每条的 id、作用域、来源与摘要，并提示合并进旧条目后删除新建的这条。相近的条目来源为用户时注明不能改动。系统不自动合并、替换或删除任何条目。运行时没有 FTS5 时没有相近结果，写入照常。

**规格场景:** [spec](../spec.md) 的 AC-16 至 AC-21；实现决定“新建时返回相近条目”“相近程度的判定”；Further Notes 中的“相近判定对中文的效果没有验证”；用户故事 14 至 17、25。

**文档影响:** [Memory](../../../docs/subsystems/memory.md) 的检索、工具与权限、验证各节，包括阈值的取值与依据；[@coko/session](../../../packages/session/README.md) 中记忆仓库契约的说明如有对应描述则同步。

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

**Closed:** true

- [x] AC-16：已有一条“用户偏好 pnpm 而不是 npm”，模型新建一条内容相近的条目时，条目已保存，结果列出已有那条的 id、作用域、来源与摘要，并提示合并与删除。
- [x] AC-17：没有相近的条目时，结果与现状相同。
- [x] AC-18：相近的已有条目来源为用户时，结果列出它并注明由用户维护、不能改动。
- [x] AC-19：带 `id` 替换时不查找，结果不列出相近条目。
- [x] AC-20：相近的条目只存在于另一个项目的项目记忆中时，结果不列出它（对手用例）；不属于项目的 Run 只与用户级条目比较。
- [x] AC-21：运行时没有 FTS5（包括测试用的强制降级）时，保存成功，结果不列出相近条目。
- [x] 新建的条目自身不出现在相近结果中；至多 3 条，按相近程度排序；文本不足三个字符时没有相近结果。
- [x] 结果中的摘要与来源取自已保存（已脱敏）的条目；工具结果的 details 与工具卡不变。
- [x] 阈值用一组中文、英文与中英混合的样例确定：样例包含应判为相近与不应判为相近的成对文本，结论与所用样例记入 Comments，取值写入当前行为文档。对中文区分度不足的情形如实记录，不为通过用例而调低标准。
- [x] 仓库契约测试覆盖排序、阈值、可见范围与不足三个字符的输入（内存实现与 SQLite 实现）；真实 Sidecar 用例在 FTS5 与强制降级下各跑一次。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 8 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 本票是整份规格中不确定性最高的一张：相近判定的效果没有数据，05 与 07 的一个用例都依赖它。效果明显不足时先在 Comments 中报告，再决定是否继续 05。
- 2026-11-19（impl-04）：已实施，分支 `mem-tiered/t04`。
  - 存储：`MemoryRepository.similar(text, { scope?, workspaceId?, limit? })`（`packages/session`）。text 切成三字符片段（小写、按码点、去重），SQLite 经 `memories_fts` 用片段的 OR 取候选，比例（text 的片段出现在正文中的占比）在 JS 中计算；低于 `MEMORY_SIMILAR_MIN = 0.35` 的去掉，同分保持 updatedAt 倒序；fts 为 false 时为空数组。内存实现对全部条目计算同一比例。服务端 `MemoryService.similar` 与 `search` 共用可见范围与放大重查（抽出 `#query`），工具端口加 `similar(text, { scope?, limit })`，05 可直接用 limit 20 与 scope。
  - 工具：`memory_write` 新建后取 `similar(content, { limit: 4 })`，去掉新建的这条后取前 3 条，在结果文字后列出 `- id, scope, source[ (maintained by the user; you cannot change it)]: 摘要` 与合并 / 删除提示；带 id、没有相近条目或没有 FTS 时文字不变；details 不变。摘要为 `memorySummary`（`section.ts`，第一个非空行截到 60 个 UTF-16 码元、不截断代理对、截断或另有内容时加省略号）；票 03（摘要层）尚未开始，将复用或调整这个函数。
  - 阈值实验（脚本在会话 scratchpad，不入库）：29 对样例，比较新正文对已有正文的片段比例。应判相近 16 对，如“用户偏好 pnpm 而不是 npm / 用户偏好使用 pnpm，不要用 npm”0.43、“提交信息使用约定式提交格式 / …（conventional commits）格式”0.55、“代码缩进使用两个空格 / 缩进统一用两个空格”0.38、“用户喜欢简洁的回答 / 回复要尽量简短”0.00、“不要在周五发布到生产环境 / 周五不发布生产环境”0.20、“Always run pnpm vitest run before you commit / Run tests with pnpm vitest run before committing”0.69、“Never commit straight to the main branch / Do not push to main directly”0.16、“迁移数据库前要备份 SQLite 文件 / 数据库迁移前先备份 SQLite 文件”0.65、“后端 API 监听 8080 端口 / API 服务端口是 8080”0.33；不应判相近 13 对，如“用户偏好深色主题 / 用户偏好 pnpm 而不是 npm”0.33、“不要在周五开会 / 不要在周五发布到生产环境”0.60、“Use spaces for indentation in Python files / Use tabs for indentation in Go files”0.63、“Run the linter with pnpm lint before pushing / Run tests with pnpm vitest run …”0.49、“构建用 vite，不用 webpack / 测试用 vitest，不用 jest”0.35、“用户偏好 yarn / 用户偏好 pnpm 而不是 npm”0.43。各阈值的召回 / 误报：0.30 为 13/16、8/13，0.35 为 12/16、6/13，0.40 为 10/16、5/13，0.45 为 8/16、4/13，0.50 为 6/16、2/13；0.35 的召回减误报最大，故取 0.35。Dice、按较短一方计的重合系数、去掉空白与标点后切片都没有明显更好。
  - 结论（如实）：三字符片段的区分度对中文和英文都不足——它只看措辞。中文在 0.35 时召回 4/6、误报 1/5，英文 4/5、3/4，中英混合 4/5、2/4；中文漏掉的多是换说法的同义句（0 到 0.2），英文误报多是同句式的不同事实。并非“对中文明显失效”，但作为“相近”的判定只能算粗筛，需由模型读摘要后判断；05 的近似匹配也会继承这一点（同义改写查不到、同句式的不同事实会混入）。是否继续 05 请负责人判断。
  - 性能抽查：SQLite 500 条（每条 30 到 400 个词）上，50 字符与 1 864 字符的 text 各一次 `similar` 分别约 24 ms 与 33 ms（一次性 bench，未入库）。
  - 检查：`pnpm exec vitest run apps/server/src/application/context packages/agent/src/context/memory packages/session tests/integration/sidecar-memory.test.ts tests/integration/sidecar-memory-projects.test.ts tests/integration/sidecar-memory-search.test.ts tests/integration/secrets-gate-memory.test.ts` 28 个文件 184 个用例通过；`pnpm exec vitest run --project integration tests/integration/sidecar-memory-similar.test.ts` 2 个用例（FTS5 与 `COKO_TEST_NO_FTS=1`）通过；`pnpm run typecheck` 通过；`pnpm exec oxlint` 退出码 0；改动文件 `oxfmt --check` 通过（全仓 `format:check` 另有 6 个未改动的 html / css 文件不合格式，非本票引入）；`pnpm run check:docs` 0 个问题。
  - 文档影响：`docs/subsystems/memory.md` 的结构入口、检索（相近查找、阈值取值与依据）、工具与权限（memory_write 的结果）、验证；frontmatter 描述与 `docs/README.md` 导航摘要同步；`packages/session/README.md` 的 `memories.similar` 契约。
  - 未验证：没有真实条目上的效果复核；未运行 Desktop E2E（工具卡与 details 未改）。
