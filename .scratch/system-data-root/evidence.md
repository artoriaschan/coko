---
kind: evidence
description: "主数据根与独立会话目录最终联合验收：真实 Sidecar、Browser Mode、后台 Electron 与打包 smoke。"
lifecycle: active
---

# 主数据根与独立会话目录联合验收

## 验证对象

- [规格](spec.md)故事 1–34；[设计](design.md)与 [13 号票](issues/13-integration-and-docs.md)。逐票红绿证据及平台限制保留在同目录 issues/01–12。
- 代码基线：`8970a86a5706ef9bcba844d9041df5358c2ec1f4`（01–12 已集成），原联合验收目标为 `5bb252fa` 的源码与测试改动；后续评审修复及重新验证见末节。13 号票 worktree 为 `/tmp/coko-sdr-13`，分支 `codex/system-data-root-13`；最终 Standards / Spec 评审由集成流程另行执行，不把本记录当作评审结论。
- 原联合验收的 8 个 TS/TSX 文件按路径排序，以 UTF-8 路径、NUL、文件字节、NUL 串联后的 SHA-256：`1ccd21cdde0938608c4a9d492ed9783d56fbb1909198d46d870ed89d08b84564`。文件为 session-runs、scheduler.test、sidecar-config/environment/mcp-resources-prompts/system-data-root.test，以及 settings 的 sections/settings-page Browser 测试。
- 环境：macOS、本机 Node/Vitest 与 Electron 41.0.3 内置 Node；Browser Mode 为无头 Chromium；Electron E2E 全部为后台测试构建。所有运行目录来自 mkdtemp；COKO_HOME、COKO_CHATS_ROOT 与 Electron userData 分别隔离，不读写真实用户业务目录。
- 模型及已声明的网络/时钟边界可被替换；桌面 E2E 沿用 harness 的原生目录/文件选择对话框替身；Artifact E2E 还在原生 shell 边界记录并替换 `shell.openPath`、`shell.showItemInFolder`，验证调用路径而不实际启动外部应用或 Finder。Sidecar、数据库、HTTP、工具、权限、文件系统和 Electron main/preload/renderer 装配使用真实实现。没有外部服务密钥或私人会话材料。

## 执行记录

| 命令或步骤 | 覆盖场景 | 实际范围与数量 | 结果 |
| --- | --- | --- | --- |
| `pnpm install --frozen-lockfile` | 独立 worktree 依赖 | 当前锁文件与原生依赖 | 退出 0 |
| 下方命令 A | 首次发送、目录、写根/checkpoint、Artifact、上传、工具结果、MCP、插件移动、空白项目、清理、存储路径、旧会话与相关回归 | 22 文件，106 项，无过滤或跳过 | 退出 0 |
| 下方命令 B | 实际桌面路径、首次发送、Artifact、附件回看/重启、空白项目、删除保留路径、存储展示 | 7 文件，11 项 | 退出 0 |
| `pnpm run test apps/desktop/e2e/package-smoke.e2e.test.ts -t '启动并完成一次 faux 对话'` | 本次打包产物启动、随包 Sidecar/ripgrep 与日志 | 1 项通过；同文件其他 5 项按标题过滤 | 退出 0 |
| `pnpm run typecheck` | 全部 TypeScript 项目 | tsc -b | 退出 0 |
| `pnpm run format`、`pnpm run lint` 后接原联合验收的 8 个 TS/TSX 文件 | 格式与静态检查 | 8 文件；`git diff --check` 同时通过 | 退出 0 |
| `pnpm run check:docs` | 正式正文、导航、生命周期与引用方向 | 末次结果见票内完成记录 | 退出 0 |

命令 A（从仓库根运行）：

