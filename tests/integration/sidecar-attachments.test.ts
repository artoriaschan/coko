import { readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, checkpointPaths } from '@coko/protocol'
import { client, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('copies uploaded files on first send and preserves the copy reference after the source is removed', async () => {
  const root = await tempDir()
  const source = join(root, 'notes.txt')
  await writeFile(source, 'durable attachment body')
  const script = await fauxScript(root, { responses: [{ content: 'received' }] })
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const api = client(sidecar, await exchange(sidecar))
  const sent = await api.post(API_ROUTES.firstSend, { draftId: 'file-copy', text: 'Read this', files: [{ name: 'notes.txt', path: source }] })
  expect(sent.status).toBe(201)
  const copied = join(dirs.dataDir, 'attachments', sent.body.session.id)
  const names = await readdir(copied)
  expect(names).toHaveLength(1)
  expect(names[0]).toMatch(/^[a-f0-9-]+-notes\.txt$/)
  await rm(source)
  expect(await readFile(join(copied, names[0]!), 'utf8')).toBe('durable attachment body')
  const detail = await api.get(apiPaths.session(sent.body.session.id))
  const messages = detail.body.entries.filter((entry: { kind: string }) => entry.kind === 'message')
  expect(JSON.stringify(messages)).toContain(join(copied, names[0]!))
  expect(JSON.stringify(messages)).not.toContain(source)
})

it('rejects oversized or missing uploads without a message or partial copies and allows retrying the same draft', async () => {
  const root = await tempDir()
  const small = join(root, 'small.txt')
  const large = join(root, 'large.txt')
  await writeFile(small, 'keep')
  await writeFile(large, '')
  await truncate(large, 32 * 1024 * 1024 + 1)
  const script = await fauxScript(root, { responses: [{ content: 'retry accepted' }] })
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const api = client(sidecar, await exchange(sidecar))
  for (const path of [large, join(root, 'missing.txt')]) {
    const rejected = await api.post(API_ROUTES.firstSend, {
      draftId: 'retry-copy',
      text: '',
      files: [
        { name: 'small.txt', path: small },
        { name: 'second.txt', path },
      ],
    })
    expect(rejected.status).toBe(400)
    expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(0)
    expect(await readdir(join(dirs.dataDir, 'attachments')).catch(() => [])).toEqual([])
  }
  const sent = await api.post(API_ROUTES.firstSend, { draftId: 'retry-copy', text: '', files: [{ name: 'small.txt', path: small }] })
  expect(sent.status).toBe(201)
  expect(sent.body.session.title).toBe('附件：small.txt')
})

it('copies image bytes and pasted file data and persists their copied paths in existing-session history', async () => {
  const root = await tempDir()
  const script = await fauxScript(root, { input: ['text', 'image'], responses: [{ content: 'copied' }] })
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const api = client(sidecar, await exchange(sidecar))
  const workspace = await api.post(API_ROUTES.workspaces, { path: root })
  const session = await api.post(API_ROUTES.sessions, { workspaceId: workspace.body.id })
  const image = {
    name: 'pixel.png',
    mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1cAAAAASUVORK5CYII=',
  }
  const sent = await api.post(apiPaths.sessionMessages(session.body.id), {
    text: 'inspect',
    images: [image],
    files: [{ name: 'pasted.txt', data: Buffer.from('pasted content').toString('base64') }],
  })
  expect(sent.status).toBe(202)
  const copyRoot = join(dirs.dataDir, 'attachments', session.body.id)
  const names = await readdir(copyRoot)
  expect(names).toHaveLength(2)
  expect(
    await readFile(
      join(
        copyRoot,
        names.find((name) => name.endsWith('-pixel.png'))!,
      ),
    ),
  ).toEqual(Buffer.from(image.data, 'base64'))
  expect(
    await readFile(
      join(
        copyRoot,
        names.find((name) => name.endsWith('-pasted.txt'))!,
      ),
      'utf8',
    ),
  ).toBe('pasted content')
  await expect.poll(async () => JSON.stringify((await api.get(apiPaths.session(session.body.id))).body.entries)).toContain(copyRoot)
})

it('reads the current session copied attachment through the real read tool without approval after restart', async () => {
  const root = await tempDir()
  const source = join(root, 'read-me.txt')
  await writeFile(source, 'CURRENT_ATTACHMENT_BODY')
  const initialScript = await fauxScript(root, { responses: [{ content: 'stored' }] })
  const dirs = await sidecarDirs()
  let sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: initialScript } })
  let api = client(sidecar, await exchange(sidecar))
  const sent = await api.post(API_ROUTES.firstSend, {
    draftId: 'read-copy',
    text: 'store',
    permissionMode: 'read-only',
    files: [{ name: 'read-me.txt', path: source }],
  })
  const id = sent.body.session.id
  const copies = join(dirs.dataDir, 'attachments', id)
  const copy = join(copies, (await readdir(copies))[0]!)
  await sidecar.stop()
  await rm(source)
  const readScript = await fauxScript(root, {
    responses: [{ content: [{ type: 'toolCall', id: 'read-copy', name: 'read', arguments: { path: copy } }] }, { content: 'read it' }],
  })
  sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: readScript } })
  api = client(sidecar, await exchange(sidecar))
  expect((await api.post(apiPaths.sessionMessages(id), { text: 'read copied file' })).status).toBe(202)
  await expect.poll(async () => JSON.stringify((await api.get(apiPaths.session(id))).body.entries)).toContain('CURRENT_ATTACHMENT_BODY')
  const detail = await api.get(apiPaths.session(id))
  expect(detail.body.entries.filter((entry: { kind: string }) => entry.kind === 'approval_request')).toHaveLength(0)
})

