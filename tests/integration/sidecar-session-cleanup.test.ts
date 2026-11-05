import { access, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths } from '@coko/protocol'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

async function setup() {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const sidecar = await startSidecar({
    dirs,
    env: { COKO_CHATS_ROOT: join(root, 'chats'), COKO_FAUX_SCRIPT: await fauxScript(root, { responses: [{ content: 'Ready.' }] }) },
  })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const create = async (draftId: string) => {
    const created = await api.post(API_ROUTES.firstSend, { draftId, text: 'hello' })
    expect(created.status).toBe(201)
    const session = created.body.session as { id: string; directory: string; cwd: string; workspaceId: string }
    stream.send({ type: 'subscribe', sessionId: session.id, afterSeq: 0 })
    await stream.waitFor(isRunEnd(session.id))
    return session
  }
  return { root, dirs, api, create }
}

it('deleting an empty standalone session removes its directory and unused Workspace', async () => {
  const { api, create } = await setup()
  const session = await create('empty-cleanup')
  expect((await api.get(`${apiPaths.session(session.id)}/delete-preview`)).body).toEqual({ retainedDirectories: [] })
  expect((await api.delete(apiPaths.session(session.id))).status).toBe(200)
  await expect(access(session.directory)).rejects.toThrow(/ENOENT/)
  expect((await api.get(API_ROUTES.workspaces)).body.workspaces).toEqual([])
})

it('nonempty roots, hidden files and symlinks are preserved; only per-session data is removed', async () => {
  const { api, create, dirs, root } = await setup()
  for (const name of ['work', 'outputs', 'root', 'hidden', 'symlink']) {
    const session = await create(`preserve-${name}`)
    const path =
      name === 'work' || name === 'outputs' ? join(session.directory, name, 'keep.txt') : join(session.directory, name === 'hidden' ? '.hidden' : 'keep.txt')
    if (name === 'symlink') {
      const target = join(root, 'external.txt')
      await writeFile(target, 'external')
      await symlink(target, path)
    } else await writeFile(path, 'keep')
    const preview = await api.get(`${apiPaths.session(session.id)}/delete-preview`)
    expect(preview.body).toEqual({ retainedDirectories: [session.directory] })
    for (const kind of ['attachments', 'tool-results', 'mcp']) {
      await mkdir(join(dirs.dataDir, kind, session.id), { recursive: true })
      await writeFile(join(dirs.dataDir, kind, session.id, 'kept.txt'), kind)
    }
    expect((await api.delete(apiPaths.session(session.id))).status).toBe(200)
    expect(await readFile(path, 'utf8')).toBe(name === 'symlink' ? 'external' : 'keep')
    expect((await api.get(API_ROUTES.workspaces)).body.workspaces.some((workspace: { id: string }) => workspace.id === session.workspaceId)).toBe(true)
    for (const kind of ['attachments', 'tool-results']) await expect(access(join(dirs.dataDir, kind, session.id))).rejects.toThrow(/ENOENT/)
    expect(await readFile(join(dirs.dataDir, 'mcp', session.id, 'kept.txt'), 'utf8')).toBe('mcp')
  }
})

it('archive and restore preserve all files, and a shared standalone root survives until its last Session is deleted', async () => {
  const { api, create, dirs } = await setup()
  const session = await create('archive-shared')
  const attachment = join(dirs.dataDir, 'attachments', session.id, 'keep.txt')
  const result = join(dirs.dataDir, 'tool-results', session.id, 'keep.txt')
  for (const path of [attachment, result]) {
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, 'preserved')
  }
  expect((await api.post(apiPaths.sessionArchive(session.id), {})).status).toBe(200)
  expect(await readdir(session.directory)).toEqual(['outputs', 'work'])
  expect(await readFile(attachment, 'utf8')).toBe('preserved')
  expect(await readFile(result, 'utf8')).toBe('preserved')
  expect((await api.post(apiPaths.sessionRestore(session.id), {})).status).toBe(200)
  const detail = (await api.get(apiPaths.session(session.id))).body
  const assistant = detail.entries.find((entry: { kind: string; payload: { role?: string } }) => entry.kind === 'message' && entry.payload.role === 'assistant')
  const fork = await api.post(`${apiPaths.session(session.id)}/fork`, { targetSeq: assistant.seq, boundary: 'assistant-inclusive' })
  expect(fork.status).toBe(201)
  expect((await api.get(`${apiPaths.session(session.id)}/delete-preview`)).body).toEqual({ retainedDirectories: [session.directory] })
  expect((await api.delete(apiPaths.session(session.id))).status).toBe(200)
  expect(await readdir(session.directory)).toEqual(['outputs', 'work'])
  expect((await api.get(API_ROUTES.workspaces)).body.workspaces.some((workspace: { id: string }) => workspace.id === session.workspaceId)).toBe(true)
  expect((await api.delete(apiPaths.session(fork.body.sessionId))).status).toBe(200)
  await expect(access(session.directory)).rejects.toThrow(/ENOENT/)
  expect((await api.get(API_ROUTES.workspaces)).body.workspaces).toEqual([])
})

