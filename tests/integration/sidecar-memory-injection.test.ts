// /api/memories 列表响应的注入汇总：真实 Sidecar（faux 模型）。每组的全文、仅摘要、未注入条数之和等于该组条数，且与同一可见范围发起的
// Run 的请求中 Memory 段各层的条数一致（项目对话两组，独立对话只有用户级且用满两层预算）；带 query 或 scope 时没有汇总。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, memoryPaths, type MemoryListResponse } from '@coko/protocol'
import { client, connect, exchange, fauxScript, openSession, sendAndWaitRun, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { memorySection, omittedOf, tiersOf, type LoggedMessage } from './sidecar-memory-harness.ts'

it('注入汇总与同一时刻发起的 Run 的请求中各层的条数一致；带 query 或 scope 时没有汇总', { timeout: 120_000 }, async () => {
  const root = await tempDir()
  const folder = join(root, 'p')
  await mkdir(folder)
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses: [{ content: 'project' }, { content: 'standalone' }] })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: folder })).body.id as string
  const add = async (body: Record<string, unknown>) => expect((await api.post(memoryPaths.memories, body)).status).toBe(201)
  // 两组都超出正文层与摘要层：各 40 条小条目，再各 4 条约 2 000 字符的大条目。
  for (let i = 0; i < 40; i++) {
    await add({ scope: 'workspace', workspaceId, content: `p${i} small project fact` })
    await add({ scope: 'user', content: `u${i} small user fact` })
  }
  for (let i = 0; i < 4; i++) {
    await add({ scope: 'workspace', workspaceId, content: `P${i} ${'x'.repeat(1900)}` })
    await add({ scope: 'user', content: `U${i} ${'x'.repeat(1900)}` })
  }
  const list = async (query = '') => (await api.get(`${memoryPaths.memories}${query}`)).body as MemoryListResponse

  const sessionId = await openSession(api, stream, workspaceId)
  const send = async () => {
    await sendAndWaitRun(api, stream, sessionId, 'hi')
    const lines = (await readFile(requestLog, 'utf8')).split('\n').filter(Boolean)
    return memorySection(JSON.parse(lines.at(-1)!) as LoggedMessage[])
  }

  // AC-27：项目的主要 Workspace，两组。
  const project = await list(`?workspaceId=${workspaceId}`)
  let section = await send()
  const { user, workspace } = project.injection!
  expect(user).toEqual({ ...tiersOf(section, 'user'), omitted: user.omitted })
  expect(workspace).toEqual({ ...tiersOf(section, 'workspace'), omitted: workspace!.omitted })
  expect(user.omitted + workspace!.omitted).toBe(omittedOf(section))
  for (const [counts, size] of [
    [user, 44],
    [workspace!, 44],
  ] as const) {
    expect(counts.full + counts.summary + counts.omitted).toBe(size)
    expect(counts.summary).toBeGreaterThan(0)
    expect(counts.omitted).toBeGreaterThan(0)
  }

  // 不带 Workspace：只有用户级，用满两层预算；与独立对话的请求一致。
  const standalone = await list()
  expect(Object.keys(standalone.injection!)).toEqual(['user'])
  expect((await api.put(apiPaths.sessionProject(sessionId), { projectId: null })).status).toBe(200)
  section = await send()
  expect(standalone.injection!.user).toEqual({ ...tiersOf(section, 'user'), omitted: omittedOf(section) })
  expect(standalone.injection!.user.full).toBeGreaterThan(user.full)

  // AC-28：带 query 或 scope 时没有汇总。
  for (const query of ['?query=small', `?workspaceId=${workspaceId}&query=fact`, '?scope=user', `?workspaceId=${workspaceId}&scope=workspace`]) {
    const res = await list(query)
    expect(res.memories.length).toBeGreaterThan(0)
    expect(res).not.toHaveProperty('injection')
  }
  expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
})
