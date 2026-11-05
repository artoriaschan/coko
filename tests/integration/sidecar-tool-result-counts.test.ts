import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import { permissionPaths } from '@coko/protocol'
import { expect, it } from 'vitest'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it.each(['js', 'ripgrep'])('count-only truncated ls/find/%s grep retain every result in the spill', async (backend) => {
  const root = await tempDir()
  const workspace = join(root, 'ws')
  await mkdir(workspace)
  const names = Array.from({ length: 1001 }, (_, i) => `f${String(i).padStart(4, '0')}`)
  await Promise.all(names.map((name) => writeFile(join(workspace, name), '')))
  await writeFile(join(workspace, 'hits.txt'), 'hit\n'.repeat(101))
  const script = await fauxScript(root, {
    responses: [
      {
        content: [
          { type: 'toolCall', name: 'ls', id: 'ls-count', arguments: {} },
          { type: 'toolCall', name: 'find', id: 'find-count', arguments: { pattern: 'f*' } },
          { type: 'toolCall', name: 'grep', id: 'grep-count', arguments: { pattern: 'hit', path: 'hits.txt' } },
          { type: 'toolCall', name: 'ls', id: 'ls-query', arguments: { limit: 7 } },
          { type: 'toolCall', name: 'find', id: 'find-query', arguments: { pattern: 'f*', limit: 7 } },
          { type: 'toolCall', name: 'grep', id: 'grep-query', arguments: { pattern: 'hit', path: 'hits.txt', limit: 7 } },
        ],
      },
      { content: 'done' },
    ],
  })
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({
    dirs,
    ...(backend === 'ripgrep' ? { args: ['--data-dir', dirs.dataDir, '--log-dir', dirs.logDir, '--ripgrep', rgPath] } : {}),
    env: { COKO_FAUX_SCRIPT: script },
  })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspaceId = (await api.post('/api/workspaces', { path: workspace })).body.id
  const sessionId = (await api.post('/api/sessions', { workspaceId })).body.id as string
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  await api.post(`/api/sessions/${sessionId}/messages`, { text: 'inspect files' })
  await stream.waitFor(isRunEnd(sessionId))
  const stored = (id: string) => readFile(join(dirs.dataDir, 'tool-results', sessionId, `${id}.txt`), 'utf8')
  expect((await stored('ls-count')).split('\n')).toEqual([...names, 'hits.txt'])
  expect((await stored('find-count')).split('\n')).toEqual(names)
  expect(await stored('grep-count')).toBe(Array.from({ length: 101 }, (_, i) => `hits.txt:${i + 1}: hit`).join('\n'))
  const results = stream
    .entries(sessionId)
    .filter((e) => e.kind === 'message')
    .map((e) => e.payload as { role: string; toolCallId?: string; content: { type: string; text?: string }[] })
    .filter((p) => p.role === 'toolResult')
  for (const [id, count] of [
    ['ls-count', 500],
    ['find-count', 1000],
    ['grep-count', 100],
  ] as const) {
    const result = results.find((e) => e.toolCallId === id)
    if (!result) throw new Error('missing tool result')
    const block = result.content[0]
    if (block?.type !== 'text' || block.text === undefined) throw new Error('missing text')
    expect(block.text.split('\n\n')[0]!.split('\n')).toHaveLength(count)
    expect(JSON.stringify(result)).toContain(join(dirs.dataDir, 'tool-results', sessionId, `${id}.txt`))
  }
  for (const id of ['ls-query', 'find-query', 'grep-query']) {
    const result = results.find((r) => r.toolCallId === id)
    expect(result?.content[0]?.text?.split('\n\n')[0]!.split('\n')).toHaveLength(7)
    await expect(access(join(dirs.dataDir, 'tool-results', sessionId, `${id}.txt`))).rejects.toThrow(/ENOENT/)
  }
})

it('full grep capture accounts redacted bytes and keeps cap markers while completing the query window', async () => {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const secret = 'registered-output-accounting-value-6f81'
  const redactedLine = 'hit ' + secret.repeat(12000)
  const unicodeLine = 'hit ' + '你好'.repeat(70000)
  await writeFile(join(root, 'redacted.txt'), (redactedLine + '\n').repeat(102))
  await writeFile(join(root, 'unicode.txt'), (unicodeLine + '\n').repeat(102))
  const script = await fauxScript(root, {
    responses: [
      {
        content: [
          { type: 'toolCall', name: 'grep', id: 'redacted', arguments: { pattern: 'hit', path: 'redacted.txt' } },
          { type: 'toolCall', name: 'grep', id: 'capped', arguments: { pattern: 'hit', path: 'unicode.txt', limit: 100 } },
        ],
      },
      { content: 'done' },
    ],
  })
  const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_CAPTURE: secret } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspaceId = (await api.post('/api/workspaces', { path: root })).body.id
  const sessionId = (await api.post('/api/sessions', { workspaceId })).body.id as string
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  await api.post(`/api/sessions/${sessionId}/messages`, { text: 'inspect large matches' })
  await stream.waitFor(isRunEnd(sessionId))
  const redacted = await readFile(join(dirs.dataDir, 'tool-results', sessionId, 'redacted.txt'), 'utf8')
  expect(redacted.includes(secret)).toBe(false)
  expect(redacted.split('\n')).toHaveLength(102)
  expect(redacted.endsWith('[REDACTED:secret]')).toBe(true)
  expect(Buffer.byteLength(redacted)).toBeLessThan(32 * 1024 * 1024)
  const capped = await readFile(join(dirs.dataDir, 'tool-results', sessionId, 'capped.txt'), 'utf8')
  expect(Buffer.byteLength(capped)).toBeLessThanOrEqual(32 * 1024 * 1024)
  expect(capped.endsWith('\n[truncated]\n')).toBe(true)
  expect(capped.includes('\uFFFD')).toBe(false)
  expect(JSON.stringify(stream.entries(sessionId))).toContain('capped.txt [truncated]')
  const cappedResult = stream
    .entries(sessionId)
    .filter((e) => e.kind === 'message')
    .map((e) => e.payload as { toolCallId?: string; details?: { matchLimitReached?: number } })
    .find((p) => p.toolCallId === 'capped')
  expect(cappedResult?.details?.matchLimitReached).toBe(100)
})

