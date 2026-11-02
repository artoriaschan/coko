// Run 的 Project 根快照：真实 Sidecar 协议与文件结果；Seatbelt 仅在 darwin 运行。
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, permissionPaths, hookPaths, mcpPaths, skillPaths, worktreePaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, waitApproval, type Stream } from './sidecar-harness.ts'
import { createGitWorkspace } from '../fixtures/git/index.ts'

const call = (name: string, id: string, args: unknown) => ({ type: 'toolCall', name, id, arguments: args })
const read = (id: string, path: string) => call('read', id, { path })
const write = (id: string, path: string) => call('write', id, { path, content: 'changed' })
const approvals = (stream: Stream, id: string) => stream.entries(id).filter((e) => e.kind === 'approval_request')
const results = (entries: SessionEntryRecord[]) =>
  entries.flatMap((e) =>
    e.kind === 'message' && (e.payload as { role?: string }).role === 'toolResult'
      ? [e.payload as { toolCallId: string; isError: boolean; content: { text?: string }[] }]
      : [],
  )
const resultText = (result: { content: { text?: string }[] }) => result.content.map((b) => b.text ?? '').join('')
const ends = (stream: Stream, id: string) => stream.entries(id).filter((e) => e.kind === 'run_end').length

async function boot(
  build: (paths: { root: string; primary: string; extra: string; outside: string }) => unknown[],
  setup?: (paths: { primary: string; extra: string; outside: string }) => Promise<void>,
) {
  const root = await realpath(await mkdtemp(join(homedir(), '.coko-project-permissions-test-')))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  // Sidecar has no TMPDIR: this host temp directory must not be its intentional /tmp write capability.
  expect(root.startsWith((await realpath('/tmp')) + '/')).toBe(false)
  const primary = join(root, 'primary'),
    extra = join(root, 'extra'),
    outside = join(root, 'outside')
  await Promise.all([primary, extra, outside].map((p) => mkdir(p)))
  await Promise.all([primary, extra, outside].map((p) => writeFile(join(p, 'note.txt'), p)))
  await setup?.({ primary, extra, outside })
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses: build({ root, primary, extra, outside }) })
  const sidecar = await startSidecar({ dirs: await sidecarDirs(), env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar),
    api = client(sidecar, cookie),
    stream = await connect(sidecar, cookie)
  const created = await api.post(API_ROUTES.projects, {
    name: 'Project',
    folders: [
      { path: primary, primary: true },
      { path: extra, primary: false },
    ],
  })
  expect(created.status).toBe(201)
  const project = created.body.project
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: project.primaryWorkspaceId })).body.id as string
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  return { requestLog, root, primary, extra, outside, sidecar, api, stream, project, sessionId }
}

it('default：附加文件夹读取免审批，写入仍询问，批准后文件改变', async () => {
  const h = await boot(({ extra }) => [
    { content: [read('r1', join(extra, 'note.txt'))] },
    { content: [write('w1', join(extra, 'new.txt'))] },
    { content: 'done' },
  ])
  await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'go' })
  const ask = await waitApproval(h.stream, h.sessionId)
  expect(ask.toolCallId).toBe('w1')
  expect(resultText(results(h.stream.entries(h.sessionId))[0]!)).toContain(h.extra)
  await h.api.post(apiPaths.sessionApproval(h.sessionId, ask.requestId), { decision: 'allow' })
  await h.stream.waitFor(() => ends(h.stream, h.sessionId) === 1)
  expect(await readFile(join(h.extra, 'new.txt'), 'utf8')).toBe('changed')
  expect(approvals(h.stream, h.sessionId)).toHaveLength(1)
})

it.each(['read-only', 'plan'] as const)('%s：附加根写入仍需审批', async (mode) => {
  const h = await boot(({ extra }) => [{ content: [write('w1', join(extra, 'new.txt'))] }, { content: 'done' }])
  await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode })
  await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'go' })
  expect((await waitApproval(h.stream, h.sessionId)).toolCallId).toBe('w1')
  await h.api.post(apiPaths.sessionAbort(h.sessionId))
  expect(
    await access(join(h.extra, 'new.txt')).then(
      () => true,
      () => false,
    ),
  ).toBe(false)
})

