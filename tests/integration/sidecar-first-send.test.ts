import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, checkpointPaths, handoffPaths, hookPaths } from '@coko/protocol'
import { client, exchange, fauxScript, pollUntil, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

it('首次发送创建专属目录并在消息持久化后返回；同一草稿并发与重启重试只有一个会话', async () => {
  const root = await tempDir()
  const chatsRoot = join(root, 'chats')
  const dirs = await sidecarDirs()
  const script = await fauxScript(root, { responses: [{ content: 'Ready.' }] })
  const env = { COKO_FAUX_SCRIPT: script, COKO_CHATS_ROOT: chatsRoot }
  const first = await startSidecar({ dirs, env })
  const api = client(first, await exchange(first))
  const input = {
    draftId: 'first-draft',
    text: '  Build a small calendar\nKeep it simple',
    permissionMode: 'accept-edits',
    model: { providerId: 'faux', modelId: 'faux-1' },
    thinkingLevel: 'off',
  }
  const [a, b] = await Promise.all([api.post('/api/chats/first-send', input), api.post('/api/chats/first-send', input)])
  expect(a.status).toBe(201)
  expect(b.status).toBe(201)
  expect(b.body.session.id).toBe(a.body.session.id)
  expect(b.body.runId).toBe(a.body.runId)
  const session = a.body.session
  expect(session).toMatchObject({ title: 'Build a small calend', projectId: null, model: input.model, thinkingLevel: 'off' })
  const workspace = (await api.get(API_ROUTES.workspaces)).body.workspaces[0]
  expect(workspace.id).toBe(session.workspaceId)
  expect(workspace.path.startsWith(await realpath(chatsRoot))).toBe(true)
  expect(basename(dirname(workspace.path))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(basename(workspace.path)).toBe(`chat-${session.id.slice(0, 12)}`)
  expect(session.directory).toBe(workspace.path)
  expect(session.cwd).toBe(join(workspace.path, 'work'))
  expect(workspace.name).toBe(`独立对话 · ${basename(dirname(workspace.path))}`)
  expect((await readdir(workspace.path)).sort()).toEqual(['outputs', 'work'])
  expect((await stat(workspace.path)).isDirectory()).toBe(true)
  expect((await api.get(API_ROUTES.projects)).body.projects).toHaveLength(0)
  const detail = (await api.get(apiPaths.session(session.id))).body
  expect(detail.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'permission_mode', payload: { mode: 'accept-edits' } }),
      expect.objectContaining({ kind: 'run_start', runId: a.body.runId }),
      expect.objectContaining({ kind: 'message', payload: expect.objectContaining({ role: 'user' }) }),
    ]),
  )
  expect((await api.put(apiPaths.sessionTitle(session.id), { title: 'Renamed title' })).status).toBe(200)
  expect((await api.get(API_ROUTES.workspaces)).body.workspaces[0].name).toBe(workspace.name)
  await first.stop()
  const second = await startSidecar({ dirs, env })
  const after = client(second, await exchange(second))
  const repeated = await after.post('/api/chats/first-send', input)
  expect(repeated.body.session.id).toBe(session.id)
  expect(repeated.body.runId).toBe(a.body.runId)
  expect((await after.get(API_ROUTES.sessions)).body.sessions).toHaveLength(1)
  expect(await readdir(chatsRoot)).toHaveLength(1)
})

