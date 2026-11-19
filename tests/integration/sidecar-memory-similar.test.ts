// 新建记忆时返回相近条目：真实 Sidecar（faux 模型）经协议驱动，同一组用例在 FTS5 与强制降级（COKO_TEST_NO_FTS=1）下各跑一次。
// FTS5：memory_write 新建后在结果文字中列出本次 Run 可见的相近条目（id、作用域、来源、摘要，用户来源注明不能改动）并提示合并与删除；
// 没有相近条目时结果不变；另一项目的项目记忆不列出（对手用例）；不属于项目的 Run 只与用户级比较；带 id 替换时不查找；details 不变。
// 降级：保存照常，结果不列出相近条目。
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, memoryPaths, permissionPaths, type MemoryEntry } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir, type SidecarDirs, type Stream } from './sidecar-harness.ts'

type Api = ReturnType<typeof client>

/** 结果中列出的相近条目行。 */
const listed = (text: string) => text.split('\n').filter((line) => line.startsWith('- id: '))
const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })
const write = (id: string, args: Record<string, unknown>) => ({ content: [toolCall(id, 'memory_write', args)] })

const modes = [
  { name: 'FTS5', env: {} as Record<string, string>, fts: true },
  { name: '强制降级（COKO_TEST_NO_FTS=1）', env: { COKO_TEST_NO_FTS: '1' } as Record<string, string>, fts: false },
]

async function boot(dirs: SidecarDirs, root: string, name: string, env: Record<string, string>, responses: unknown[]) {
  const script = await fauxScript(root, { responses }, `${name}.json`)
  const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, ...env } })
  const cookie = await exchange(sidecar)
  return { sidecar, api: client(sidecar, cookie), stream: await connect(sidecar, cookie) }
}

async function open(api: Api, stream: Stream, workspaceId: string) {
  const id = (await api.post(API_ROUTES.sessions, { workspaceId })).body.id as string
  expect((await api.put(permissionPaths.sessionPermissionMode(id), { mode: 'accept-edits' })).status).toBe(200)
  stream.send({ type: 'subscribe', sessionId: id, afterSeq: 0 })
  await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === id)
  return id
}

const runEnds = (stream: Stream, id: string) => stream.entries(id).filter((e) => e.kind === 'run_end').length
async function send(api: Api, stream: Stream, id: string, text: string) {
  const before = runEnds(stream, id)
  expect((await api.post(apiPaths.sessionMessages(id), { text })).status).toBe(202)
  await stream.waitFor(() => runEnds(stream, id) > before)
}

/** 按 toolCallId 取工具结果的文字与 details。 */
function results(stream: Stream, id: string) {
  const all = stream
    .entries(id)
    .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
    .map((e) => e.payload as { toolCallId: string; isError: boolean; details?: unknown; content: { text?: string }[] })
  return (callId: string) => {
    const found = all.find((r) => r.toolCallId === callId)!
    expect(found).toMatchObject({ isError: false })
    return { text: found.content.map((c) => c.text ?? '').join(''), details: found.details as { action: string; memory: MemoryEntry } }
  }
}