it('accept-edits：附加根内普通写入免审批', async () => {
  const h = await boot(({ extra }) => [{ content: [write('w1', join(extra, 'new.txt'))] }, { content: 'done' }])
  await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'accept-edits' })
  await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'go' })
  await h.stream.waitFor(() => approvals(h.stream, h.sessionId).length > 0 || ends(h.stream, h.sessionId) > 0)
  expect(approvals(h.stream, h.sessionId)).toHaveLength(0)
  expect(await readFile(join(h.extra, 'new.txt'), 'utf8')).toBe('changed')
})

it('附加根不绕过拒绝、受保护路径或外向符号链接；目录结果也过滤拒绝项', async () => {
  const h = await boot(
    ({ extra }) => [
      { content: [read('deny-read', join(extra, 'secret.txt')), write('deny-write', join(extra, 'secret.txt'))] },
      { content: [call('grep', 'grep', { pattern: 'needle', path: extra })] },
      { content: [write('protected', join(extra, '.git', 'config'))] },
      { content: [read('link-read', join(extra, 'link', 'note.txt'))] },
      { content: [write('link-write', join(extra, 'link', 'note.txt'))] },
      { content: 'done' },
    ],
    async ({ extra, outside }) => {
      await mkdir(join(extra, '.git'))
      await writeFile(join(extra, '.git', 'config'), 'guarded')
      await writeFile(join(extra, 'secret.txt'), 'needle secret')
      await writeFile(join(extra, 'open.txt'), 'needle open')
      await symlink(outside, join(extra, 'link'))
    },
  )
  await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'accept-edits' })
  for (const tool of ['Read', 'Edit'])
    expect(
      (await h.api.post(permissionPaths.sessionPermissionRules(h.sessionId), { rule: { behavior: 'deny', tool, content: join(h.extra, 'secret.txt') } }))
        .status,
    ).toBe(200)
  await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'go' })
  for (const [index, id] of ['protected', 'link-read', 'link-write'].entries()) {
    const ask = await waitApproval(h.stream, h.sessionId, index + 1)
    expect(ask.toolCallId).toBe(id)
    await h.api.post(apiPaths.sessionApproval(h.sessionId, ask.requestId), { decision: 'deny', feedback: 'Keep it unchanged and continue' })
  }
  await h.stream.waitFor(() => ends(h.stream, h.sessionId) === 1)
  const out = results(h.stream.entries(h.sessionId))
  for (const id of ['deny-read', 'deny-write']) expect(resultText(out.find((r) => r.toolCallId === id)!)).toContain('Permission denied by rule')
  expect(resultText(out.find((r) => r.toolCallId === 'grep')!)).toContain('needle open')
  expect(resultText(out.find((r) => r.toolCallId === 'grep')!)).not.toContain('needle secret')
  expect(await readFile(join(h.extra, 'secret.txt'), 'utf8')).toBe('needle secret')
  expect(await readFile(join(h.extra, '.git', 'config'), 'utf8')).toBe('guarded')
  expect(await readFile(join(h.outside, 'note.txt'), 'utf8')).toBe(h.outside)
})

it('Run 中移出项目不改变本次根快照，下个 Run 收回；原 cwd 保留', async () => {
  const h = await boot(({ extra }) => [
    { content: [write('barrier', 'barrier.txt')] },
    { content: [read('same-run', join(extra, 'note.txt'))] },
    { content: 'one' },
    { content: [read('next-run', join(extra, 'note.txt'))] },
    { content: 'two' },
  ])
  await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'one' })
  const barrier = await waitApproval(h.stream, h.sessionId)
  expect(barrier.toolCallId).toBe('barrier')
  expect((await h.api.put(apiPaths.sessionProject(h.sessionId), { projectId: null })).status).toBe(200)
  await h.api.post(apiPaths.sessionApproval(h.sessionId, barrier.requestId), { decision: 'allow' })
  await h.stream.waitFor(() => ends(h.stream, h.sessionId) === 1)
  expect(approvals(h.stream, h.sessionId)).toHaveLength(1)
  expect(resultText(results(h.stream.entries(h.sessionId)).find((r) => r.toolCallId === 'same-run')!)).toContain(h.extra)
  expect(await readFile(join(h.primary, 'barrier.txt'), 'utf8')).toBe('changed')
  await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'two' })
  expect((await waitApproval(h.stream, h.sessionId, 2)).toolCallId).toBe('next-run')
  await h.api.post(apiPaths.sessionAbort(h.sessionId))
})