it('Hook 拒绝与模型校验失败会清理本次目录、Workspace 和会话，同草稿可以修正重试', async () => {
  const root = await tempDir()
  const chatsRoot = join(root, 'chats')
  await mkdir(chatsRoot)
  const keep = join(chatsRoot, '2026-11-03-existing')
  await mkdir(keep)
  await writeFile(join(keep, 'work.txt'), 'keep')
  const script = await fauxScript(root, { responses: [{ content: 'Ready.' }] })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script, COKO_CHATS_ROOT: chatsRoot } })
  const api = client(sidecar, await exchange(sidecar))
  expect(
    (
      await api.put(hookPaths.hooks, {
        hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo rejected >&2; exit 2' }] }] },
        expectedRevision: 0,
      })
    ).status,
  ).toBe(200)
  const input = { draftId: 'rejected', text: 'hello' }
  const rejected = await api.post('/api/chats/first-send', input)
  expect([rejected.status, rejected.body.error.code]).toEqual([400, 'hook-blocked'])
  expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(0)
  expect((await api.get(API_ROUTES.workspaces)).body.workspaces).toHaveLength(0)
  expect(await readdir(chatsRoot)).toEqual(['2026-11-03-existing'])
  expect((await api.put(hookPaths.hooks, { hooks: {}, expectedRevision: 1 })).status).toBe(200)
  expect((await api.post('/api/chats/first-send', { ...input, model: { providerId: 'missing', modelId: 'missing' } })).status).toBe(400)
  expect(await readdir(chatsRoot)).toEqual(['2026-11-03-existing'])
  expect((await api.post('/api/chats/first-send', input)).status).toBe(201)
})

it('目录根创建失败不留会话；模型在首条消息接受后失败保留会话', async () => {
  const root = await tempDir()
  const chatsRoot = join(root, 'not-a-directory')
  await writeFile(chatsRoot, 'untouched')
  const script = await fauxScript(root, { responses: [{ content: [], stopReason: 'error', errorMessage: 'model unavailable' }] })
  const dirs = await sidecarDirs()
  const first = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, COKO_CHATS_ROOT: chatsRoot } })
  const api = client(first, await exchange(first))
  expect((await api.post('/api/chats/first-send', { draftId: 'failed-dir', text: 'hello' })).status).toBe(500)
  expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(0)
  await first.stop()
  const second = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, COKO_CHATS_ROOT: join(root, 'chats') } })
  const after = client(second, await exchange(second))
  const created = await after.post('/api/chats/first-send', { draftId: 'model-error', text: 'hello' })
  expect(created.status).toBe(201)
  expect((await after.get(API_ROUTES.sessions)).body.sessions).toHaveLength(1)
})

it('只有文件引用时标题为附件文件名，并校验空消息与草稿身份', async () => {
  const root = await tempDir()
  const script = await fauxScript(root, { responses: [{ content: 'Ready.' }] })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script, COKO_CHATS_ROOT: join(root, 'chats') } })
  const api = client(sidecar, await exchange(sidecar))
  expect((await api.post(API_ROUTES.firstSend, { draftId: 'files', text: '@a.ts @b.txt' })).body.session.title).toBe('附件：a.ts、b.txt')
  expect((await api.post(API_ROUTES.firstSend, { draftId: '', text: 'hello' })).status).toBe(400)
  expect((await api.post(API_ROUTES.firstSend, { draftId: 'blank', text: '  ' })).status).toBe(400)
  expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(1)
})

it('项目首次发送固定使用主要文件夹，拒绝后保留项目和源文件，同草稿并发只创建一个归属会话', async () => {
  const root = await tempDir()
  const folder = join(root, 'project')
  await mkdir(folder)
  await writeFile(join(folder, 'keep.txt'), 'untouched')
  const script = await fauxScript(root, { responses: [{ content: 'Project ready.' }] })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script, COKO_CHATS_ROOT: join(root, 'chats') } })
  const api = client(sidecar, await exchange(sidecar))
  const workspace = (await api.post(API_ROUTES.workspaces, { path: folder, name: 'Project' })).body
  const project = (await api.get(API_ROUTES.projects)).body.projects[0]
  const input = { draftId: 'project-draft', projectId: project.id, text: 'Project task' }
  await api.put(hookPaths.hooks, { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'exit 2' }] }] }, expectedRevision: 0 })
  expect((await api.post(API_ROUTES.firstSend, input)).body.error.code).toBe('hook-blocked')
  expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(0)
  expect((await api.get(API_ROUTES.workspaces)).body.workspaces).toHaveLength(1)
  expect(await readFile(join(folder, 'keep.txt'), 'utf8')).toBe('untouched')
  await api.put(hookPaths.hooks, { hooks: {}, expectedRevision: 1 })
  const [a, b] = await Promise.all([api.post(API_ROUTES.firstSend, input), api.post(API_ROUTES.firstSend, input)])
  expect(a.status).toBe(201)
  expect(a.body.session).toMatchObject({ projectId: project.id, workspaceId: workspace.id })
  expect(b.body.session.id).toBe(a.body.session.id)
  expect((await api.get(API_ROUTES.projects)).body.projects[0].sessionCount).toBe(1)
  expect((await api.post(API_ROUTES.firstSend, { draftId: 'missing-project', projectId: 'missing', text: 'hello' })).status).toBe(404)
  expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(1)
  expect((await api.get(API_ROUTES.workspaces)).body.workspaces[0].path).toBe(await realpath(folder))
})

