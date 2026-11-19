# 07: 评测：预置记忆与两个用例

**What to build:** 分层与检索是否有效可以被衡量。评测运行器增加两项能力：在 Run 开始前经记忆接口预置一组条目；faux 脚本能引用预置条目的 id（预置后由运行器把占位符替换为实际 id）。在此之上新增两个 Eval Case：“摘要层中的记忆被读出”——预置的条目使答案所在的条目落在摘要层，模型按 id 读取后把答案写入文件；“靠检索找到记忆”——预置的条目使答案所在的条目落在检索层，模型用与正文措辞不同的 `query` 找到它并写入文件。faux 模式下两个用例通过；真实模式在没有 Provider 配置或凭据时记为 `skipped: no-credentials`，不阻塞交付。

**规格场景:** [spec](../spec.md) 的 AC-31、AC-32；Testing Decisions 中的“评测”；Further Notes 中的“真实模型未验证”；用户故事 27。

**文档影响:** [追踪、审计、导出与评测](../../../docs/subsystems/tracing.md#评测)的用例格式表增加预置记忆的字段与占位符说明、当前用例列表增加两个用例；[测试约定](../../../docs/tech-stack/testing.md)中列举评测判定依据处同步。

**Blocked by:** 03 摘要层；05 检索的近似匹配

**Status:** ready-for-agent

Closed: true

- [x] Eval Case 支持在 Run 开始前预置一组记忆条目（正文与作用域）；预置只经记忆接口，不写库文件；加载用例时校验格式，格式错误给出一条原因。
- [x] faux 脚本中可以用占位符引用预置条目的 id，运行器在预置后替换；引用不存在的预置条目在加载或运行前报错，不静默通过。
- [x] 预置字段与占位符替换由单元测试覆盖，包括格式错误与引用越界。
- [x] AC-31：“摘要层中的记忆被读出”在 faux 模式下通过：预置的条目数量与长度使答案所在的条目落在摘要层，期望以文件内容判定。
- [x] AC-32：“靠检索找到记忆”在 faux 模式下通过：答案所在的条目落在检索层，faux 脚本的 `query` 与条目正文措辞不同，靠近似匹配命中。
- [x] 两个用例不依赖项目归属与任何允许规则；没有 `COKO_EVAL_PROVIDER_CONFIG` 或对应凭据时，报告中真实模式为 `skipped: no-credentials`。
- [x] 反向验证：把答案条目移出预置或把期望改成不匹配的内容时用例失败并给出原因，之后改回。
- [x] 具备凭据时运行真实模式并把结果单独报告；不具备时在 Comments 中明确记为未验证，不把 faux 通过表述为模型会主动读取摘要或检索。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-19：用户确认 8 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。
- 2026-11-19（impl-07）：已实施，分支 `mem-tiered/t07`。
  - 实现：`tests/evals/case.ts` 增加可选字段 `memories: [{ content, scope? }]`（`scope` 目前只能是 `user`：评测的 Workspace 不属于项目，workspace 作用域会被接口 400）与 faux 占位符 `{{memory:N}}`（N 为 memories 序号，从 0 起）；加载时校验格式与引用（不是整数、越界或没有预置都报一条原因），`fillMemoryIds` 在预置后替换。`tests/evals/runner.ts` 的 `seedMemories`：faux 脚本在 Sidecar 启动时读取、id 由服务端生成，所以先在同一数据目录启动一个 Sidecar 经 `POST /api/memories` 按次序新建（不写库文件），停下后替换占位符再启动运行用例的 Sidecar；真实模式同样先预置。
  - 用例：`reads-summarized-memory`（AC-31：答案条目最旧，其后 6 条约 2 000 字符的条目；正文层放最新 5 条，答案条目在摘要层，摘要行只有第一行不含答案；faux 以 `ids: ["{{memory:0}}"]` 读取后写 `token.txt`）、`finds-memory-by-search`（AC-32：答案条目、45 条短条目、6 条大条目；答案条目在检索层，“7 more entries not shown”；faux 的 query `run docker-compose before tests` 与正文“Run docker compose up before integration tests”措辞不同，严格匹配为空，近似匹配命中后写 `answer.txt`）。均为 full-access、只用用户级条目，不依赖项目归属与允许规则。
  - 测试：新增 `tests/evals/case.test.ts`（先红后绿）：合法格式、6 种格式错误 / 引用越界的原因、占位符替换；另检查两个用例的构造（答案条目含期望的答案、`tierMemories` 下所在的层、摘要行不含答案、AC-32 的 query 在内存实现上严格匹配为空且近似匹配命中答案条目）。另临时给 faux 脚本加 requestLog 在真实 Sidecar 上确认：AC-31 请求中答案条目是摘要行、`ids` 结果为全文；AC-32 段内 5 条正文、40 条摘要行、“7 more entries”，`memory_list` 返回 `No exact match…` 与答案条目（确认后已撤回该临时改动）。
  - 反向验证（改后运行、再改回）：把 AC-31 或 AC-32 的答案条目移出预置 → `case.test.ts` 构造检查失败（“expected … to contain 'BLUE-HERON-42' / 'HERON-STACK-7'”）；AC-32 去掉 19 条短条目 → 失败（“expected 'summary' to be 'omitted'”）；两例期望改成不匹配内容 → 评测失败并给出 `files/token.txt: expected to match /^RED-FOX-1$/…`、`files/answer.txt: expected "WRONG"…`。注意：faux 脚本是固定的，只移走答案条目而不改期望时评测本身仍会通过，这类错误由构造检查发现。
  - 检查：`pnpm exec vitest run --project evals`（= `pnpm run eval`）3 个文件 46 个通过、14 个跳过（真实模式与门槛）；报告中两例在 v1 与 v2 faux 下均 pass，`real` 为 `{ skipped: 'no-credentials' }`；`pnpm run typecheck` 通过；`pnpm run check:docs` 0 个问题；改动文件 `oxlint` 退出码 0、`oxfmt --check` 通过。
  - 未验证：本机没有 `COKO_EVAL_PROVIDER_CONFIG` 与凭据，真实模式未运行。faux 通过只说明预置、分层、按 id 读取与近似匹配的链路可用，不说明真实模型会主动读取摘要层条目或在检索落空后换说法再查。
  - 文档影响：`docs/subsystems/tracing.md#评测` 的用例格式表（`memories`、`{{memory:N}}`）、当前用例列表、运行器说明与 faux 局限；`docs/tech-stack/testing.md` 的评测说明（预置记忆只经记忆接口）。