it('独立对话移入项目包含主要文件夹，读取免审批、写入询问；执行 cwd 仍是专属目录', async () => {
  const h = await boot(({ primary }) => [
    { content: 'standalone' },
    { content: [read('main-read', join(primary, 'note.txt'))] },
    { content: [write('main-write', join(primary, 'moved.txt'))] },
    { content: [write('cwd-write', 'cwd.txt')] },
    { content: 'done' },
  ])
  const created = await h.api.post(API_ROUTES.firstSend, { draftId: 'standalone', text: 'hello' })
  expect(created.status).toBe(201)
  const id = created.body.session.id as string
  h.stream.send({ type: 'subscribe', sessionId: id, afterSeq: 0 })
  await h.stream.waitFor(() => ends(h.stream, id) === 1)
  const workspace = (await h.api.get(API_ROUTES.workspaces)).body.workspaces.find((w: { id: string }) => w.id === created.body.session.workspaceId)
  expect((await h.api.put(apiPaths.sessionProject(id), { projectId: h.project.id })).status).toBe(200)
  await h.api.post(apiPaths.sessionMessages(id), { text: 'moved' })
  for (const [index, toolCallId] of ['main-write', 'cwd-write'].entries()) {
    const ask = await waitApproval(h.stream, id, index + 1)
    expect(ask.toolCallId).toBe(toolCallId)
    await h.api.post(apiPaths.sessionApproval(id, ask.requestId), { decision: 'allow' })
  }
  await h.stream.waitFor(() => ends(h.stream, id) === 2)
  expect(await readFile(join(h.primary, 'moved.txt'), 'utf8')).toBe('changed')
  expect(await readFile(join(workspace.path, 'cwd.txt'), 'utf8')).toBe('changed')
  expect((await h.api.get(apiPaths.session(id))).body.session.workspaceId).toBe(workspace.id)
})

it.skipIf(process.platform !== 'darwin')('darwin Seatbelt：批准 bash 后可写附加根，保护路径与外向链接仍被拒绝（其他平台无 Seatbelt）', async () => {
  const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'"
  const h = await boot(
    ({ extra }) => [
      { content: [call('bash', 'b1', { command: `printf shell > ${quote(join(extra, 'shell.txt'))}` })] },
      { content: [call('bash', 'b2', { command: `printf bad > ${quote(join(extra, '.git', 'config'))}` })] },
      { content: [call('bash', 'b3', { command: `printf bad > ${quote(join(extra, 'link', 'note.txt'))}` })] },
      { content: 'done' },
    ],
    async ({ extra, outside }) => {
      await mkdir(join(extra, '.git'))
      await writeFile(join(extra, '.git', 'config'), 'guarded')
      await symlink(outside, join(extra, 'link'))
    },
  )
  await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'go' })
  for (const n of [1, 2, 3]) {
    const ask = await waitApproval(h.stream, h.sessionId, n)
    expect(ask.toolCallId).toBe(`b${n}`)
    await h.api.post(apiPaths.sessionApproval(h.sessionId, ask.requestId), { decision: 'allow' })
  }
  await h.stream.waitFor(() => ends(h.stream, h.sessionId) === 1)
  expect(await readFile(join(h.extra, 'shell.txt'), 'utf8')).toBe('shell')
  for (const id of ['b2', 'b3'])
    expect(resultText(results(h.stream.entries(h.sessionId)).find((r) => r.toolCallId === id)!)).toContain(
      '[sandbox: file access denied under workspace-write mode]',
    )
  expect(await readFile(join(h.extra, '.git', 'config'), 'utf8')).toBe('guarded')
  expect(await readFile(join(h.outside, 'note.txt'), 'utf8')).toBe(h.outside)
})