it('独立会话在 work 中执行并收到交付目录指令；项目会话不注入该约定', async () => {
  const root = await tempDir()
  const requestLog = join(root, 'requests.jsonl')
  const script = await fauxScript(root, {
    requestLog,
    responses: [
      { content: [{ type: 'toolCall', name: 'write', id: 'cwd-proof', arguments: { path: 'cwd-proof.txt', content: 'work directory' } }] },
      { content: 'done' },
    ],
  })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script, COKO_CHATS_ROOT: join(root, 'chats') } })
  const api = client(sidecar, await exchange(sidecar))
  const sent = await api.post(API_ROUTES.firstSend, { draftId: 'work-instructions', text: 'create proof', permissionMode: 'accept-edits' })
  expect(sent.status).toBe(201)
  const session = sent.body.session
  await pollUntil(async () => (await api.get(apiPaths.session(session.id))).body.entries.some((entry: { kind: string }) => entry.kind === 'run_end'), {
    timeoutMs: 10000,
    what: 'run end',
  })
  expect(await readFile(join(session.directory, 'work', 'cwd-proof.txt'), 'utf8')).toBe('work directory')
  const sections = (await readFile(requestLog, 'utf8'))
    .trim()
    .split('\n')
    .flatMap((line) => JSON.parse(line))
    .find((message: { sections?: Record<string, string> }) => message.sections?.environment)?.sections
  expect(sections['standalone-directory']).toContain('Intermediate files')
  expect(sections['standalone-directory']).toContain(join(session.directory, 'outputs'))
  expect(sections['standalone-directory']).toContain('Do not create files elsewhere in the session directory')
  const projectFolder = join(root, 'project')
  await mkdir(projectFolder)
  await api.post(API_ROUTES.workspaces, { path: projectFolder })
  const project = (await api.get(API_ROUTES.projects)).body.projects[0]
  const projectSent = await api.post(API_ROUTES.firstSend, { draftId: 'project-instructions', projectId: project.id, text: 'project task' })
  expect(projectSent.body.session.directory).toBeNull()
  await pollUntil(
    async () => (await api.get(apiPaths.session(projectSent.body.session.id))).body.entries.some((entry: { kind: string }) => entry.kind === 'run_end'),
    { timeoutMs: 10000, what: 'run end' },
  )
  const projectRequest = (await readFile(requestLog, 'utf8'))
    .trim()
    .split('\n')
    .flatMap((line) => JSON.parse(line))
    .find((message: { sections?: Record<string, string> }) => message.sections?.environment?.includes(`Workspace: ${projectSent.body.session.cwd}`))
  expect(projectRequest.sections['standalone-directory']).toBeUndefined()
})