```sh
pnpm run test tests/integration/sidecar-system-data-root.test.ts tests/integration/sidecar-first-send.test.ts tests/integration/sidecar-standalone-write-roots.test.ts tests/integration/sidecar-artifacts.test.ts tests/integration/sidecar-attachments.test.ts tests/integration/sidecar-tool-results.test.ts tests/integration/sidecar-mcp-data-directory.test.ts tests/integration/sidecar-plugins.test.ts tests/integration/sidecar-blank-project.test.ts tests/integration/sidecar-session-cleanup.test.ts tests/integration/sidecar-storage-paths.test.ts tests/integration/sidecar-concurrency.test.ts tests/integration/sidecar-session.test.ts tests/integration/sidecar-environment.test.ts tests/integration/sidecar-config.test.ts tests/integration/sidecar-mcp-resources-prompts.test.ts packages/agent/src/tools/scheduler.test.ts packages/session/src/sqlite/migrate-v12.test.ts packages/protocol/src/readme.test.ts apps/server/src/config.test.ts apps/desktop/src/renderer/features/settings/sections.browser.test.tsx apps/desktop/src/renderer/features/settings/settings-page.browser.test.tsx
```

命令 B：

```sh
pnpm run test apps/desktop/e2e/data-root.e2e.test.ts apps/desktop/e2e/first-send.e2e.test.ts apps/desktop/e2e/artifacts.e2e.test.ts apps/desktop/e2e/attachments.e2e.test.ts apps/desktop/e2e/create-project.e2e.test.ts apps/desktop/e2e/session-delete.e2e.test.ts apps/desktop/e2e/storage-paths.e2e.test.ts
```

### 联合事实与回归修正

新增 `sidecar-system-data-root.test.ts` 在一个真实 Sidecar 中提交文件附件，观察 Agent 把报告写入 outputs、读取报告触发完整结果落盘，再经 Artifact 接口读取同一报告；删除原文件后副本可读，归档与恢复保留副本，永久删除清理私有附件/结果但保留交付文件和 MCP 哨兵。另创建无 directory 的旧式会话，详情仍返回 Workspace cwd、Artifact 返回不可用。其余 MCP 环境/cwd、插件整体移动及空白项目的实际行为由同次命令 A 验证。

22 文件相关集包含之前 03/07/12 发现的 13 条过时基线断言。本票先以 6 文件运行复现 13 失败、19 通过，再依据独立事实修正：

- model_request 在对应 assistant 之前提交；MCP 命令前有日期 State Update；命令和 user 按 kind 定位，展开文本的字面期望保留，并与真实模型请求比较。
- 会话上下文 system 统计包含已送达状态块；期望从外部网络实际收到的块计算，草稿仍不含它们。
- 项目路径用文件系统 realpath 验证；不把 macOS 的 /var 别名当成最终规范路径。
- 设置导航加入已交付归档项，标题栏只包含当前交付操作；焦点顺序随实际菜单语义更新。
- 居中相对详情区域的 clientWidth（排除真实滚动条占位）验证，保留精确几何断言，没有放宽容差。

这些修改不改变对应产品行为。首次联合测试中的错误 HTTP verb 与非法创建参数已按现有协议修正；它们是测试构造问题，不当作产品红绿证据。

运行时仅将 `standaloneWriteRoots` 的异步快照移到最后准入检查之前，与其他根和工具一同获取。最终 isRunning/checkpoint 检查到启动保持同步，避免原新增 await 重新打开准入间隙。该修正经控制流读回以及本次真实并发、会话、首次发送和写根用例验证；未声称有可控文件系统 barrier 的确定性竞态复现。

## 文档影响与读回

| 行为或正文变化 | 所属正文 | 消费者与动作 | 读回结果 |
| --- | --- | --- | --- |
| 主根、独立目录及跨进程所有权 | configuration、server README | 补充可选启动参数、COKO_CHATS_ROOT、装配责任与正式入口 | 路径与实现一致 |
| Session.directory/cwd、files、Artifact、删除预览与 storage 协议 | protocol README | 同步路由表与操作响应；readme 机械检查通过 | 完整且可达 |
| 新目录与空目录清理决定 | ADR 0016、0020、0025、0026 | 原决定保留历史范围，0020 追加用户确认修订并链向生效决定 | 当前与原语义可区分 |
| 读取根与写根不同 | worktrees、permissions | 说明项目根快照与托管独立写根的例外 | 无互相矛盾的共享根描述 |
| MCP 提示与宿主状态 | mcp | 将模型输入说明同步为展开文本和状态前置块 | 与持久化/请求测试一致 |

