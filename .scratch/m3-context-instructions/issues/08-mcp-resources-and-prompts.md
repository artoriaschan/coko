# 08: MCP 资源与提示模板

**What to build:** agent `extensions/mcp/`：Server 声明 resources 能力时注册 `list_mcp_resources`、`list_mcp_resource_templates`、`read_mcp_resource { server, uri }`（权限类 context-read，文本按 50KB 截断，blob 注明类型与大小，图片按内容块透传）；prompts 经 `request("prompts/list" | "prompts/get")` 封装：能力检查、cursor 分页与重复 cursor 检测（最多 1000 页）、结果按 schema 校验（不合格记诊断，不抛到 Run）、消息转文本（文本拼接、嵌入资源内联、图片注明省略）。server `context/mcp.ts` 向命令目录登记 `/mcp__<server>__<prompt>` 来源（位置参数按声明顺序映射，缺必填参数时 400 `bad-request` 并给出参数名），`prompts/list_changed` 与 `resources/list_changed` 时刷新。

**User stories:** 16

**Blocked by:** 07, 04

**Status:** ready-for-agent

**Write scope:** `packages/agent/src/extensions/mcp/`、`apps/server/src/application/context/mcp.ts`、`packages/protocol/src/mcp.ts`、`tests/fixtures/mcp/`、`tests/integration/sidecar-mcp-resources-prompts.test.ts`（新）、`docs/subsystems/mcp.md`

- [ ] agent 测试：分页合并、重复 cursor 停止并诊断、不合 schema 的 prompts/get 结果被拒绝、消息转文本
- [ ] 集成测试：Server 没有 resources 能力时三个资源工具不注册；有时列表分页完整、读取文本与 blob 正确，各模式下都不出现审批，`read_mcp_resource` 的 deny 规则拒绝
- [ ] 集成测试：`/mcp__srv__greet Alice` 提交 `command { source: mcp }` 与展开文本（来自测试 Server 的 prompts/get），缺必填参数 400；测试 Server 发出 list_changed 后 `GET /api/commands` 出现新提示模板
- [ ] mcp.md 增加资源与提示模板；`pnpm run check:docs` 通过

## Comments
