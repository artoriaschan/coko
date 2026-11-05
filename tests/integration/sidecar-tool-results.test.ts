import { access, readFile, writeFile, stat, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths } from '@coko/protocol'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir, waitApproval } from './sidecar-harness.ts'

it('truncated bash output is stored for its session and normal output creates no file', async () => {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const requestLog = join(root, 'requests.jsonl')
  const script = await fauxScript(root, {
    requestLog,
    responses: [
      {
        content: [
          { type: 'toolCall', name: 'bash', id: 'long-output', arguments: { command: 'seq 1 2500' } },
          { type: 'toolCall', name: 'bash', id: 'short-output', arguments: { command: 'printf short' } },
        ],
      },
      { content: 'done' },
    ],
  })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'print output' })).status).toBe(202)
  await stream.waitFor(isRunEnd(sessionId))
  const path = join(dirs.dataDir, 'tool-results', sessionId, 'long-output.txt')
  expect(await readFile(path, 'utf8')).toBe(Array.from({ length: 2500 }, (_, i) => `${i + 1}\n`).join(''))
  expect(JSON.stringify(stream.entries(sessionId).filter((entry) => entry.kind === 'message'))).toContain(path)
  expect(await readFile(requestLog, 'utf8')).toContain(path)
  await expect(access(join(dirs.dataDir, 'tool-results', sessionId, 'short-output.txt'))).rejects.toThrow(/ENOENT/)
})

it('a truncated text read saves a UTF-8 prefix with a 32 MiB cap and a safe call filename', async () => {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  await writeFile(join(root, 'large.txt'), '你好'.repeat(6 * 1024 * 1024))
  const script = await fauxScript(root, {
    responses: [{ content: [{ type: 'toolCall', name: 'read', id: '../large', arguments: { path: 'large.txt' } }] }, { content: 'done' }],
  })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  await api.post(apiPaths.sessionMessages(sessionId), { text: 'read the file' })
  await stream.waitFor(isRunEnd(sessionId))
  const path = join(dirs.dataDir, 'tool-results', sessionId, '..%2Flarge.txt')
  const stored = await readFile(path, 'utf8')
  expect((await stat(path)).size).toBeLessThanOrEqual(32 * 1024 * 1024)
  expect(stored.startsWith('你好你好')).toBe(true)
  expect(stored.endsWith('\n[truncated]\n')).toBe(true)
  expect(stored.includes('\uFFFD')).toBe(false)
  expect(JSON.stringify(stream.entries(sessionId))).toContain(`${path} [truncated]`)
})

