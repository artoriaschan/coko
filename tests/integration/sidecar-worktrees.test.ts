// Worktree（ADR 0016；docs/subsystems/worktrees.md）：真实 Sidecar（faux）与 git 夹具仓库。创建（exclude、校验、重名）、会话绑定后的工作目录
// （bash pwd -P、write、受保护路径、Seatbelt、指令文件）、父 Workspace 的 grep / find / ls 不列出 worktree、移除（busy / dirty / removed、重启
// 标记）与对手用例（.coko-worktrees 是符号链接、worktree 会话读取主 checkout）。
// 新读取根：.coko-worktrees（创建时拒绝符号链接）；worktree 会话的读取根就是其工作目录，主 checkout 在其外（须审批）。
import { lstat, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { rgPath } from '@vscode/ripgrep'
import { describe, expect, it, onTestFinished } from 'vitest'
import {
  API_ROUTES,
  apiPaths,
  checkpointPaths,
  contextPaths,
  hookPaths,
  jobPaths,
  permissionPaths,
  worktreePaths,
  type ContextUsageResponse,
  type SessionEntryRecord,
} from '@coko/protocol'
import { createGitWorkspace, type GitWorkspace } from '../fixtures/git/index.ts'
import {
  client,
  connect,
  exchange,
  fauxScript,
  pollUntil,
  sidecarDirs,
  startSidecar,
  tempDir,
  waitApproval,
  type SidecarDirs,
  type Stream,
} from './sidecar-harness.ts'

const darwin = process.platform === 'darwin'
type Message = { role: string; content: { type: string; text?: string }[]; toolCallId?: string; isError?: boolean; sections?: Record<string, string> }
const call = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })

async function repo(files?: Record<string, string>): Promise<GitWorkspace> {
  const fixture = await createGitWorkspace(files ? { files } : {})
  onTestFinished(() => fixture.dispose())
  return fixture
}

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    () => false,
  )

async function boot(fixture: GitWorkspace, responses: unknown[], options: { dirs?: SidecarDirs; args?: (dirs: SidecarDirs) => string[] } = {}) {
  const scratch = await tempDir()
  const dirs = options.dirs ?? (await sidecarDirs())
  const requestLog = join(scratch, 'requests.jsonl')
  await writeFile(requestLog, '')
  const env = { ...fixture.env, COKO_FAUX_SCRIPT: await fauxScript(scratch, { requestLog, responses }) }
  const sidecar = await startSidecar({ dirs, env, ...(options.args ? { args: options.args(dirs) } : {}) })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspace = async (path: string) => (await api.post(API_ROUTES.workspaces, { path })).body.id as string
  const session = async (workspaceId: string, worktreeId?: string) => {
    const response = await api.post(API_ROUTES.sessions, { workspaceId, ...(worktreeId ? { worktreeId } : {}) })
    expect(response.status).toBe(201)
    const id = response.body.id as string
    stream.send({ type: 'subscribe', sessionId: id, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === id)
    return { id, dto: response.body }
  }
  const requests = async () =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Message[])
  return { dirs, sidecar, api, stream, workspace, session, requests }
}

const runEnds = (stream: Stream, sessionId: string, n: number) =>
  stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= n, 30_000)
const toolResult = (stream: Stream, sessionId: string, toolCallId: string) =>
  stream.entries(sessionId).find((e) => e.kind === 'message' && (e.payload as Message).toolCallId === toolCallId)?.payload as Message | undefined
const text = (message: Message | undefined) => (message?.content ?? []).map((b) => b.text ?? '').join('')
const approvals = (stream: Stream, sessionId: string) => stream.entries(sessionId).filter((e: SessionEntryRecord) => e.kind === 'approval_request')