it('附加文件夹只提供文件能力，指令、设置、Hook、MCP 与 Skills 仍从 cwd 发现', async () => {
  const h = await boot(
    ({ extra }) => [{ content: [read('resource-read', join(extra, 'sub', 'note.txt'))] }, { content: 'done' }],
    async ({ primary, extra }) => {
      await writeFile(join(primary, 'AGENTS.md'), 'CWD-INSTRUCTION-MARKER')
      await writeFile(join(extra, 'AGENTS.md'), 'EXTRA-INSTRUCTION-SECRET')
      await mkdir(join(extra, 'sub'))
      await writeFile(join(extra, 'sub', 'AGENTS.md'), 'EXTRA-NESTED-SECRET')
      await writeFile(join(extra, 'sub', 'note.txt'), 'readable source')
      await mkdir(join(extra, '.coko'))
      await writeFile(
        join(extra, '.coko', 'settings.json'),
        JSON.stringify({
          instructions: { enabled: false },
          permissions: { deny: ['Read(*)'] },
          hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo EXTRA-HOOK-SECRET >&2; exit 2' }] }] },
        }),
      )
      await writeFile(join(extra, '.mcp.json'), JSON.stringify({ mcpServers: { 'extra-resource-server': { command: '/nonexistent/extra-mcp-secret' } } }))
      await mkdir(join(extra, '.agents', 'skills', 'extra-resource-skill'), { recursive: true })
      await writeFile(
        join(extra, '.agents', 'skills', 'extra-resource-skill', 'SKILL.md'),
        '---\nname: extra-resource-skill\ndescription: EXTRA-SKILL-SECRET\n---\nNever load me.\n',
      )
    },
  )
  expect((await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'inspect sources' })).status).toBe(202)
  await h.stream.waitFor(() => ends(h.stream, h.sessionId) === 1)
  expect(approvals(h.stream, h.sessionId)).toHaveLength(0)
  const out = results(h.stream.entries(h.sessionId)).find((r) => r.toolCallId === 'resource-read')!
  expect(out.isError).toBe(false)
  expect(resultText(out)).toContain('readable source')
  const logged = await readFile(h.requestLog, 'utf8')
  expect(logged).toContain('CWD-INSTRUCTION-MARKER')
  for (const marker of ['EXTRA-INSTRUCTION-SECRET', 'EXTRA-NESTED-SECRET', 'EXTRA-HOOK-SECRET', 'extra-resource-server', 'extra-resource-skill'])
    expect(logged).not.toContain(marker)
  expect(JSON.stringify((await h.api.get(`${hookPaths.hooks}?sessionId=${h.sessionId}`)).body)).not.toContain('EXTRA-HOOK-SECRET')
  const mcp = await h.api.get(`${mcpPaths.mcp}?workspaceId=${h.project.primaryWorkspaceId}`)
  expect(mcp.status).toBe(200)
  expect(JSON.stringify(mcp.body)).not.toContain('extra-resource-server')
  const skills = await h.api.get(`${skillPaths.skills}?workspaceId=${h.project.primaryWorkspaceId}`)
  expect(skills.status).toBe(200)
  expect(JSON.stringify(skills.body)).not.toContain('extra-resource-skill')
})

it('子智能体按根会话当前项目继承附加根；孩子自身不保存独立归属', async () => {
  const h = await boot(({ extra }) => [
    {
      match: 'ROOT-PROJECT',
      content: [call('agent', 'agent1', { description: 'read sources', prompt: 'CHILD-PROJECT read sources', subagent_type: 'general' })],
    },
    { match: 'CHILD-PROJECT', content: [read('child-read', join(extra, 'note.txt')), write('child-write', join(extra, 'child.txt'))] },
    { match: 'CHILD-PROJECT', content: 'done child' },
    { match: 'ROOT-PROJECT', content: 'done root' },
  ])
  await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'accept-edits' })
  await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'ROOT-PROJECT go' })
  await h.stream.waitFor(() => ends(h.stream, h.sessionId) === 1)
  const start = h.stream.entries(h.sessionId).find((e) => e.kind === 'agent_start')!
  expect(start).toBeDefined()
  const id = (start.payload as { agentId: string }).agentId
  const detail = (await h.api.get(apiPaths.session(id))).body
  expect(detail.session.projectId).toBe(h.project.id)
  expect(detail.entries.filter((e: SessionEntryRecord) => e.kind === 'approval_request')).toHaveLength(0)
  expect(
    results(detail.entries)
      .filter((r) => ['child-read', 'child-write'].includes(r.toolCallId))
      .map((r) => r.isError),
  ).toEqual([false, false])
  expect(await readFile(join(h.extra, 'child.txt'), 'utf8')).toBe('changed')
})

