# 04: 插件核心：清单与诊断、目录 / git 安装、digest 批准、启用 / 禁用 / 更新 / 卸载、贡献提供方

**What to build:** 见 [规格](../spec.md)"插件"与 [ADR 0017](../../../docs/adr/0017-plugins-declarative-user-installed.md)：agent `extensions/plugins/`（清单解析与诊断、路径与符号链接检查、`${COKO_PLUGIN_ROOT}` 替换、engines 比较、digest 与可执行声明的展开）；server `PluginService`（安装、复制、git 浅克隆经 `adapters/git.ts`、批准、启用 / 禁用、更新、卸载、`PluginContributionsPort` 的实现与 `onChange`）、`routes/plugins.ts`、layers.ts 的 plugins 块；package-smoke 一例。界面归票 12。

**User stories:** 1, 2, 3（服务端）

**Blocked by:** 03

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/extensions/plugins/`、`packages/protocol/src/plugins.ts`、`apps/server/src/application/plugins.ts`、`http/routes/plugins.ts`、`adapters/git.ts`（`clone`）、`runtime/layers.ts` 的 plugins 块、`packages/i18n/src/dictionaries/domains/plugins.ts`、就近测试、`tests/integration/{sidecar-plugins,sidecar-plugins-trust,secrets-gate-plugins}.test.ts`（新）、`tests/fixtures/plugins/` 中新增的夹具（不改 03 的 `sample/`）、`apps/desktop/e2e/package-smoke.e2e.test.ts`（追加一例）、`docs/subsystems/plugins.md`（新）、`docs/adr/0017-plugins-declarative-user-installed.md`（实施记录）

**跨票接口：** 实现 03 定义的 `PluginContributionsPort { snapshot(), onChange(listener) }`，快照形状不改；05 与 09 只读取 `lspServers` / `mcpServers`。票 12 使用本票的 `GET /api/plugins` 等接口与 `PluginView { …, executables, contributions, diagnostics }`，形状以 `protocol/src/plugins.ts` 为准（03 建立，本票可以只增加可选字段）。

- [ ] agent 表驱动：清单每种诊断、两种清单位置、路径数组与缺省目录、`engines.coko` 比较、变量替换、digest 不受键顺序影响且改 Hook 命令 / MCP 参数 / LSP 命令时变化、改 Skill 正文不变化
- [ ] 集成：目录来源安装 → 201、`needs-approval`、未批准时 Skill 不在索引、Hook 不运行、MCP / LSP 进程不启动（假服务器的记录文件不存在）；批准后各类资源可用且带 `<plugin>:` 前缀或 `plugin-<plugin>-` 名；与用户 Skill 同名时用户的仍按原名可用
- [ ] 集成（git 夹具，`file://` 仓库）：安装记录 commit；`#<tag>` 取该 ref；更新后改动了 Hook 命令 → `needs-approval` 且旧 Hook 不再运行，批准新 digest 后运行；用旧 digest 批准 409
- [ ] 集成：禁用后下一个 Run 不再加载、MCP 进程退出（登记行删除）；卸载 → 204、目录不存在、记录不存在、进程退出；`plugins.enabled: false` 时全部不加载
- [ ] **对手用例（信任）**：插件 Hook 输出 allow 时，询问规则、`.git/config` 写入、越出可写根仍询问（ADR 0013）；插件 Hook 的 deny 在 full-access 下生效；清单 `skills: "../../outside"` 与指向插件根外的符号链接被拒（`path-outside-plugin`），复制时同样不跟随；插件 MCP 引用 Secret 不加载；`engines.coko: ">=99.0.0"` 为 `incompatible`；超过文件数或体积上限 400
- [ ] 卸载的路径安全：记录中的 path 被改成插件根外的目录时，卸载拒绝删除（单元，先红）
- [ ] 秘密总闸 `secrets-gate-plugins`：插件 Skill 正文与 Hook 输出含登记 Secret 时，requestLog、条目、HTTP、WS、库、插件 Hook 的 stdin 中没有明文
- [ ] 产物 smoke（接收侧）：打包应用中从仓库夹具目录安装插件、批准后插件的 LSP 假服务器（经 03 夹具）与 MCP Server 在打包产物中被启动（记录文件出现）
- [ ] plugins.md 建立并可达（清单、来源、批准、命名空间、生命周期、与项目资源的区别）；ADR 0017 补服务端证据（implemented 由 12 改）；`check:docs` 通过

## Comments
- 2026-10-31 lead：裁决（产物 smoke 中的插件 LSP）。本票验收"插件的 LSP 假服务器在打包产物中被启动"依赖票 05 的 LspService（main 上是票 03 的空存根）。本票的 smoke 改为断言：插件声明的 MCP Server 在打包产物中被启动（记录文件出现），且插件的 lspServers 出现在 GET /api/plugins 的 executables 中；该验收项按此读法勾选。"插件的 LSP 进程在打包产物中被启动"移到票 05 的验收（见票 05 Comments），票 14 的发布构建 E2E 复跑时一并确认。
