---
kind: evidence
description: "主数据根与独立会话目录最终联合验收：真实 Sidecar、Browser Mode、后台 Electron 与打包 smoke。"
lifecycle: active
---

# 主数据根与独立会话目录联合验收

## 验证对象

- [规格](spec.md)故事 1–34；[设计](design.md)与 [13 号票](issues/13-integration-and-docs.md)。逐票红绿证据及平台限制保留在同目录 issues/01–12。
- 代码基线：`8970a86a5706ef9bcba844d9041df5358c2ec1f4`（01–12 已集成），目标为本记录同提交的源码与测试改动。13 号票 worktree 为 `/tmp/coko-sdr-13`，分支 `codex/system-data-root-13`；最终 Standards / Spec 评审由集成流程另行执行，不把本记录当作评审结论。
- 本票 8 个 TS/TSX 文件按路径排序，以 UTF-8 路径、NUL、文件字节、NUL 串联后的 SHA-256：`1ccd21cdde0938608c4a9d492ed9783d56fbb1909198d46d870ed89d08b84564`。文件为 session-runs、scheduler.test、sidecar-config/environment/mcp-resources-prompts/system-data-root.test，以及 settings 的 sections/settings-page Browser 测试。
- 环境：macOS、本机 Node/Vitest 与 Electron 41.0.3 内置 Node；Browser Mode 为无头 Chromium；Electron E2E 全部为后台测试构建。所有运行目录来自 mkdtemp；COKO_HOME、COKO_CHATS_ROOT 与 Electron userData 分别隔离，不读写真实用户业务目录。
- 只替换模型及已声明的网络/时钟边界；Sidecar、数据库、HTTP、工具、权限、文件系统和 Electron 装配均使用真实实现。没有外部服务密钥或私人会话材料。

## 执行记录

| 命令或步骤 | 覆盖场景 | 实际范围与数量 | 结果 |
| --- | --- | --- | --- |
| `pnpm install --frozen-lockfile` | 独立 worktree 依赖 | 当前锁文件与原生依赖 | 退出 0 |
| 下方命令 A | 首次发送、目录、写根/checkpoint、Artifact、上传、工具结果、MCP、插件移动、空白项目、清理、存储路径、旧会话与相关回归 | 22 文件，106 项，无过滤或跳过 | 退出 0 |
| 下方命令 B | 实际桌面路径、首次发送、Artifact、附件回看/重启、空白项目、删除保留路径、存储展示 | 7 文件，11 项 | 退出 0 |
| `pnpm run test apps/desktop/e2e/package-smoke.e2e.test.ts -t '启动并完成一次 faux 对话'` | 本次打包产物启动、随包 Sidecar/ripgrep 与日志 | 1 项通过；同文件其他 5 项按标题过滤 | 退出 0 |
| `pnpm run typecheck` | 全部 TypeScript 项目 | tsc -b | 退出 0 |
| `pnpm run format`、`pnpm run lint` 后接本票 8 个 TS/TSX 文件 | 格式与静态检查 | 8 文件；`git diff --check` 同时通过 | 退出 0 |
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