it('同日短目录冲突时回退完整 id，保留占用目录，不认领完整 id 已占用目录', async () => {
  const root = await tempDir()
  const chatsRoot = join(root, 'chats')
  const now = new Date()
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const idFor = (draft: string) => `chat-${createHash('sha256').update(draft).digest('hex')}`
  const id = idFor('collision')
  const day = join(chatsRoot, date)
  const occupied = join(day, `chat-${id.slice(0, 12)}`)
  await mkdir(occupied, { recursive: true })
  await writeFile(join(occupied, 'keep.txt'), 'keep')
  const script = await fauxScript(root, { responses: [{ content: 'done' }] })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script, COKO_CHATS_ROOT: chatsRoot } })
  const api = client(sidecar, await exchange(sidecar))
  const sent = await api.post(API_ROUTES.firstSend, { draftId: 'collision', text: 'hello' })
  expect(sent.status).toBe(201)
  expect(sent.body.session.directory).toBe(join(await realpath(day), id))
  expect(await readFile(join(occupied, 'keep.txt'), 'utf8')).toBe('keep')
  const blocked = idFor('both-occupied')
  await mkdir(join(day, `chat-${blocked.slice(0, 12)}`))
  await mkdir(join(day, blocked))
  await writeFile(join(day, blocked, 'keep.txt'), 'still here')
  expect((await api.post(API_ROUTES.firstSend, { draftId: 'both-occupied', text: 'hello' })).status).toBe(500)
  expect(await readFile(join(day, blocked, 'keep.txt'), 'utf8')).toBe('still here')
  expect((await api.get(API_ROUTES.sessions)).body.sessions).toHaveLength(1)
})

it('独立会话的分叉、当前目录交接和非隔离子代理保留固定 cwd 与会话目录', async () => {
  const root = await tempDir()
  const script = await fauxScript(root, {
    responses: [
      {
        match: 'PARENT',
        content: [{ type: 'toolCall', name: 'agent', id: 'delegate', arguments: { description: 'write proof', prompt: 'CHILD', subagent_type: 'general' } }],
      },
      { match: 'CHILD', content: [{ type: 'toolCall', name: 'write', id: 'child-write', arguments: { path: 'child.txt', content: 'child work' } }] },
      { match: 'CHILD', content: 'child done' },
      { match: 'PARENT', content: 'parent done' },
      { content: 'Summary for continuation' },
    ],
  })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script, COKO_CHATS_ROOT: join(root, 'chats') } })
  const api = client(sidecar, await exchange(sidecar))
  const sent = await api.post(API_ROUTES.firstSend, { draftId: 'continuations', text: 'PARENT', permissionMode: 'accept-edits' })
  expect(sent.status).toBe(201)
  const source = sent.body.session
  await pollUntil(async () => (await api.get(apiPaths.session(source.id))).body.entries.some((entry: { kind: string }) => entry.kind === 'run_end'), {
    timeoutMs: 15000,
    what: 'parent run',
  })
  const detail = (await api.get(apiPaths.session(source.id))).body
  const childId = detail.entries.find((entry: { kind: string }) => entry.kind === 'agent_start').payload.agentId
  const child = (await api.get(apiPaths.session(childId))).body.session
  expect(child).toMatchObject({ cwd: source.cwd, directory: source.directory })
  expect(await readFile(join(source.cwd, 'child.txt'), 'utf8')).toBe('child work')
  const targetSeq = detail.entries.find((entry: { kind: string; payload: { role?: string } }) => entry.kind === 'message' && entry.payload.role === 'user').seq
  const forked = await api.post(checkpointPaths.sessionFork(source.id), { targetSeq })
  expect(forked.status).toBe(201)
  expect((await api.get(apiPaths.session(forked.body.sessionId))).body.session).toMatchObject({ cwd: source.cwd, directory: source.directory })
  expect((await api.post(handoffPaths.handoff(source.id), { instructions: 'continue', target: { kind: 'current' } })).status).toBe(202)
  const targetId = await pollUntil(
    async () => (await api.get(apiPaths.session(source.id))).body.entries.find((entry: { kind: string }) => entry.kind === 'handoff')?.payload.targetSessionId,
    { timeoutMs: 10000, what: 'handoff' },
  )
  expect((await api.get(apiPaths.session(targetId))).body.session).toMatchObject({ cwd: source.cwd, directory: source.directory })
})
