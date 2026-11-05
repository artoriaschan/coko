import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, checkpointPaths, permissionPaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, waitApproval, type Stream } from './sidecar-harness.ts'

const call = (id: string, name: string, args: Record<string, unknown>) => ({ content: [{ type: 'toolCall', name, id, arguments: args }] })
const write = (id: string, path: string, content: string) => call(id, 'write', { path, content })
const results = (entries: SessionEntryRecord[]) => entries.filter((e) => e.kind === 'message' && (e.payload as { role?: string }).role === 'toolResult')
const ended = (stream: Stream, id: string, count: number) => stream.waitFor(() => stream.entries(id).filter((e) => e.kind === 'run_end').length >= count)
const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

async function boot(responses: unknown[], underTmp = false) {
  const root = await tempDir()
  const script = await fauxScript(root, { responses: [{ content: 'ready' }, ...responses] })
  const chatsRoot = underTmp ? await mkdtemp('/tmp/coko-chat-') : join(root, 'chats')
  if (underTmp) onTestFinished(() => rm(chatsRoot, { recursive: true, force: true }))
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script, COKO_CHATS_ROOT: chatsRoot } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const sent = await api.post(API_ROUTES.firstSend, { draftId: 'roots', text: 'warmup', permissionMode: 'accept-edits' })
  expect(sent.status).toBe(201)
  const session = sent.body.session
  const stream = await connect(sidecar, cookie)
  stream.send({ type: 'subscribe', sessionId: session.id, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed')
  await ended(stream, session.id, 1)
  return { root, api, stream, session }
}

it('独立会话 work/outputs 内写入和会话根读取免审批，根其他位置写入须单次审批', async () => {
  const { api, stream, session } = await boot([
    write('work', 'work.txt', 'intermediate'),
    write('output', '../outputs/result.txt', 'delivery'),
    call('edit', 'edit', { path: '../outputs/result.txt', oldText: 'delivery', newText: 'final' }),
    call('read', 'read', { path: '../readme.txt' }),
    write('root', '../root.txt', 'approved'),
    { content: 'done' },
  ])
  await writeFile(join(session.directory, 'readme.txt'), 'root is readable')
  await api.post(apiPaths.sessionMessages(session.id), { text: 'go' })
  await stream.waitFor(
    () => stream.entries(session.id).some((e) => e.kind === 'approval_request') || stream.entries(session.id).filter((e) => e.kind === 'run_end').length >= 2,
  )
  const request = stream.entries(session.id).find((e) => e.kind === 'approval_request')?.payload as
    | { requestId: string; toolCallId: string; suggestions: unknown[] }
    | undefined
  expect(request).toMatchObject({ toolCallId: 'root', suggestions: [] })
  expect(await readFile(join(session.cwd, 'work.txt'), 'utf8')).toBe('intermediate')
  expect(await readFile(join(session.directory, 'outputs/result.txt'), 'utf8')).toBe('final')
  expect(results(stream.entries(session.id)).find((e) => (e.payload as { toolCallId: string }).toolCallId === 'read')?.payload).toMatchObject({
    isError: false,
  })
  expect(await exists(join(session.directory, 'root.txt'))).toBe(false)
  const approval = apiPaths.sessionApproval(session.id, request!.requestId)
  expect((await api.post(approval, { decision: 'allow', scope: 'session' })).status).toBe(400)
  expect((await api.post(approval, { decision: 'allow' })).status).toBe(204)
  await ended(stream, session.id, 2)
  expect(await readFile(join(session.directory, 'root.txt'), 'utf8')).toBe('approved')
  expect(stream.entries(session.id).filter((e) => e.kind === 'approval_request')).toHaveLength(1)
})

it('outputs 的 write/edit 记录 checkpoint，回退到原内容且不误报为目录外文件', async () => {
  const { api, stream, session } = await boot([
    write('overwrite', '../outputs/result.txt', 'draft'),
    call('edit-delivery', 'edit', { path: '../outputs/result.txt', oldText: 'draft', newText: 'final' }),
    { content: 'done' },
  ])
  const path = join(session.directory, 'outputs/result.txt')
  await writeFile(path, 'original')
  await api.post(apiPaths.sessionMessages(session.id), { text: 'replace delivery' })
  await ended(stream, session.id, 2)
  expect(await readFile(path, 'utf8')).toBe('final')
  const target = stream
    .entries(session.id)
    .find(
      (e) =>
        e.kind === 'message' && (e.payload as { role?: string; content?: unknown }).role === 'user' && JSON.stringify(e.payload).includes('replace delivery'),
    )!
  const request = { targetSeq: target.seq, mode: 'code' }
  const preview = await api.post(checkpointPaths.sessionRewind(session.id), { ...request, dryRun: true })
  expect(preview.status).toBe(200)
  expect(preview.body.restored).toEqual([path])
  expect(preview.body.outside).toEqual([])
  const restored = await api.post(checkpointPaths.sessionRewind(session.id), request)
  expect(restored.status).toBe(200)
  expect(await readFile(path, 'utf8')).toBe('original')
})

it.each(['accept-edits', 'read-only'] as const)('%s 下拒绝会话根其他位置的写入，根内仍可读取', async (mode) => {
  const { api, stream, session } = await boot([
    call('read-root', 'read', { path: '../readme.txt' }),
    write('denied-root', '../denied.txt', 'no'),
    { content: 'done' },
  ])
  await writeFile(join(session.directory, 'readme.txt'), 'readable')
  await api.put(permissionPaths.sessionPermissionMode(session.id), { mode })
  await api.post(apiPaths.sessionMessages(session.id), { text: 'attempt write' })
  const request = await waitApproval(stream, session.id)
  expect(request).toMatchObject({ toolCallId: 'denied-root', suggestions: [] })
  await api.post(apiPaths.sessionApproval(session.id, request.requestId), { decision: 'deny' })
  await ended(stream, session.id, 2)
  expect(await exists(join(session.directory, 'denied.txt'))).toBe(false)
  expect(results(stream.entries(session.id)).find((e) => (e.payload as { toolCallId: string }).toolCallId === 'read-root')?.payload).toMatchObject({
    isError: false,
  })
})

it.skipIf(process.platform !== 'darwin')('会话根位于 /tmp 时 Seatbelt 仍只允许 work/outputs，不能借临时根授权写入会话根', async () => {
  const { api, stream, session } = await boot(
    [
      call('shell', 'bash', { command: 'printf work > work-shell.txt; printf deliver > ../outputs/shell.txt; printf blocked > ../root-shell.txt' }),
      call('remove', 'bash', { command: 'rm work-shell.txt ../outputs/shell.txt' }),
      { content: 'done' },
    ],
    true,
  )
  await api.post(apiPaths.sessionMessages(session.id), { text: 'shell proof' })
  const request = await waitApproval(stream, session.id)
  await api.post(apiPaths.sessionApproval(session.id, request.requestId), { decision: 'allow' })
  const removal = await waitApproval(stream, session.id, 2)
  expect(await readFile(join(session.cwd, 'work-shell.txt'), 'utf8')).toBe('work')
  expect(await readFile(join(session.directory, 'outputs/shell.txt'), 'utf8')).toBe('deliver')
  expect(await exists(join(session.directory, 'root-shell.txt'))).toBe(false)
  const result = results(stream.entries(session.id)).find((e) => (e.payload as { toolCallId: string }).toolCallId === 'shell')
  expect(result?.payload).toMatchObject({ isError: true, details: { sandbox: { mode: 'workspace-write', denied: true } } })
  await api.post(apiPaths.sessionApproval(session.id, removal.requestId), { decision: 'allow' })
  await ended(stream, session.id, 2)
  expect(await exists(join(session.cwd, 'work-shell.txt'))).toBe(false)
  expect(await exists(join(session.directory, 'outputs/shell.txt'))).toBe(false)
})

it('outputs 被替换为根外符号链接时不会授予链接目标写权限', async () => {
  const { api, stream, session } = await boot([write('link-write', '../outputs/no.txt', 'no'), { content: 'done' }])
  const outside = await tempDir()
  await rm(join(session.directory, 'outputs'), { recursive: true })
  await symlink(outside, join(session.directory, 'outputs'))
  await api.post(apiPaths.sessionMessages(session.id), { text: 'linked output' })
  const request = await waitApproval(stream, session.id)
  expect(request).toMatchObject({ toolCallId: 'link-write', suggestions: [] })
  await api.post(apiPaths.sessionApproval(session.id, request.requestId), { decision: 'deny' })
  await ended(stream, session.id, 2)
  expect(await exists(join(outside, 'no.txt'))).toBe(false)
})

it.skipIf(process.platform !== 'darwin')('read-only 的已批准命令仍不能写会话根', async () => {
  const { api, stream, session } = await boot([call('readonly-shell', 'bash', { command: 'printf blocked > ../readonly-root.txt' }), { content: 'done' }])
  await api.put(permissionPaths.sessionPermissionMode(session.id), { mode: 'read-only' })
  await api.post(apiPaths.sessionMessages(session.id), { text: 'read only shell' })
  const request = await waitApproval(stream, session.id)
  await api.post(apiPaths.sessionApproval(session.id, request.requestId), { decision: 'allow' })
  await ended(stream, session.id, 2)
  expect(await exists(join(session.directory, 'readonly-root.txt'))).toBe(false)
  expect(results(stream.entries(session.id)).find((e) => (e.payload as { toolCallId: string }).toolCallId === 'readonly-shell')?.payload).toMatchObject({
    isError: true,
    details: { sandbox: { mode: 'read-only', denied: true } },
  })
})
