import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths } from '@coko/protocol'
import { client, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

const image = { name: 'pixel.png', mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1cAAAAASUVORK5CYII=' }
it('accepts image-only first send, persists image blocks and sends them to the model', async () => {
  const root = await tempDir()
  const log = join(root, 'requests.jsonl')
  const script = await fauxScript(root, { input: ['text', 'image'], requestLog: log, responses: [{ content: 'seen' }] })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const api = client(sidecar, await exchange(sidecar))
  const result = await api.post(API_ROUTES.firstSend, { draftId: 'image-only', text: '', images: [image] })
  expect(result.status).toBe(201)
  expect(result.body.session.title).toBe('附件：pixel.png')
  const detail = await api.get(apiPaths.session(result.body.session.id))
  expect(detail.body.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'message',
        payload: expect.objectContaining({
          role: 'user',
          content: expect.arrayContaining([expect.objectContaining({ type: 'image', data: image.data, mimeType: image.mimeType })]),
        }),
      }),
    ]),
  )
  await expect.poll(async () => readFile(log, 'utf8').catch(() => '')).toContain(image.data)
})
it('rejects malformed image bytes and images over the read limit without creating a session', async () => {
  const root = await tempDir()
  const script = await fauxScript(root, { input: ['text', 'image'], responses: [{ content: 'unused' }] })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const api = client(sidecar, await exchange(sidecar))
  for (const [draftId, candidate] of [
    ['invalid', { ...image, data: 'aGVsbG8=' }],
    ['large', { ...image, data: Buffer.alloc(4.5 * 1024 * 1024 + 1).toString('base64') }],
  ] as const) {
    expect((await api.post(API_ROUTES.firstSend, { draftId, text: '', images: [candidate] })).status).toBe(400)
  }
  expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(0)
})

it('server rejects images for a text-only model in new and existing sessions', async () => {
  const root = await tempDir()
  const script = await fauxScript(root, { responses: [{ content: 'unused' }] })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const api = client(sidecar, await exchange(sidecar))
  const rejected = await api.post(API_ROUTES.firstSend, { draftId: 'unsupported', text: '', images: [image] })
  expect(rejected.status).toBe(400)
  expect(rejected.body.error.message).toContain('does not support image input')
  expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(0)
  const workspace = await api.post(API_ROUTES.workspaces, { path: root })
  const session = await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id })
  expect((await api.post(apiPaths.sessionMessages(session.body.id), { text: 'look', images: [image] })).status).toBe(400)
  expect(
    (await api.get(apiPaths.session(session.body.id))).body.entries.filter((entry: { kind: string }) => entry.kind === 'message' || entry.kind === 'run_start'),
  ).toHaveLength(0)
})
