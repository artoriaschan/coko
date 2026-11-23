// Session Reference：真实 Sidecar（faux 模型）。提交的文本中的 @session:<id> 指向同一 Project 的另一个根 Session 时，同一条 user message
// 追加 <session_reference> 块。断言 faux requestLog 中实际发给模型的内容块与读回的条目：记录只有用户文本与助手文字，压缩过的以摘要
// 打头，被回退的消息不出现，命令消息为原始调用，超过 50KB 时截断；范围之外只有一行说明，不存在的 id 不产生块。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, checkpointPaths, handoffPaths, permissionPaths, runPaths, type SessionEntryRecord } from '@coko/protocol'
import { createGitWorkspace } from '../fixtures/git/index.ts'
import { DATE_TEST_BLOCK as dateBlock, DATE_TEST_ENV } from './date-state-fixture.ts'
import { tempDir } from './sidecar-harness.ts'
import { bootAgents, call, runEnds, starts } from './sidecar-subagents-harness.ts'

type Block = { type: string; text?: string }

async function boot(responses: unknown[], options: { script?: Record<string, unknown>; env?: Record<string, string>; workspace?: string } = {}) {
  const workspace = options.workspace ?? join(await tempDir(), 'ws')
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

describe('文件引用与会话引用共用额度', () => {
  it('混合超过 10 个、合计超过 200KB：按出现顺序附上，超出的各有一行说明；File Reference 的说明文本不变', { timeout: 90_000 }, async () => {
    const { stream, session, send, lastUser, requests, wsPath, sidecar, dirs } = await boot([
      { content: 'A-REPLY' },
      { content: 'TAIL-REPLY' },
      { content: 'f'.repeat(5_000) },
      { content: 'r1' },
      { content: 'r2' },
      { content: 'r3' },
      { content: 'seen' },
      { content: 'seen' },
    ])
    for (let i = 0; i < 8; i++) await writeFile(join(wsPath, `f${i}.txt`), `F${i}`)
    for (let i = 0; i < 5; i++) await writeFile(join(wsPath, `big${i}.txt`), Array.from({ length: 450 }, () => 'y'.repeat(99)).join('\n'))
    const a = await session('短会话')
    await send(a, 'A-MESSAGE')
    const tail = await session('放不下')
    await send(tail, 't'.repeat(300))
    const fill = await session('填满')
    await send(fill, 'q')
    const long = await session('长会话')
    for (let i = 1; i <= 3; i++) await send(long, `m${i} ${'x'.repeat(10_000)}`)
    const b = await session('实施')
    const aBlock = block(a, '短会话', '[User]: A-MESSAGE\n\n[Assistant]: A-REPLY')
    const fileBlock = (path: string, body: string) => `<file_reference path="${path}">\n${body}\n</file_reference>`
    const sentBlocks = async () =>
      (
        (await requests())
          .at(-1)!
          .filter((m) => m.role === 'user')
          .at(-1)!.content as Block[]
      )
        .map((c) => c.text)
        .filter((t) => !t?.startsWith('<state_update'))

    // 数量：说明块（引用自己）计入 10 个；第 11 个会话引用与第 12 个文件引用各附自己的说明。
    const files = Array.from({ length: 7 }, (_, i) => `@f${i}.txt`).join(' ')
    const counted = `@session:${b} ${files} @session:${a} @session:${tail} @session:${fill} @f7.txt`
    await send(b, counted)
    expect(lastUser(b)).toEqual([
      counted,
      block(b, '实施', '[Not attached: this session cannot be referenced.]'),
      ...Array.from({ length: 7 }, (_, i) => fileBlock(`f${i}.txt`, `F${i}`)),
      aBlock,
      block(tail, '放不下', `[User]: ${'t'.repeat(300)}\n\n[Assistant]: TAIL-REPLY`),
      block(fill, '填满', '[Not attached: at most 10 references per message.]'),
      fileBlock('f7.txt', '[Not attached: at most 10 file references per message.]'),
    ])
    expect(await sentBlocks()).toEqual(lastUser(b))

    // 字节：4 个约 45KB 的文件之后，长会话按剩余额度截断，填满后放得下的短记录照常附上，放不下的会话与文件各附自己的说明。
    const bigs = Array.from({ length: 4 }, (_, i) => `@big${i}.txt`).join(' ')
    const budgeted = `${bigs} @session:${long} @session:${fill} @session:${a} @session:${tail} @big4.txt`
    await send(b, budgeted)
    const blocks = lastUser(b) as string[]
    expect(blocks).toHaveLength(10)
    expect(
      blocks[5]!.startsWith(
        `<session_reference id="${long}" title="长会话">\n[1 earlier message omitted to fit the session reference limit]\n\n[Assistant]: r1\n\n[User]: m2 x`,
      ),
    ).toBe(true)
    expect(blocks[5]!.endsWith('x\n\n[Assistant]: r3\n</session_reference>')).toBe(true)
    expect(blocks[5]).not.toContain('m1 x')
    expect(
      blocks[6]!.startsWith(
        `<session_reference id="${fill}" title="填满">\n[1 earlier message omitted to fit the session reference limit]\n\n[Assistant]: [Earlier part of this message omitted to fit the session reference limit]\nfff`,
      ),
    ).toBe(true)
    expect(blocks[6]!.endsWith('fff\n</session_reference>')).toBe(true)
    expect(blocks.slice(7)).toEqual([
      aBlock,
      block(tail, '放不下', '[Not attached: references in this message exceed 200KB in total.]'),
      fileBlock('big4.txt', '[Not attached: file references in this message exceed 200KB in total.]'),
    ])
    const attachedBytes = blocks
      .slice(1)
      .map((text) => text.slice(text.indexOf('\n') + 1, text.lastIndexOf('\n')))
      .filter((body) => !body.startsWith('[Not attached'))
      .reduce((sum, body) => sum + Buffer.byteLength(body, 'utf-8'), 0)
    expect(attachedBytes).toBeLessThanOrEqual(200 * 1024)
    expect(attachedBytes).toBeGreaterThan(200 * 1024 - 200)
    expect(await sentBlocks()).toEqual(blocks)
    expect(stream.invalidEntries).toEqual([])

    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
    const log = (await readFile(join(dirs.logDir, 'sidecar.jsonl'), 'utf8')).split('\n').filter((line) => line.includes('references attached'))
    expect(log.at(-2)).toContain('"sessions":{"count":4,"statuses":{"not-referable":1,"attached":2,"skipped":1},"truncated":0}')
    expect(log.at(-1)).toContain('"sessions":{"count":4,"statuses":{"attached":3,"skipped":1},"truncated":2}')
  })
})

describe('其余展开入口', () => {
  it('首次发送按新建 Session 所属的 Project 判定范围，标题中显示被引用会话的标题；Run 进行中的追加指令同样展开', { timeout: 60_000 }, async () => {
    const chats = join(await tempDir(), 'chats')
    const { api, stream, subscribe, session, send, lastUser, requests } = await boot(
      [
        { match: 'COKO_SESSION_TITLE', content: '生成的标题' },
        { content: 'A-REPLY' },
        { content: 'seen' },
        { content: 'seen' },
        { content: [call('bash', 'b1', { command: 'sleep 2 && echo slept' })] },
        { content: 'adjusted' },
      ],
      { env: { COKO_CHATS_ROOT: chats } },
    )
    const a = await session('方案')
    await send(a, 'A-MESSAGE')
    const aBlock = block(a, '方案', '[User]: A-MESSAGE\n\n[Assistant]: A-REPLY')
    const projectId = (await api.get(apiPaths.session(a))).body.session.projectId as string
    expect(projectId).toEqual(expect.any(String))
    const firstSend = async (body: Record<string, unknown>) => {
      const created = await api.post(API_ROUTES.firstSend, body)
      expect(created.status).toBe(201)
      const id = created.body.session.id as string
      await subscribe(id)
      await stream.waitFor(() => runEnds(stream, id).length >= 1)
      return id
    }

    // 同一 Project 的新对话：首条消息附上记录；标题请求中的文本以被引用会话的标题显示，不含 id。
    const inProject = await firstSend({ draftId: 'in-project', projectId, text: `接着 @session:${a} 的结论` })
    expect(lastUser(inProject)).toEqual([`接着 @session:${a} 的结论`, aBlock])
    await stream.waitFor((m) => m.type === 'session_title' && m.sessionId === inProject)
    expect((await api.get(apiPaths.session(inProject))).body.session.title).toBe('生成的标题')
    const titleRequest = (await requests()).find((messages) => JSON.stringify(messages).includes('COKO_SESSION_TITLE'))!
    expect(JSON.parse(titleRequest.find((m) => m.role === 'user')!.content as string)).toEqual({ text: '接着 @方案 的结论', filenames: [] })

    // 独立对话引用项目会话：只有说明。标题请求没有可用的回复，标题保持由消息文本派生的那一个。
    const standalone = await firstSend({ draftId: 'standalone', text: `接着 @session:${a} 的结论` })
    expect(lastUser(standalone)).toEqual([`接着 @session:${a} 的结论`, block(a, '方案', '[Not attached: the session does not belong to the current project.]')])
    expect((await api.get(apiPaths.session(standalone))).body.session.title).toBe('接着 @方案 的结论')

    // 追加指令。
    const b = await session('实施')
    expect((await api.put(permissionPaths.sessionPermissionMode(b), { mode: 'full-access' })).status).toBe(200)
    await api.post(apiPaths.sessionMessages(b), { text: 'run it' })
    await stream.waitFor((m) => m.type === 'progress' && m.sessionId === b && m.event.type === 'tool_start')
    expect((await api.post(runPaths.sessionSteer(b), { text: `补充 @session:${a}` })).status).toBe(204)
    await stream.waitFor(() => runEnds(stream, b).length >= 1)
    expect(lastUser(b)).toEqual([`补充 @session:${a}`, aBlock])
    const sent = (await requests())
      .at(-1)!
      .filter((m) => m.role === 'user')
      .at(-1)!.content as Block[]
    expect(sent.map((c) => c.text)).toEqual([`补充 @session:${a}`, aBlock])
  })

  it('Worktree Session：首次发送带 newWorktree 时按同一 Project 判定范围；Worktree Session 作为被引用方照常附上记录', { timeout: 60_000 }, async () => {
    const fixture = await createGitWorkspace()
    onTestFinished(() => fixture.dispose())
    const { api, stream, subscribe, session, send, lastUser } = await boot([{ content: 'A-REPLY' }, { content: 'W-REPLY' }, { content: 'seen' }], {
      workspace: fixture.root,
      env: fixture.env,
    })
    const a = await session('方案')
    await send(a, 'A-MESSAGE')
    const projectId = (await api.get(apiPaths.session(a))).body.session.projectId as string
    const text = `接着 @session:${a} 的结论`
    const created = await api.post(API_ROUTES.firstSend, { draftId: 'worktree', projectId, newWorktree: true, text })
    expect(created.status).toBe(201)
    expect(created.body.session).toMatchObject({ projectId, worktree: { name: expect.any(String) } })
    const w = created.body.session.id as string
    await subscribe(w)
    await stream.waitFor(() => runEnds(stream, w).length >= 1)
    expect(lastUser(w)).toEqual([text, block(a, '方案', '[User]: A-MESSAGE\n\n[Assistant]: A-REPLY')])

    const b = await session('实施')
    await send(b, `看 @session:${w}`)
    expect(lastUser(b)).toEqual([`看 @session:${w}`, block(w, '接着 @方案 的结论', `[User]: ${text}\n\n[Assistant]: W-REPLY`)])
  })

  it('被引用会话正在运行：提交不等待，块中只有已提交的条目', { timeout: 60_000 }, async () => {
    const { api, stream, session, send, lastUser, submit } = await boot([
      { match: 'REF-MARK', content: 'seen' },
      { match: 'RUN-IT', content: [{ type: 'text', text: 'RUNNING-TEXT' }, call('bash', 'b1', { command: 'sleep 3 && echo slept' })] },
      { match: 'RUN-IT', content: 'AFTER-TOOL' },
    ])
    const a = await session('运行中')
    expect((await api.put(permissionPaths.sessionPermissionMode(a), { mode: 'full-access' })).status).toBe(200)
    await submit(a, 'RUN-IT')
    await stream.waitFor((m) => m.type === 'progress' && m.sessionId === a && m.event.type === 'tool_start')
    const b = await session('实施')
    // 同一个会话在一条消息里只附一次。
    const text = `REF-MARK @session:${a} 再提一次 @session:${a}`
    await send(b, text)
    // b 的 Run 已结束，a 仍在运行：没有等待 a。
    expect(runEnds(stream, a)).toEqual([])
    expect(lastUser(b)).toEqual([text, block(a, '运行中', '[User]: RUN-IT\n\n[Assistant]: RUNNING-TEXT')])
    await stream.waitFor(() => runEnds(stream, a).length >= 1)
    expect(JSON.stringify(stream.entries(a))).toContain('AFTER-TOOL')
  })
})

describe('引用块的善后', () => {
  it('回退与分叉到带两种引用的消息：返回文本只有原文，命令消息为原始调用；再次提交仍展开；分叉出的会话保留已附上的记录', { timeout: 60_000 }, async () => {
    const { api, stream, session, send, lastUser, requests } = await boot([
      { content: 'A-REPLY' },
      { content: 'first' },
      { content: 'second' },
      { content: 'third' },
      { content: 'again' },
      { content: 'HANDOFF-SUMMARY' },
    ])
    const a = await session('方案')
    await send(a, 'A-MESSAGE')
    const b = await session('实施')
    const fileBlock = '<file_reference path="src/a.ts">\nFILE-MARK\n\n</file_reference>'
    const sessionBlock = block(a, '方案', '[User]: A-MESSAGE\n\n[Assistant]: A-REPLY')
    const first = `先看 @src/a.ts 与 @session:${a}`
    const second = `再看 @session:${a} 和 @src/a.ts`
    const third = `/explain @session:${a}`
    await send(b, first)
    await send(b, second)
    await send(b, third)
    const users = stream.entries(b).filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'user')
    expect(users).toHaveLength(3)

    // Checkpoint 列表中的文本同样只有用户当时输入的文本。
    const checkpoints = (await api.get(checkpointPaths.sessionCheckpoints(b))).body.checkpoints as { text: string }[]
    expect(checkpoints.map((c) => c.text)).toEqual([first, second, third])

    const forked = await api.post(checkpointPaths.sessionFork(b), { targetSeq: users[1]!.seq })
    expect([forked.status, forked.body.text]).toEqual([201, second])
    const copy = (await api.get(apiPaths.session(forked.body.sessionId as string))).body.entries as SessionEntryRecord[]
    const copied = copy.filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'user')
    expect(copied).toHaveLength(1)
    expect((copied[0]!.payload as { content: Block[] }).content.map((c) => c.text).filter((t) => !t?.startsWith('<state_update'))).toEqual([
      first,
      fileBlock,
      sessionBlock,
    ])

    const command = await api.post(checkpointPaths.sessionRewind(b), { targetSeq: users[2]!.seq, mode: 'conversation' })
    expect([command.status, command.body.text]).toEqual([200, third])
    const rewound = await api.post(checkpointPaths.sessionRewind(b), { targetSeq: users[1]!.seq, mode: 'conversation' })
    expect([rewound.status, rewound.body.text]).toEqual([200, second])
    await send(b, rewound.body.text as string)
    expect(lastUser(b)).toEqual([second, sessionBlock, fileBlock])

    // 交接不复制消息：摘要请求使用源会话的有效上下文，其中已附上的块原样在。
    expect((await api.post(handoffPaths.handoff(b), { instructions: '继续实施', target: { kind: 'current' } })).status).toBe(202)
    await stream.waitFor(() => stream.entries(b).some((e) => e.kind === 'handoff'))
    const handoffTexts = (await requests()).at(-1)!.flatMap((m) => (Array.isArray(m.content) ? (m.content as Block[]).map((c) => c.text) : [m.content]))
    expect(handoffTexts.at(-1)).toContain('<next-goal>\n继续实施\n</next-goal>')
    expect(handoffTexts.filter((t) => t === sessionBlock)).toHaveLength(2)
  })

  it('带会话引用的消息进入压缩：摘要请求中只有一行“附了哪次会话”，没有被引用会话的记录正文', { timeout: 90_000 }, async () => {
    const big = (n: number, c: string) => c.repeat(n)
    const { stream, session, send, lastUser, requests } = await boot(
      [{ content: 'TRANSCRIPT-REPLY' }, { content: 'ok1' }, { content: 'ok2' }, { content: 'ok3' }, { content: '## Goal\nSUMMARY-MARK' }],
      { script: { contextWindow: 60_000, maxTokens: 4_000 } },
    )
    const a = await session('方案 "讨论"')
    await send(a, 'TRANSCRIPT-MARK')
    const b = await session('实施')
    await send(b, `按 @session:${a} 继续 ${big(4_000, 'x')}`)
    // 前置：记录确实附在这条消息上。
    expect(lastUser(b)[1]).toBe(block(a, '方案 &quot;讨论&quot;', '[User]: TRANSCRIPT-MARK\n\n[Assistant]: TRANSCRIPT-REPLY'))
    await send(b, big(48_000, 'y'))
    await send(b, big(40_000, 'w'))
    await send(b, '/compact')
    expect(stream.entries(b).filter((e) => e.kind === 'compaction')).toHaveLength(1)
    const summaries = (await requests())
      .map((messages) => messages.at(-1)!.content)
      .map((content) => (typeof content === 'string' ? content : (content as Block[]).map((c) => c.text ?? '').join('\n')))
      .filter((text) => text.startsWith('<conversation>'))
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toContain(`\n按 @session:${a} 继续 xxx`)
    expect(summaries[0]).toContain('x\n[session reference attached: 方案 "讨论"]\n')
    for (const mark of ['TRANSCRIPT-MARK', 'TRANSCRIPT-REPLY', '<session_reference']) expect(summaries[0]).not.toContain(mark)
  })
})
