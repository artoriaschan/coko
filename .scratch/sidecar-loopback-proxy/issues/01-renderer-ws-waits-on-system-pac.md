# 01: 系统 PAC 无响应时，renderer 连不上本机 Sidecar

**Status:** needs-triage

**Category:** bug

**What:** 宿主的系统代理启用了 PAC、而 PAC 地址无响应时，应用启动后停在连接失败的状态：main 能连上 Sidecar，renderer 到同一个 Sidecar 的 WebSocket 一直打不开，直到超时。连接目标是本机回环地址，本不需要代理。

**已观察到的（2026-11-23，未打包的测试构建，`feat/session-reference` 的 `c5c2b94c`）：**

- 宿主：`scutil --proxy` 显示启用了 PAC，地址在 `127.0.0.1`，由本机的代理工具提供；`curl --max-time 15` 请求该地址两次都超时、0 字节。
- `desktop.jsonl`：`sidecar ready` 之后是 `connection failed { code: "ws-timeout" }`。
- `sidecar.jsonl`：只有 main 发的 `auth/exchange` 204 与 `health` 200，renderer 的请求一个都没有到达。
- 同一构建加 `--no-proxy-server` 启动：没有 `connection failed`，Sidecar 收到 renderer 的后续请求。
- 打包出的 Sidecar 单独启动正常：输出 `ready`，认证交换 204，带 cookie 的 `/api/ws` 握手成功。问题不在 Sidecar。
- 受此影响，当时 Electron E2E 4 个文件 11 例全部以 `Timed out waiting for sidecar connected` 失败；加开关后 10 例通过，剩下 1 例是 `main` 上既有的失败。

**没有验证的：**

- 正式构建（不带 `COKO_TEST_BUILD`）是否同样受影响。按上面的现象推断会，但没有在正式构建上复现。
- 机制只到现象层面：renderer 的请求在 PAC 取回之前没有发出。Chromium 对回环地址的默认绕过规则在 PAC 未取回时为什么没有生效，没有查证。
- PAC 可达但返回慢、或返回错误脚本时的表现。
- Windows 与 Linux。

**建议方向（待分拣确认）：** 先在正式构建上复现。属实的话，让到本机 Sidecar 的连接不经系统代理解析；候选做法是对回环地址设置直连，或给承载应用界面的会话单独设置代理规则。选哪一种、是否影响用户配置的 Provider 代理与模型请求（那些由 Sidecar 发出，不经 renderer），需要在修之前确认。

**影响判断：** 使用本机代理工具并配置了 PAC 的用户，在代理工具未启动、卡住或退出后，应用会打不开；用户看到的是连接失败，看不出与代理有关。

**来源：** session-reference 评审修复后重跑 E2E 时发现并诊断；E2E 自身已改为固定带 `--no-proxy-server`，不再依赖宿主的代理状态，所以这个问题今后不会再由 E2E 暴露。

## Comments
