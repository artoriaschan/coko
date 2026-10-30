# 01: 预构建：M3 结构债 J1、J2、J4–J7 与 sessions.ts、runtime.ts 拆分（行为不变）

**What to build:** 不改变任何行为，在引入 Goal / Plan 状态之前收敛 [M3 Standards 评审](../../m3-context-instructions/review-standards.md) 的 J1、J2、J4–J7，并拆分两个过大的文件，细节见 [规格](../spec.md)：J1 贡献工具的权限类由 `ContextContribution.ruleTools` 声明，删除 sessions.ts 的 `CONTRIBUTED_TOOLS`、`process.cwd()` 取名与 `#rememberContributed`；J2 `McpAdmin` 拆出、每个 Run 只 `#load` 一次；J4 `ContextService` 与 Application 持有的 `MemoryService`，路由只校验与调用；J5 `engine/compaction-driver.ts` 与 `engine/system-message.ts`；J6 `CommandSourceContribution.list` 返回 `SourcedCommand[]`；J7 `createIpcDecryptor` 与 `createEncryptingBridge`。sessions.ts 拆出 `session-models.ts` 与 `session-runs.ts`。

**User stories:** 17

**Blocked by:** None - can start immediately（阻塞本目录其余全部票）

**Status:** ready-for-agent

**Write scope:** `apps/server/src/application/sessions.ts`、`session-models.ts`（新）、`session-runs.ts`（新）、`session-runtimes.ts`、`permissions.ts`、`secrets.ts`、`memory.ts`（若存在）、`context-service.ts`（新）、`application/index.ts`、`application/context/{index,types,mcp,mcp-admin（新）,memory,commands,skills,usage}.ts`、`apps/server/src/http/routes/{context,commands,skills,files,memories,mcp}.ts`、`apps/server/src/http/app.ts`、`apps/server/src/runtime/layers.ts`、`apps/server/src/adapters/{credentials,ipc-decryptor（新）}.ts`、`apps/desktop/src/main/{credentials,secrets,encrypting-bridge（新）}.ts`、`packages/agent/src/engine/`（`runtime.ts`、`compaction-driver.ts`（新）、`system-message.ts`（新）、`types.ts`）、`packages/agent/src/context/compaction/`（只限被 driver 移动的导出）、上述文件的就近测试（只改导入路径，新测试见下）、`packages/agent/README.md`、`apps/server/README.md`、`docs/tech-stack/architecture.md`（应用层结构一句）

- [ ] 改动前在 main 记录基线：全量测试的文件数、用例数与跳过数写入 Comments
- [ ] 已有的 agent、session、server、集成、Browser Mode 与 Electron E2E 测试只改导入路径即通过；任何断言改动在 Comments 逐条说明理由（预期为零）
- [ ] `wc -l`：sessions.ts ≤ 300、runtime.ts ≤ 450，本票新建或改动的源文件 ≤ 500 行（结果写入 Comments）
- [ ] J1：`grep -n 'CONTRIBUTED_TOOLS\|process.cwd()' apps/server/src/application/sessions.ts` 无结果；新单元测试：memory 关闭时仍能写 `Memory` 规则、新增一个贡献只需在贡献中声明 `ruleTools`（用测试贡献验证 `PermissionService` 接受其名字）
- [ ] J2：新单元测试断言一个 Run 中 `.mcp.json` 与有效配置各只读取一次（计数文件端口）；`McpManager` 不再含 view / updateServers / approve
- [ ] J4：`routes/{context,commands,skills,files,memories}.ts` 不再直接调用 `app.store`、不 `new MemoryService`、不用 `contributions.find`（grep 证据）；`sidecar-context.test.ts` 等原集成测试通过
- [ ] J5：runtime.ts 不含 `summarize` / `compactNow` / `autoCompact` / `recoverOverflow` 的实现；`engine/compaction.test.ts` 原样通过
- [ ] J6：`isSourcedCommand` 删除，`tsc -b` 通过
- [ ] J7：Credential 与 Secret 的 IPC 解密共用 `createIpcDecryptor`；`secrets-gate*.test.ts` 全部通过；按 M3 方式做一次负向确认（临时让解密器跳过按值脱敏登记，确认总闸失败，再撤销）
- [ ] `pnpm run typecheck`、`lint`、`format:check`、`check:docs` 退出 0；`scripts/browser-deps.test.ts`、`scripts/source-references.test.ts` 通过；README 与 architecture.md 的结构描述与新文件一致

## Comments
