---
kind: technical-spec
description: "测试运行时与编排、用例设计、隔离与确定性，以及执行范围和结果报告的项目约定。"
lifecycle: active
---

# 测试约定

项目级技术约定，不代表已有实现或已验证结果；适用范围与变更规则见 [专项导航](README.md)。

## 运行与编排

Vitest 测试运行在开发机 Node.js，UI 组件通过 Browser Mode 在真实浏览器中测试。Agent 与服务端的业务逻辑通过运行时无关的接口进行单元测试；涉及进程启动、访问认证、`node:sqlite` 存储与写者互斥或恢复的集成测试，由 Vitest 以 `ELECTRON_RUN_AS_NODE=1` 启动真实 sidecar 并通过协议验证，使行为在 Electron 内置 Node.js 中成立。被宿主覆盖的工具，内置实现与宿主实现运行同一组契约测试。测试发现、断言、生命周期和报告统一使用 Vitest。

依赖安装、类型检查、Lint、测试及桌面构建均通过本地脚本执行，打包与发布统一由 Electron Forge 管理。

桌面 E2E 与产物 smoke 默认以后台模式启动应用（`COKO_E2E_BACKGROUND=1`）：应用仍在真实 Electron 中渲染和交互，但不激活、不抢占前台焦点、不显示 Dock 图标，窗口透明；该开关只在未打包或测试构建中生效，发布构建忽略它。本地调试需要看到窗口时设置 `COKO_E2E_VISIBLE=1`。

发布构建（不带 `COKO_TEST_BUILD`）的产物 E2E 是单独的 Vitest 项目 `desktop-release`（`apps/desktop/vitest.release.config.ts`），只在 `COKO_RELEASE_E2E=1` 时选中用例；未设置时选中 0 个文件、不打包，默认的 `pnpm run test` 不受影响。它的 globalSetup 以 `COKO_FORGE_OUT_DIR=out-release` 运行 `pnpm run make`，与测试构建的 `out/` 分开；因为会再打一次包，在全量测试锁内运行。发布构建忽略后台模式，用例以 `open -g -n` 启动应用（不激活）并经 CDP 连接，进程号从 CDP 的 `SystemInfo.getProcessInfo` 读取，只结束这些进程。对手用例：带 `COKO_FAUX_SCRIPT`、`COKO_TEST_CLOCK`、`COKO_E2E_BACKGROUND`、`COKO_TEST_UPDATE_FEED_URL` 启动时没有 Provider、日志 `test hooks ignored in a packaged build` 列出这些名字、`POST /api/test/clock` 404、测试更新源收不到请求且 `auto update disabled { reason: no-feed }`、随包 ripgrep 与 node-pty 被加载；dmg 经 `hdiutil attach -readonly -nobrowse` 挂载后有 `Coko.app`，记录 `codesign --verify` 的结果（adhoc，不断言 Developer ID）后卸载。当前做法见 [安装包、自动更新与发布构建](../subsystems/delivery.md)。

