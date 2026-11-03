---
kind: evidence
description: "文件工具专用详情的真实 App、Sidecar、双主题同列宽视觉与清理记录。"
lifecycle: active
---

# 05 文件读取与修改详情证据

## 对象与范围

- 2026-11-03，macOS、Node 26.10.0、pnpm 12.15.0、Vitest 5.0.3、headless Chromium、DPR 1。
- Coko 对象：实现 `6b936aa`，合入票 01/02 的集成对象后为 `78981072110b82d0e59aa23cd48efa082dd25442`，最终工具栏图形/代码标识为该对象上的本票补充；补充提交只包含本票文件及本证据。最新集成分支核对仍为 `3f853817f6b0286c0d53329afac3e0c54450db63`。
- 参考锁定 `8bd073392eef6f54e921a093b95076248eb08cbb`。读取真实 ReadRow/read-family-row、FileMutationRow、read-card-model、diff-card-model、ToolRow、ReadBlock、DiffBlock、CodeToolbar 及样式；聊天消费者实际 cap 为 read 8、diff 9。
- 接缝沿用规格确认的真实 App：createFixtureChat → 实际 store/投影/时间线/ToolCardView。实际文件执行另经现有 faux → 真实 Sidecar → 原有 read/write/edit → SQLite 记录与 HTTP 读回，未替换工具、持久化或后续业务实现。

## 测试与检查

所有命令在本票隔离 worktree，以 `rtk proxy` 前缀执行。精确命令如下，退出码均为 0（另列红灯/环境诊断）。

- `pnpm install --frozen-lockfile`：9 workspace，锁文件未改。
- `pnpm run test apps/desktop/src/renderer/features/conversation/file-tool-details.browser.test.tsx apps/desktop/src/renderer/features/conversation/tool-cards.browser.test.tsx apps/desktop/src/renderer/features/conversation/tool-rows.browser.test.tsx tests/integration/sidecar-file-details.test.ts`：4 文件、23 测试通过，其中本票 App 6 例、真实 Sidecar 1 例。工具栏修正后重跑仍 23 通过。
- `pnpm run typecheck`：通过；在合入票 01 后及工具栏修正后执行。
- `pnpm exec oxlint apps/desktop/src/renderer/features/conversation/file-tool-details.tsx apps/desktop/src/renderer/features/conversation/file-tool-details.browser.test.tsx apps/desktop/src/renderer/features/conversation/tool-cards.tsx tests/integration/sidecar-file-details.test.ts`：通过；提交 hook 同时执行 oxfmt/oxlint。
- `pnpm run check:docs`：266 Markdown、0 问题，退出 0；正式正文归属既有 workbench，无新增文档类别。
- `git diff --check`：通过。

TDD 红灯：首个真实 App 读取测试在实现前失败（专用读取节点不存在，1/1 失败），实现后通过；390px 双主题材质测试发现错误 CSS token 导致透明背景（2/5 失败），修正为共享 code-block token 后通过。文件执行测试的首次认证失败来自重复交换一次性 token，修正夹具复用 cookie 后真实记录/磁盘断言通过。

环境修复：frozen install 后 `node -e "console.log(require('electron'))"` 报 Electron 未正确安装；执行 `/Users/artorias_chan/.nvm/versions/node/v24.15.0/bin/node node_modules/electron/install.js`，退出 0。只修复本地安装产物，无依赖/manifest 变更。

覆盖：读取 offset 与原文、真实继续 offset 提示、8 行首尾展开与键盘；写入空文件与不带行号的复制；实际编号多段 diff、增删统计、9 行展开；缺失 diff 与错误保留完整输入/输出/details；双主题 390px App 的长路径/局部横滚/换行；已完成实时读取转为提交记录保留实体、展开、选区与横向滚动。Sidecar 验证读取窗口、真实写入字节、多段编辑实际 diff 与文件字节、ENOENT 失败，以及无关文件二进制字节保持不变。

## 视觉与交互