从 AGENTS → docs/README → configuration、workbench、projects、permissions、execution、mcp、plugins、worktrees → ADR 与包契约读回：活动链接和锚点存在，正式文档不依赖任务材料；没有新正式目录或重复权威正文；原 ADR 理由保留，当前决定和实施状态明确。没有归档文档被改写。

## 平台审查与限制

- 主根由 homedir 与 node:path.join 派生，Windows 不分流到 APPDATA/LOCALAPPDATA；桌面 Documents 来自 Electron getPath。文件系统使用平台路径，Artifact 协议路径使用 `/` 并在服务端重新解析，普通 POSIX 反斜杠文件名已有真实用例。
- 创建目录采用原子 mkdir 与后缀冲突处理；目录删除采用 lstat/空目录操作，保留符号链接与用户内容。Windows 上权限模式位不等于 ACL，没有新增 ACL 或长路径前缀。该审查只确认代码及测试层假设，未在 Windows 实机执行；权限、符号链接、特殊名称和长路径的 Windows 行为不在本机结果中证明。
- 不迁移旧 userData/data 或旧会话目录；新主根中的空库不会显示旧库会话。v12 的空值回退只保证显式打开旧库后的记录兼容，不代表扫描或迁移旧库。
- Session directory/cwd 与附件消息引用保存本机绝对路径；跨机器重映射不在本轮范围。插件相对路径与批准摘要的整体移动是已验证的单独契约。
- 真实模型、Windows 实机、成功打开外部文件应用/Finder、真实鼠标和原生标题栏未验证。后台 CDP/Electron 操作及 Browser Mode 证明所列交互，不能替代这些范围。未运行全仓测试或发布构建平台矩阵。
- 本票仅本地提交；没有推送、远程 CI、合并 main 或发布。后续源码/依赖/配置变化需重新判断相关证据，最终评审修复由集成流程记录。


## 双轴评审修复（集成基线 e09289e9）

首轮评审独立检查了 f6db82e3 到 e09289e9：Standards 3 项（最严重 P1），Spec 1 项（P2）。全部由同一新实施代理在独立分支修复；此处记录处理与验证，不代替后续独立确认。

- Standards S1：原通用落盘和 bash 直接流写先于会话脱敏 Hook，合成登记 Secret 会进入结果文件。Sidecar 现给运行时提供 `toolOutputRedaction` 整段/流式端口，复用已有登记值脱敏器（Secret 与已登记 Credential 共用），agent 不依赖 Sidecar 或全局日志注册表。bash 在解码后、任何缓冲/写盘前处理增量；通用正文在转字节/写盘前处理。现有 Hook 顺序保持原样。流式跨 chunk 行为由同次既有 redactor 用例验证；真实 Sidecar 新增 read/bash 长结果用例扫描运行中及退出后的整个数据目录，未声称 OS 数据 chunk 被测试强制定界。
- Spec F1：ls/find/JS grep/随包 ripgrep 的默认数量上限原先提前丢弃结果。现保留原显示数量，同时将其余允许读取结果收集到有界缓冲；收集前流式脱敏、按实际字节计 32 MiB、保留 UTF-8，并用临时 capped 标记保证提前停止时文件与模型文本仍标注 `[truncated]`。grep 的两后端通过逐匹配接缝异步消费，不保留第二份无界匹配数组；context 仅缓存当前文件。显式 limit 与 read 的 offset/limit 一样是查询边界，仍及时停止，不因落盘扩大查询。
- Standards S2：普通文件草稿的完整名称与移除动作接入共享 Tooltip；名称可键盘聚焦。真实 Browser Mode 验证 320px 宽容器中的实际截断、hover 全文、Escape 与移除提示/动作，覆盖明暗主题；后台 Electron 通过键盘焦点显示同一全文并验证附件重启持久化。本轮读回截图为 `/tmp/coko-sdr-review-filename-light.png` 与 `/tmp/coko-sdr-review-filename-dark.png`；自动化最终改为独立 mkdtemp 截图命名空间，避免并行进程覆盖。
- Standards S3：本记录开头明确披露桌面原生文件选择替身及 Artifact E2E 的 shell 调用记录边界。外部应用/Finder 成功打开仍未验证，没有把记录调用冒充真实 OS 打开。

