// File Reference：真实 Sidecar（faux 模型），临时 Workspace 在测试中建立。断言提交的 user message 条目、faux requestLog 中实际发给
// 模型的内容块，以及 GET /api/workspaces/:id/files 的候选。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, fileReferencePath, filePaths, type SessionEntryRecord } from '@coko/protocol'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

async function write(root: string, relative: string, content: string) {
  const path = join(root, relative)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

async function boot(responses: unknown[]) {
  const root = await tempDir()
  const workspaceDir = join(root, 'workspace')
  await write(workspaceDir, '.git/HEAD', 'ref: refs/heads/main\n')
  await write(workspaceDir, '.gitignore', 'dist/\n')
  await write(workspaceDir, 'src/a.ts', 'export const a = 1\n')
  await write(workspaceDir, 'src/lib/b.ts', 'export const b = 2\n')
  await write(workspaceDir, 'dist/out.js', 'built\n')
  await write(workspaceDir, 'secret.txt', 'TOP-SECRET-VALUE\n')
  await write(workspaceDir, '.coko/settings.json', JSON.stringify({ permissions: { deny: ['Read(secret.txt)'] } }))
  await write(workspaceDir, '.coko/commands/explain.md', 'Explain $ARGUMENTS in one paragraph.\n')
  const dirs = await sidecarDirs()
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { responses, requestLog })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const workspace = (await api.post(API_ROUTES.workspaces, { path: workspaceDir })).body as { id: string; path: string }
  const newSession = async () => {
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    return sessionId
  }
  const requests = async () =>
    (await readFile(requestLog, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { role: string; content: unknown }[])
  return { sidecar, api, stream, workspace, newSession, requests }
}

type Block = { type: string; text?: string }
const kindOf = (e: SessionEntryRecord) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind)
const userBlocks = (entries: SessionEntryRecord[]) => entries.filter((e) => kindOf(e) === 'user').map((e) => (e.payload as { content: Block[] }).content)
const sentUserBlocks = (messages: { role: string; content: unknown }[]) => messages.filter((m) => m.role === 'user').map((m) => m.content as Block[])

describe('File Reference 展开', () => {
  it('看看 @src/a.ts → 同一条 user message 含原文与 <file_reference path="src/a.ts"> 块；faux requestLog 中可见', async () => {
    const { api, stream, newSession, requests, sidecar } = await boot([{ content: 'seen' }])
    const sessionId = await newSession()
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: '看看 @src/a.ts' })).status).toBe(202)
    await stream.waitFor(isRunEnd(sessionId))

    const entries = stream.entries(sessionId)
    expect(entries.map(kindOf)).toEqual(['permission_mode', 'run_start', 'user', 'assistant', 'model_request', 'run_end'])
    const expected = [
      { type: 'text', text: '看看 @src/a.ts' },
      { type: 'text', text: '<file_reference path="src/a.ts">\nexport const a = 1\n\n</file_reference>' },
    ]
    expect(userBlocks(entries)).toEqual([expected])
    expect(fileReferencePath(userBlocks(entries)[0]![1]!.text!)).toBe('src/a.ts')
    const sent = await requests()
    expect(sent).toHaveLength(1)
    expect(sentUserBlocks(sent[0]!)).toEqual([expected])
    // 重新读回的条目相同。
    expect(userBlocks((await api.get(apiPaths.session(sessionId))).body.entries)).toEqual([expected])
    expect(stream.invalidEntries).toEqual([])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })

  it('Read 拒绝规则（project 作用域）覆盖的文件不附内容，只附说明；没有引用时 user message 只有原文', async () => {
    const { api, stream, newSession, requests } = await boot([{ content: 'a' }, { content: 'b' }])
    const sessionId = await newSession()
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'read @secret.txt please' })
    await stream.waitFor(isRunEnd(sessionId))
    await api.post(apiPaths.sessionMessages(sessionId), { text: 'mail me at a@b.com, ping @nobody' })
    await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length >= 2)

    const [denied, plain] = userBlocks(stream.entries(sessionId))
    expect(denied).toEqual([
      { type: 'text', text: 'read @secret.txt please' },
      { type: 'text', text: '<file_reference path="secret.txt">\n[Not attached: denied by permission rules.]\n</file_reference>' },
    ])
    expect(plain).toEqual([{ type: 'text', text: 'mail me at a@b.com, ping @nobody' }])
    expect(JSON.stringify(await requests())).not.toContain('TOP-SECRET-VALUE')
  })

  it('命令与引用同时出现时先展开命令：/explain @src/a.ts → command 条目，展开后的文本带 File Reference 块', async () => {
    const { api, stream, newSession, requests } = await boot([{ content: 'explained' }])
    const sessionId = await newSession()
    await api.post(apiPaths.sessionMessages(sessionId), { text: '/explain @src/a.ts' })
    await stream.waitFor(isRunEnd(sessionId))

    const entries = stream.entries(sessionId)
    expect(entries.map(kindOf)).toEqual(['permission_mode', 'run_start', 'command', 'user', 'assistant', 'model_request', 'run_end'])
    expect(entries[2]!.payload).toEqual({ name: 'explain', args: '@src/a.ts', source: 'project' })
    const expected = [
      { type: 'text', text: 'Explain @src/a.ts in one paragraph.' },
      { type: 'text', text: '<file_reference path="src/a.ts">\nexport const a = 1\n\n</file_reference>' },
    ]
    expect(userBlocks(entries)).toEqual([expected])
    expect(sentUserBlocks((await requests())[0]!)).toEqual([expected])
  })
})

describe('GET /api/workspaces/:id/files', () => {
  it('遵守 .gitignore、不含 .git、目录带 /、有上限；limit 不合法 400，Workspace 不存在 404', async () => {
    const { api, workspace } = await boot([])
    const list = async (query: string, limit?: number) => {
      const res = await api.get(`${filePaths.workspaceFiles(workspace.id)}?query=${encodeURIComponent(query)}${limit === undefined ? '' : `&limit=${limit}`}`)
      expect(res.status).toBe(200)
      return (res.body as { files: { path: string; kind: string }[] }).files
    }
    const all = await list('')
    const paths = all.map((f) => f.path)
    expect(paths).toContain('src/')
    expect(paths).toContain('src/lib/b.ts')
    expect(paths).toContain('.coko/')
    expect(paths.some((p) => p === '.git/' || p.startsWith('.git/'))).toBe(false)
    expect(paths.some((p) => p.startsWith('dist'))).toBe(false)
    expect(all.find((f) => f.path === 'src/')).toEqual({ path: 'src/', kind: 'directory' })
    expect((await list('src/')).map((f) => f.path)).toEqual(['src/a.ts', 'src/lib/', 'src/lib/b.ts'])
    expect((await list('bts')).map((f) => f.path)).toEqual(['src/lib/b.ts'])
    expect(await list('', 2)).toHaveLength(2)
    expect((await api.get(`${filePaths.workspaceFiles(workspace.id)}?limit=51`)).status).toBe(400)
    expect((await api.get(`${filePaths.workspaceFiles(workspace.id)}?limit=x`)).status).toBe(400)
    expect((await api.get(filePaths.workspaceFiles('nope'))).status).toBe(404)
  })
})
