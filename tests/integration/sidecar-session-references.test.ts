// Session Reference：真实 Sidecar（faux 模型）。提交的文本中的 @session:<id> 指向同一 Project 的另一个根 Session 时，同一条 user message
// 追加 <session_reference> 块。断言 faux requestLog 中实际发给模型的内容块与读回的条目：记录只有用户文本与助手文字，压缩过的以摘要
// 打头，被回退的消息不出现，命令消息为原始调用，超过 50KB 时截断；范围之外只有一行说明，不存在的 id 不产生块。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, checkpointPaths, type SessionEntryRecord } from '@coko/protocol'
import { DATE_TEST_BLOCK as dateBlock, DATE_TEST_ENV } from './date-state-fixture.ts'
import { tempDir } from './sidecar-harness.ts'
import { bootAgents, call, runEnds, starts } from './sidecar-subagents-harness.ts'

type Block = { type: string; text?: string }

async function boot(responses: unknown[], options: { script?: Record<string, unknown>; env?: Record<string, string> } = {}) {
  const workspace = join(await tempDir(), 'ws')
  await mkdir(join(workspace, '.coko', 'commands'), { recursive: true })
  await mkdir(join(workspace, 'src'))
  await writeFile(join(workspace, 'src', 'a.ts'), 'FILE-MARK\n')
  await writeFile(join(workspace, 'tool-CALL-MARK.txt'), 'RESULT-MARK\n')
  await writeFile(join(workspace, '.coko', 'commands', 'explain.md'), 'TEMPLATE-MARK Explain $ARGUMENTS in one paragraph.\n')
  const env = await bootAgents(responses, { workspace, env: { ...DATE_TEST_ENV, ...options.env }, ...(options.script ? { script: options.script } : {}) })
  const { api, stream } = env
  const session = async (title: string, workspaceId = env.workspaceId) => {
    const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId, title })).body.id as string
    await env.subscribe(sessionId)
    return sessionId
  }
  /** 提交并等到该 Run 结束。 */
  const send = async (sessionId: string, text: string) => {
    const before = runEnds(stream, sessionId).length
    await env.submit(sessionId, text)
    await stream.waitFor(() => runEnds(stream, sessionId).length > before, 30_000)
  }
  /** 该 Session 最后一条 user message 中除 State Update 之外的文本块。 */
  const lastUser = (sessionId: string) =>
    (
      stream
        .entries(sessionId)
        .filter((e: SessionEntryRecord) => e.kind === 'message' && (e.payload as { role: string }).role === 'user')
        .at(-1)!.payload as { content: Block[] }
    ).content
      .filter((block) => !block.text?.startsWith('<state_update'))
      .map((block) => block.text)
  return { ...env, session, send, lastUser }
}

const block = (id: string, title: string, body: string) => `<session_reference id="${id}" title="${title}">\n${body}\n</session_reference>`

