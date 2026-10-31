import type { ConfigResponse } from '@coko/protocol'
import { describe, expect, it } from 'vitest'
import { CAPABILITY_SWITCHES, createConfigClient, createConfigStore, type CapabilitySwitch } from './config-store.ts'

const response = (global: ConfigResponse['global'], revision = 3): ConfigResponse => ({
  effective: {
    instructions: { enabled: true },
    skills: { enabled: true, disabled: [] },
    commands: { enabled: true, disabled: [] },
    mcp: { enabled: true },
    memory: { enabled: true },
    context: { autoCompact: true, trimOldToolResults: true },
    hooks: { enabled: true },
    agents: { enabled: true },
    schedules: { enabled: true },
    plugins: { enabled: true },
    lsp: { enabled: true },
    teams: { enabled: true },
  },
  global,
  globalRevision: revision,
})

describe('config-store：能力开关', () => {
  it('setSwitch 读取全局值与 revision 后整体替换（PUT /api/config 带回其他全局键），再重新读取', async () => {
    const calls: { method: string; path: string; body?: unknown }[] = []
    let global: ConfigResponse['global'] = { skills: { disabled: ['pdf'] }, context: { trimOldToolResults: false } }
    const client = createConfigClient(async (path, init) => {
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
      calls.push({ method: init?.method ?? 'GET', path, ...(body === undefined ? {} : { body }) })
      if (init?.method === 'PUT') global = body.values
      return new Response(JSON.stringify(response(global)), { status: 200 })
    })
    const store = createConfigStore(client)
    await store.getState().load('w 1')
    await store.getState().setSwitch('context.autoCompact', false)
    await store.getState().setSwitch('mcp.enabled', false)
    const puts = calls.filter((c) => c.method === 'PUT')
    expect(puts).toEqual([
      {
        method: 'PUT',
        path: '/api/config',
        body: {
          values: { skills: { disabled: ['pdf'] }, context: { trimOldToolResults: false, autoCompact: false } },
          expectedRevision: 3,
          workspaceId: 'w 1',
        },
      },
      {
        method: 'PUT',
        path: '/api/config',
        body: {
          values: { skills: { disabled: ['pdf'] }, context: { trimOldToolResults: false, autoCompact: false }, mcp: { enabled: false } },
          expectedRevision: 3,
          workspaceId: 'w 1',
        },
      },
    ])
    expect(calls.at(-1)).toEqual({ method: 'GET', path: '/api/config?workspaceId=w%201' })
    expect(store.getState().config!.global.mcp).toEqual({ enabled: false })
  })

  it('开关表：全局值缺省为开；项目关闭时有效值为 false', () => {
    const keys: CapabilitySwitch[] = ['instructions.enabled', 'commands.enabled', 'mcp.enabled', 'context.autoCompact', 'context.trimOldToolResults']
    expect(Object.keys(CAPABILITY_SWITCHES).sort()).toEqual([...keys, 'memory.enabled', 'skills.enabled'].sort())
    const config = response({ context: { autoCompact: false } })
    config.effective.instructions.enabled = false
    expect(CAPABILITY_SWITCHES['context.autoCompact'].global(config.global)).toBe(false)
    expect(CAPABILITY_SWITCHES['context.trimOldToolResults'].global(config.global)).toBe(true)
    expect(CAPABILITY_SWITCHES['instructions.enabled'].effective(config.effective)).toBe(false)
  })
})
