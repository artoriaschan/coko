// MemoryService.search：用户级与当前 Workspace 一起按仓库的全局次序取前 limit 条；其他 Workspace 的条目占满前几页时放大条数再查。
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { describe, expect, it } from 'vitest'
import { MemoryService } from './memory.ts'

async function setup() {
  let clock = 1_000
  const store = createMemoryStore({ payloads: createPayloadRegistry([]), now: () => clock++ })
  const mine = await store.sessions.registerWorkspace({ path: '/mine' })
  const other = await store.sessions.registerWorkspace({ path: '/other' })
  return { store, mine: mine.id, other: other.id, service: new MemoryService(store) }
}

describe('MemoryService.search', () => {
  it('其他 Workspace 的匹配条目远多于可见条目时，仍返回全部可见的匹配（按全局次序），不混入其他 Workspace', async () => {
    const { store, mine, other, service } = await setup()
    const user = await store.memories.create({ scope: 'user', content: 'docker tip 1', source: 'user' })
    const own = await store.memories.create({ scope: 'workspace', workspaceId: mine, content: 'docker tip 2', source: 'user' })
    // 更新的 120 条属于其他 Workspace：仓库的前 40、160 条中可见的不足。
    for (let i = 0; i < 120; i++) await store.memories.create({ scope: 'workspace', workspaceId: other, content: `docker noise ${i}`, source: 'user' })
    const found = await service.search('docker', { workspaceId: mine })
    expect(found.map((m) => m.id)).toEqual([own.id, user.id])
    expect((await service.search('docker', { workspaceId: mine, limit: 1 })).map((m) => m.id)).toEqual([own.id])
  })

  it('至多 20 条；空白查询为空；scope 与列表相同；workspace 作用域缺 workspaceId 为 bad-request、Workspace 不存在为 not-found', async () => {
    const { store, mine, service } = await setup()
    for (let i = 0; i < 25; i++)
      await store.memories.create({ scope: i % 2 ? 'user' : 'workspace', workspaceId: i % 2 ? null : mine, content: `fact ${i}`, source: 'user' })
    expect(await service.search('fact', { workspaceId: mine })).toHaveLength(20)
    expect(await service.search('   ', { workspaceId: mine })).toEqual([])
    expect((await service.search('fact', { workspaceId: mine, scope: 'user' })).every((m) => m.scope === 'user')).toBe(true)
    expect(await service.search('fact', { workspaceId: mine, scope: 'workspace' })).toHaveLength(13)
    expect(await service.search('fact')).toHaveLength(12)
    await expect(service.search('fact', { scope: 'workspace' })).rejects.toMatchObject({ code: 'bad-request' })
    await expect(service.search('fact', { workspaceId: 'missing' })).rejects.toMatchObject({ code: 'not-found' })
  })
})