回归评测是 Vitest 项目 `evals`（`tests/evals/vitest.config.ts`），随 `pnpm run test` 运行，`pnpm run eval` 只运行它。每个 Eval Case 为 `cases/<name>/` 中的 `case.json`（提示、权限模式、faux 脚本与期望）与初始 `workspace/`；运行器复用集成测试的 sidecar-harness 启动真实 Sidecar，在临时目录中运行后只按外部事实判定（文件内容、应不变的文件、工具调用数与 Run 状态），报告写到 git 忽略的 `tests/evals/reports/<ISO>.json`（每例 pass / fail、原因、tokens、cost、durationMs）。默认只跑 faux；`COKO_EVAL_PROVIDER_CONFIG` 与对应的 `COKO_CREDENTIAL_<ID>` 都存在时同一组用例另用真实模型运行，缺一时报告记 `skipped: no-credentials`，按上文“真实模型测试单独报告”列为未验证。用例格式与真实模式见 [追踪、审计、导出与评测](../subsystems/tracing.md#评测)。

## 测试用例生成与维护

新增功能、修复缺陷或改变已有行为时，按以下规则设计测试；框架版本见 [技术栈](../TECH_STACK.md#代码质量与测试工具)，运行时遵循下文“运行与编排”，测试位置遵循 [构建与测试归属](architecture.md#构建与测试归属)。

- **从行为生成用例。** 先明确输入、可观察结果和失败条件，再选择单元、集成、浏览器、桌面端到端或会话回放测试。优先覆盖边界条件、错误路径、事件顺序、取消、恢复、并发和资源释放；不要逐行复刻实现或仅为提高覆盖率增加无行为价值的断言。
- **验证回归能被捕获。** 缺陷修复在可行时先观察回归用例在修复前失败、修复后通过；新增静态检查或守卫必须临时引入违规样例，确认因预期原因失败，再撤销样例。竞态测试用 barrier 或 deferred promise 确定交叠位置，重复运行不能替代竞态复现。
- **保留真实实现。** 只在昂贵或不确定的边界替换模型适配器、外部网络或时钟，其后的业务逻辑、工具注册与执行、状态流转和持久化链路使用真实实现。同进程类型接口已经保证的输入不额外制造非法值测试；解析器、配置、工具 JSON、文件、持久化和跨进程协议需要验证非法输入。
- **断言外部事实。** 端到端测试重新读取文件、查询持久化状态、观察协议事件、UI 或进程退出结果；Agent 回复“完成”或包含关键词不能证明操作成功。文件修改场景验证预期目录内容，并确认不应变化的文件逐字节不变。
- **覆盖实际入口。** 产品可见能力必须有通过真实应用装配入口运行的非单元测试。涉及 sidecar 进程、访问认证或宿主专属能力时启动真实 sidecar，通过协议验证；涉及 Electron 原生能力时启动真实 Electron。修改打包、导出、进程入口或资源路径时，对当前构建产物执行 smoke test，源码测试不能替代产物验证。
- **同步维护可见输出。** 非平凡的模型、协议或用户可见行为变化，在同一变更中新增或更新无需密钥的录制会话回放或所属输出快照；会话驱动行为验证回放与持久化结果，纯 UI 行为验证实际浏览器输出。缺少必要测试驱动时一并补齐。逐项审查录制或刷新产生的差异，预期文件内容独立维护，不用本次实际输出自动覆盖期望来消除失败。
- **测试随行为演进。** 合理改变旧行为时同步更新旧测试并说明原因。测试放在被测模块附近，跨应用场景按技术栈放到根测试目录；共享 fixture/helper 放在普通模块中，不导入另一个测试文件，以免重复注册和执行用例。

## 测试隔离与确定性

编写或修改异步测试、fixture、子进程及测试执行配置时，假设不同测试文件、worker、独立测试进程和 CI job 可能同时运行。

- **原子分配资源。** 每个测试使用独立临时目录、数据库和会话命名空间；临时目录使用 `mkdtemp`，网络服务绑定 loopback 的端口 `0` 并在 listening 后读取实际端口。禁止先探测空闲端口再绑定，或使用可冲突的固定路径。仅作为解析输入或期望值的字面量不受此限制。
- **恢复全局状态。** 优先依赖注入；确需修改环境变量、cwd、时区、locale、全局 mock、注册表或 fake timers 时，立即登记清理，并在最小作用域的 `try/finally` 中恢复原值，包括原先不存在的状态。
- **等待可观察状态。** 通过就绪事件、握手、状态变化、受控 promise 或外部条件同步。固定 sleep 不能代表准备或清理完成；timeout 只限制等待上限。测试时间行为时注入或模拟时钟，并恢复真实时钟。
- **Browser Mode 共用页面。** 同一 Browser Mode 项目的文件共用一个页面源。desktop renderer 的共用 setup（`apps/desktop/src/renderer/testing/browser-setup.ts`）在每个用例前快照 localStorage、结束后恢复，卸载渲染的组件，并在 body 的子节点留有 `aria-hidden` / `data-aria-hidden` 或 body 的 `pointer-events` 未复原时让该用例失败：打开 Radix 菜单或对话框的用例要等它关闭后再结束，不要清空 `document.body` 代替卸载，`unmount()` 要 await。 指针位置同样不在文件之间重置：断言颜色、hover 或命中区域的用例自己设定指针状态（例如测量区域 `pointer-events: none`，或先显式移动指针），不依赖前一个文件留下的位置。
- **测试中的 git 不经过包装。** git 夹具为每个测试设一个新的临时 HOME。PATH 上的 `git` 若是包装程序（例如 git-ai 的 `~/.git-ai/bin/git -> git-ai`），包装会为每个 HOME 起一个后台进程，临时目录删除后进程仍在，累积后耗尽 `kern.maxprocperuid`，git、hook 与 vitest worker 都会 `spawn EAGAIN`。根 `vitest.config.ts` 在 worker 启动前用 `scripts/test-path.ts` 去掉这类目录，worker、Sidecar 与 Electron 子进程继承清理后的 PATH；`scripts/test-path.test.ts` 断言测试进程中的 `git` 解析到名为 git 的程序。从仓库根运行 `pnpm run test` 或 `pnpm exec vitest run <文件>` 时生效。
- **清理到真正结束。** 获取资源后立即登记 teardown，确保断言失败、超时或重试时也释放资源。停止新任务、解除监听并等待子进程退出、server close、worker termination 等完成信号；仅调用 `abort()`、`close()` 或 `kill()` 不算清理完成。迟到的回调不得污染其他测试。
- **尊重平台与执行预算。** 用实际读回值验证操作系统管理的时间戳等数据；确属平台专有行为时显式跳过并说明原因。测试和 hooks 的超时预算应匹配执行环境；测试内部 deadline 必须明显短于外层等待上限。
- **按风险验证隔离。** 全局状态变更验证恢复，生命周期变更验证清理完成，跨进程资源隔离修复使用独立测试进程并发验证。只在单独运行时通过应视为测试缺陷；不要用整个套件串行化掩盖资源冲突。

## 测试执行与结果报告

- **先确认真实执行入口。** 从当前 `package.json`、Vitest 配置和 CI 工作流确认命令、测试项目、过滤参数及构建前置条件。Vitest 统一编排测试；单元测试解析当前源码，产物测试显式依赖本次构建，避免源码与旧构建产物混用。不得假设技术栈文档中规划的脚本已经存在。
- **先跑最小相关集。** 每个行为改动运行能捕获其回归的最小测试文件或用例；共享接口变化再扩大到受影响模块。输出变化运行对应回放或快照，构建变化运行类型检查、构建及产物 smoke，纯文档变化运行适用的文档检查。确认实际选中的测试数量，零用例、全部跳过均不算通过验证。
- **全量运行有明确理由。** 不默认运行全仓测试；全量覆盖率及平台矩阵交由 CI。仅在用户明确要求、诊断 CI 失败，或变更确实无法缩小验证范围时在本地全量执行。已有通过证据在代码、依赖、配置和相关基础状态未变时复用，不因提交或推送而重复执行；后续变更仅重跑失效的检查。
- **覆盖率与测试范围分别选择。** 聚焦运行时同时选择所属测试与受影响源码的覆盖率范围，遵守仓库配置的阈值。不得降低阈值、排除受影响源码或允许零测试来制造通过。未覆盖代码先判断是否为死代码；覆盖率只说明代码执行过，不能替代行为断言或实际入口验证。
- **真实模型测试单独报告。** 涉及 provider 或真实 Agent 行为且具备凭据时，运行相关真实 API 场景；无密钥的回放只证明可控输入下的链路。缺少凭据时显式跳过并报告未验证项，禁止输出或提交密钥。
- **失败先定位再修复。** 保留精确命令、失败用例、日志和环境，先复现失败组或具体场景。不得靠盲目加长 timeout、重试、sleep、吞异常、放宽断言或归一化真实差异消除失败。外部服务已知瞬态故障可在边界采用有依据的有限重试；预算调整必须说明等待对象和观测证据。
- **证据对应当前状态。** 完成或推送前运行选定的相关检查；失败先修复或明确报告阻塞。只报告实际执行的命令、范围与结果，区分通过、失败、跳过、未运行和 CI 等待中。针对当前提交核对 CI；历史绿灯、局部通过、成功构建均不能表述为当前全量测试通过。
