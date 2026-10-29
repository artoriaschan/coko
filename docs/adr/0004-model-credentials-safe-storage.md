---
kind: decision
description: "模型凭据以 Electron safeStorage 在 main 加解密，密文存 SQLite，sidecar 经控制 IPC 按需取明文。修改凭据输入、存储、注入或脱敏时回看。"
status: accepted
implementation: implemented
lifecycle: active
category: architecture
---

# 模型凭据由 main 用 safeStorage 加密

## 上下文

[ADR 0003](0003-settings-and-sessions-in-sqlite.md) 把设置存入 sidecar 独占的 SQLite，但规定凭据明文不入库。sidecar 需要 API key 调用模型；renderer 需要输入和更新密钥；日志与协议不能泄露密钥。用户于 2026-10-28 授权讨论中的问题采用推荐方案。

## 决定

- 加解密只在 Electron main 进行，使用 `safeStorage`（macOS 上由 Keychain 保护的密钥）；密文由 sidecar 存入 SQLite。
- renderer 输入的密钥经 preload 的受控 IPC 直达 main，不经 HTTP；设置接口只返回"已配置"与末四位。
- sidecar 通过 CredentialStore 端口在需要时经控制 IPC 向 main 请求明文，只缓存在进程内存。
- sidecar 脱离桌面运行（测试、headless）时，CredentialStore 从环境变量读取。
- 密钥、Authorization、Cookie 与启动令牌在日志中脱敏。

## 理由与备选方案

- **sidecar 直接读写 Keychain。** sidecar 以 `ELECTRON_RUN_AS_NODE` 运行，无法使用 `safeStorage`；需要 koffi 调用 Security.framework，增加原生代码面。
- **明文存 SQLite 或配置文件。** pi 的 auth.json 做法；数据库文件被复制即泄露密钥。
- **仅环境变量。** 桌面用户无法在界面中配置。

## 后果与验证

- 凭据可用性依赖 main 在线；sidecar 重启后需重新取得明文。
- `safeStorage` 不可用时（加密不可用）拒绝保存并提示，不回退明文。
- implementation 变为 implemented 前需要：集成测试确认库中不含明文、设置接口不回传密钥、日志脱敏，以及 Electron E2E 中配置密钥后可调用模型。
- 当前为 implemented：sidecar 一侧的 credential.store / credential.decrypt 控制消息、只存密文、明文内存缓存、环境变量模式与日志及模型错误文本脱敏，集成测试确认库与日志不含明文、设置接口不回传密钥，见 [apps/server](../../apps/server/README.md)；main 的 safeStorage 加解密与 preload 的 `setCredential` 通道（只回传末四位提示，safeStorage 不可用时返回 `encryption-unavailable` 且不发送任何消息），Electron E2E 在设置中添加 Provider 与密钥后经解密的密钥调用本地 OpenAI 兼容假服务，并确认用户数据目录中的每个文件都不含明文。真实模型服务的调用依赖宿主凭据，未在本机验证。
- 按值脱敏（2026-10-29，M3 评审修复）：Credential 的明文与 [ADR 0007](0007-secrets-from-registered-entries.md) 的 Secret 用同一机制登记为按值脱敏的来源（IPC 模式为已解密的缓存，环境变量模式为 `COKO_CREDENTIAL_*` 与各 Provider kind 的密钥变量），替换为 `[REDACTED]`，没有 `sk-` 等凭据形态的自定义密钥被回显时同样替换。`tests/integration/secrets-gate-memory.test.ts` 改用非凭据形态的 Credential 覆盖；`apps/server/src/adapters/credentials.test.ts` 覆盖环境变量模式登记的值。

- 写入与使用路径调整（2026-10-29 决定，尚未实施）：Provider 配置与密钥改为经 main 一次提交、在一个事务中存储，获取可用模型可临时使用表单中的明文密钥，独立运行不再按 kind 读取密钥变量，见 [ADR 0010](0010-provider-one-shot-save.md)。本页的加密位置、密文存储与按需取明文不变；上文“当前为 implemented”描述的是 0010 实施前的两步写入。

## 来源与后继

- [Electron safeStorage](https://github.com/electron/electron/blob/v41.0.3/docs/api/safe-storage.md)。
- 存储边界见 [ADR 0003](0003-settings-and-sessions-in-sqlite.md)。
- 写入路径的扩展见 [ADR 0010](0010-provider-one-shot-save.md)。
