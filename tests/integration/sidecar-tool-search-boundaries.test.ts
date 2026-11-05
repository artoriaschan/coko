import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, checkpointPaths, mcpPaths, permissionPaths, type SessionEntryRecord } from '@coko/protocol'
import { stdioServerConfig } from '../fixtures/mcp/index.ts'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

const A = 'mcp__demo__echo'
const B = 'mcp__demo__big'
const call = (name: string, id: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const search = (name: string, id: string) => call('tool_search', id, { query: 'select:' + name })
type Message = { role: string; content?: unknown; toolsAdded?: { name: string }[]; toolsRemoved?: { name: string }[] }
const text = (entry: SessionEntryRecord) => JSON.stringify((entry.payload as Message).content)
const mcpTools = (messages: Message[]) => {
  const names = new Set<string>()
  for (const message of messages) {
    for (const tool of message.toolsAdded ?? []) names.add(tool.name)
    for (const tool of message.toolsRemoved ?? []) names.delete(tool.name)
  }
  return [...names].filter((name) => name.startsWith('mcp__')).sort()
}

it.each([false, true])('keeps load boundaries across both forks, file/conversation rewind and Handoff (compacted source: %s)', async (compacted) => {
  const root = await tempDir()
  const requestLog = join(root, 'requests.jsonl')
  const script = await fauxScript(root, {
    contextWindow: 300_000,
    requestLog,
    responses: [
      { match: 'SEED', content: 'seeded' },
      { match: 'LOAD-A', content: [search(A, 'load-a')] },
      { match: 'LOAD-A', content: 'A loaded' },
      ...(compacted ? [{ match: 'PADDING', content: 'padding done' }, { match: 'PADDING', content: 'padding two done' }, { content: 'LOADS-SUMMARY' }] : []),
      { match: 'BOUNDARY', content: 'boundary answer' },
      { match: 'LOAD-B', content: [search(B, 'load-b'), call('write', 'write-later', { path: 'later.txt', content: 'later bytes' })] },
      { match: 'LOAD-B', content: 'B loaded' },
      { match: 'PROBE-USER', content: 'user fork observed' },
      { match: 'PROBE-ASSISTANT', content: 'assistant fork observed' },
      { match: 'PROBE-AGAIN', content: 'second fork observed' },
      { match: 'PROBE-CODE', content: 'file rewind observed' },
      { match: '<next-goal>', content: '## Context\nloaded tools\n## Files\nNone\n## Open items\nNone\n## Task\ncontinue' },
      { match: 'PROBE-HANDOFF', content: 'handoff observed' },
      { match: 'PROBE-REWIND', content: 'conversation rewind observed' },
    ],
  })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id as string
  expect((await api.put(mcpPaths.servers, { servers: { demo: stdioServerConfig() }, workspaceId, expectedRevision: 0 })).status).toBe(200)
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
  const entries = async (id: string) => (await api.get(apiPaths.session(id))).body.entries as SessionEntryRecord[]
  const subscribe = async (id: string) => {
    stream.send({ type: 'subscribe', sessionId: id, afterSeq: 0 })
    await stream.waitFor((message) => message.type === 'subscribed' && message.sessionId === id)
  }
  const send = async (id: string, input: string) => {
    const run = await api.post(apiPaths.sessionMessages(id), { text: input })
    expect(run.status).toBe(202)
    await stream.waitFor(() => stream.entries(id).some((entry) => entry.kind === 'run_end' && entry.runId === run.body.runId))
    expect(stream.entries(id).find((entry) => entry.kind === 'run_end' && entry.runId === run.body.runId)?.payload).toMatchObject({ status: 'completed' })
  }
  const lastRequest = async (): Promise<Message[]> => JSON.parse((await readFile(requestLog, 'utf8')).trim().split('\n').at(-1)!)
  const loads = async (id: string) => (await entries(id)).filter((entry) => entry.kind === 'tool_load').map((entry) => entry.payload)
  await subscribe(sessionId)
  await send(sessionId, 'SEED' + 'x'.repeat(4_000))
  await send(sessionId, 'LOAD-A' + 'y'.repeat(48_000))
  if (compacted) {
    await send(sessionId, 'PADDING' + 'w'.repeat(40_000))
    await send(sessionId, 'PADDING' + 'z'.repeat(40_000))
    await send(sessionId, '/compact')
  }
  await send(sessionId, 'BOUNDARY')
  await send(sessionId, 'LOAD-B')
  const source = await entries(sessionId)
  const compaction = source.find((entry) => entry.kind === 'compaction')
  const firstLoad = source.find((entry) => entry.kind === 'tool_load')!
  expect({
    compacted: Boolean(compaction),
    coversLoad: compaction ? (compaction.payload as { firstKeptSeq: number }).firstKeptSeq > firstLoad.seq : false,
  }).toEqual({ compacted, coversLoad: compacted })
  const targetUser = source.find((entry) => entry.kind === 'message' && (entry.payload as Message).role === 'user' && text(entry).includes('BOUNDARY'))!
  const targetReply = source.find(
    (entry) => entry.kind === 'message' && (entry.payload as Message).role === 'assistant' && text(entry).includes('boundary answer'),
  )!
  expect(await loads(sessionId)).toEqual([
    { names: [A], source: 'search', toolCallId: 'load-a' },
    { names: [B], source: 'search', toolCallId: 'load-b' },
  ])
  let assistantForkId = ''
  for (const [boundary, targetSeq, prompt] of [
    ['user-before', targetUser.seq, 'PROBE-USER'],
    ['assistant-inclusive', targetReply.seq, 'PROBE-ASSISTANT'],
  ] as const) {
    const fork = await api.post(checkpointPaths.sessionFork(sessionId), { boundary, targetSeq })
    expect(fork.status).toBe(201)
    const id = fork.body.sessionId as string
    expect(await loads(id)).toEqual([{ names: [A], source: 'search', toolCallId: 'load-a' }])
    expect((await entries(id)).some((entry) => entry.kind === 'compaction')).toBe(compacted)
    await subscribe(id)
    await send(id, prompt)
    expect(mcpTools(await lastRequest())).toEqual([A])
    if (boundary === 'assistant-inclusive') assistantForkId = id
  }
  const copiedReply = (await entries(assistantForkId)).find((entry) => entry.kind === 'message' && text(entry).includes('boundary answer'))!
  const again = await api.post(checkpointPaths.sessionFork(assistantForkId), { boundary: 'assistant-inclusive', targetSeq: copiedReply.seq })
  expect(again.status).toBe(201)
  expect(await loads(again.body.sessionId)).toEqual([{ names: [A], source: 'search', toolCallId: 'load-a' }])
  await subscribe(again.body.sessionId)
  await send(again.body.sessionId, 'PROBE-AGAIN')
  expect(mcpTools(await lastRequest())).toEqual([A])
  expect(await entries(sessionId)).toEqual(source)
  expect(await readFile(join(root, 'later.txt'), 'utf8')).toBe('later bytes')
  const code = await api.post(checkpointPaths.sessionRewind(sessionId), { targetSeq: targetUser.seq, mode: 'code' })
  expect(code.status).toBe(200)
  expect(
    await stat(join(root, 'later.txt')).then(
      () => true,
      () => false,
    ),
  ).toBe(false)
  expect(await loads(sessionId)).toHaveLength(2)
  await send(sessionId, 'PROBE-CODE')
  expect(mcpTools(await lastRequest())).toEqual([B, A])
  await send(sessionId, '/handoff continue')
  await stream.waitFor(() => stream.entries(sessionId).some((entry) => entry.kind === 'handoff'))
  const handoff = stream.entries(sessionId).find((entry) => entry.kind === 'handoff')!
  const targetId = (handoff.payload as { targetSessionId: string }).targetSessionId
  await subscribe(targetId)
  await stream.waitFor(() => stream.entries(targetId).some((entry) => entry.kind === 'permission_mode'))
  expect(await loads(targetId)).toEqual([])
  await send(targetId, 'PROBE-HANDOFF')
  expect(mcpTools(await lastRequest())).toEqual([])
  const rewind = await api.post(checkpointPaths.sessionRewind(sessionId), { targetSeq: targetUser.seq, mode: 'conversation' })
  expect(rewind.status).toBe(200)
  await send(sessionId, 'PROBE-REWIND')
  expect(mcpTools(await lastRequest())).toEqual([A])
  expect(stream.invalidEntries).toEqual([])
  expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
})
