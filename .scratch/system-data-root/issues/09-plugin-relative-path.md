# 09: 插件路径相对化

**What to build:** 已安装插件在数据库里记录相对 `COKO_HOME` 的安装路径，读取时再解析为绝对路径。用户整体移动主数据根后，已安装插件仍然可用；旧版本留下的绝对路径记录按原样继续工作。

**Blocked by:** 01 主数据根切换到 ~/.coko

**Status:** ready-for-agent

- [x] 新安装的插件在库中存相对主根的路径，启动后能被扫描并出现在插件列表。
- [x] 把 `COKO_HOME` 指到新位置（连同插件目录一起移动）后，插件仍能被识别与启用。
- [x] 旧记录中的绝对路径仍可读取；路径不存在时给出与现在一致的错误，不会误删或误判为越界。
- [x] 卸载与更新前的路径校验仍只允许主根下的路径，越界路径被拒绝。
- [x] 集成测试覆盖相对路径解析、主根移动后的读取与旧绝对路径兼容。


Closed: true

## Comments

### 2026-11-05 — 实施与验证

- 基线 `b1bad1c0`；独立 worktree `/tmp/coko-sdr-09`、分支 `codex/system-data-root-09`。新安装保存相对 `COKO_HOME` 的 `plugins/<name>`；加载、更新目标和卸载检查统一基于当前主根解析。旧绝对记录保留原路径；更新/卸载仍检查字面与真实路径都在插件根内。
- 新相对记录使用替换根目录前的完整可执行声明摘要；旧绝对记录继续使用原展开后摘要，不把摘要不匹配自动转为批准。整体搬移主根不使新记录失效，实际 Hook 命令、MCP 参数/env、LSP 命令变化仍要求重新批准。
- TDD 红：`rtk pnpm run test apps/server/src/application/plugins.test.ts -t '安装：复制'`，1 失败/9 过滤，实际绝对路径与期望 `plugins/demo` 不同；修复后同命令 1 通过/9 过滤。
- TDD 红：`rtk pnpm run test tests/integration/sidecar-plugins.test.ts -t '整体移动'`，1 失败/3 过滤，移动后 `digest` 变化、状态 `needs-approval`；修复摘要后同命令 1 通过/3 过滤。用例实际移动主根和 SQLite，重启真实 Sidecar，验证批准状态、命令、Hook 文件与 MCP 工具执行、真实声明变化再审批，以及在新位置更新和卸载。
- 最小相关集：`rtk pnpm run test tests/integration/sidecar-plugins.test.ts tests/integration/sidecar-plugins-trust.test.ts tests/integration/secrets-gate-plugins.test.ts packages/agent/src/extensions/plugins/manifest.test.ts apps/server/src/application/plugins.test.ts`，退出 0，5 文件 59 项通过，无过滤/跳过。包含旧绝对路径与旧批准摘要兼容、缺失路径诊断、越界绝对/相对/符号链接更新与卸载拒绝；既有插件批准、信任与 Secret 脱敏回归通过。
- `rtk pnpm run typecheck` 退出 0；五个变更 TS 文件的 `rtk pnpm exec oxfmt ...` 与 `rtk pnpm exec oxlint ...` 退出 0；`rtk git diff --check` 退出 0。
- 文档归属：插件当前路径/摘要契约更新 `docs/subsystems/plugins.md`，ADR 0017 追加实施补充，`docs/README.md` 同步导航摘要。搜索 `安装目录不同`、`替换根目录之后`、`digest.*安装目录`、`record.path`（含隐藏目录），当前消费者已同步；旧摘要测试保留旧格式含义，其他历史记录不改写。
- `rtk pnpm run check:docs` 退出 0，378 Markdown/0 问题；从 AGENTS → docs/README → 插件正文读回：路径与锚点、语义、归属、引用方向、生命周期、入口、新会话范围与历史保留均通过。没有新增正文目录或重新批准产品决定。
- 本票未改桌面 UI/原生入口，未重复 Electron E2E；仅 macOS 本地真实 Sidecar 与文件系统、faux 模型输入。Windows 路径按原生 `node:path` 的 relative/resolve 解析，未做 Windows 实机验证；未运行真实模型、CI 或发布。全部测试使用临时主根，未读写真实 `~/.coko` 或 Documents。
