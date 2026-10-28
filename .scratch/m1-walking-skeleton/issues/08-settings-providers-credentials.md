# 08: 设置、Provider 与 Credential

**What to build:** 设置弹窗（General：主题、语言；Models：Provider 增改删与模型列表；About）；Credential 经 preload → main safeStorage 加密 → Sidecar 存密文；Sidecar 调模型时经控制 IPC 取明文（[ADR 0004](../../../docs/adr/0004-model-credentials-safe-storage.md)）；输入区模型选择；未配置时引导到设置。

**Blocked by:** 07

**Status:** ready-for-agent

- [x] Electron E2E：添加 Provider 与密钥后界面只显示末四位；数据库文件中不含明文
- [x] 设置在重启后保留；revision 冲突时提示并保留输入
- [x] 未配置 Provider 时发送入口引导到设置
- [ ] 具备真实凭据环境变量时，一次真实对话成功；否则报告未验证（本机无 DEEPSEEK_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY，未验证）

## Comments

- 2026-10-28 implementer（分支 m1/08-settings-providers-credentials）：

**覆盖的验收**

- Credential 与末四位：`apps/desktop/e2e/settings.e2e.test.ts` 用真实 Electron 与真实 Sidecar，在设置中添加 OpenAI 兼容 Provider（本地流式假服务）并输入密钥。卡片只显示"已配置 · 末四位"，DOM 文本与所有 input 中都没有密钥，`/api/providers` 只含 hint。发送后假服务收到 `Authorization: Bearer <密钥>`，链路为 preload → main safeStorage（真实 Keychain）→ credential.store → credential.decrypt。关闭应用后逐个读取 user-data 目录下的所有文件（coko.db、WAL、日志、Chromium 存储），都不含明文。
- 重启保留与冲突：同一 E2E 文件中切换深色主题与另一种界面语言，经 `/api/settings` 读回。另一处写入使 revision 前进后，界面再切主题时显示冲突 Toast，界面保留用户的选择，服务端保持另一处的值；点 Toast 的"重试"后保存当前选择。重启后 html 的 `dark` 类与 `lang` 从 SQLite 读回。
- 未配置引导：没有可用模型时，发送按钮变为"配置模型"，Enter 也打开设置的 Models 分区，草稿保留（E2E 与 Browser Mode 都覆盖）。模型出错返回 `model-not-configured` 时，Toast 带"打开设置"入口。
- 真实模型：`it.skipIf(!DEEPSEEK_API_KEY)` 用例经界面输入密钥并完成一次对话。本机没有凭据，已跳过，未验证。

**实现要点**

- main：`src/main/credentials.ts` 负责 safeStorage 加解密与 credential.* 往返。提示只取末四位，短于 8 个字符的密钥不给提示。safeStorage 不可用时返回 `encryption-unavailable`，不发送任何消息。输入校验在 main（非字符串、空、含空白、超过 4096 字符都拒绝）。确认超时 10 秒。`SidecarProcess` 增加 `send` 与 `onControlMessage`。装配入口 `main/index.ts` 只增加 safeStorage 与 `IPC.setCredential` 几行，preload 只增加 `setCredential`。
- server（最小改动）：只读路由 `GET /api/provider-presets` 与 `GET /api/models`，由 packages/agent 新增的 `providerPresets()` 提供预设目录。Credential 的 Sidecar 一侧在票 04 已实现，未改动。
- renderer：`stores/settings-store.ts` 管理设置、Provider、预设与模型。同一设置键的写入串行，避免自我冲突；冲突后读回服务端的 revision。`app/preferences.ts` 中主题与语言以 appearance store 为唯一来源，设置首次加载后应用一次，不覆盖用户在加载前做的选择。新建 Provider 时 Credential 失败，配置已建，表单转为编辑并保留输入，再次保存不会重复创建。chat store 增加 `draftModel` / `selectModel`：草稿中选的模型用于创建 Session，打开的会话经 `PUT …/model` 切换。
- 设置弹窗：General / Models / About，⌘, 打开，Escape 关闭。原侧栏的"外观与语言"菜单并入 General，侧栏底部改为设置入口。packages/ui 新增 Dialog、Input、Checkbox、ToggleGroup（基于已有的 radix-ui，未加依赖）。
- 修复：模态对话框打开时 Radix 让 body 不接收指针事件，Toast 的"重试"无法点击（E2E 发现）。Toaster 设为 `pointer-events: auto`，DialogContent 把点在 Toast 上的操作视为对话框内部操作。

**实际运行的命令与结果**（合入 main e1350aa 后）

- `pnpm install --frozen-lockfile`、`pnpm run typecheck`、`pnpm run lint`（0 警告 0 错误）、`pnpm run format:check`、`pnpm run check:docs`（60 个文件 0 问题）：均退出 0。
- `pnpm run test`：52 个文件，390 个用例通过，1 个跳过（真实 DeepSeek）。其中有本票新增的：settings E2E 2 例，integration 新增 2 例（预设目录、可用模型），main credentials 5 例，settings-store 6 例，preferences 3 例，chat-store 新增 2 例，desktop-renderer app 新增 5 例（设置弹窗 zh/en 字典、Provider 表单 Credential 失败、未配置引导、模型切换）。
- 另在 Electron 中截图检查浅色与深色主题、520px 窄窗口下的设置弹窗（分区导航改为横排）、Provider 表单与卡片、输入区模型选择，未见溢出或裁剪。

**未验证项**

- 真实模型对话（无凭据）。
- 打包产物（`electron-forge package`）上的 safeStorage：E2E 使用未签名的开发构建。首次加密会在登录钥匙串中创建 Electron 的 Safe Storage 条目，签名构建的钥匙串访问提示未验证。
- 对话框打开时，Toast 只能用指针点击；对话框的焦点约束使 Toast 动作无法用键盘到达。
- Browser Mode 的 390px 用例单独运行时 main 宽 334px，随整个文件运行时测得 110px（侧栏过渡未结束）。模型选择改为可收缩后，两种情况都通过；测得值随运行顺序变化的原因未追查。

**与规格 / 约定的差异**

- 主题只有浅色 / 深色，没有"跟随系统"。未保存过时用系统偏好作为初始值。
- 侧栏的"外观与语言"菜单已移除，并入设置的 General 分区。

**文档影响**

- ADR 0004 的 implementation 改为 implemented，并同步 ADR 索引。
- `apps/server/README.md`：新增两个只读路由。
- `docs/tech-stack/architecture.md`：Credential 经 preload setCredential → main safeStorage → 控制 IPC。
- TECH_STACK 无变化（未新增依赖）。
