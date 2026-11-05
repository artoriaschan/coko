# 04: 关键词检索、查询语法与可见范围

**What to build:** 模型用自然语言关键词调用 `tool_search` 时，在本 Run 的目录上检索工具名、说明与第一层参数名，按相关度返回最多 limit 个工具并加载它们。中文描述按二字切分，可以用中文关键词搜到；`+词` 要求该词必须出现；没有正分时按工具名子串兜底。零命中时列出可用 Server，并提示用“Server 名 + 具体动作”重搜；schema 累计超过 8000 字符后，其余只注明已加载。`tool_search` 本身可以被 deny 规则与 PreToolUse Hook 拦截，Plan Mode 下可用；它只搜得到本 Run 可用的工具，加载不授予执行权限。

**规格场景:** [spec](../spec.md) 的 AC-03、AC-04、AC-05；对应 TS-05、06、07、08、09。

**设计依据:** [design.md](../design.md) 第 5 节“`tool_search` 的结果”；检索与结果的复刻基准见[程小帮研究](../research/chengxiaobang.md)第三节。

**文档影响:** [MCP](../../../docs/subsystems/mcp.md) 补充 `tool_search` 的查询语法与可见范围。

**Blocked by:** 03 按需加载最小闭环：目录、按确切名称加载与加载记录

**Status:** ready-for-agent

**Closed:** true

- [x] 检索照搬程小帮 v1.10.1：工具名中的 `_ . - :` 换成空格；分词取小写字母数字串，连续中日韩字符切成二字 bigram，单字保留；Okapi BM25，k1=1.5、b=0.75，df 与平均长度只在通过 `+词` 过滤的候选上统计；同分按 Server 与名称排序；没有正分时用完整查询串匹配工具名子串。不做分字段加权、NFKC 归一化、递归提取参数、翻译或 embedding。
- [x] 结果字段与提示文字照搬程小帮，替换 03 号票中非 `select:` 查询的临时零命中行为。
- [x] AC-03：`select:` 两个确切名称在 limit 为 1 时都加载；`+词` 只返回含该词的工具；常驻工具列为已可用；不存在的名称列为未知；零命中时返回可用 Server 与重搜提示；schema 累计超过 8000 字符的部分只注明已加载。
- [x] AC-04：中文描述的工具按二字切分命中；英文描述的工具没有命中时按零命中处理；子串查询在没有正分时仍返回该工具。
- [x] AC-05：目标工具有 deny 规则时可以加载，但调用被拒绝，处理函数不执行；PreToolUse Hook 能拦截 `tool_search`；Plan Mode 下可以搜索；disabledTools 中的工具与未批准项目 Server 的工具搜不到，按确切名称选择时报未知。
- [x] 检索与结果文本有纯函数单测；AC-03 至 AC-05 另经真实 Sidecar（faux 脚本）验证，单测不代替它们。模型可见的结果文本变化同步到 03 号票建立的会话回放或快照。
- [x] 按[测试约定](../../../docs/tech-stack/testing.md#测试执行与结果报告)运行最小相关集与类型检查；实际执行的检查和文档影响记入 Comments。

## Comments

- 2026-11-05：用户确认 15 票的拆分及阻塞关系。本票发布到本地 Markdown tracker，尚未实施，验收项均未完成。

- 2026-11-05 实施：新增纯查询解析与 BM25（k1=1.5、b=0.75），必需词先过滤再统计候选语料，按英文数字词与 CJK 二字切分；只索引名称、说明与第一层参数名。普通查询 limit 缺省 5、裁剪到 1—20，确切选择不受 limit 限制；结果 schema 累计预算为 8000 字符，超额项目仍加载并注明省略。文本与提示按 v1.10.1 复刻、只替换工具名称。
- TDD：`rtk pnpm run test packages/agent/src/tools/tool-search/tool-search.test.ts` 最初 1 failed / 2 passed，关键词查询实际返回空；实现后通过。schema 预算测试另先红（未省略超额 schema）后绿。最终检索/目录纯函数 8/8，覆盖必需词过滤后的 BM25 排名、同分顺序、CJK、不翻译/不递归/NFKC、完整子串兜底、limit 与 schema 预算。
- Sidecar 接缝：新增 `tests/integration/sidecar-tool-search-keywords.test.ts` 5/5，真实 stdio MCP fixture 使用每例独立目录的 catalog 文件，模型为 faux。AC-03/04 通过中文 Server 与另一个英文 Server、关键词、确切选择、常驻/未知名称、零命中与大 schema 结果验证；独立期望 `tests/fixtures/tool-search/keyword-result.json` 在真实 Sidecar 结果上比对。AC-05 覆盖 Plan Mode 搜索、disabledTools 与未批准项目 Server 返回未知（项目 fixture 未启动）、deny/PreToolUse 拦截搜索，以及已加载的被拒业务工具不向 MCP 发送调用。
- 最终检查：`rtk pnpm run test packages/agent/src/tools/tool-search/tool-search.test.ts tests/integration/sidecar-tool-search-keywords.test.ts tests/integration/sidecar-tool-search.test.ts` 3 文件 19/19，退出码 0；`rtk pnpm run typecheck` 退出码 0；定向 `rtk pnpm exec oxlint` 退出码 0。首次集成测试有两处状态码预期写成 201，而规则接口契约为 200，修正测试后通过；未放宽业务断言。
- 文档影响：`docs/subsystems/mcp.md` 更新检索语法、算法、schema 预算、可见范围及权限规则；`docs/README.md` 同步导航摘要。搜索旧“关键词查询返回零命中/关键词检索另行接入”结论，无活动正式正文残留；03 号已关闭票保留当时分阶段行为。按 AGENTS → docs/README → MCP 正文读回核对，生命周期、归属、引用方向与导航一致。
- 未覆盖：真实 Provider/缓存效果、Electron 窗口和原生层、构建产物与 CI。本票未修改 UI、Provider 传输或存储接口，不新增这些范围的验证。