it('worktree 移入新项目后仍排除原主检出，重叠附加根不绕过隔离', async () => {
  const repo = await createGitWorkspace({ files: { 'README.md': '# fixture\n', 'nested/secret.txt': 'main nested' } })
  onTestFinished(() => repo.dispose())
  let sourceRoot = ''
  const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'"
  const h = await boot(
    ({ root, extra, outside }) => {
      sourceRoot = join(root, 'source-repo')
      return [
        {
          content: [
            read('wt-read', 'README.md'),
            read('new-project', join(outside, 'note.txt')),
            read('extra', join(extra, 'note.txt')),
            write('wt-write', 'isolated.txt'),
          ],
        },
        { content: [read('main-read', join(sourceRoot, 'README.md'))] },
        { content: [write('main-write', join(sourceRoot, 'README.md'))] },
        { content: [read('main-nested', join(sourceRoot, 'nested', 'secret.txt'))] },
        ...(process.platform === 'darwin'
          ? [{ content: [call('bash', 'main-bash', { command: `printf bad > ${quote(join(sourceRoot, 'README.md'))}` })] }]
          : []),
        { content: 'done' },
      ]
    },
    async ({ primary }) => {
      await cp(repo.root, join(primary, '..', 'source-repo'), { recursive: true })
    },
  )
  const source = (await h.api.post(API_ROUTES.workspaces, { path: sourceRoot })).body
  const worktree = (await h.api.post(worktreePaths.workspaceWorktrees(source.id), { name: 'scope' })).body
  expect(worktree.path).toBeDefined()
  const target = await h.api.post(API_ROUTES.projects, {
    name: 'Moved project',
    folders: [
      { path: h.outside, primary: true },
      { path: h.extra, primary: false },
      { path: join(sourceRoot, '..'), primary: false },
      { path: sourceRoot, primary: false },
      { path: join(sourceRoot, 'nested'), primary: false },
    ],
  })
  expect(target.status).toBe(201)
  const id = (await h.api.post(API_ROUTES.sessions, { workspaceId: source.id, worktreeId: worktree.id })).body.id as string
  expect((await h.api.put(apiPaths.sessionProject(id), { projectId: target.body.project.id })).status).toBe(200)
  await h.api.put(permissionPaths.sessionPermissionMode(id), { mode: 'accept-edits' })
  h.stream.send({ type: 'subscribe', sessionId: id, afterSeq: 0 })
  await h.stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === id)
  await h.api.post(apiPaths.sessionMessages(id), { text: 'go' })
  for (const [index, toolCallId] of ['main-read', 'main-write', 'main-nested', ...(process.platform === 'darwin' ? ['main-bash'] : [])].entries()) {
    const ask = await waitApproval(h.stream, id, index + 1)
    expect(ask.toolCallId).toBe(toolCallId)
    expect(
      (
        await h.api.post(
          apiPaths.sessionApproval(id, ask.requestId),
          toolCallId === 'main-bash' ? { decision: 'allow' } : { decision: 'deny', feedback: 'Keep main checkout unchanged' },
        )
      ).status,
    ).toBe(204)
  }
  await h.stream.waitFor(() => ends(h.stream, id) === 1)
  expect(await readFile(join(worktree.path, 'isolated.txt'), 'utf8')).toBe('changed')
  expect(await readFile(join(sourceRoot, 'README.md'), 'utf8')).toBe('# fixture\n')
  expect((await h.api.get(apiPaths.session(id))).body.session.worktree.id).toBe(worktree.id)
})

