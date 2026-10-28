---
kind: decision
description: "本地 sidecar 服务强制认证：启动令牌一次性交换为 HMAC 签名 cookie，cookie 只由 main 持有，所有请求先过 Host/Origin 信任围栏。修改服务入口、协议代理或凭据处理时回看。"
status: accepted
implementation: implemented
lifecycle: active
category: architecture
---

# 本地服务访问认证

## 上下文

sidecar 在 loopback 上提供 HTTP 与 WebSocket，能驱动有 shell 和文件权限的 Agent。只绑定 loopback 拦不住本机其他进程，也拦不住借 DNS rebinding 或跨站请求访问 `127.0.0.1` 的网页；原约定只写了 main 通过 preload 向 renderer 提供"连接信息"，没有认证要求。

用户于 2026-10-28 参考 DeepSeek Harness 本地服务的认证方式确认本决定：认证默认强制、不可关闭；每次启动生成随机 launch token，一次交换为绑定 authority 的 HMAC 签名 cookie；认证之前先用 Host、Origin 和 `sec-fetch-site` 建立信任围栏；桌面窗口经自定义协议加载，cookie 由壳进程持有并代为注入。

## 决定

采用上述模型，具体规则见 [项目架构约定](../tech-stack/architecture.md#本地服务访问认证)：

- 每次启动生成 32 字节随机令牌，只经启动 IPC 交给 main，交换成功后作废，不接受作为 Authorization 头。
- 交换后签发 `HttpOnly`、`SameSite=Strict` 的 HMAC 签名 cookie；所有 API 与 WebSocket 升级先过信任围栏（403），再校验 cookie（401），没有关闭开关。
- renderer 经 `coko-app://` 加载，不接触令牌与 cookie；main 转发请求并注入 cookie，剥离 `set-cookie`。

与参考实现的差异：coko 只有桌面入口，签名密钥只保存在 sidecar 进程内存，不持久化；sidecar 重启即吊销全部 cookie，由 main 重新交换。因此不提供 cookie 有效期配置、`trustedHosts` 或反向代理部署。

## 理由与备选方案

- **只依赖 loopback 绑定。** 即原约定的状态，无法区分本机调用方，也挡不住 DNS rebinding 与跨站请求。
- **令牌长期作为请求头或 URL 参数。** 令牌会进入 renderer 可见状态、日志或历史记录；一次交换后由 main 持有 cookie，可以把凭据限制在主进程。
- **像参考实现一样持久化签名密钥。** 参考实现需要浏览器会话跨重启有效；coko 的 cookie 只有 main 使用，每次启动重新交换即可，持久化只会扩大吊销难度。

## 后果与验证

- 服务请求依赖 main 代理：协议转发、WebSocket 头注入与 sidecar 校验共同构成认证链，需要一起测试。
- sidecar 重启后旧 cookie 失效；main 必须在重新交换完成后再恢复转发，期间请求按处理中状态呈现，不提前报告失败。
- 启动令牌与 cookie 属于日志脱敏字段。
- implementation 变为 implemented 前需要集成测试覆盖：无 cookie 返回 401；令牌错误或重复交换被拒绝；非 loopback Host、跨站 Origin 和 `sec-fetch-site: cross-site` 返回 403；WebSocket 升级执行同样的校验；sidecar 重启后旧 cookie 被拒绝。
- 当前为 implemented：sidecar 一侧的令牌交换、cookie 签发与校验、信任围栏，上述场景均由以 `ELECTRON_RUN_AS_NODE` 启动真实 sidecar 的集成测试覆盖，见 [apps/server](../../apps/server/README.md)。交换入口按规范化后的路径只供 main 调用：代理对 `/api/auth` 下任何编码变体返回 404，sidecar 只接受原样路径、不带 cookie 的 POST。main 的协议转发、WebSocket 头注入、非主窗口升级被取消，以及 sidecar 意外退出后的重启与重新交换（重新交换完成前代理返回 503，renderer 显示重启中，完成后重连），由 apps/desktop 的单元测试与 Electron E2E 与真实 sidecar 联合覆盖。

## 来源与后继

参考实现：DeepSeek Harness 的 Connection 插件（`packages/client/connection` 的 `browser-auth.ts`、`api-request-trust.ts`）与桌面端 `apps/desktop/src/web-document.ts`、`main.ts` 的 WebSocket 头注入，本页已提炼所需结论。进程模型见 [ADR 0001](0001-sidecar-on-electron-node.md)。
