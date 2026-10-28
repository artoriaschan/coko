---
kind: decision
description: "模型凭据以 Electron safeStorage 在 main 加解密，密文存 SQLite，sidecar 经控制 IPC 按需取明文。修改凭据输入、存储、注入或脱敏时回看。"
status: accepted
implementation: not-started
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

## 来源与后继

- [Electron safeStorage](https://github.com/electron/electron/blob/v41.0.3/docs/api/safe-storage.md)。
- 存储边界见 [ADR 0003](0003-settings-and-sessions-in-sqlite.md)。