it('Run 中编辑项目文件夹只影响下次 Run：gate 与 Seatbelt 使用同一快照，旧 cwd 始终保留', async () => {
  const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'"
  const h = await boot(({ extra, outside }) => [
    { content: [write('folder-barrier', 'barrier.txt')] },
    { content: [read('not-yet-added', join(outside, 'note.txt'))] },
    { content: [read('frozen-read', join(extra, 'note.txt')), write('frozen-write', join(extra, 'current.txt'))] },
    ...(process.platform === 'darwin'
      ? [{ content: [call('bash', 'frozen-bash', { command: `printf shell > ${quote(join(extra, 'current-shell.txt'))}` })] }]
      : []),
    { content: 'one' },
    { content: [read('new-primary', join(outside, 'note.txt')), write('fixed-cwd', 'next-cwd.txt')] },
    { content: [read('removed-read', join(extra, 'note.txt'))] },
    { content: [write('removed-write', join(extra, 'next.txt'))] },
    { content: 'two' },
  ])
  await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'one' })
  const barrier = await waitApproval(h.stream, h.sessionId)
  expect(barrier.toolCallId).toBe('folder-barrier')
  expect((await h.api.put(`${API_ROUTES.projects}/${h.project.id}`, { name: 'Changed', folders: [{ path: h.outside, primary: true }] })).status).toBe(200)
  await h.api.post(apiPaths.sessionApproval(h.sessionId, barrier.requestId), { decision: 'allow' })
  const pendingRoot = await waitApproval(h.stream, h.sessionId, 2)
  expect(pendingRoot.toolCallId).toBe('not-yet-added')
  await h.api.post(apiPaths.sessionApproval(h.sessionId, pendingRoot.requestId), { decision: 'deny', feedback: 'Use the next Run for the new source' })
  const writeAsk = await waitApproval(h.stream, h.sessionId, 3)
  expect(writeAsk.toolCallId).toBe('frozen-write')
  expect(writeAsk.suggestions).not.toHaveLength(0)
  await h.api.post(apiPaths.sessionApproval(h.sessionId, writeAsk.requestId), { decision: 'allow' })
  for (const toolCallId of process.platform === 'darwin' ? ['frozen-bash'] : []) {
    const bashAsk = await waitApproval(h.stream, h.sessionId, 4)
    expect(bashAsk.toolCallId).toBe(toolCallId)
    await h.api.post(apiPaths.sessionApproval(h.sessionId, bashAsk.requestId), { decision: 'allow' })
  }
  await h.stream.waitFor(() => ends(h.stream, h.sessionId) === 1)
  expect(await readFile(join(h.extra, 'current.txt'), 'utf8')).toBe('changed')
  for (const name of process.platform === 'darwin' ? ['current-shell.txt'] : []) expect(await readFile(join(h.extra, name), 'utf8')).toBe('shell')
  const before = approvals(h.stream, h.sessionId).length
  await h.api.put(permissionPaths.sessionPermissionMode(h.sessionId), { mode: 'accept-edits' })
  await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'two' })
  for (const [index, toolCallId] of ['removed-read', 'removed-write'].entries()) {
    const ask = await waitApproval(h.stream, h.sessionId, before + index + 1)
    expect(ask.toolCallId).toBe(toolCallId)
    await h.api.post(apiPaths.sessionApproval(h.sessionId, ask.requestId), { decision: 'deny', feedback: 'Keep removed sources unchanged' })
  }
  await h.stream.waitFor(() => ends(h.stream, h.sessionId) === 2)
  expect(await readFile(join(h.primary, 'next-cwd.txt'), 'utf8')).toBe('changed')
  expect(
    await access(join(h.extra, 'next.txt')).then(
      () => true,
      () => false,
    ),
  ).toBe(false)
  expect((await h.api.get(apiPaths.session(h.sessionId))).body.session.workspaceId).toBe(h.project.primaryWorkspaceId)
})

it('附加根写入获批后目标被换成外向链接，执行前复核再次询问，拒绝后外部文件不变', async () => {
  const h = await boot(({ extra }) => [{ content: [write('swap', join(extra, 'swap.txt'))] }, { content: 'done' }])
  await h.api.post(apiPaths.sessionMessages(h.sessionId), { text: 'go' })
  const first = await waitApproval(h.stream, h.sessionId)
  expect(first.toolCallId).toBe('swap')
  await symlink(join(h.outside, 'note.txt'), join(h.extra, 'swap.txt'))
  await h.api.post(apiPaths.sessionApproval(h.sessionId, first.requestId), { decision: 'allow' })
  const second = await waitApproval(h.stream, h.sessionId, 2)
  expect(second.toolCallId).toBe('swap')
  expect(second.suggestions).toHaveLength(0)
  await h.api.post(apiPaths.sessionApproval(h.sessionId, second.requestId), { decision: 'deny', feedback: 'Keep outside unchanged' })
  await h.stream.waitFor(() => ends(h.stream, h.sessionId) === 1)
  expect(await readFile(join(h.outside, 'note.txt'), 'utf8')).toBe(h.outside)
  expect(h.stream.entries(h.sessionId).filter((e) => e.kind === 'tool_exec')).toHaveLength(0)
})
