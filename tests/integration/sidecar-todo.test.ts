// Todo List：真实 Sidecar（faux 模型）经协议驱动。todo_write 整表替换并提交 todo_list 条目（生成的 id、去掉空白）；有未完成项时下一个 Run
// 的请求含 <todo_list> section，全部完成后不再注入；不合规则的调用是错误结果、不提交条目；default 与 read-only 模式都不询问；
// 压缩后（todo_write 的调用已被摘要）<todo_list> 仍在。本票不读取文件，不涉及符号链接越界。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, type Stream } from './sidecar-harness.ts'

type Api = ReturnType<typeof client>
type LoggedMessage = { role: string; content?: unknown; sections?: Record<string, string | null> }

const toolCall = (id: string, items: unknown[]) => ({ type: 'toolCall', name: 'todo_write', id, arguments: { items } })

async function boot(responses: unknown[], extra: Record<string, unknown> = {}) {
  const root = await tempDir()
  const workspaceDir = join(root, 'ws')
  await mkdir(workspaceDir)
  const dirs = await sidecarDirs()
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses, ...extra })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body.id as string
  const requests = async () =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LoggedMessage[])
  return { sidecar, api, stream, workspaceId, requests }
}

async function newSession(api: Api, stream: Stream, workspaceId: string, mode?: string) {
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  if (mode) {
    const changed = await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode })
    if (changed.status !== 200) throw new Error('permission mode not set: ' + changed.status)
  }
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  return sessionId
}

const runEnds = (stream: Stream, sessionId: string) => stream.entries(sessionId).filter((e) => e.kind === 'run_end')
async function send(api: Api, stream: Stream, sessionId: string, text: string) {
  const before = runEnds(stream, sessionId).length
  const res = await api.post(apiPaths.sessionMessages(sessionId), { text })
  expect({ status: res.status, body: res.body }).toMatchObject({ status: 202 })
  await stream.waitFor(() => runEnds(stream, sessionId).length > before, 30_000)
  return stream.entries(sessionId).filter((e) => e.runId === res.body.runId)
}

/** 依次重放请求中的系统消息，得到该请求生效的 sections。 */
function sectionsOf(messages: LoggedMessage[]) {
  const sections: Record<string, string> = {}
  for (const m of messages) {
    if (m.role !== 'system') continue
    for (const [name, text] of Object.entries(m.sections ?? {})) {
      if (text === null) delete sections[name]
      else sections[name] = text
    }
  }
  return sections
}

const todoLists = (stream: Stream, sessionId: string) =>
  stream
    .entries(sessionId)
    .filter((e) => e.kind === 'todo_list')
    .map((e) => e.payload)
const todoResults = (stream: Stream, sessionId: string) =>
  stream
    .entries(sessionId)
    .filter((e) => e.kind === 'message' && (e.payload as { toolName?: string }).toolName === 'todo_write')
    .map((e) => e.payload as { isError: boolean; content: { text: string }[] })
const textOf = (message: LoggedMessage | undefined) =>
  !message ? '' : typeof message.content === 'string' ? message.content : ((message.content ?? []) as { text?: string }[]).map((b) => b.text ?? '').join('')