红绿证据：`pnpm run test tests/integration/secrets-gate-tool-results.test.ts` 在修复前 2/2 因原文落盘失败；修复后通过。`pnpm run test tests/integration/sidecar-tool-result-counts.test.ts` 的最初 2 个后端用例在修复前因无落盘文件失败；修复后连同脱敏字节计量/上限标记场景共 3 项通过。`pnpm run test apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx -t 'long file drafts'` 在修复前 2 项因没有 Tooltip 失败，修复后 2 项通过（同文件 14 项按标题过滤）。后续 UI 调试遇到共享 Tooltip 的 pointer-grace 和关闭动画多个临时节点，测试使用 Escape 与按目标内容定位来验证独立操作，没有放宽等待预算。

最终相关集命令：

```sh
pnpm run test tests/integration/secrets-gate-tool-results.test.ts tests/integration/secrets-gate-echo.test.ts tests/integration/secrets-gate-jobs.test.ts tests/integration/sidecar-tool-result-counts.test.ts tests/integration/sidecar-tool-results.test.ts tests/integration/sidecar-ripgrep.test.ts tests/integration/sidecar-system-data-root.test.ts tests/integration/sidecar-session-cleanup.test.ts tests/integration/sidecar-standalone-write-roots.test.ts apps/server/src/adapters/ripgrep.test.ts packages/agent/src/tools/builtin/grep.test.ts packages/agent/src/tools/builtin/file-tools.test.ts packages/agent/src/tools/builtin/bash.test.ts packages/agent/src/tools/scheduler.test.ts packages/logging/src/secret-values.test.ts apps/desktop/src/renderer/features/conversation/composer.browser.test.tsx packages/ui/src/guards/style-guard.test.ts
```

结果：17 文件、167 项通过，无过滤或跳过。最后将 ls 的 stat 异常捕获范围收窄，避免吞掉收集/脱敏异常后，针对失效部分再运行 `pnpm run test tests/integration/sidecar-tool-result-counts.test.ts packages/agent/src/tools/builtin/file-tools.test.ts`：2 文件、17 项通过。随后区分 grep 的查询数量耗尽与捕获字节上限，并补查不应伪报 matchLimitReached 的显式窗口；`pnpm run test tests/integration/sidecar-tool-result-counts.test.ts apps/server/src/adapters/ripgrep.test.ts packages/agent/src/tools/builtin/grep.test.ts packages/agent/src/tools/builtin/file-tools.test.ts`：4 文件、60 项通过。

- `pnpm run test apps/desktop/e2e/attachments.e2e.test.ts`：1 项通过，实际 Electron 900×680 窗口、明暗主题全文提示、删除源文件/重启回看与原生选择边界。
- `pnpm run test apps/desktop/e2e/package-smoke.e2e.test.ts -t '启动并完成一次 faux 对话'`：当前构建产物 1 项通过，5 项按标题过滤。
- `pnpm run typecheck`、17 个改动 TS/TSX 文件的 format/lint：通过；文档检查和最终提交状态见 13 号票追加记录。

文档按 AGENTS → 导航 → execution 与 agent README 读回：落盘前脱敏、默认显示上限和显式查询上限、临时字段移除及原生验证边界与代码/测试一致；无新增正式目录、归档改写或正式文档反向依赖任务材料。平台与未覆盖范围沿用上节，未运行全仓测试、真实模型、Windows 实机或原生前台操作。


## grep 后续复核修复（集成基线 69d558ab）

原 Standards 三项在新代理复核中均已确认修复，复核另发现两处 grep 输出回归，由另一全新实施代理在 `codex/system-data-root-grep-followup` 独立分支修复：

- 被拒绝文件的多条匹配重复增加“省略路径数”。恢复调用内的拒绝文件集合，同一路径只调用一次拒绝计数；被拒绝的内容仍不进入预览或完整捕获。
- 原始结果达到 32 MiB 后过早停止后端，连尚未完成的可见窗口也被缩短。捕获上限与预览窗口分别判断：只要可见匹配尚不足请求数量，就继续搜索；上下文分支先完成当前可见匹配的上下文，再决定停止。32 MiB 缓冲、脱敏和文件/模型截断标记保持原样。

