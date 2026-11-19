// memory_list 按 id 读取：真实 Sidecar（faux 模型）。项目 Session 只读得到用户级与本项目的条目，其他项目与不存在的 id 列为没有找到；
// ids 与 query 同时给出为工具错误，超过 20 个为参数错误；移出项目后 Workspace 作用域的条目没有找到；子 Session 同样可按 id 读取
// （无界面运行的用例见 headless）。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, memoryPaths, type MemoryEntry } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { bootAgents, call, runEnds as agentRunEnds, starts } from './sidecar-subagents-harness.ts'

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })

it('memory_list 的 ids：按次序返回可见条目的全文，不可见与不存在的列为没有找到', { timeout: 120_000 }, async () => {
  const root = await tempDir()
  const [p, q] = [join(root, 'p'), join(root, 'q')]
  await Promise.all([mkdir(p), mkdir(q)])
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  // faux 脚本在启动时读取，条目 id 由服务端生成：先在同一数据目录中建好条目，再带脚本重启。
  const dirs = await sidecarDirs()
  const setup = await startSidecar({ dirs })
  const setupApi = client(setup, await exchange(setup))
  const wp = (await setupApi.post(API_ROUTES.workspaces, { path: p })).body.id as string
  const wq = (await setupApi.post(API_ROUTES.workspaces, { path: q })).body.id as string
  const add = async (body: Record<string, unknown>) => (await setupApi.post(memoryPaths.memories, body)).body as MemoryEntry
  const user = await add({ scope: 'user', content: 'User prefers tabs\nand two-space YAML' })
  const pFact = await add({ scope: 'workspace', workspaceId: wp, content: 'P uses pnpm\nwith a frozen lockfile' })
  const qFact = await add({ scope: 'workspace', workspaceId: wq, content: 'Q uses npm' })
  expect(await setup.stop()).toEqual({ code: 0, signal: null })

  const script = await fauxScript(root, {
    requestLog,
    responses: [
      {
        content: [
          toolCall('mixed', 'memory_list', { ids: [pFact.id, 'missing', qFact.id, user.id] }),
          toolCall('both', 'memory_list', { ids: [user.id], query: 'tabs' }),
          toolCall('many', 'memory_list', { ids: Array.from({ length: 21 }, (_, i) => `m${i}`) }),
        ],
      },
      { content: 'in P' },
      { content: [toolCall('standalone', 'memory_list', { ids: [pFact.id, user.id] })] },
      { content: 'standalone' },
    ],
  })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: wp })).body.id as string
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  const runEnds = () => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
  const send = async (text: string) => {
    const before = runEnds()
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
    await stream.waitFor(() => runEnds() > before)
  }
  const result = (id: string) => {
    const payload = stream
      .entries(sessionId)
      .map((e) => e.payload as { role?: string; toolCallId?: string; isError: boolean; content: { text?: string }[] })
      .find((x) => x.role === 'toolResult' && x.toolCallId === id)!
    return { isError: payload.isError, text: payload.content.map((c) => c.text ?? '').join('') }
  }

  // AC-12、AC-13：可见的两条按给出的次序带全文，另一项目与不存在的 id 列在之后。
  await send('read by id')
  expect(result('mixed')).toEqual({
    isError: false,
    text:
      `<entry id="${pFact.id}" scope="workspace" source="user">\nP uses pnpm\nwith a frozen lockfile\n</entry>\n` +
      `<entry id="${user.id}" scope="user" source="user">\nUser prefers tabs\nand two-space YAML\n</entry>\n\n` +
      `Memory entries not found: missing, ${qFact.id}.`,
  })
  // AC-14：与 query 同时给出是工具错误；21 个在参数校验阶段失败。
  expect(result('both')).toMatchObject({ isError: true, text: expect.stringMatching(/either ids or query/) })
  expect(result('many')).toMatchObject({ isError: true, text: expect.stringMatching(/Validation failed for tool "memory_list"/) })
  const [first] = (await readFile(requestLog, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { role: string; toolsAdded?: { name: string; description?: string; parameters?: unknown }[] }[])
  const declared = first!.flatMap((m) => m.toolsAdded ?? []).find((t) => t.name === 'memory_list')!
  expect(declared.description).toMatch(/Pass ids to read specific entries in full text/)
  expect(JSON.stringify(declared.parameters)).toContain('"ids"')

  // 不属于项目的 Run：Workspace 作用域的条目没有找到，用户级照常读出。
  expect((await api.put(apiPaths.sessionProject(sessionId), { projectId: null })).status).toBe(200)
  await send('read without project')
  expect(result('standalone')).toEqual({
    isError: false,
    text: `<entry id="${user.id}" scope="user" source="user">\nUser prefers tabs\nand two-space YAML\n</entry>\n\nMemory entries not found: ${pFact.id}.`,
  })
  expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
})

it('子 Session 的 memory_list 有 ids 参数，按 id 读取返回全文', { timeout: 120_000 }, async () => {
  const dirs = await sidecarDirs()
  const setup = await startSidecar({ dirs })
  const saved = (await client(setup, await exchange(setup)).post(memoryPaths.memories, { scope: 'user', content: 'Prefers tabs\nin every file' }))
    .body as MemoryEntry
  expect(await setup.stop()).toEqual({ code: 0, signal: null })
  const env = await bootAgents(
    [
      { match: 'PARENT-M', content: [call('agent', 'a1', { description: 'read memory', prompt: 'CHILD-M read', subagent_type: 'general' })] },
      { match: 'CHILD-M', content: [call('memory_list', 'r1', { ids: [saved.id] })] },
      { match: 'CHILD-M', content: 'read' },
      { match: 'PARENT-M', content: 'ok' },
    ],
    { dirs },
  )
  const parent = await env.open('full-access')
  await env.submit(parent, 'PARENT-M go')
  await env.stream.waitFor(() => agentRunEnds(env.stream, parent).length >= 1, 30_000)
  const child = starts(env.stream, parent)[0]!.agentId
  const childResults = ((await env.api.get(apiPaths.session(child))).body.entries as { kind: string; payload: Record<string, unknown> }[])
    .map((e) => e.payload as { role?: string; toolName?: string; isError?: boolean; content: { text?: string }[] })
    .filter((m) => m.role === 'toolResult')
    .map((m) => [m.toolName, m.isError, m.content.map((c) => c.text ?? '').join('')])
  expect(childResults).toEqual([['memory_list', false, `<entry id="${saved.id}" scope="user" source="user">\nPrefers tabs\nin every file\n</entry>`]])
  const childRequest = (await env.requests()).find((r) => JSON.stringify(r).includes('CHILD-M read'))!
  const declared = childRequest.flatMap((m) => (m.toolsAdded ?? []) as { name: string; parameters?: unknown }[]).find((t) => t.name === 'memory_list')
  expect(JSON.stringify(declared?.parameters)).toContain('"ids"')
  expect(await env.sidecar.stop()).toEqual({ code: 0, signal: null })
})