静默 agent-browser 命名会话 `coko-file-05`（真实 App）与 `coko-file-reference-05`（参考源码组件）。无前台窗口、真实鼠标或原生层验证。参考 harness 位于 `/tmp/coko-conversation-detail/reference-harness`；真实 App harness 位于 `/tmp/coko-conversation-detail/file-harness`。两者均只在仓库外组合真实源码，不改参考仓库文件。

精确捕获入口：`rtk proxy python3 /tmp/coko-conversation-detail/file-harness/capture.py`，退出 0。脚本逐项执行 `rtk proxy agent-browser --session <name> open <origin>`、`wait` 内容谓词、`find role button click --name <工具名称>`、`set viewport`、`wait --fn <实际卡宽谓词>`、`eval` 计算样式/几何与 `screenshot`。等待依据实际 DOM、卡宽与完成信号，没有 sleep/固定等待。图形修正后重新捕获全部 8 图。

- [Coko light/wide](coko-light-wide.png)、[dark/wide](coko-dark-wide.png)：实际消息列 680、卡宽 676；[reference light/wide](reference-light-wide.png)、[dark/wide](reference-dark-wide.png) 同列宽。
- [Coko light/390](coko-light-390.png)、[dark/390](coko-dark-390.png)：viewport 454、实际消息列 390、卡宽 386；[reference light/390](reference-light-390.png)、[dark/390](reference-dark-390.png) 同列宽。
- light=en，dark=zh；每个场景的 `*-metrics.txt` 保留计算样式、卡宽、DPR 与整页 overflow=false。Coko 使用共享字体优先级（Noto Sans SC / JetBrains Mono），参考保持原 SF Mono / 系统字体优先级；没有改全局字体。
- 人工读图检查两主题文件标识、工具栏、行号、diff 增删色与 3px 左沿、长路径换行和操作可达性。正文 11px/19px，工具栏 padding 10px 18px 8px 22px，操作 24×24、14px 源 SVG，body padding 6px 0 20px，R16、共享明暗 code-block 材质。代码和 diff 局部横向滚动，换行控件保留原文。
- 键盘展开/全文、换行、复制可达性及实时提交稳定性由真实 App 浏览器用例验证；不是从截图推断。

源数据允许的适配：Coko 无语言 metadata，显示 code 与原文，不虚构语法；write 无旧文件内容，不把成功写入误画为新建文件 diff 或新增行统计；edit 保留 Coko 实际编号 diff，不由 args 重造完整文件。读取行号来自有效 offset 和实际返回文本，末尾真实恢复提示单列。参考样例显式提供 typescript、完整新建 diff，截图差异因此保留。Coko 的副作用回执原文仍位于正文底部。现有工具详情无文件打开宿主回调，路径保持可读标识，不添加死按钮。

## 文档、交付与限制

当前行为原地更新 `docs/subsystems/workbench.md` 的对话工具详情段；从 AGENTS → docs/README → workbench 读回，生命周期 active、导航可达、无需更改 ADR/GLOSSARY。正式正文没有反向链接任务材料。搜索相关工具说明后，原有执行/Checkpoint/Rewind 契约不变。

本票不执行真实模型、发布产物、原生文件打开或宿主鼠标测试；这些不是本次记录展示边界。参考是实际源码组件基线，不声称完整参考 App。跨票组合评审、最终 13 票全局验收与远程 CI 未运行，交由票 13；本地相关结果不代替全量结果。

最终捕获为标准 CSS1Compat 文档（两 harness 补齐 doctype 后重新捕获全部 8 图），各 metrics 保留 mode。命名会话键盘检查见 keyboard.txt：Space 收起=false、Enter 展开=true、Enter 换行=true，焦点继续留在相应按钮；同时读回代码 11px/19px、工具栏 padding、24px 按钮和 386px 窄卡宽。

清理：两个命名浏览器会话 close 均退出 0 / Browser closed；两个 Vite 命令在 Ctrl-C 后实际退出 130。最终标准文档复核所启动的后继命令同样关闭并核对端口/进程；截图与仓库外 harness 保留。
