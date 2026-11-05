// 指令文件：真实 Sidecar（临时 COKO_HOME，faux 模型）。断言 faux requestLog 中实际发给模型的 system sections 与
// toolResult、重新订阅读回的条目，以及项目设置 instructions.enabled: false 时不注入。
import { readFile, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SYSTEM_PROMPT } from '@coko/agent'
import { API_ROUTES, apiPaths, nestedInstructionPath, permissionPaths, type SessionEntryRecord } from '@coko/protocol'
import { writeLayeredRepo, writeTree } from '../fixtures/instructions/layered.ts'
import { client, connect, exchange, fauxScript, isRunEnd, sidecarDirs, startSidecar, tempDir, writeCokoHome, type Stream } from './sidecar-harness.ts'

type RequestMessage = { role: string; content: unknown; sections?: Record<string, string>; toolCallId?: string }

async function requests(path: string): Promise<RequestMessage[][]> {
  return (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RequestMessage[])
}

async function logRecords(logDir: string): Promise<{ message: string; properties: Record<string, unknown> }[]> {
  return (await readFile(join(logDir, 'sidecar.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { message: string; properties: Record<string, unknown> })
}

const runEnds = (stream: Stream, sessionId: string) => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
const toolResults = (entries: SessionEntryRecord[]) =>
  entries
    .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
    .map((e) => e.payload as { toolCallId: string; content: { type: string; text?: string }[] })
const read = (id: string, path: string) => ({ type: 'toolCall', name: 'read', id, arguments: { path } })

async function boot(root: string, responses: unknown[]) {
  const dirs = await sidecarDirs()
  const requestLog = join(root, 'requests.jsonl')
  await writeFile(requestLog, '')
  const script = await fauxScript(root, { requestLog, responses })
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script } })
  const cookie = await exchange(sidecar)
  return { dirs, requestLog, sidecar, cookie, api: client(sidecar, cookie), stream: await connect(sidecar, cookie) }
}

async function openSession(api: ReturnType<typeof client>, stream: Stream, workspacePath: string) {
  const workspace = (await api.post(API_ROUTES.workspaces, { path: workspacePath })).body as { id: string; path: string }
  const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: workspace.id })).body.id as string
  expect((await api.put(permissionPaths.sessionPermissionMode(sessionId), { mode: 'full-access' })).status).toBe(200)
  stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
  return { workspace, sessionId }
}

async function send(api: ReturnType<typeof client>, stream: Stream, sessionId: string, text: string) {
  const before = runEnds(stream, sessionId)
  expect((await api.post(apiPaths.sessionMessages(sessionId), { text })).status).toBe(202)
  await stream.waitFor(() => runEnds(stream, sessionId) > before)
}

