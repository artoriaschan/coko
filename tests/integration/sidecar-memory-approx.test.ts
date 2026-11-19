// Memory 检索的近似匹配：真实 Sidecar（faux 模型）经协议驱动，同一组用例在 FTS5 与强制降级（COKO_TEST_NO_FTS=1）下各跑一次。
// memory_list 的 query 严格匹配为空时，FTS5 下返回相近条目并在第一行注明没有完全匹配；严格匹配有结果时不变；scope 同样生效；
// 另一项目的条目不出现（对手用例）；含 FTS 语法字符的查询按字面处理；/api/memories?query= 仍只做严格匹配。降级时不放宽。
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, memoryPaths, type MemoryEntry } from '@coko/protocol'
import {
  client,
  connect,
  exchange,
  fauxScript,
  openSession,
  sendAndWaitRun,
  sidecarDirs,
  startSidecar,
  tempDir,
  toolCall,
  type Stream,
} from './sidecar-harness.ts'
import { ftsModes } from './sidecar-memory-harness.ts'

const list = (id: string, args: Record<string, unknown>) => ({ content: [toolCall(id, 'memory_list', args)] })

// 与条目“Run docker compose up before integration tests”措辞相近，但“docker-compose”不出现在正文中，严格匹配为空。
const PARAPHRASE = 'run docker-compose before tests'
const OTHER_PROJECT = 'releases ship via staging clusters'
const SYNTAX = 'NEAR(docker "compose" ups*'

describe('Memory 检索的近似匹配', () => {
  it.each(ftsModes)('$name', { timeout: 120_000 }, async ({ env, fts }) => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const [p, q] = [join(root, 'p'), join(root, 'q')]
    await Promise.all([mkdir(p), mkdir(q)])
    const script = await fauxScript(root, {
      responses: [
        // 项目 P 的 Session。
        list('l1', { query: PARAPHRASE }),
        list('l2', { query: PARAPHRASE, scope: 'workspace' }),
        list('l3', { query: 'docker compose' }),
        list('l4', { query: 'yarn berry' }),
        list('l5', { query: OTHER_PROJECT }),
        list('l6', { query: SYNTAX }),
        { content: 'done' },
        // 项目 Q 的 Session：对照，同一查询找到 Q 的条目。
        list('m1', { query: OTHER_PROJECT }),
        { content: 'done' },
      ],
    })
    const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, ...env } })
    const cookie = await exchange(sidecar)
    const api = client(sidecar, cookie)
    const stream = await connect(sidecar, cookie)
    const wp = (await api.post(API_ROUTES.workspaces, { path: p })).body.id as string
    const wq = (await api.post(API_ROUTES.workspaces, { path: q })).body.id as string
    const add = async (body: Record<string, unknown>) => {
      const created = await api.post(memoryPaths.memories, body)
      expect(created.status).toBe(201)
      return created.body as MemoryEntry
    }
    const compose = await add({ scope: 'user', content: 'Run docker compose up before integration tests' })
    await add({ scope: 'workspace', workspaceId: wp, content: 'This workspace deploys with docker and kubernetes manifests' })
    const release = await add({ scope: 'workspace', workspaceId: wq, content: 'Releases ship through the staging cluster first' })

    // AC-25：接口的 query 仍只做严格匹配。
    const strict = await api.get(apiPaths.memorySearch(PARAPHRASE, { workspaceId: wp }))
    expect(strict.status).toBe(200)
    expect(strict.body.memories).toEqual([])

    const run = async (stream: Stream, workspaceId: string) => {
      const id = await openSession(api, stream, workspaceId)
      await sendAndWaitRun(api, stream, id, 'what do we know?')
      const all = stream
        .entries(id)
        .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
        .map((e) => e.payload as { toolCallId: string; isError: boolean; content: { text?: string }[] })
      expect(all.every((r) => !r.isError)).toBe(true)
      return (callId: string) =>
        all
          .find((r) => r.toolCallId === callId)!
          .content.map((c) => c.text ?? '')
          .join('')
    }
    const block = (m: MemoryEntry) => `<entry id="${m.id}" scope="${m.scope}" source="user">\n${m.content}\n</entry>`
    const approx = (query: string, m: MemoryEntry) => `No exact match for "${query}"; showing similar entries instead:\n\n${block(m)}`
    const none = (query: string) => `No memories match "${query}".`

    const result = await run(stream, wp)
    // AC-22 / AC-26：FTS5 下第一行注明没有完全匹配，随后是相近的条目块；降级时为“没有匹配”。
    expect(result('l1')).toBe(fts ? approx(PARAPHRASE, compose) : none(PARAPHRASE))
    // scope 对近似匹配同样生效：相近的条目是用户级，限定 workspace 时没有。
    expect(result('l2')).toBe(none(PARAPHRASE))
    // AC-23：严格匹配有结果时与现状相同。
    expect(result('l3')).toBe(block(compose))
    // AC-24：既没有严格匹配也没有相近条目。
    expect(result('l4')).toBe(none('yarn berry'))
    // 另一项目的条目不出现（对手用例）。
    expect(result('l5')).toBe(none(OTHER_PROJECT))
    // FTS 语法字符按字面处理，不报错。
    expect(result('l6')).toBe(fts ? approx(SYNTAX, compose) : none(SYNTAX))

    const inQ = await run(stream, wq)
    expect(inQ('m1')).toBe(fts ? approx(OTHER_PROJECT, release) : none(OTHER_PROJECT))
    expect(await sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})
