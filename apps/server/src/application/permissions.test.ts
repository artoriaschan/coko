// 规则工具名：贡献工具由 ContextContribution.ruleTools 静态声明，PermissionService 据此接受与归一规则（与当前是否注册无关）。
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SESSION_ENTRY_PAYLOADS, createBuiltinToolRegistry, createLocalExecPort, createModelRegistry, InMemoryCredentialStore } from '@coko/agent'
import { CONFIG_SETTING } from '@coko/protocol'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigService } from './config.ts'
import { createContextAssembly, createContributions, type ContextContribution } from './context/index.ts'
import { SessionHub } from './hub.ts'
import { SessionService } from './sessions.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'coko-permissions-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function setup(extra: ContextContribution[] = []) {
  const store = createMemoryStore({ payloads: createPayloadRegistry(SESSION_ENTRY_PAYLOADS) })
  const config = new ConfigService({ store })
  const contributions = [...createContributions({ cokoHome: '', memories: store }), ...extra]
  const service = new SessionService({
    store,
    registry: createModelRegistry({ credentials: new InMemoryCredentialStore() }),
    hub: new SessionHub(),
    runs: { launch: () => {} },
    tools: (cwd) => createBuiltinToolRegistry({ cwd, exec: createLocalExecPort() }),
    context: createContextAssembly({ contributions, config, cokoHome: '' }),
  })
  return { store, service }
}

describe('贡献工具的规则名', () => {
  it('Memory 关闭时仍能写 Memory 规则：memory_write 与 memory_delete 归一为 Memory，memory_list 保持原名', async () => {
    const { store, service } = setup()
    await store.settings.set(CONFIG_SETTING, { memory: { enabled: false } }, 0)
    const response = await service.updatePermissions({
      target: 'global',
      expectedRevision: 0,
      rules: [
        { behavior: 'deny', tool: 'memory_write' },
        { behavior: 'ask', tool: 'MEMORY_DELETE' },
        { behavior: 'allow', tool: 'memory_list' },
      ],
    })
    expect(response.global.rules).toEqual([
      { behavior: 'deny', tool: 'Memory' },
      { behavior: 'ask', tool: 'Memory' },
      { behavior: 'allow', tool: 'memory_list' },
    ])
  })

  it('新增贡献只需声明 ruleTools：没有任何 Run 注册过的工具名也被接受，未声明的名字以 unknown-tool 拒绝', async () => {
    const { service } = setup([
      {
        name: 'fake',
        ruleTools: [
          { name: 'fake_lookup', permissionClass: 'context-read' },
          { name: 'fake_note', permissionClass: 'memory-write' },
        ],
      },
    ])
    const response = await service.updatePermissions({
      target: 'global',
      expectedRevision: 0,
      rules: [
        { behavior: 'allow', tool: 'FAKE_LOOKUP' },
        { behavior: 'deny', tool: 'fake_note' },
      ],
    })
    expect(response.global.rules).toEqual([
      { behavior: 'allow', tool: 'fake_lookup' },
      { behavior: 'deny', tool: 'Memory' },
    ])
    await expect(
      service.updatePermissions({ target: 'global', expectedRevision: response.global.revision, rules: [{ behavior: 'allow', tool: 'fake_other' }] }),
    ).rejects.toMatchObject({ code: 'bad-request', details: { reason: 'unknown-tool', tool: 'fake_other' } })
  })
})
