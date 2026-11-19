// 记忆分层注入的跨票联合场景：真实 Sidecar（faux 模型）。项目中预置足以填满三层的条目（一条最早的用户手写条目，其余多为 Agent 记下的）：
// 发送后用户手写的仍在正文层；模型按 id 读出摘要层条目的全文；用措辞不同的 query 找到检索层的条目；新建与已有条目相近的记忆时结果列出相近条目、
// 系统不改动已有条目；同一时刻 /api/memories 的两组注入汇总与这一 Run 请求中各层的条数一致。各票的细节见 sidecar-memory* 的其他用例。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, memoryPaths, type MemoryEntry, type MemoryListResponse } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, type Stream } from './sidecar-harness.ts'

type Logged = { role: string; sections?: Record<string, string | null>; toolCallId?: string; isError?: boolean; content?: { text?: string }[] }
type Api = ReturnType<typeof client>

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({ content: [{ type: 'toolCall', name, id, arguments: args }] })
const tiersOf = (section: string, scope: 'user' | 'workspace') => ({
  full: section.match(new RegExp(`<entry [^>]*scope="${scope}"`, 'g'))?.length ?? 0,
  summary: section.match(new RegExp(`<summary [^>]*scope="${scope}"`, 'g'))?.length ?? 0,
})
const omittedOf = (section: string) => Number(/(\d+) more entr(?:y|ies) not shown/.exec(section)?.[1] ?? 0)

const TARGET = 'Run docker compose up before integration tests'
const PARAPHRASE = 'run docker-compose before tests'
const PNPM = '用户偏好 pnpm 而不是 npm'

async function session(api: Api, stream: Stream, workspaceId: string) {
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  return sessionId
}
async function send(api: Api, stream: Stream, sessionId: string) {
  const before = stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
  expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'go' })).status).toBe(202)
  // 全量测试的负载下，预置的一个 Run 可能超过 60 秒。
  await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length > before, 150_000)
}