it('forks copied attachments into the new session before the source session and its files are deleted', async () => {
  const root = await tempDir()
  const source = join(root, 'branch.txt')
  await writeFile(source, 'FORK_ATTACHMENT_BODY')
  const script = await fauxScript(root, { responses: [{ content: 'ready to fork' }] })
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const api = client(sidecar, await exchange(sidecar))
  const sent = await api.post(API_ROUTES.firstSend, { draftId: 'fork-copy', text: 'keep this', files: [{ name: 'branch.txt', path: source }] })
  const sourceId = sent.body.session.id
  await expect.poll(async () => (await api.get(apiPaths.session(sourceId))).body.session.running).toBe(false)
  const detail = await api.get(apiPaths.session(sourceId))
  const assistant = detail.body.entries.find(
    (entry: { kind: string; payload: { role?: string } }) => entry.kind === 'message' && entry.payload.role === 'assistant',
  )
  const forked = await api.post(checkpointPaths.sessionFork(sourceId), { targetSeq: assistant.seq, boundary: 'assistant-inclusive' })
  expect(forked.status).toBe(201)
  const forkId = forked.body.sessionId
  const forkRoot = join(dirs.dataDir, 'attachments', forkId)
  const names = await readdir(forkRoot)
  expect(names).toHaveLength(1)
  expect(await readFile(join(forkRoot, names[0]!), 'utf8')).toBe('FORK_ATTACHMENT_BODY')
  expect((await api.delete(apiPaths.session(sourceId))).status).toBe(200)
  await rm(join(dirs.dataDir, 'attachments', sourceId), { recursive: true, force: true })
  const retained = await api.get(apiPaths.session(forkId))
  expect(JSON.stringify(retained.body.entries)).toContain(forkRoot)
  expect(JSON.stringify(retained.body.entries)).not.toContain(join(dirs.dataDir, 'attachments', sourceId))
  expect(await readFile(join(forkRoot, names[0]!), 'utf8')).toBe('FORK_ATTACHMENT_BODY')
})

it('rolls back the new fork and all its copies when a later inherited attachment cannot be copied', async () => {
  const root = await tempDir()
  const a = join(root, 'a.txt')
  const b = join(root, 'b.txt')
  await writeFile(a, 'first')
  await writeFile(b, 'second')
  const script = await fauxScript(root, { responses: [{ content: 'ready' }] })
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const api = client(sidecar, await exchange(sidecar))
  const sent = await api.post(API_ROUTES.firstSend, {
    draftId: 'fork-failure',
    text: 'keep',
    files: [
      { name: 'a.txt', path: a },
      { name: 'b.txt', path: b },
    ],
  })
  const id = sent.body.session.id
  await expect.poll(async () => (await api.get(apiPaths.session(id))).body.session.running).toBe(false)
  const copies = join(dirs.dataDir, 'attachments', id)
  const names = await readdir(copies)
  await truncate(
    join(
      copies,
      names.find((name) => name.endsWith('-b.txt'))!,
    ),
    32 * 1024 * 1024 + 1,
  )
  const detail = await api.get(apiPaths.session(id))
  const assistant = detail.body.entries.find(
    (entry: { kind: string; payload: { role?: string } }) => entry.kind === 'message' && entry.payload.role === 'assistant',
  )
  const rejected = await api.post(checkpointPaths.sessionFork(id), { targetSeq: assistant.seq, boundary: 'assistant-inclusive' })
  expect(rejected.status).toBe(400)
  expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(1)
  expect(await readdir(join(dirs.dataDir, 'attachments'))).toEqual([id])
  expect(
    await readFile(
      join(
        copies,
        names.find((name) => name.endsWith('-a.txt'))!,
      ),
      'utf8',
    ),
  ).toBe('first')
})
