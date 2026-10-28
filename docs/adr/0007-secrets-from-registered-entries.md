---
kind: decision
description: "工具与 MCP Server 使用的 Secret 只来自用户在设置中登记、由 main 以 safeStorage 加密的条目（无界面运行时只读 COKO_SECRET_ 前缀变量），不再按名字读取 Sidecar 自身环境；项目文件不能引用 Secret。修改 Secrets 来源、注入、MCP 凭据或命令环境剔除规则时回看。"
status: accepted
implementation: not-started
lifecycle: active
category: architecture
---

# Secret 只来自登记条目

## 上下文

M2 交付了 Secrets 的声明与注入接缝：工具声明所需的变量名，宿主只在该次调用中注入。宿主实现 `createEnvSecretProvider` 按名字读取 Sidecar 自身的环境变量；bash 的命令环境按名字模式（`API_KEY`、`TOKEN`、`SECRET` 等）剔除凭据形态的变量。M2 两轴评审指出，这两条规则合起来依赖"密钥名一定匹配剔除模式"：M3 的 MCP Server 若需要 `NPM_REGISTRY_PASS`、`SENTRY_DSN` 这类不匹配模式的名字，bash 用 `env` 就能读到。

MCP 配置需要把密钥放进 stdio Server 的环境变量或 HTTP Server 的请求头。claude-code 与 pi 都允许配置值用 `${VAR}` 展开进程环境，pi 另规定认证信息只能写在全局配置中。用户于 2026-10-28 的常设指示要求讨论问题采用推荐方案并优先沿用参考项目；本决定于 2026-10-29 规划 M3 时按该指示采纳，未经用户逐条确认。

## 决定

- **Secret 是登记条目。** 用户在设置中按名字登记 Secret（名字形如 `^[A-Z][A-Z0-9_]{0,63}$`）。值的输入、加密与存储沿用 [ADR 0004](0004-model-credentials-safe-storage.md) 的通道：renderer 经 preload 交给 main，main 以 safeStorage 加密，Sidecar 只存密文，用时经控制 IPC 取明文并只缓存在内存。设置接口只返回名字与末四位。
- **唯一来源。** `SecretProvider` 只解析已登记的名字，不再读取 Sidecar 进程环境中的同名变量。无界面运行（测试、headless）时只读 `COKO_SECRET_<NAME>` 变量；该前缀已被命令环境的 `COKO_*` 剔除规则覆盖。
- **MCP 引用。** 全局 MCP 配置的 `env` 值与 `headers` 值可以写 `${NAME}`，在启动或连接该 Server 时从登记的 Secret 展开；名字未登记时该 Server 启动失败并给出诊断，不回退到进程环境。字面值照常使用。
- **项目文件不能引用 Secret。** Workspace 内的 `.mcp.json` 等项目文件中出现 `${…}` 时，该 Server 以诊断拒绝加载，避免仓库内容决定把用户的密钥发往何处。
- **命令环境。** bash 的环境剔除规则保持不变，作为第二道防线；Secret 的正确性不再依赖它。

## 理由与备选方案

- **把所有工具声明的 Secret 名动态加入剔除列表。** 修补面小，但来源仍是 Sidecar 环境：桌面应用从 Finder 启动时环境不可控，用户也无法在界面中查看和撤销。
- **沿用参考项目的 `${VAR}` 展开进程环境。** 与 claude-code、pi 的配置兼容，但项目文件可以借此把任意环境变量写进请求头发往自己选择的地址；pi 只禁止项目文件写认证配置，没有覆盖 env 与 headers。
- **Secret 存进系统 Keychain。** Sidecar 以 `ELECTRON_RUN_AS_NODE` 运行无法使用 safeStorage，理由同 ADR 0004。

## 后果与验证

- 从其他客户端复制来的 MCP 配置中的 `${VAR}` 需要先在设置中登记同名 Secret 才能使用；诊断要写明缺少哪个名字。
- implementation 变为 implemented 前需要：秘密不外泄总闸覆盖一个不匹配剔除模式的 Secret 名（例如 `MY_SERVICE_DSN`），经 MCP 测试 Server 注入后，WebSocket 帧、HTTP 响应、库文件（含 `-wal`）、日志与 bash `env` 输出中都没有明文；项目 `.mcp.json` 引用 `${…}` 时该 Server 不启动；未登记名字时诊断可见；safeStorage 不可用时拒绝保存。

## 来源与后继

- 扩展 [ADR 0004](0004-model-credentials-safe-storage.md) 的凭据通道到 Secret；Credential（Provider 密钥）仍按 ADR 0004 处理。
- 参考实现：claude-code 社区还原版 `src/services/mcp/envExpansion.ts`；pi v1.4.0 `packages/coding-agent/src/extensions/mcp/config.ts`（认证只允许全局配置）。本页已提炼所需结论。
- 能力归属见 [Agent 执行约定](../tech-stack/agent-runtime.md)。
