// 子代理集成测试共用：启动带 faux 脚本的 Sidecar 与 Workspace（复制 tests/fixtures/agents 的定义），以及读取父 / 子 Session 条目的辅助。
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { API_ROUTES, apiPaths, permissionPaths } from '@coko/protocol'
import { client, connect, exchange, fauxScript, seedProviders, sidecarDirs, startSidecar, tempDir, type Stream } from './sidecar-harness.ts'

export type Logged = { role: string; content: unknown; sections?: Record<string, string> }[]
const fixtures = new URL('../fixtures/agents/', import.meta.url)

export const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
export const texts = (content: unknown) => (typeof content === 'string' ? [content] : (content as { type: string; text?: string }[]).map((b) => b.text ?? ''))
export const flat = (logged: Logged) => JSON.stringify(logged)
/** 最后一条 user message 含该文本的请求（父级之后的请求在 agent 调用参数中也含子代理的 prompt）。 */
export const byUser = (logged: Logged[], marker: string) =>
  logged.filter((r) =>
    texts(r.filter((m) => m.role === 'user').at(-1)?.content ?? '')
      .join('')
      .includes(marker),
  )

export async function bootAgents(
  responses: unknown[],
  options: {
    env?: Record<string, string>
    script?: Record<string, unknown>
    providers?: Parameters<typeof seedProviders>[1]
    workspace?: string
    ipc?: boolean
  } = {},
) {
  const root = await tempDir()
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const dirs = await sidecarDirs()
  if (options.providers) await seedProviders(dirs, options.providers)
  const script = await fauxScript(root, { requestLog, responses, ...options.script })
  const sidecar = await startSidecar({ dirs, ipc: options.ipc, env: { COKO_FAUX_SCRIPT: script, COKO_TEST_TOOLS: '1', ...options.env } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const wsPath = options.workspace ?? join(root, 'ws')
  await mkdir(join(wsPath, '.coko', 'agents'), { recursive: true })
  await cp(new URL('two-turns.md', fixtures), join(wsPath, '.coko', 'agents', 'two-turns.md'))
  await cp(new URL('writer.md', fixtures), join(wsPath, '.coko', 'agents', 'writer.md'))
  await writeFile(join(wsPath, 'notes.txt'), 'NOTES-CONTENT\n')
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: wsPath })).body.id as string
  const subscribe = async (sessionId: string) => {
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  }
  const open = async (mode?: string) => {
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
    const set = mode ? await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode }) : undefined
    if (set && set.status !== 200) throw new Error(`setting mode ${mode} failed: ${set.status}`)
    await subscribe(sessionId)
    return sessionId
  }
  const requests = async () =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Logged)
  const submit = async (sessionId: string, text: string) => {
    const res = await api.post(apiPaths.sessionMessages(sessionId), { text })
    if (res.status !== 202) throw new Error(`submit failed: ${res.status} ${JSON.stringify(res.body)}`)
    return res.body.runId as string
  }
  return { root, wsPath, dirs, sidecar, api, stream, workspaceId, open, subscribe, requests, submit }
}

export const of = (stream: Stream, sessionId: string, kind: string) => stream.entries(sessionId).filter((e) => e.kind === kind)
export const waitKind = (stream: Stream, sessionId: string, kind: string, n = 1, timeoutMs = 30_000) =>
  stream.waitFor(() => of(stream, sessionId, kind).length >= n, timeoutMs)
export const runEnds = (stream: Stream, sessionId: string) =>
  of(stream, sessionId, 'run_end').map((e) => e.payload as { status: string; error?: { code: string } })
export const toolResults = (stream: Stream, sessionId: string, name?: string) =>
  of(stream, sessionId, 'message')
    .map((e) => e.payload as { role: string; toolName?: string; isError?: boolean; content: unknown })
    .filter((m) => m.role === 'toolResult' && (name === undefined || m.toolName === name))
    .map((m) => ({ toolName: m.toolName, isError: m.isError, text: texts(m.content).join('') }))
export const starts = (stream: Stream, sessionId: string) =>
  of(stream, sessionId, 'agent_start').map((e) => e.payload as { agentId: string; agentType: string; background: boolean; goalId?: string })
export const ends = (stream: Stream, sessionId: string) =>
  of(stream, sessionId, 'agent_end').map((e) => e.payload as { agentId: string; status: string; usage: { turns: number; toolCalls: number; tokens: number } })