it.each(['js', 'ripgrep'])('%s grep counts each denied path once across matching lines', async (backend) => {
  const root = await tempDir()
  const workspace = join(root, 'ws')
  await mkdir(workspace)
  const denied = join(workspace, 'private.txt')
  await writeFile(denied, 'hit private\nhit private\nhit private\n')
  await writeFile(join(workspace, 'public.txt'), 'hit public\n')
  const script = await fauxScript(root, {
    responses: [{ content: [{ type: 'toolCall', name: 'grep', id: 'filtered', arguments: { pattern: 'hit' } }] }, { content: 'done' }],
  })
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({
    dirs,
    ...(backend === 'ripgrep' ? { args: ['--data-dir', dirs.dataDir, '--log-dir', dirs.logDir, '--ripgrep', rgPath] } : {}),
    env: { COKO_FAUX_SCRIPT: script },
  })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspaceId = (await api.post('/api/workspaces', { path: workspace })).body.id
  const sessionId = (await api.post('/api/sessions', { workspaceId })).body.id as string
  expect(
    (await api.post(permissionPaths.sessionPermissionRules(sessionId), { rule: { behavior: 'deny', tool: 'Read', content: await realpath(denied) } })).status,
  ).toBe(200)
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  await api.post(`/api/sessions/${sessionId}/messages`, { text: 'inspect permitted files' })
  await stream.waitFor(isRunEnd(sessionId))
  const result = stream
    .entries(sessionId)
    .filter((e) => e.kind === 'message')
    .map((e) => e.payload as { toolCallId?: string; content?: { type: string; text?: string }[] })
    .find((p) => p.toolCallId === 'filtered')
  expect(result?.content?.[0]?.text).toBe('public.txt:1: hit public\n\n[1 path omitted: denied by permission rules]')
  expect(JSON.stringify(result)).not.toContain('hit private')
})

it.each(['js', 'ripgrep'])('%s grep finishes its visible window after full capture reaches the byte cap', async (backend) => {
  const root = await tempDir()
  const workspace = join(root, 'ws')
  await mkdir(workspace)
  await writeFile(join(workspace, 'hits.txt'), 'hit ' + 'x'.repeat(33 * 1024 * 1024) + '\n' + 'hit\n'.repeat(99))
  const script = await fauxScript(root, {
    responses: [
      {
        content: [
          { type: 'toolCall', name: 'grep', id: 'default-window', arguments: { pattern: 'hit', path: 'hits.txt' } },
          { type: 'toolCall', name: 'grep', id: 'explicit-window', arguments: { pattern: 'hit', path: 'hits.txt', limit: 7 } },
          { type: 'toolCall', name: 'grep', id: 'context-window', arguments: { pattern: 'hit', path: 'hits.txt', context: 1 } },
        ],
      },
      { content: 'done' },
    ],
  })
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({
    dirs,
    ...(backend === 'ripgrep' ? { args: ['--data-dir', dirs.dataDir, '--log-dir', dirs.logDir, '--ripgrep', rgPath] } : {}),
    env: { COKO_FAUX_SCRIPT: script },
  })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspaceId = (await api.post('/api/workspaces', { path: workspace })).body.id
  const sessionId = (await api.post('/api/sessions', { workspaceId })).body.id as string
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  await api.post(`/api/sessions/${sessionId}/messages`, { text: 'inspect long matches' })
  await stream.waitFor(isRunEnd(sessionId))
  const results = stream
    .entries(sessionId)
    .filter((e) => e.kind === 'message')
    .map((e) => e.payload as { toolCallId?: string; content?: { type: string; text?: string }[] })
  for (const [id, expected] of [
    ['default-window', 100],
    ['explicit-window', 7],
    ['context-window', 100],
  ] as const) {
    const result = results.find((p) => p.toolCallId === id)
    const text = result?.content?.[0]?.text
    if (text === undefined) throw new Error('missing grep result')
    expect(
      text
        .split('\n\n')[0]
        ?.split('\n')
        .filter((line) => /^hits\.txt:\d+:/.test(line)),
    ).toHaveLength(expected)
    expect(text).toContain(`hits.txt:${expected}: hit`)
    const outputPath = join(dirs.dataDir, 'tool-results', sessionId, `${id}.txt`)
    const saved = await readFile(outputPath, 'utf8')
    expect(Buffer.byteLength(saved)).toBeLessThanOrEqual(32 * 1024 * 1024)
    expect(saved.endsWith('\n[truncated]\n')).toBe(true)
    expect(JSON.stringify(result)).toContain(`${outputPath} [truncated]`)
  }
  expect(results.find((p) => p.toolCallId === 'explicit-window')?.content?.[0]?.text).not.toContain('hits.txt:8: hit')
})
