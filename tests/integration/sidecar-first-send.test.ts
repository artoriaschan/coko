import { mkdir, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { API_ROUTES, apiPaths, hookPaths } from '@coko/protocol'
import { client, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

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
  expect(workspace.path.split('/').at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}-.+/)
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