describe('新建记忆时返回相近条目', () => {
  it.each(modes)('$name', { timeout: 180_000 }, async ({ env, fts }) => {
    const root = await tempDir()
    const dirs = await sidecarDirs()
    const [p, q] = [join(root, 'p'), join(root, 'q')]
    await Promise.all([mkdir(p), mkdir(q)])

    const first = await boot(dirs, root, 'first', env, [
      // 项目 P 的 Session。
      write('w1', { content: '用户偏好 pnpm 而不是 npm', scope: 'user' }),
      write('w2', { content: '用户偏好使用 pnpm，不要用 npm', scope: 'user' }),
      write('w3', { content: 'Commit messages must follow conventional commits', scope: 'user' }),
      write('w4', { content: 'Q 的发布流程：先在 staging 验证再上线，周五不发布', scope: 'workspace' }),
      { content: 'noted' },
      // 同一 Session 移出项目后：只与用户级比较。
      write('w5', { content: '部署前先运行数据库迁移脚本，然后重启服务' }),
      { content: 'noted' },
      // 项目 Q 的 Session：同一正文（对照）列出 Q 的条目。
      write('w6', { content: 'Q 的发布流程：先在 staging 验证再上线，周五不发布', scope: 'workspace' }),
      { content: 'noted' },
    ])
    const { api, stream } = first
    const wp = (await api.post(API_ROUTES.workspaces, { path: p })).body.id as string
    const wq = (await api.post(API_ROUTES.workspaces, { path: q })).body.id as string
    const add = async (body: Record<string, unknown>) => {
      const created = await api.post(memoryPaths.memories, body)
      expect(created.status).toBe(201)
      return created.body as MemoryEntry
    }
    // 经接口添加的条目来源为用户。
    const commits = await add({ scope: 'user', content: 'Commit messages follow the conventional commits format' })
    const pDeploy = await add({ scope: 'workspace', workspaceId: wp, content: '部署前先运行数据库迁移脚本' })
    const qRelease = await add({ scope: 'workspace', workspaceId: wq, content: 'Q 的发布流程：先在 staging 验证再上线' })

    const s = await open(api, stream, wp)
    await send(api, stream, s, 'remember these')
    let result = results(stream, s)
    const remembered = (r: { text: string; details: { memory: MemoryEntry } }) => `Remembered (id: ${r.details.memory.id}, scope: ${r.details.memory.scope}).`

    // AC-17：没有相近条目时结果与现状相同。
    const w1 = result('w1')
    expect(w1.text).toBe(remembered(w1))
    // AC-16 / AC-21：条目已保存；FTS 时列出已有那条并提示合并与删除，降级时结果不变。details 不变。
    const w2 = result('w2')
    expect(w2.details).toMatchObject({ action: 'created', memory: { content: '用户偏好使用 pnpm，不要用 npm', source: 'model' } })
    expect(w2.text.startsWith(remembered(w2))).toBe(true)
    expect(listed(w2.text)).toEqual(fts ? [`- id: ${w1.details.memory.id}, scope: user, source: agent: 用户偏好 pnpm 而不是 npm`] : [])
    expect(new RegExp(`merge[\\s\\S]*delete the new entry ${w2.details.memory.id} with memory_delete`).test(w2.text)).toBe(fts)
    // AC-18：相近的条目来源为用户时注明不能改动。
    const w3 = result('w3')
    expect(listed(w3.text)).toEqual(
      fts
        ? [
            `- id: ${commits.id}, scope: user, source: user (maintained by the user; you cannot change it): Commit messages follow the conventional commits format`,
          ]
        : [],
    )
    // AC-20：相近的条目只在另一项目的项目记忆中：不列出。
    const w4 = result('w4')
    expect(w4.text).toBe(remembered(w4))
    expect(w4.text).not.toContain(qRelease.id)

    // 不属于项目的 Run：P 的项目记忆不参与比较。
    expect((await api.put(apiPaths.sessionProject(s), { projectId: null })).status).toBe(200)
    await send(api, stream, s, 'remember standalone')
    result = results(stream, s)
    const w5 = result('w5')
    expect(w5.text).toBe(remembered(w5))
    expect(w5.text).not.toContain(pDeploy.id)

    // 对照：在 Q 的 Session 中同一正文列出 Q 的条目（P 的 w4 不可见）。
    const sq = await open(api, stream, wq)
    await send(api, stream, sq, 'remember in Q')
    const w6 = results(stream, sq)('w6')
    expect(listed(w6.text)).toEqual(
      fts ? [`- id: ${qRelease.id}, scope: workspace, source: user (maintained by the user; you cannot change it): Q 的发布流程：先在 staging 验证再上线`] : [],
    )
    expect(await first.sidecar.stop()).toEqual({ code: 0, signal: null })

    // AC-19：带 id 替换时不查找（库中另有相近的 w2）。
    const second = await boot(dirs, root, 'second', env, [
      write('r1', { id: w1.details.memory.id, content: '用户偏好 pnpm 而不是 npm（包括 CI）', scope: 'user' }),
      { content: 'noted' },
    ])
    const r = await open(second.api, second.stream, wp)
    await send(second.api, second.stream, r, 'update it')
    const r1 = results(second.stream, r)('r1')
    expect(r1.text).toBe(`Updated memory ${w1.details.memory.id}.`)
    expect(r1.details).toMatchObject({ action: 'updated', memory: { id: w1.details.memory.id } })
    expect(await second.sidecar.stop()).toEqual({ code: 0, signal: null })
  })
})
