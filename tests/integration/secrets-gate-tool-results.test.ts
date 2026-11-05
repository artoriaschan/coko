import { expect, it } from 'vitest'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'
import { leaksIn, persisted } from './secrets-gate-harness.ts'
it.each(['read', 'bash'])('%s truncated output is redacted before spill and leaves no registered plaintext in application data', async (tool) => {
  const secret = 'review-sdr-secret-7d14fc82c7fd'
  const root = await tempDir()
  const dirs = await sidecarDirs()
  await writeFile(join(root, 'long.txt'), secret + '\n' + 'ordinary line\n'.repeat(3000))
  const script = await fauxScript(root, {
    responses: [
      { content: [{ type: 'toolCall', name: tool, id: 'secret-spill', arguments: tool === 'read' ? { path: 'long.txt' } : { command: 'cat long.txt' } }] },
      { content: 'done' },
    ],
  })
  const sidecar = await startSidecar({ dirs, ipc: false, env: { COKO_FAUX_SCRIPT: script, COKO_SECRET_MY_SERVICE_DSN: secret } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspaceId = (await api.post('/api/workspaces', { path: root })).body.id
  const sessionId = (await api.post('/api/sessions', { workspaceId })).body.id as string
  await api.put('/api/sessions/' + sessionId + '/permission-mode', { mode: 'full-access' })
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  await api.post('/api/sessions/' + sessionId + '/messages', { text: 'read' })
  await stream.waitFor(isRunEnd(sessionId))
  const entries = stream.entries(sessionId)
  const results = entries
    .filter((e) => e.kind === 'message')
    .map((e) => e.payload as { role: string })
    .filter((p) => p.role === 'toolResult')
  expect(JSON.stringify(results)).not.toContain(secret)
  const spill = await readFile(join(dirs.dataDir, 'tool-results', sessionId, 'secret-spill.txt'), 'utf8')
  expect(spill.includes('[REDACTED:secret]')).toBe(true)
  expect(spill).toContain('ordinary line')
  expect(spill).not.toContain(secret)
  const running = await persisted(dirs)
  sidecar.child.kill('SIGTERM')
  expect(await sidecar.exited).toEqual({ code: 0, signal: null })
  const stopped = await persisted(dirs)
  expect(
    leaksIn(
      [...running, ...stopped].map((f) => [f.name, f.bytes]),
      { fixture: secret },
    ),
  ).toEqual([])
})