it('跨票联合：用户手写的留在正文层、按 id 读摘要层、换说法检索到检索层、新建得到相近条目、汇总与请求一致', { timeout: 240_000 }, async () => {
  const root = await tempDir()
  const folder = join(root, 'p')
  await mkdir(folder)
  const dirs = await sidecarDirs()

  // 预置（由旧到新）：用户手写的两条；Agent 记下的检索目标、60 条小条目与 6 条约 2 000 字符的用户级大条目；项目级 4 条大条目。
  // Agent 条目只能由模型写入，所以预置用一个带写入脚本的 Sidecar；faux 脚本在启动时读取、id 由服务端生成，读取用的脚本在重启时再给。
  const small = Array.from({ length: 60 }, (_, i) => `Small fact ${i} about the release checklist`)
  const write = (id: string, scope: string, content: string) => ({ type: 'toolCall', name: 'memory_write', id, arguments: { scope, content } })
  const writes = [
    [write('target', 'user', TARGET)],
    small.map((c, i) => write(`small${i}`, 'user', c)), // 一条消息中的多个调用，省去逐轮往返；同一批内的次序与断言无关。
    [0, 1, 2, 3, 4, 5].map((i) => write(`u${i}`, 'user', `U${i} ${'x'.repeat(1900)}`)),
    ...[0, 1, 2, 3].map((i) => [write(`p${i}`, 'workspace', `P${i} ${'x'.repeat(1900)}\nsecond paragraph`)]),
  ]
  const seedScript = await fauxScript(root, { responses: [...writes.map((content) => ({ content })), { content: 'seeded' }] }, 'seed.json')
  const setup = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: seedScript } })
  const setupCookie = await exchange(setup)
  const api0 = client(setup, setupCookie)
  const workspaceId = (await api0.post(API_ROUTES.workspaces, { path: folder })).body.id as string
  for (const content of ['Always answer in Chinese', PNPM]) expect((await api0.post(memoryPaths.memories, { scope: 'user', content })).status).toBe(201)
  const stream0 = await connect(setup, setupCookie)
  await send(api0, stream0, await session(api0, stream0, workspaceId))
  const seeded = (await api0.get(`${memoryPaths.memories}?workspaceId=${workspaceId}`)).body.memories as MemoryEntry[]
  expect(seeded).toHaveLength(writes.flat().length + 2)
  expect(await setup.stop()).toEqual({ code: 0, signal: null })
  const byContent = (prefix: string) => seeded.find((m) => m.content.startsWith(prefix))!
  const [p0, target, pnpm] = [byContent('P0 '), byContent(TARGET), byContent(PNPM)]
  expect([p0.source, target.source, pnpm.source]).toEqual(['model', 'model', 'user'])

  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, {
    requestLog,
    responses: [
      toolCall('read', 'memory_list', { ids: [p0.id] }),
      toolCall('search', 'memory_list', { query: PARAPHRASE }),
      toolCall('write', 'memory_write', { scope: 'user', content: '用户偏好使用 pnpm，不要用 npm' }),
      { content: 'done' },
    ],
  })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  // 设置页在这一时刻看到的汇总（项目对话：两组）。
  const summary = ((await api.get(`${memoryPaths.memories}?workspaceId=${workspaceId}`)).body as MemoryListResponse).injection!
  await send(api, stream, await session(api, stream, workspaceId))

  const requests = (await readFile(requestLog, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Logged[])
  const section = requests[0]!.map((m) => m.sections?.memory).find(Boolean)!

  // 用户手写的两条（含最早的一条）在正文层；Agent 条目被降到摘要层与检索层；检索目标不在段内。
  const full = [...section.matchAll(/<entry [^>]*source="(\w+)">\n([^\n]+)/g)].map((m) => [m[1], m[2]!.slice(0, 24)])
  expect(full).toContainEqual(['user', 'Always answer in Chinese'])
  expect(full).toContainEqual(['user', PNPM])
  expect(section).toContain(`<summary id="${p0.id}" scope="workspace" source="agent">`)
  expect(section).not.toContain(target.id)
  expect(omittedOf(section)).toBeGreaterThan(0)

  // 设置页两组的汇总与这一 Run 请求中各层的条数一致。
  expect(summary.user).toEqual({ ...tiersOf(section, 'user'), omitted: summary.user.omitted })
  expect(summary.workspace).toEqual({ ...tiersOf(section, 'workspace'), omitted: summary.workspace!.omitted })
  expect(summary.user.omitted + summary.workspace!.omitted).toBe(omittedOf(section))
  expect(
    summary.user.full + summary.user.summary + summary.user.omitted + summary.workspace!.full + summary.workspace!.summary + summary.workspace!.omitted,
  ).toBe(seeded.length)

  const result = (id: string) => {
    const message = requests.at(-1)!.find((m) => m.role === 'toolResult' && m.toolCallId === id)!
    expect(message.isError).toBe(false)
    return message.content!.map((c) => c.text ?? '').join('')
  }
  // 按 id 读出摘要层条目的全文。
  expect(result('read')).toBe(`<entry id="${p0.id}" scope="workspace" source="agent">\n${p0.content}\n</entry>`)
  // 措辞不同的查询：严格匹配为空，近似匹配找到检索层的目标并注明。
  const found = result('search')
  expect(found.startsWith(`No exact match for "${PARAPHRASE}"; showing similar entries instead:\n\n`)).toBe(true)
  expect(found).toContain(`<entry id="${target.id}" scope="user" source="agent">\n${TARGET}\n</entry>`)
  // 新建相近的条目：已保存，结果列出用户维护的那条；系统不改动任何已有条目。
  const written = result('write')
  expect(written).toMatch(/^Remembered \(id: [^,]+, scope: user\)\./)
  expect(written).toContain(`- id: ${pnpm.id}, scope: user, source: user (maintained by the user; you cannot change it): ${PNPM}`)
  const after = (await api.get(`${memoryPaths.memories}?workspaceId=${workspaceId}`)).body.memories as MemoryEntry[]
  expect(after).toHaveLength(seeded.length + 1)
  expect(after.filter((m) => seeded.some((s) => s.id === m.id))).toEqual(expect.arrayContaining(seeded))
  expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
})