describe('Session Reference 展开', () => {
  it('引用两轮对话的会话：同一条 user message 含原文与 <session_reference> 块，块中只有用户文本与助手文字', async () => {
    const { api, stream, session, send, requests, sidecar, dirs } = await boot([
      {
        content: [{ type: 'thinking', thinking: 'THINK-MARK' }, { type: 'text', text: '我先看看。' }, call('read', 'c1', { path: 'tool-CALL-MARK.txt' })],
      },
      { content: 'A-REPLY-1' },
      { content: 'A-REPLY-2' },
      { content: 'seen' },
    ])
    const a = await session('方案 "讨论"')
    await send(a, '先看 @src/a.ts')
    await send(a, '第二轮')
    // 前置：被引用会话里确实有文件内容、工具调用与工具结果。
    const source = JSON.stringify(stream.entries(a))
    for (const mark of ['FILE-MARK', 'CALL-MARK', 'RESULT-MARK']) expect(source).toContain(mark)

    const b = await session('实施')
    const text = `按 @session:${a} 的结论继续`
    await send(b, text)
    const entries = stream.entries(b)
    expect(entries.map((e) => (e.kind === 'message' ? (e.payload as { role: string }).role : e.kind))).toEqual([
      'permission_mode',
      'run_start',
      'state_update',
      'user',
      'model_request',
      'assistant',
      'run_end',
    ])
    const expected = [
      { type: 'text', text: dateBlock },
      { type: 'text', text },
      {
        type: 'text',
        text: block(
          a,
          '方案 &quot;讨论&quot;',
          '[User]: 先看 @src/a.ts\n\n[Assistant]: 我先看看。\n\n[Assistant]: A-REPLY-1\n\n[User]: 第二轮\n\n[Assistant]: A-REPLY-2',
        ),
      },
    ]
    expect((entries[3]!.payload as { content: Block[] }).content).toEqual(expected)
    // 实际发给模型的最后一条 user message 相同；重新读回的条目相同。
    const sent = (await requests()).at(-1)!
    expect(sent.filter((m) => m.role === 'user').at(-1)!.content).toEqual(expected)
    const detail = (await api.get(apiPaths.session(b))).body.entries as SessionEntryRecord[]
    expect((detail[3]!.payload as { content: Block[] }).content).toEqual(expected)
    expect(stream.invalidEntries).toEqual([])

    // 引用日志只有数量与状态。
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const log = (await readFile(join(dirs.logDir, 'sidecar.jsonl'), 'utf8')).split('\n').filter((line) => line.includes('references attached'))
    expect(log).toHaveLength(2)
    expect(log[1]).toContain('"sessions":{"count":1,"statuses":{"attached":1},"truncated":0}')
    expect(log[1]).not.toContain('讨论')
    expect(log[1]).not.toContain('A-REPLY')
    expect(log[1]!.split(a)).toHaveLength(1)
  })

  it('被回退的消息不出现；命令消息以原始调用出现，不含模板正文', async () => {
    const { api, stream, session, send, lastUser, requests } = await boot([
      { content: 'KEPT-REPLY' },
      { content: 'REWOUND-REPLY' },
      { content: 'seen' },
      { content: 'EXPLAINED' },
      { content: 'seen' },
    ])
    const rewound = await session('回退过')
    await send(rewound, 'KEPT-MESSAGE')
    await send(rewound, 'REWOUND-MESSAGE')
    const target = stream.entries(rewound).find((e) => JSON.stringify(e.payload).includes('REWOUND-MESSAGE'))!
    expect((await api.post(checkpointPaths.sessionRewind(rewound), { targetSeq: target.seq, mode: 'conversation' })).status).toBe(200)
    const b = await session('实施')
    await send(b, `@session:${rewound}`)
    expect(lastUser(b)).toEqual([`@session:${rewound}`, block(rewound, '回退过', '[User]: KEPT-MESSAGE\n\n[Assistant]: KEPT-REPLY')])

    const command = await session('命令')
    await send(command, '/explain @src/a.ts')
    // 前置：被引用会话的 user message 是模板展开后的文本，并附了文件。
    expect(JSON.stringify(stream.entries(command))).toContain('TEMPLATE-MARK Explain @src/a.ts')
    await send(b, `再看 @session:${command}.`)
    expect(lastUser(b)).toEqual([`再看 @session:${command}.`, block(command, '命令', '[User]: /explain @src/a.ts\n\n[Assistant]: EXPLAINED')])
    const sent = JSON.stringify(
      (await requests())
        .at(-1)!
        .filter((m) => m.role === 'user')
        .at(-1),
    )
    expect(sent).toContain('[User]: /explain @src/a.ts')
    for (const mark of ['TEMPLATE-MARK', 'FILE-MARK']) expect(sent).not.toContain(mark)
  })

  it('压缩过的会话：块以摘要打头，摘要之前的消息不出现', { timeout: 90_000 }, async () => {
    const big = (n: number, c: string) => c.repeat(n)
    const { stream, session, send, lastUser } = await boot(
      [{ content: 'ok1' }, { content: 'ok2' }, { content: 'ok3' }, { content: '## Goal\nSUMMARY-MARK' }, { content: 'AFTER-REPLY' }, { content: 'seen' }],
      { script: { contextWindow: 60_000, maxTokens: 4_000 } },
    )
    const a = await session('长会话')
    await send(a, `OLD-MARK ${big(4_000, 'x')}`)
    await send(a, big(48_000, 'y'))
    await send(a, big(40_000, 'w'))
    await send(a, '/compact')
    expect(stream.entries(a).filter((e) => e.kind === 'compaction')).toHaveLength(1)
    await send(a, 'AFTER-COMPACT')
    const b = await session('实施')
    await send(b, `@session:${a}`)
    const [, reference] = lastUser(b)
    expect(reference!.startsWith(`<session_reference id="${a}" title="长会话">\n[Summary of the earlier conversation]: ## Goal\nSUMMARY-MARK`)).toBe(true)
    expect(reference!.endsWith('[User]: AFTER-COMPACT\n\n[Assistant]: AFTER-REPLY\n</session_reference>')).toBe(true)
    expect(reference).not.toContain('OLD-MARK')
  })

  it('超过 50KB 的会话：块不超过上限，最近的消息在，开头注明省略的条数', { timeout: 60_000 }, async () => {
    const { session, send, lastUser, sidecar, dirs } = await boot([
      ...Array.from({ length: 6 }, (_, i) => ({ content: `reply-${i + 1}` })),
      { content: 'seen' },
    ])
    const a = await session('大会话')
    for (let i = 1; i <= 6; i++) await send(a, `m${i} ${'x'.repeat(12_000)}`)
    const b = await session('实施')
    await send(b, `@session:${a}`)
    const [, reference] = lastUser(b)
    const body = reference!.slice(reference!.indexOf('\n') + 1, reference!.lastIndexOf('\n'))
    expect(Buffer.byteLength(body, 'utf-8')).toBeLessThanOrEqual(50 * 1024)
    // 12 条（6 轮，每轮约 12KB）中放得下最近的 4 轮与再往前的一条短回复；省略 m1、reply-1 与 m2。
    expect(body.startsWith('[3 earlier messages omitted to fit the session reference limit]\n\n[Assistant]: reply-2\n\n[User]: m3 xxx')).toBe(true)
    expect(body.endsWith('\n\n[Assistant]: reply-6')).toBe(true)
    expect(body).not.toContain('m2 xxx')
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const log = (await readFile(join(dirs.logDir, 'sidecar.jsonl'), 'utf8')).split('\n').filter((line) => line.includes('references attached'))
    expect(log.at(-1)).toContain('"sessions":{"count":1,"statuses":{"attached":1},"truncated":1}')
  })

  it('范围之外：另一个 Project、当前会话自己、子代理会话各附一行说明；不存在的 id 不产生块；已归档的照常附上', { timeout: 90_000 }, async () => {
    const { api, stream, session, send, lastUser, root } = await boot([
      { match: 'PARENT-1', content: [call('agent', 'a1', { description: 'read notes', prompt: 'CHILD-MARK read notes.txt', subagent_type: 'explore' })] },
      { match: 'CHILD-MARK', content: 'CHILD-REPLY' },
      { match: 'PARENT-1', content: 'parent done' },
      { content: 'OTHER-REPLY' },
      { content: 'ARCHIVED-REPLY' },
      { content: 'seen' },
      { content: 'seen' },
    ])
    const otherDir = join(root, 'other-project')
    await mkdir(otherDir)
    const otherWorkspace = (await api.post(API_ROUTES.workspaces, { path: otherDir })).body.id as string
    const other = await session('别的项目', otherWorkspace)
    await send(other, 'OTHER-MARK')
    const archived = await session('已归档')
    await send(archived, 'ARCHIVED-MESSAGE')
    expect((await api.post(apiPaths.sessionArchive(archived), {})).status).toBe(200)
    const b = await session('实施')
    await send(b, 'PARENT-1 delegate')
    const child = starts(stream, b)[0]!.agentId
    const childDetail = (await api.get(apiPaths.session(child))).body as { session: { title: string; parentSessionId: string } }
    expect(childDetail.session.parentSessionId).toBe(b)

    const text = `@session:${other} 与 @session:${b} 与 @session:${child} 与 @session:nope 与 @session:${archived}`
    await send(b, text)
    const blocks = lastUser(b)
    expect(blocks).toEqual([
      text,
      block(other, '别的项目', '[Not attached: the session does not belong to the current project.]'),
      block(b, '实施', '[Not attached: this session cannot be referenced.]'),
      block(child, childDetail.session.title, '[Not attached: this session cannot be referenced.]'),
      block(archived, '已归档', '[User]: ARCHIVED-MESSAGE\n\n[Assistant]: ARCHIVED-REPLY'),
    ])
    for (const mark of ['OTHER-MARK', 'OTHER-REPLY', 'CHILD-REPLY', 'parent done']) expect(JSON.stringify(blocks.slice(1))).not.toContain(mark)

    // 只有不存在的 id：提交照常被接受，文本原样保留。
    await send(b, '只有 @session:nope')
    expect(lastUser(b)).toEqual(['只有 @session:nope'])
  })

  it('独立对话的范围是其他独立对话：项目会话与独立对话互相只得到说明', { timeout: 60_000 }, async () => {
    const chats = join(await tempDir(), 'chats')
    const { api, stream, subscribe, session, send, lastUser } = await boot(
      [{ content: 'S1-REPLY' }, { content: 'S2-REPLY' }, { content: 'P-REPLY' }, { content: 'seen' }, { content: 'seen' }],
      { env: { COKO_CHATS_ROOT: chats } },
    )
    const standalone = async (draftId: string, text: string) => {
      const created = await api.post(API_ROUTES.firstSend, { draftId, text })
      expect(created.status).toBe(201)
      const { id, projectId } = created.body.session as { id: string; projectId: string | null }
      expect(projectId).toBeNull()
      await subscribe(id)
      await stream.waitFor(() => runEnds(stream, id).length >= 1)
      return id
    }
    const s1 = await standalone('d1', 'STANDALONE-MARK')
    const s2 = await standalone('d2', 'second')
    const project = await session('项目会话')
    await send(project, 'PROJECT-MARK')

    await send(s2, `@session:${s1} 和 @session:${project}`)
    const [, first, second] = lastUser(s2)
    expect(first).toMatch(
      new RegExp(`^<session_reference id="${s1}" title="[^"]*">\\n\\[User\\]: STANDALONE-MARK\\n\\n\\[Assistant\\]: S1-REPLY\\n</session_reference>$`),
    )
    expect(second).toBe(block(project, '项目会话', '[Not attached: the session does not belong to the current project.]'))

    await send(project, `@session:${s1}`)
    const [, fromProject] = lastUser(project)
    expect(fromProject).toMatch(
      /^<session_reference id="[^"]+" title="[^"]*">\n\[Not attached: the session does not belong to the current project\.\]\n<\/session_reference>$/,
    )
  })
})