it('the current session can read its spilled results in read-only mode without granting sibling reads or writes', async () => {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const first = await startSidecar({ dirs })
  const firstApi = client(first, await exchange(first))
  const workspaceId = (await firstApi.post(API_ROUTES.workspaces, { path: root })).body.id
  const sessionId = (await firstApi.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  const otherId = (await firstApi.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  await firstApi.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'read-only' })
  await first.stop()
  const own = join(dirs.dataDir, 'tool-results', sessionId, 'prior.txt')
  const sibling = join(dirs.dataDir, 'tool-results', otherId, 'prior.txt')
  for (const id of [sessionId, otherId]) await mkdir(join(dirs.dataDir, 'tool-results', id), { recursive: true })
  await writeFile(own, 'own full output')
  await writeFile(sibling, 'sibling private output')
  const script = await fauxScript(root, {
    responses: [
      {
        content: [
          { type: 'toolCall', name: 'read', id: 'read-own', arguments: { path: own } },
          { type: 'toolCall', name: 'read', id: 'read-sibling', arguments: { path: sibling } },
          { type: 'toolCall', name: 'write', id: 'write-own', arguments: { path: own, content: 'changed' } },
        ],
      },
      { content: 'done' },
    ],
  })
  const second = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(second)
  const api = client(second, cookie)
  const stream = await connect(second, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  await api.post(apiPaths.sessionMessages(sessionId), { text: 'inspect outputs' })
  const approval = await waitApproval(stream, sessionId)
  expect(approval.toolCallId).toBe('read-sibling')
  await api.post(apiPaths.sessionApproval(sessionId, approval.requestId), { decision: 'deny' })
  await stream.waitFor(isRunEnd(sessionId))
  const entries = stream.entries(sessionId)
  expect(entries.filter((entry) => entry.kind === 'approval_request')).toHaveLength(1)
  const results = entries
    .filter((entry) => entry.kind === 'message')
    .map((entry) => entry.payload as { role: string; toolCallId?: string; isError?: boolean; content: unknown })
  expect(results.find((result) => result.toolCallId === 'read-own')).toMatchObject({ isError: false, content: [{ type: 'text', text: 'own full output' }] })
  expect(results.find((result) => result.toolCallId === 'read-sibling')).toMatchObject({ isError: true })
  expect(results.find((result) => result.toolCallId === 'write-own')).toMatchObject({ isError: true })
  expect(JSON.stringify(results.filter((result) => result.role === 'toolResult'))).not.toContain('sibling private output')
  expect(await readFile(own, 'utf8')).toBe('own full output')
})

it('grep, find and ls preserve text before line and byte display truncation', async () => {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const names = Array.from({ length: 300 }, (_, i) => `${String(i).padStart(3, '0')}-${'x'.repeat(180)}.txt`)
  await Promise.all(names.map((name) => writeFile(join(root, name), '')))
  const matching = `needle ${'y'.repeat(4000)}`
  await writeFile(join(root, 'matches.log'), matching)
  const script = await fauxScript(root, {
    responses: [
      {
        content: [
          { type: 'toolCall', name: 'grep', id: 'grep-output', arguments: { pattern: 'needle', path: 'matches.log' } },
          { type: 'toolCall', name: 'find', id: 'find-output', arguments: { pattern: '*.txt' } },
          { type: 'toolCall', name: 'ls', id: 'ls-output', arguments: {} },
        ],
      },
      { content: 'done' },
    ],
  })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  await api.post(apiPaths.sessionMessages(sessionId), { text: 'inspect files' })
  await stream.waitFor(isRunEnd(sessionId))
  const outputRoot = join(dirs.dataDir, 'tool-results', sessionId)
  expect(await readFile(join(outputRoot, 'grep-output.txt'), 'utf8')).toBe(`matches.log:1: ${matching}`)
  for (const name of ['find-output', 'ls-output']) {
    const stored = await readFile(join(outputRoot, `${name}.txt`), 'utf8')
    expect(stored).toContain(names.at(-1))
    expect(Buffer.byteLength(stored)).toBeGreaterThan(50 * 1024)
  }
})

it('streamed bash output is bounded and keeps complete UTF-8 characters at the cap', async () => {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const script = await fauxScript(root, {
    responses: [
      {
        content: [
          {
            type: 'toolCall',
            name: 'bash',
            id: 'capped',
            arguments: { command: `"${process.execPath}" -e "process.stdout.write('你好'.repeat(6*1024*1024))"` },
          },
          { type: 'toolCall', name: 'bash', id: 'exact', arguments: { command: `"${process.execPath}" -e "process.stdout.write('x'.repeat(32*1024*1024))"` } },
        ],
      },
      { content: 'done' },
    ],
  })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspaceId = (await api.post(API_ROUTES.workspaces, { path: root })).body.id
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  await api.post(apiPaths.sessionMessages(sessionId), { text: 'large outputs' })
  await stream.waitFor(isRunEnd(sessionId))
  const outputRoot = join(dirs.dataDir, 'tool-results', sessionId)
  const capped = await readFile(join(outputRoot, 'capped.txt'), 'utf8')
  expect(Buffer.byteLength(capped)).toBeLessThanOrEqual(32 * 1024 * 1024)
  expect(capped.endsWith('\n[truncated]\n')).toBe(true)
  expect(capped.includes('\uFFFD')).toBe(false)
  const exact = await readFile(join(outputRoot, 'exact.txt'))
  expect(exact.length).toBe(32 * 1024 * 1024)
  expect(exact.at(-1)).toBe('x'.charCodeAt(0))
  expect(JSON.stringify(stream.entries(sessionId))).toContain('[truncated]')
})