describe('Todo List', () => {
  it(
    'todo_write 提交 todo_list，下一个 Run 注入 <todo_list>；不合规则时错误结果、原表不变；全部完成后不再注入；default 模式不询问',
    { timeout: 90_000 },
    async () => {
      const { sidecar, api, stream, workspaceId, requests } = await boot([
        // Run 1：写入三项（省略 id）。
        {
          content: [
            toolCall('c1', [
              { content: '  read the spec ', status: 'in_progress' },
              { content: 'write tests', status: 'pending', blockedBy: ['t1'] },
              { content: 'implement', status: 'pending', blockedBy: ['t2'] },
            ]),
          ],
        },
        { content: 'planned' },
        // Run 2：两个 in_progress（不合规则）。
        {
          content: [
            toolCall('c2', [
              { content: 'read the spec', status: 'in_progress' },
              { content: 'write tests', status: 'in_progress' },
            ]),
          ],
        },
        { content: 'oops' },
        // Run 3：全部完成。
        {
          content: [
            toolCall('c3', [
              { content: 'read the spec', status: 'completed', result: 'three parts' },
              { content: 'write tests', status: 'completed', blockedBy: ['t1'] },
              { content: 'implement', status: 'cancelled', blockedBy: ['t2'] },
            ]),
          ],
        },
        { content: 'done' },
        // Run 4。
        { content: 'idle' },
      ])
      const sessionId = await newSession(api, stream, workspaceId)
      expect(stream.entries(sessionId).map((e) => e.kind)).toEqual(['permission_mode'])

      await send(api, stream, sessionId, 'plan the work')
      // todo_list 在 tool_exec 之后、toolResult 之前提交（不带 runId，与 permission_mode 相同）。
      expect(stream.entries(sessionId).map((e) => e.kind)).toEqual([
        'permission_mode',
        'run_start',
        'message',
        'message',
        'tool_exec',
        'todo_list',
        'message',
        'message',
        'run_end',
      ])
      expect(todoLists(stream, sessionId)).toEqual([
        {
          items: [
            { id: 't1', content: 'read the spec', status: 'in_progress' },
            { id: 't2', content: 'write tests', status: 'pending', blockedBy: ['t1'] },
            { id: 't3', content: 'implement', status: 'pending', blockedBy: ['t2'] },
          ],
        },
      ])
      expect(todoResults(stream, sessionId).map((r) => [r.isError, r.content[0]!.text.split('\n')[0]])).toEqual([
        [false, 'Updated todo list: 2 pending, 1 in progress, 0 completed, 0 cancelled.'],
      ])

      await send(api, stream, sessionId, 'start')
      expect(todoLists(stream, sessionId)).toHaveLength(1)
      const rejected = todoResults(stream, sessionId)[1]!
      expect(rejected.isError).toBe(true)
      expect(rejected.content[0]!.text).toMatch(/At most one item can be in_progress/)

      await send(api, stream, sessionId, 'finish')
      expect(todoLists(stream, sessionId).at(-1)).toEqual({
        items: [
          { id: 't1', content: 'read the spec', status: 'completed', result: 'three parts' },
          { id: 't2', content: 'write tests', status: 'completed', blockedBy: ['t1'] },
          { id: 't3', content: 'implement', status: 'cancelled', blockedBy: ['t2'] },
        ],
      })
      await send(api, stream, sessionId, 'anything else?')

      // default 模式：todo_write 不经审批。
      expect(stream.entries(sessionId).filter((e) => e.kind === 'approval_request')).toEqual([])
      const log = await requests()
      expect(log).toHaveLength(7)
      const todo = log.map((messages) => sectionsOf(messages).todo_list)
      // Run 1 的两次请求：写入之前没有；Run 1 内写入之后 section 不变（每个 Run 开始时取值）。
      expect(todo.slice(0, 2)).toEqual([undefined, undefined])
      // Run 2、Run 3 开始时有未完成项。
      for (const text of todo.slice(2, 6)) {
        expect(text).toMatch(/^<todo_list>\n/)
        expect(text).toContain('- [in_progress] t1: read the spec')
        expect(text).toContain('- [pending] t3: implement (blocked by t2)')
      }
      // Run 4：全部完成或取消，不再注入。
      expect(todo[6]).toBeUndefined()
      expect(stream.invalidEntries).toEqual([])
      expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    },
  )

  it('read-only 模式不询问；压缩后（调用已被摘要）<todo_list> 仍在', { timeout: 90_000 }, async () => {
    const big = (n: number, c: string) => c.repeat(n)
    const { sidecar, api, stream, workspaceId, requests } = await boot(
      [
        {
          content: [
            toolCall('c1', [
              { content: 'migrate the schema', status: 'in_progress' },
              { content: 'update docs', status: 'pending' },
            ]),
          ],
        },
        { content: 'ok1' },
        { content: 'ok2' },
        { content: 'ok3' },
        { content: 'SUMMARY' },
        { content: 'after compaction' },
      ],
      // 窗口随常驻工具定义的体积调整（定时任务的 schedule_* 工具）；阈值算法不变。
      { contextWindow: 64_000, maxTokens: 4_000 },
    )
    const sessionId = await newSession(api, stream, workspaceId, 'read-only')
    await send(api, stream, sessionId, big(4_000, 'g'))
    expect(todoLists(stream, sessionId)).toHaveLength(1)
    expect(stream.entries(sessionId).filter((e) => e.kind === 'approval_request')).toEqual([])
    await send(api, stream, sessionId, big(48_000, 'h'))
    await send(api, stream, sessionId, big(40_000, 'i'))
    const compacted = await send(api, stream, sessionId, '/compact')
    expect(compacted.map((e) => e.kind)).toEqual(['run_start', 'compaction', 'run_end'])
    await send(api, stream, sessionId, 'next')

    const last = (await requests()).at(-1)!
    // 被摘要的区间含 todo_write 的调用与结果：请求中已没有它们，section 仍注入。
    expect(last.some((m) => textOf(m).includes('Updated todo list'))).toBe(false)
    expect(textOf(last.find((m) => m.role === 'user'))).toContain('SUMMARY')
    const text = sectionsOf(last).todo_list
    expect(text).toContain('- [in_progress] t1: migrate the schema')
    expect(text).toContain('- [pending] t2: update docs')
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})