it('a fork owns inherited tool-result files after its source is deleted and can read them after restart', async () => {
  const root = await tempDir()
  const dirs = await sidecarDirs()
  const script = await fauxScript(root, {
    responses: [{ content: [{ type: 'toolCall', name: 'bash', id: 'long-result', arguments: { command: 'seq 1 2500' } }] }, { content: 'Done.' }],
  })
  const first = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(first)
  const api = client(first, cookie)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: root })).body
  const source = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body
  await api.put(`${apiPaths.session(source.id)}/permission-mode`, { mode: 'full-access' })
  const stream = await connect(first, cookie)
  stream.send({ type: 'subscribe', sessionId: source.id, afterSeq: 0 })
  await api.post(apiPaths.sessionMessages(source.id), { text: 'long output' })
  await stream.waitFor(isRunEnd(source.id))
  const detail = (await api.get(apiPaths.session(source.id))).body
  const assistant = detail.entries
    .filter((entry: { kind: string; payload: { role?: string } }) => entry.kind === 'message' && entry.payload.role === 'assistant')
    .at(-1)
  const fork = await api.post(`${apiPaths.session(source.id)}/fork`, { targetSeq: assistant.seq, boundary: 'assistant-inclusive' })
  expect(fork.status).toBe(201)
  const path = join(dirs.dataDir, 'tool-results', fork.body.sessionId, 'long-result.txt')
  expect(JSON.stringify((await api.get(apiPaths.session(fork.body.sessionId))).body.entries)).toContain(path)
  expect(await readFile(path, 'utf8')).toBe(Array.from({ length: 2500 }, (_, i) => `${i + 1}\n`).join(''))
  expect((await api.delete(apiPaths.session(source.id))).status).toBe(200)
  await expect(access(join(dirs.dataDir, 'tool-results', source.id))).rejects.toThrow(/ENOENT/)
  await first.stop()
  const second = await startSidecar({
    dirs,
    env: {
      COKO_FAUX_SCRIPT: await fauxScript(root, {
        responses: [{ content: [{ type: 'toolCall', name: 'read', id: 'read-copy', arguments: { path, offset: 1, limit: 1 } }] }, { content: 'Read.' }],
      }),
    },
  })
  const secondCookie = await exchange(second)
  const after = client(second, secondCookie)
  await after.put(`${apiPaths.session(fork.body.sessionId)}/permission-mode`, { mode: 'read-only' })
  const afterStream = await connect(second, secondCookie)
  afterStream.send({ type: 'subscribe', sessionId: fork.body.sessionId, afterSeq: 0 })
  await after.post(apiPaths.sessionMessages(fork.body.sessionId), { text: 'read inherited output' })
  await afterStream.waitFor(isRunEnd(fork.body.sessionId))
  expect(afterStream.entries(fork.body.sessionId).filter((entry) => entry.kind === 'approval_request')).toEqual([])
  const read = afterStream
    .entries(fork.body.sessionId)
    .find(
      (entry) =>
        entry.kind === 'message' &&
        typeof entry.payload === 'object' &&
        entry.payload !== null &&
        'toolCallId' in entry.payload &&
        entry.payload.toolCallId === 'read-copy',
    )
  expect(read?.payload).toMatchObject({
    role: 'toolResult',
    isError: false,
    content: [{ type: 'text', text: '1\n\n[2500 more lines in file. Use offset=2 to continue.]' }],
  })
})

it('deletion checks disk again after the preview and preserves a directory used by a project', async () => {
  const { api, create } = await setup()
  const session = await create('changed-after-preview')
  expect((await api.get(`${apiPaths.session(session.id)}/delete-preview`)).body).toEqual({ retainedDirectories: [] })
  await writeFile(join(session.directory, 'outputs', 'late.txt'), 'created after preview')
  expect((await api.delete(apiPaths.session(session.id))).status).toBe(200)
  expect(await readFile(join(session.directory, 'outputs', 'late.txt'), 'utf8')).toBe('created after preview')
  const projectSession = await create('project-bound-directory')
  const project = await api.post(API_ROUTES.projects, { name: 'Keep project', folders: [{ path: projectSession.directory, primary: true }] })
  expect(project.status).toBe(201)
  expect((await api.delete(apiPaths.session(projectSession.id))).status).toBe(200)
  expect(await readdir(projectSession.directory)).toEqual(['outputs', 'work'])
  expect((await api.get(API_ROUTES.workspaces)).body.workspaces.some((workspace: { id: string }) => workspace.id === projectSession.workspaceId)).toBe(true)
})