真实 Sidecar 红绿：新增 JS/随包 ripgrep 两后端的拒绝计数用例，在修复前均观测一个文件的三条匹配报告 3 paths，修复后均为 1 path。首轮夹具的规则路径使用了 macOS /tmp 别名，先改为真实路径后才得到上述有效红证据，未将夹具构造错误算作产品问题。再新增两后端的超长首行用例：第一条匹配为 33 MiB，其后 99 条短匹配；修复前默认窗口实际只有 1 条，修复后默认 100 条、显式 limit=7 的 7 条，以及 context=1 的 100 条匹配均完整可见；三个落盘文件都不超过 32 MiB，且文件和模型文本保留 `[truncated]`。

执行记录：

- `pnpm install --frozen-lockfile`：退出 0，锁文件不变。
- `pnpm run test tests/integration/sidecar-tool-result-counts.test.ts -t 'counts each denied path'`：有效红 2 失败/3 过滤；产品修复后 2 通过/3 过滤。
- `pnpm run test tests/integration/sidecar-tool-result-counts.test.ts -t 'finishes its visible window'`：修复前 2 失败/5 过滤（预期 100、实际 1）；修复后 2 通过/5 过滤。
- `pnpm run test tests/integration/sidecar-tool-result-counts.test.ts apps/server/src/adapters/ripgrep.test.ts packages/agent/src/tools/builtin/grep.test.ts tests/integration/sidecar-ripgrep.test.ts tests/integration/secrets-gate-tool-results.test.ts`：5 文件 55 通过、1 失败。唯一失败是旧的显式 100 条查询断言仍要求 matchLimitReached 缺省；现在窗口确实完成 100 条，依据请求字面值把该断言改为 100，并同步测试名称。
- 修正该失效断言后，`pnpm run test tests/integration/sidecar-tool-result-counts.test.ts`：1 文件 7 项全部通过；其他 4 文件 49 项的既有通过证据仍有效（产品逻辑未再改变）。
- `pnpm run typecheck`：退出 0。两项 TS 文件 format/lint 与文档机械检查结果见 13 号票追加回执。

产品源码只改 grep 过滤缓存与停止条件；没有修改原生适配器、入口、依赖、UI、权限边界、或已有缓冲/脱敏实现。新增行为经当前源码启动的真实 Sidecar 及实际随包 ripgrep 验证。本小批次未重复 Electron/打包 smoke，之前的产物记录仍限定在当时源码；Windows 实机、真实模型和原生前台未验证范围不变。正式正文已经描述相同的过滤、显示上限和捕获上限契约，无新长期决定或引用需要迁移；本次只在任务证据与 13 号票追加修复回执。主代理将使用新代理完成最终 Spec 确认。


## 最终集成确认

- 产品代码集成基线为 `28c5875279b6b0c7431aa2a4e047a91c632450eb`，分支 `codex/system-data-root`；本节关闭回执仅修改任务 Markdown，不改变已验证的产品源码。
- 首轮 Standards 3 项与 Spec 1 项均由同一全新实施代理修复。新的 Standards 代理独立确认原 3 项无遗留，另运行 3 文件 28 项检查通过。Spec 后续发现的拒绝路径重复计数、捕获上限提前终止可见窗口两处回归，由另一全新实施代理一并修复。
- 最后的全新 Spec 代理独立检查 `69d558ab...28c58752`，并运行真实 Sidecar 数量结果测试：1 文件 7 项全部通过；JS/native 去重、33 MiB 首行后的默认 100 条、显式 7 条及上下文窗口完整性、文件和模型双端截断标记均确认，0 项遗留。
- 13 张实施票全部关闭，无未勾选验收项。本次 13 个实施 worktree 与 2 个评审修复 worktree 均在确认干净且分支已合入后清理；保留当前集成 worktree 与原有用户 worktree。所有实施、合并和评审委派均使用新代理，没有复用代理开展新任务。
- 结果已本地提交，未推送、未合入 main、未发布；Windows 实机、真实模型、成功打开外部应用/Finder 和原生前台操作的未验证范围保持不变。
