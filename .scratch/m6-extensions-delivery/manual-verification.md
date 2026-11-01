# M6 人工验证清单

来源：[规格的人工验证清单](spec.md#人工验证清单交付前需要真实凭据或外部条件)，票 14 补入 390px 宽度下的 Team tab、GET 流上的 401、没有 FTS5 的运行时、Developer ID 签名与公证、真实更新 feed 的下载与安装，并把真实 Playwright MCP 与要求认证的 HTTP MCP 两项写成可执行的操作。这些项需要真实凭据、网络、证书或特定运行时，本地自动测试中以 `skipIf` 跳过或以 faux、假服务器替代，交付时不记为已验证。

填写方式：`结果` 写"通过"、"失败：<实际观察>"或"未执行：<原因>"；`日期` 写 YYYY-MM-DD；`执行者` 写姓名或 agent 会话。

| 项 | 前置条件 | 操作 | 预期观察 | 票 | 结果 | 日期 | 执行者 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 真实模型的 teammate 协作 | 任一 Provider 的凭据 | 在 Workspace 中让 Agent 建两个 teammate 分工完成一个小改动 | 任务板有两项被不同成员认领并完成；名册显示用量；Goal 用量包含两者 | 06、13 |  |  |  |
| 真实模型的 LSP 修复 | 凭据；本机 `typescript-language-server` | 配置 TS 服务器，让 Agent 修一个类型错误并用 `lsp diagnostics` 确认 | 修复前诊断 ≥ 1，修复后 0 | 05 |  |  |  |
| 真实语言服务器 | `npm i -g typescript typescript-language-server` | 设置中添加服务器，对仓库内一个 TS 文件查定义与引用 | 结果位置正确；状态 running；10 分钟后 idle | 05 |  |  |  |
| 浏览器 MCP（真实 Playwright MCP） | 网络、Node（npx）、凭据 | 添加 Playwright 预设，让 Agent 打开一个页面并截图；另运行 `COKO_REAL_PLAYWRIGHT_MCP=1 pnpm exec vitest run tests/integration/sidecar-mcp-presets.test.ts` | 审批卡出现；工具卡显示截图缩略图；真实用例通过（不再 skipped） | 09 |  |  |  |
| HTTP MCP 401（要求认证的真实 HTTP MCP） | 一个需要 Bearer 的 MCP 服务 | 不带 / 带错误的 Authorization 添加 | 状态"需要认证"，10 秒内不重连；补上正确的请求头后 connected | 09 |  |  |  |
| GET 流上的 401 | 一个对 Streamable HTTP 的 GET（SSE 流）返回 401、对 POST 正常的 MCP 服务 | 添加该 Server 并等待连接 | 状态为"需要认证"而不是 failed 或反复重连；诊断不含响应体与令牌（测试 Server 对 GET 回 405，未覆盖此路径） | 09 |  |  |  |
| headless 真实运行 | 凭据（`COKO_CREDENTIAL_<ID>`）与 Provider 配置文件 | 对打包产物运行 `headless.mjs --output stream-json` | 最后一行 result completed，退出 0；default 模式下的写入被拒并有说明 | 08 |  |  |  |
| evals 真实模式 | `COKO_EVAL_PROVIDER_CONFIG` 与凭据 | `pnpm run eval` | 报告中 3 例有 pass / fail 与费用，无 `skipped` | 07 |  |  |  |
| 插件来自真实 git 仓库 | 网络与一个公开插件仓库 | 以 https URL 安装、批准、启用（界面的 git 表单） | 资源出现，commit 记录正确 | 04、12 |  |  |  |
| 没有 FTS5 的运行时 | 一个未编译 FTS5 的 Node / SQLite 运行时（Electron 41.0.3 内置的已编译） | 以该运行时启动 Sidecar，在设置 → Memory 中检索 | 启动日志有 `memory search falls back to LIKE { reason: fts5-unavailable }`；检索结果至多 20 条、按更新时间倒序（测试中只以 `COKO_TEST_NO_FTS=1` 强制降级） | 11 |  |  |  |
| 390px 宽度下的 Team tab | 有两个 teammate 与若干任务的会话 | 把窗口缩到 390px 宽，打开右栏 Team tab，选中一个成员再关闭 | 名册、任务板与成员时间线不溢出、不逐词换行，关闭按钮可点、可用键盘到达（Agents tab 的 390px 用例不覆盖它） | 13 |  |  |  |
| Developer ID 签名与公证 | Apple Developer ID 证书与公证账号 | 以证书签名并公证打包产物，对 dmg 中的 `Coko.app` 运行 `codesign --verify --deep --strict --verbose=2` 与 `spctl -a -vv` | 两项都通过；当前 adhoc 产物为 `invalid Info.plist (plist or signature have been modified)` | 10 |  |  |  |
| 真实更新 feed 的下载与安装 | 已签名的两个版本与一个发布 feed（`COKO_UPDATE_FEED_URL` 构建） | 安装旧版本，设置 → 关于 → 检查更新，下载完成后"重启以更新" | 状态依次为 checking → downloading → downloaded；重启后关于页显示新版本（adhoc 签名下只能验证到 error） | 10 |  |  |  |
| 非 darwin 平台 | 不在首发范围 | — | 记为不在范围 | — |  |  |  |