describe('指令文件', () => {
  it('系统提示含用户级与项目级指令（用户 → 仓库根 → Workspace，@import 在引入者之前，越界与代码块中的不展开）；改文件后下一次 Run 读到新内容；项目设置关闭后不注入', async () => {
    const root = await tempDir()
    const { workspace: workspacePath } = await writeLayeredRepo(root)
    const { dirs, requestLog, sidecar, api, stream } = await boot(root, [{ content: 'one' }, { content: 'two' }, { content: 'three' }])
    await writeCokoHome(dirs, 'AGENTS.md', 'USER-RULE\n')
    const { workspace, sessionId } = await openSession(api, stream, workspacePath)
    const repo = join(workspace.path, '..')

    await send(api, stream, sessionId, 'first')
    const [first] = await requests(requestLog)
    const leading = first![0]!
    expect(leading.role).toBe('system')
    expect(Object.keys(leading.sections!)).toEqual(['coko.base', 'environment', 'instructions'])
    expect(leading.sections!['coko.base']).toBe(DEFAULT_SYSTEM_PROMPT)
    const section = leading.sections!.instructions!
    expect(section.startsWith('<instructions>\nCodebase and user instructions are shown below.')).toBe(true)
    const order = ['USER-RULE', 'STYLE-RULE', 'REPO-RULE', 'APP-RULE-V1'].map((marker) => section.indexOf(marker))
    expect(order.every((at) => at >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(section).toContain('<instruction_file path="' + join(dirs.cokoHome, 'AGENTS.md') + '" scope="user">')
    expect(section).toContain('<instruction_file path="' + join(repo, 'docs', 'style.md') + '" scope="project">')
    expect(section).toContain('<instruction_file path="' + join(workspace.path, 'CLAUDE.md') + '" scope="project">')
    for (const absent of ['OUTSIDE-MARKER', 'FENCED-MARKER', 'PKG-RULE']) expect(section).not.toContain(absent)

    // 修改 Workspace 的指令文件：下一次 Run 读到新内容。
    const app = join(workspace.path, 'CLAUDE.md')
    await writeFile(app, 'APP-RULE-V2 changed\n')
    const later = new Date(Date.now() + 5_000)
    await utimes(app, later, later)
    await send(api, stream, sessionId, 'second')
    const second = (await requests(requestLog))[1]![0]!.sections!.instructions!
    expect(second).toContain('APP-RULE-V2 changed')
    expect(second).not.toContain('APP-RULE-V1')

    // 项目设置关闭指令：不注入，开头的系统消息仍含基础提示与环境。
    await writeTree(workspace.path, { '.coko/settings.json': JSON.stringify({ instructions: { enabled: false } }) })
    await send(api, stream, sessionId, 'third')
    const third = (await requests(requestLog))[2]![0]!
    expect(third.sections!['coko.base']).toBe(DEFAULT_SYSTEM_PROMPT)
    expect(Object.keys(third.sections!)).toEqual(['coko.base', 'environment'])
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })

    // 日志（文件 sink 在退出时落盘）：前两次 Run 各一条 instructions loaded，关闭后没有。
    const loaded = (await logRecords(dirs.logDir)).filter((r) => r.message === 'instructions loaded')
    expect(loaded).toHaveLength(2)
    expect(loaded[0]!.properties).toMatchObject({ sessionId, chars: expect.any(Number) })
    expect((loaded[0]!.properties.files as { scope: string }[]).map((f) => f.scope)).toEqual(['user', 'project', 'project', 'project'])
    expect((loaded[0]!.properties.diagnostics as { code: string }[]).map((d) => d.code)).toEqual(['import-outside-boundary'])
  })

  it('read 子目录 pkg/a.ts 后该次 toolResult 末尾附 pkg/AGENTS.md；同一运行时再次触及不重复；条目读回与回放一致', async () => {
    const root = await tempDir()
    const { workspace: workspacePath } = await writeLayeredRepo(root)
    const { requestLog, sidecar, cookie, api, stream } = await boot(root, [
      { content: [read('r1', 'pkg/a.ts')] },
      { content: [read('r2', 'pkg/b.ts')] },
      { content: 'done' },
      { content: [read('r3', 'pkg/a.ts')] },
      { content: 'done again' },
    ])
    const { workspace, sessionId } = await openSession(api, stream, workspacePath)
    const nested = join(workspace.path, 'pkg', 'AGENTS.md')

    await send(api, stream, sessionId, 'read pkg')
    await send(api, stream, sessionId, 'read again')
    const results = toolResults(stream.entries(sessionId))
    expect(results.map((r) => r.toolCallId)).toEqual(['r1', 'r2', 'r3'])
    const [r1, r2, r3] = results
    const r1Texts = r1!.content.map((b) => b.text ?? '')
    expect(r1Texts[0]).toContain('export const a = 1')
    expect(r1Texts.at(-1)).toBe('<instruction_file path="' + nested + '" scope="nested">\nPKG-RULE\n</instruction_file>')
    expect(r1Texts.map((t) => nestedInstructionPath(t)).filter(Boolean)).toEqual([nested])
    // 同一 Run 的下一批与下一个 Run：都不再附加。
    for (const result of [r2!, r3!]) expect(result.content.some((b) => nestedInstructionPath(b.text ?? '') !== undefined)).toBe(false)

    // 模型在下一次请求中看到的就是附加后的结果。
    const log = await requests(requestLog)
    const sent = log[1]!.find((m) => m.role === 'toolResult' && m.toolCallId === 'r1')!
    expect(JSON.stringify(sent.content)).toContain('PKG-RULE')
    // 开始时的系统提示不含嵌套指令。
    expect(log[0]![0]!.sections!.instructions).not.toContain('PKG-RULE')

    // 重新订阅（afterSeq 0）读回的条目与实时推送的相同。
    const live = stream.entries(sessionId)
    const again = await connect(sidecar, cookie)
    again.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await again.waitFor(isRunEnd(sessionId))
    await again.waitFor(() => again.entries(sessionId).length >= live.length)
    expect(again.entries(sessionId)).toEqual(live)
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})