describe('Worktree 创建', () => {
  it('201：git worktree list 含该路径、分支 coko/<name>、info/exclude 只追加一次；非 git 400；非法 name 400；重名 409；列表含 sessionCount', async () => {
    const fixture = await repo()
    const h = await boot(fixture, [])
    const workspaceId = await h.workspace(fixture.root)
    const created = await h.api.post(worktreePaths.workspaceWorktrees(workspaceId), { name: 'feat-a' })
    expect(created.status).toBe(201)
    const path = join(fixture.root, '.coko-worktrees', 'feat-a')
    expect(created.body).toMatchObject({ workspaceId, name: 'feat-a', path, branch: 'coko/feat-a', status: 'active', createdBy: 'user', sessionCount: 0 })
    expect(created.body.baseCommit).toBe((await fixture.git('rev-parse', 'HEAD')).trim())
    expect(await fixture.git('worktree', 'list', '--porcelain')).toContain(`worktree ${path}\nHEAD ${created.body.baseCommit}\nbranch refs/heads/coko/feat-a`)
    const generated = await h.api.post(worktreePaths.workspaceWorktrees(workspaceId), {})
    expect([generated.status, generated.body.name]).toEqual([201, expect.stringMatching(/^wt-[0-9a-f]{6}$/)])
    const exclude = await readFile(join(fixture.root, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude.split('\n').filter((line) => line === '/.coko-worktrees/')).toHaveLength(1)
    // 父仓库的 git status 不列出 worktree。
    expect(await fixture.git('status', '--porcelain')).toBe('')

    expect((await h.api.post(worktreePaths.workspaceWorktrees(workspaceId), { name: 'feat-a' })).body.error.code).toBe('worktree-exists')
    expect((await h.api.post(worktreePaths.workspaceWorktrees(workspaceId), { name: 'feat-a' })).status).toBe(409)
    await fixture.git('branch', 'coko/taken')
    expect((await h.api.post(worktreePaths.workspaceWorktrees(workspaceId), { name: 'taken' })).status).toBe(409)
    for (const name of ['../x', 'a/b', 'Upper', 'x'.repeat(65)]) {
      const response = await h.api.post(worktreePaths.workspaceWorktrees(workspaceId), { name })
      expect([name, response.status, response.body.error.code]).toEqual([name, 400, 'invalid-name'])
    }
    expect(await readdir(join(fixture.root, '.coko-worktrees'))).toEqual(['feat-a', generated.body.name].sort())
    expect(await exists(join(fixture.root, 'x'))).toBe(false)

    const plain = await tempDir()
    const plainId = await h.workspace(plain)
    const notRepo = await h.api.post(worktreePaths.workspaceWorktrees(plainId), { name: 'x' })
    expect([notRepo.status, notRepo.body.error.code]).toEqual([400, 'not-a-git-repo'])
    expect(await readdir(plain)).toEqual([])
    expect((await h.api.post(worktreePaths.workspaceWorktrees('missing'), {})).status).toBe(404)

    await h.session(workspaceId, created.body.id)
    const listed = await h.api.get(worktreePaths.workspaceWorktrees(workspaceId))
    expect(listed.body.map((w: { name: string; sessionCount: number }) => [w.name, w.sessionCount])).toEqual([
      ['feat-a', 1],
      [generated.body.name, 0],
    ])
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

const quote = (p: string) => `'${p.replaceAll("'", "'\\''")}'`

describe('worktree 会话的作用域', () => {
  it('上下文用量的指令分项来自 worktree 的 AGENTS.md；Hook 的 COKO_PROJECT_DIR 为会话工作目录；/<skill> 参数 时 UserPromptSubmit 的 prompt 为原文', async () => {
    const fixture = await repo({ 'AGENTS.md': 'MAIN-RULE\n' })
    const g = await boot(fixture, [{ content: 'skill done' }])
    const scratch = await tempDir()
    const [stdinFile, envFile] = [join(scratch, 'stdin.json'), join(scratch, 'env.txt')]
    const command = `cat > ${quote(stdinFile)}; printf '%s' "$COKO_PROJECT_DIR" > ${quote(envFile)}`
    expect((await g.api.put(hookPaths.hooks, { hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command }] }] }, expectedRevision: 0 })).status).toBe(
      200,
    )
    const workspaceId = await g.workspace(fixture.root)
    const worktree = (await g.api.post(worktreePaths.workspaceWorktrees(workspaceId), { name: 'scoped' })).body as { id: string; path: string }
    await writeFile(join(worktree.path, 'AGENTS.md'), 'WORKTREE-RULE\n')
    await mkdir(join(worktree.path, '.coko', 'skills', 'demo'), { recursive: true })
    await writeFile(join(worktree.path, '.coko', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: Demo skill.\n---\nSKILL-BODY-TEXT\n')
    const a = await g.session(workspaceId, worktree.id)

    const usage = (await g.api.get(contextPaths.session(a.id))).body as ContextUsageResponse
    expect(usage.instructions.filter((i) => i.scope === 'project').map((i) => i.path)).toEqual([join(worktree.path, 'AGENTS.md')])

    expect((await g.api.post(apiPaths.sessionMessages(a.id), { text: '/demo do it' })).status).toBe(202)
    await runEnds(g.stream, a.id, 1)
    expect(JSON.stringify(await g.requests())).toContain('SKILL-BODY-TEXT')
    await pollUntil(async () => (await readFile(envFile, 'utf8').catch(() => '')) !== '', { timeoutMs: 10_000, what: 'the hook record' })
    expect(await readFile(envFile, 'utf8')).toBe(worktree.path)
    const stdin = JSON.parse(await readFile(stdinFile, 'utf8')) as { prompt: string; cwd: string }
    expect([stdin.prompt, stdin.cwd]).toEqual(['/demo do it', worktree.path])
    expect(await g.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('回退边界：Workspace 为仓库子目录的 worktree 会话中 write 之后回退代码，文件内容恢复；越出该目录的路径列入 outside（ADR 0006：照常处理并警告）', async () => {
    const fixture = await repo({ 'pkg/a.txt': 'a\n' })
    // worktree 路径由名字确定（<repo>/.coko-worktrees/<name>）：脚本在创建之前写出。
    const tree = join(fixture.root, '.coko-worktrees', 'rw')
    const outside = join(tree, 'OUT.txt')
    const g = await boot(fixture, [
      { content: [call('w1', 'write', { path: 'a.txt', content: 'changed\n' }), call('w2', 'write', { path: outside, content: 'outside\n' })] },
      { content: 'written' },
    ])
    const workspaceId = await g.workspace(join(fixture.root, 'pkg'))
    const worktree = (await g.api.post(worktreePaths.workspaceWorktrees(workspaceId), { name: 'rw' })).body as { id: string; path: string }
    expect(worktree.path).toBe(tree)
    const a = await g.session(workspaceId, worktree.id)
    expect((await g.api.put(permissionPaths.sessionPermissionMode(a.id), { mode: 'full-access' })).status).toBe(200)
    expect((await g.api.post(apiPaths.sessionMessages(a.id), { text: 'edit' })).status).toBe(202)
    // full-access：越出工作目录（worktree 根在 pkg 之外）的写入也免审批；回退只恢复工作目录之内的路径。
    await runEnds(g.stream, a.id, 1)
    expect([await readFile(join(tree, 'pkg', 'a.txt'), 'utf8'), await readFile(outside, 'utf8')]).toEqual(['changed\n', 'outside\n'])

    const [checkpoint] = (await g.api.get(checkpointPaths.sessionCheckpoints(a.id))).body.checkpoints as { seq: number }[]
    const done = await g.api.post(checkpointPaths.sessionRewind(a.id), { targetSeq: checkpoint!.seq, mode: 'code' })
    expect(done.status).toBe(200)
    // 边界为会话工作目录（worktree 中的 pkg）：其内的 a.txt 恢复；其外的 OUT.txt 列入 outside。ADR 0006 规定 outside 照常处理（确认对话框单独警告），
    // 所以它与其他新建文件一样被删除。
    expect(done.body).toMatchObject({ restored: [join(tree, 'pkg', 'a.txt')], deleted: [outside], outside: [outside], skipped: [] })
    expect(await readFile(join(tree, 'pkg', 'a.txt'), 'utf8')).toBe('a\n')
    expect(await exists(outside)).toBe(false)
    expect(await g.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

describe('绑定 worktree 的会话', () => {
  // 受限档位的 bash 只在 darwin 有 Seatbelt；其他平台 fail-closed（ADR 0005），本用例的 bash 部分无法运行。
  it.skipIf(!darwin)(
    'bash pwd -P 为 worktree 路径（子目录 Workspace 为对应子目录）；write 落在 worktree 内、accept-edits 免审批；指令文件读 worktree 中的版本；对手用例：读取主 checkout 须审批',
    async () => {
      const fixture = await repo({ 'AGENTS.md': 'MAIN-RULE\n', 'pkg/a.txt': 'a\n' })
      const g = await boot(fixture, [
        { content: [call('w1', 'write', { path: 'notes.txt', content: 'in worktree\n' })] },
        { content: [call('b1', 'bash', { command: 'pwd -P && echo sb > sb.txt' })] },
        { content: [call('r1', 'read', { path: join(fixture.root, 'MAIN-ONLY.txt') })] },
        { content: [call('r2', 'read', { path: '../../MAIN-ONLY.txt' })] },
        { content: [call('b2', 'bash', { command: 'pwd -P' })] },
        { content: 'sub done' },
      ])
      const workspaceId = await g.workspace(fixture.root)
      const worktree = (await g.api.post(worktreePaths.workspaceWorktrees(workspaceId), { name: 'bound' })).body
      // worktree 中的指令文件与主 checkout 不同；主 checkout 另有一个只在其中的文件。
      await writeFile(join(worktree.path, 'AGENTS.md'), 'WORKTREE-RULE\n')
      await writeFile(join(fixture.root, 'MAIN-ONLY.txt'), 'main secret\n')
      const a = await g.session(workspaceId, worktree.id)
      expect(a.dto.worktree).toEqual({ id: worktree.id, name: 'bound', branch: 'coko/bound', status: 'active' })
      expect((await g.api.put(permissionPaths.sessionPermissionMode(a.id), { mode: 'accept-edits' })).status).toBe(200)
      expect((await g.api.post(apiPaths.sessionMessages(a.id), { text: 'work here' })).status).toBe(202)

      // write：accept-edits 下 worktree 内免审批（.coko-worktrees 不是受保护路径）。bash 在 default 类询问后执行。
      const bashApproval = await waitApproval(g.stream, a.id, 1)
      expect([bashApproval.toolName, bashApproval.subject]).toEqual(['bash', 'pwd -P && echo sb > sb.txt'])
      await g.api.post(apiPaths.sessionApproval(a.id, bashApproval.requestId), { decision: 'allow' })
      // 对手用例：主 checkout 中的文件在 worktree 会话的工作目录之外——绝对路径与 ../.. 两种写法都产生审批，拒绝后不读出内容。
      const denyRead = async (n: number, toolCallId: string, subject: string) => {
        const request = await waitApproval(g.stream, a.id, n)
        expect([request.toolCallId, request.kind, request.subject]).toEqual([toolCallId, 'tool', subject])
        // 越出工作目录的读取：建议规则为该文件的路径模式（而不是允许整个目录）。
        expect(request.suggestions).toEqual([{ behavior: 'allow', tool: 'Read', content: expect.stringContaining('MAIN-ONLY.txt') }])
        await g.api.post(apiPaths.sessionApproval(a.id, request.requestId), { decision: 'deny' })
      }
      await denyRead(2, 'r1', join(fixture.root, 'MAIN-ONLY.txt'))
      // 拒绝审批结束该 Run；相对路径的写法在下一个 Run 中。
      await runEnds(g.stream, a.id, 1)
      expect((await g.api.post(apiPaths.sessionMessages(a.id), { text: 'try the relative path' })).status).toBe(202)
      await denyRead(3, 'r2', '../../MAIN-ONLY.txt')
      await runEnds(g.stream, a.id, 2)
      expect(approvals(g.stream, a.id)).toHaveLength(3)
      expect(toolResult(g.stream, a.id, 'w1')?.isError).toBe(false)
      expect(await readFile(join(worktree.path, 'notes.txt'), 'utf8')).toBe('in worktree\n')
      expect(await exists(join(fixture.root, 'notes.txt'))).toBe(false)
      // Seatbelt（workspace-write）允许写 worktree：可写根为工作目录本身。
      const pwd = toolResult(g.stream, a.id, 'b1')
      expect([pwd?.isError, text(pwd).split('\n')[0]]).toEqual([false, worktree.path])
      expect(await readFile(join(worktree.path, 'sb.txt'), 'utf8')).toBe('sb\n')
      for (const id of ['r1', 'r2']) expect(text(toolResult(g.stream, a.id, id))).not.toContain('main secret')
      const instructions = (await g.requests())[0]![0]!.sections!.instructions!
      expect(instructions).toContain('WORKTREE-RULE')
      expect(instructions).not.toContain('MAIN-RULE')
      expect(instructions).toContain(`path="${join(worktree.path, 'AGENTS.md')}"`)

      // Workspace 为仓库子目录：工作目录为 worktree 中的对应子目录。
      const subWorkspace = await g.workspace(join(fixture.root, 'pkg'))
      const subTree = (await g.api.post(worktreePaths.workspaceWorktrees(subWorkspace), { name: 'sub' })).body
      expect(subTree.path).toBe(join(fixture.root, '.coko-worktrees', 'sub'))
      const b = await g.session(subWorkspace, subTree.id)
      expect((await g.api.put(permissionPaths.sessionPermissionMode(b.id), { mode: 'full-access' })).status).toBe(200)
      await g.api.post(apiPaths.sessionMessages(b.id), { text: 'where am i' })
      await runEnds(g.stream, b.id, 1)
      expect(text(toolResult(g.stream, b.id, 'b2')).trim()).toBe(join(subTree.path, 'pkg'))
      expect(await g.sidecar.stop()).toEqual({ code: 0, signal: null })
    },
  )

  it.each([
    ['内置 grep', undefined],
    ['ripgrep', rgPath],
  ])('父 Workspace 会话的 grep / find / ls 不列出 .coko-worktrees 下的文件（%s）', async (_label, ripgrep) => {
    const fixture = await repo({ 'main.txt': 'NEEDLE-MAIN\n' })
    const h = await boot(
      fixture,
      [
        {
          content: [
            call('g1', 'grep', { pattern: 'NEEDLE' }),
            call('f1', 'find', { pattern: '**/*.txt' }),
            call('l1', 'ls', {}),
            call('l2', 'ls', { path: '.coko-worktrees' }),
          ],
        },
        { content: 'done' },
      ],
      ripgrep ? { args: (dirs) => ['--data-dir', dirs.dataDir, '--log-dir', dirs.logDir, '--ripgrep', ripgrep] } : {},
    )
    const workspaceId = await h.workspace(fixture.root)
    const worktree = (await h.api.post(worktreePaths.workspaceWorktrees(workspaceId), { name: 'hidden' })).body
    await writeFile(join(worktree.path, 'only-in-worktree.txt'), 'NEEDLE-WORKTREE\n')
    const parent = await h.session(workspaceId)
    expect((await h.api.put(permissionPaths.sessionPermissionMode(parent.id), { mode: 'full-access' })).status).toBe(200)
    await h.api.post(apiPaths.sessionMessages(parent.id), { text: 'search' })
    await runEnds(h.stream, parent.id, 1)
    const grep = text(toolResult(h.stream, parent.id, 'g1'))
    expect(grep).toContain('main.txt')
    expect(grep).not.toContain('NEEDLE-WORKTREE')
    // worktree 中已跟踪的 main.txt 副本同样不出现。
    expect(grep).not.toContain('.coko-worktrees')
    const find = text(toolResult(h.stream, parent.id, 'f1'))
    expect(find).toContain('main.txt')
    expect(find).not.toContain('.coko-worktrees')
    // ls 只列一层：根下只有目录本身，不列出其中的文件。
    expect(text(toolResult(h.stream, parent.id, 'l1'))).not.toContain('only-in-worktree.txt')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

describe('Worktree 移除', () => {
  it('running Job 时 409 worktree-busy；未提交文件 409 worktree-dirty 且逐字节不变；干净时移除、分支仍在、提交 409 worktree-removed、读取照常', async () => {
    const fixture = await repo()
    const h = await boot(fixture, [{ content: [call('b1', 'bash', { command: 'sleep 60', run_in_background: true })] }, { content: 'started' }])
    const workspaceId = await h.workspace(fixture.root)
    const worktree = (await h.api.post(worktreePaths.workspaceWorktrees(workspaceId), { name: 'rm' })).body
    const s = await h.session(workspaceId, worktree.id)
    expect((await h.api.put(permissionPaths.sessionPermissionMode(s.id), { mode: 'full-access' })).status).toBe(200)
    await h.api.post(apiPaths.sessionMessages(s.id), { text: 'start a job' })
    await runEnds(h.stream, s.id, 1)
    const jobId = (h.stream.entries(s.id).find((e) => e.kind === 'job_start')!.payload as { jobId: string }).jobId

    const busy = await h.api.delete(worktreePaths.worktree(worktree.id))
    expect([busy.status, busy.body.error.code, busy.body.error.details]).toEqual([409, 'worktree-busy', { reasons: ['job'] }])
    expect(await exists(worktree.path)).toBe(true)
    expect((await h.api.post(jobPaths.kill(jobId))).status).toBe(204)

    const status = await h.api.get(worktreePaths.sessionGitStatus(s.id))
    expect(status.body).toEqual({ repo: true, branch: 'coko/rm', dirtyFiles: 0 })
    await writeFile(join(worktree.path, 'README.md'), 'edited\n')
    await mkdir(join(worktree.path, 'new'))
    await writeFile(join(worktree.path, 'new', 'file.bin'), Buffer.from([0, 1, 2, 255]))
    expect((await h.api.get(worktreePaths.sessionGitStatus(s.id))).body).toEqual({ repo: true, branch: 'coko/rm', dirtyFiles: 2 })
    const dirty = await h.api.delete(worktreePaths.worktree(worktree.id))
    expect([dirty.status, dirty.body.error.code, dirty.body.error.details]).toEqual([409, 'worktree-dirty', { files: ['README.md', 'new/file.bin'], count: 2 }])
    expect(await readFile(join(worktree.path, 'README.md'), 'utf8')).toBe('edited\n')
    expect([...(await readFile(join(worktree.path, 'new', 'file.bin')))]).toEqual([0, 1, 2, 255])

    await fixture.git('-C', worktree.path, 'checkout', '--', 'README.md')
    await rm(join(worktree.path, 'new'), { recursive: true })
    expect((await h.api.delete(worktreePaths.worktree(worktree.id))).status).toBe(204)
    expect(await exists(worktree.path)).toBe(false)
    expect(await fixture.git('worktree', 'list', '--porcelain')).not.toContain(worktree.path)
    expect((await fixture.git('branch', '--list', 'coko/rm')).trim()).toBe('coko/rm')
    const submitted = await h.api.post(apiPaths.sessionMessages(s.id), { text: 'more' })
    expect([submitted.status, submitted.body.error.code]).toEqual([409, 'worktree-removed'])
    const detail = await h.api.get(apiPaths.session(s.id))
    expect(detail.status).toBe(200)
    expect(detail.body.session.worktree).toEqual({ id: worktree.id, name: 'rm', branch: 'coko/rm', status: 'removed' })
    expect(detail.body.entries.filter((e: SessionEntryRecord) => e.kind === 'run_end')).toHaveLength(1)
    expect((await h.api.get(worktreePaths.sessionGitStatus(s.id))).body).toEqual({ repo: false, dirtyFiles: 0 })
    expect((await h.api.delete(worktreePaths.worktree(worktree.id))).status).toBe(204)
    expect((await h.api.delete(worktreePaths.worktree('missing'))).status).toBe(404)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('外部删除目录后重启：worktree 标为 removed，绑定会话提交 409 worktree-removed', async () => {
    const fixture = await repo()
    const h = await boot(fixture, [])
    const workspaceId = await h.workspace(fixture.root)
    const worktree = (await h.api.post(worktreePaths.workspaceWorktrees(workspaceId), { name: 'gone' })).body
    const s = await h.session(workspaceId, worktree.id)
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
    await rm(worktree.path, { recursive: true, force: true })
    const g = await boot(fixture, [], { dirs: h.dirs })
    expect((await g.api.get(worktreePaths.workspaceWorktrees(workspaceId))).body.map((w: { status: string }) => w.status)).toEqual(['removed'])
    expect((await g.api.post(apiPaths.sessionMessages(s.id), { text: 'x' })).body.error.code).toBe('worktree-removed')
    expect(await g.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

describe('对手用例：.coko-worktrees 是符号链接', () => {
  it.each([
    ['指向仓库外', async (fixture: GitWorkspace, outside: string) => symlink(outside, join(fixture.root, '.coko-worktrees'))],
    [
      '指向仓库内的目录',
      async (fixture: GitWorkspace) => {
        await mkdir(join(fixture.root, 'elsewhere'))
        await symlink(join(fixture.root, 'elsewhere'), join(fixture.root, '.coko-worktrees'))
      },
    ],
  ])('%s时 400 unsafe-worktree-path：外部目录没有新文件、没有新分支、exclude 不变', async (_label, link) => {
    const fixture = await repo()
    const outside = await tempDir('coko-outside-')
    await link(fixture, outside)
    const h = await boot(fixture, [])
    const workspaceId = await h.workspace(fixture.root)
    const before = await readFile(join(fixture.root, '.git', 'info', 'exclude'), 'utf8').catch(() => '')
    const response = await h.api.post(worktreePaths.workspaceWorktrees(workspaceId), { name: 'escape' })
    expect([response.status, response.body.error.code]).toEqual([400, 'unsafe-worktree-path'])
    expect(await readdir(outside)).toEqual([])
    expect((await fixture.git('branch', '--format=%(refname:short)')).trim()).toBe('main')
    expect(await readFile(join(fixture.root, '.git', 'info', 'exclude'), 'utf8').catch(() => '')).toBe(before)
    expect(await fixture.git('worktree', 'list', '--porcelain')).not.toContain('escape')
    expect(await h.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})

it('助手分支继承 Worktree 实际 cwd；移除后服务端拒绝从只读来源分支', async () => {
  const fixture = await repo({ 'tracked.txt': 'same bytes' })
  const h = await boot(fixture, [{ content: 'source answer' }, { content: [call('branch-pwd', 'bash', { command: 'pwd -P' })] }, { content: 'branch done' }])
  const workspaceId = await h.workspace(fixture.root)
  const worktree = (await h.api.post(worktreePaths.workspaceWorktrees(workspaceId), { name: 'assistant-fork' })).body
  const source = await h.session(workspaceId, worktree.id)
  await h.api.put(permissionPaths.sessionPermissionMode(source.id), { mode: 'full-access' })
  await h.api.post(apiPaths.sessionMessages(source.id), { text: 'source prompt' })
  await runEnds(h.stream, source.id, 1)
  const entries = h.stream.entries(source.id)
  const target = entries.find((e) => e.kind === 'message' && text(e.payload as Message) === 'source answer')!
  const fork = await h.api.post(checkpointPaths.sessionFork(source.id), { targetSeq: target.seq, boundary: 'assistant-inclusive' })
  expect(fork.status).toBe(201)
  const id = fork.body.sessionId as string
  const detail = await h.api.get(apiPaths.session(id))
  expect(detail.body.session.worktree.id).toBe(worktree.id)
  expect(detail.body.session.cwd).toBe(worktree.path)
  h.stream.send({ type: 'subscribe', sessionId: id, afterSeq: 0 })
  await h.stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === id)
  await h.api.post(apiPaths.sessionMessages(id), { text: 'where am I' })
  await runEnds(h.stream, id, 1)
  expect(text(toolResult(h.stream, id, 'branch-pwd')).trim()).toBe(worktree.path)
  expect(await readFile(join(fixture.root, 'tracked.txt'), 'utf8')).toBe('same bytes')
  expect(await readFile(join(worktree.path, 'tracked.txt'), 'utf8')).toBe('same bytes')
  expect(h.stream.entries(source.id)).toEqual(entries)
  expect((await h.api.delete(worktreePaths.worktree(worktree.id))).status).toBe(204)
  expect(await h.api.post(checkpointPaths.sessionFork(source.id), { targetSeq: target.seq, boundary: 'assistant-inclusive' })).toMatchObject({
    status: 409,
    body: { error: { code: 'worktree-removed' } },
  })
})
