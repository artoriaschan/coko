// Recorded file details are checked through the real Sidecar, tools and persistence boundary.
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('file detail records match actual read, write, multi-edit and failure without changing unrelated bytes', async () => {
  const root = await realpath(await tempDir())
  await writeFile(join(root, 'source.txt'), 'alpha\nbeta\ngamma\n')
  await writeFile(join(root, 'untouched.txt'), Buffer.from([0, 255, 42, 10]))
  const call = (id: string, name: string, args: unknown) => ({ type: 'toolCall', id, name, arguments: args })
  const script = await fauxScript(root, {
    responses: [
      { content: [call('r', 'read', { path: 'source.txt', offset: 2, limit: 1 })] },
      { content: [call('w', 'write', { path: 'new.txt', content: 'original\n原文' })] },
      {
        content: [
          call('e', 'edit', {
            path: 'source.txt',
            edits: [
              { oldText: 'alpha', newText: 'ALPHA' },
              { oldText: 'gamma', newText: 'GAMMA' },
            ],
          }),
        ],
      },
      { content: [call('failed', 'read', { path: 'missing.txt' })] },
      { content: 'done' },
    ],
  })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const workspace = await api.post(API_ROUTES.workspaces, { path: root })
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id })).body.id as string
  await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'accept-edits' })
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((message) => message.type === 'subscribed')
  await api.post(apiPaths.sessionMessages(sessionId), { text: 'inspect and modify files' })
  await stream.waitFor(() => stream.entries(sessionId).some((entry) => entry.kind === 'run_end'))
  const entries = (await api.get(apiPaths.session(sessionId))).body.entries as SessionEntryRecord[]
  const records = entries
    .filter((entry) => entry.kind === 'message')
    .map(
      (entry) => entry.payload as { role: string; toolCallId: string; content: { type: string; text: string }[]; details?: { diff: string }; isError: boolean },
    )
  const result = (id: string) => records.find((record) => record.role === 'toolResult' && record.toolCallId === id)!
  expect(result('r').content[0]!.text).toBe('beta\n\n[2 more lines in file. Use offset=3 to continue.]')
  expect(result('w').content[0]!.text).toBe('Successfully wrote to new.txt')
  expect(await readFile(join(root, 'new.txt'), 'utf8')).toBe('original\n原文')
  expect(result('e').details?.diff).toContain('-1 alpha')
  expect(result('e').details?.diff).toContain('+1 ALPHA')
  expect(result('e').details?.diff).toContain('+3 GAMMA')
  expect(await readFile(join(root, 'source.txt'), 'utf8')).toBe('ALPHA\nbeta\nGAMMA\n')
  expect(result('failed').isError).toBe(true)
  expect(result('failed').content[0]!.text).toContain('ENOENT')
  expect(await readFile(join(root, 'untouched.txt'))).toEqual(Buffer.from([0, 255, 42, 10]))
  expect(stream.invalidEntries).toEqual([])
})
