// Memory 检索：真实 Sidecar 经协议驱动，同一组用例在 FTS5 与 LIKE 降级（COKO_TEST_NO_FTS=1）下各跑一次。写入 30 条后按关键词检索
// （GET /api/memories?query= 与 memory_list 的 query），结果集合相同；FTS 下按相关度、LIKE 下按 updatedAt 倒序；Workspace 隔离；
// 至多 20 条；改正文与删除后结果同步；含 FTS 语法字符（引号、星号、NEAR、括号、列名前缀）的查询不报错、按字面匹配。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { API_ROUTES, apiPaths, memoryPaths, type MemoryEntry } from '@coko/protocol'
import { client, connect, exchange, fauxScript, sidecarDirs, startSidecar, tempDir } from './sidecar-harness.ts'

type LoggedMessage = { role: string; toolsAdded?: { name: string; description?: string }[] }

const toolCall = (id: string, name: string, args: Record<string, unknown>) => ({ type: 'toolCall', name, id, arguments: args })

const modes = [
  { name: 'FTS5', env: {} as Record<string, string>, fts: true },
  { name: 'LIKE 降级（COKO_TEST_NO_FTS=1）', env: { COKO_TEST_NO_FTS: '1' } as Record<string, string>, fts: false },
]

describe('Memory 检索', () => {
  it.each(modes)(
    '$name：关键词检索、Workspace 隔离、至多 20 条、改删同步、FTS 语法字符按字面、memory_list 的 query',
    { timeout: 120_000 },
    async ({ env, fts }) => {
      const root = await tempDir()
      const dirs = await sidecarDirs()
      await Promise.all([mkdir(join(root, 'one')), mkdir(join(root, 'two'))])
      const requestLog = join(root, 'requests.jsonl')
      await writeFile(requestLog, '')
      const script = await fauxScript(root, {
        requestLog,
        responses: [
          { content: [toolCall('l1', 'memory_list', { query: 'docker' })] },
          { content: [toolCall('l2', 'memory_list', { query: 'kubernetes', scope: 'user' })] },
          { content: [toolCall('l3', 'memory_list', { query: 'NEAR(' })] },
          { content: 'done' },
        ],
      })
      const sidecar = await startSidecar({ dirs, env: { COKO_FAUX_SCRIPT: script, ...env } })
      const cookie = await exchange(sidecar)
      const api = client(sidecar, cookie)
      const stream = await connect(sidecar, cookie)
      const w1 = (await api.post(API_ROUTES.workspaces, { path: join(root, 'one') })).body.id as string
      const w2 = (await api.post(API_ROUTES.workspaces, { path: join(root, 'two') })).body.id as string

      const add = async (scope: 'user' | 'workspace', content: string, workspaceId?: string) => {
        const created = await api.post(memoryPaths.memories, { scope, content, ...(workspaceId ? { workspaceId } : {}) })
        expect(created.status).toBe(201)
        return created.body as MemoryEntry
      }
      const search = async (query: string, options: { scope?: 'user' | 'workspace'; workspaceId?: string } = {}) => {
        const response = await api.get(apiPaths.memorySearch(query, options))
        expect(response.status, `${query}: ${JSON.stringify(response.body)}`).toBe(200)
        return (response.body as { memories: MemoryEntry[] }).memories
      }
      const ids = (memories: MemoryEntry[]) => memories.map((m) => m.id)

      // ── 写入 30 条 ──
      // 最早写入、词出现次数最多：FTS 按相关度排在最前；LIKE 按 updatedAt 倒序排在最后。
      const dense = await add('user', 'docker docker docker: always prune docker images')
      const written: MemoryEntry[] = [dense]
      for (let i = 0; i < 26; i++) {
        const scope = i % 2 === 0 ? 'workspace' : 'user'
        written.push(await add(scope, `fact ${i}: the build uses pnpm and vitest, see note ${i}`, scope === 'workspace' ? w1 : undefined))
      }
      const userDocker = await add('user', 'Run docker compose up before integration tests; this note explains the long setup in detail')
      const w1Docker = await add('workspace', 'This workspace deploys with docker and kubernetes manifests', w1)
      const w2Docker = await add('workspace', 'The other workspace uses docker swarm', w2)
      written.push(userDocker, w1Docker, w2Docker)
      expect(written).toHaveLength(30)

      // ── 关键词检索：用户级与该 Workspace 的相关条目，另一 Workspace 的不在其中 ──
      const docker = await search('docker', { workspaceId: w1 })
      expect(ids(docker).toSorted()).toEqual([dense.id, userDocker.id, w1Docker.id].toSorted())
      // FTS：词出现最多的最早条目在前；LIKE：updatedAt 倒序。
      expect(fts ? docker[0]!.id : ids(docker)).toEqual(fts ? dense.id : [w1Docker.id, userDocker.id, dense.id])
      // 大小写不敏感、全部词出现才匹配。
      expect(ids(await search('DOCKER Kubernetes', { workspaceId: w1 }))).toEqual([w1Docker.id])
      expect(ids(await search('docker', { workspaceId: w2 })).toSorted()).toEqual([dense.id, userDocker.id, w2Docker.id].toSorted())
      // 作用域：不给 workspaceId 时只有用户级；scope 限定一种。
      expect(ids(await search('docker')).toSorted()).toEqual([dense.id, userDocker.id].toSorted())
      expect(ids(await search('docker', { scope: 'user', workspaceId: w1 })).toSorted()).toEqual([dense.id, userDocker.id].toSorted())
      expect(ids(await search('docker', { scope: 'workspace', workspaceId: w1 }))).toEqual([w1Docker.id])
      expect(await search('yarn', { workspaceId: w1 })).toEqual([])

      // ── 至多 20 条：26 条 fact 中用户级 13 条、w1 13 条 ──
      const facts = await search('fact', { workspaceId: w1 })
      expect(facts).toHaveLength(20)
      expect(facts.every((m) => m.content.startsWith('fact '))).toBe(true)
      expect(await search('fact', { scope: 'workspace', workspaceId: w1 })).toHaveLength(13)
      expect(await search('fact', { workspaceId: w2 })).toHaveLength(13)
      // 不带 query（或只有空白）时为列表：用户级 15 条与 w1 的 14 条。
      expect((await api.get(`${memoryPaths.memories}?workspaceId=${w1}&query=${encodeURIComponent('  ')}`)).body.memories).toHaveLength(29)

      // ── 参数校验 ──
      expect((await api.get(`${memoryPaths.memories}?query=docker&scope=team`)).status).toBe(400)
      expect((await api.get(`${memoryPaths.memories}?query=docker&scope=workspace`)).status).toBe(400)
      expect((await api.get(apiPaths.memorySearch('docker', { workspaceId: 'missing' }))).status).toBe(404)

      // ── 改正文与删除后同步 ──
      expect((await api.put(memoryPaths.memory(userDocker.id), { content: 'Run podman compose up before integration tests' })).status).toBe(200)
      expect(ids(await search('docker', { workspaceId: w1 })).toSorted()).toEqual([dense.id, w1Docker.id].toSorted())
      expect(ids(await search('podman', { workspaceId: w1 }))).toEqual([userDocker.id])
      expect((await api.delete(memoryPaths.memory(w1Docker.id))).status).toBe(204)
      expect(ids(await search('docker', { workspaceId: w1 }))).toEqual([dense.id])
      expect(await search('kubernetes', { workspaceId: w1 })).toEqual([])
      await add('workspace', 'This workspace deploys with docker and kubernetes manifests', w1)

      // ── 对手用例：FTS 语法字符按字面匹配，不报错 ──
      const quoted = await add('user', 'Say "hello world" to greet the user')
      const star = await add('user', 'Glob *.tsx matches renderer files')
      const near = await add('user', 'NEAR(alpha beta) is an fts5 operator, not a word')
      const paren = await add('user', 'call fn(a, b) then close it )')
      const column = await add('user', 'content: the column prefix syntax')
      const ops = await add('user', 'The flags AND OR NOT are booleans')
      const cases: [string, string[]][] = [
        ['"', [quoted.id]],
        ['"hello', [quoted.id]],
        ['world"', [quoted.id]],
        ['*', [star.id]],
        ['*.tsx', [star.id]],
        ['NEAR(', [near.id]],
        ['NEAR(alpha', [near.id]],
        [')', [paren.id, near.id].toSorted()],
        ['fn(a,', [paren.id]],
        ['content:', [column.id]],
        ['AND OR', [ops.id]],
        ['NOT booleans', [ops.id]],
        ['"*"', []],
        ['^docker', []],
      ]
      for (const [query, expected] of cases) expect({ query, ids: ids(await search(query)).toSorted() }).toEqual({ query, ids: expected })

      // ── memory_list 的 query（Session 在 w1）──
      const sessionId = (await api.post(API_ROUTES.sessions, { workspaceId: w1 })).body.id as string
      stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
      await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
      expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'what do we know about docker?' })).status).toBe(202)
      await stream.waitFor(() => stream.entries(sessionId).some((e) => e.kind === 'run_end'))
      const results = stream
        .entries(sessionId)
        .filter((e) => e.kind === 'message' && (e.payload as { role: string }).role === 'toolResult')
        .map((e) => e.payload as { toolName: string; isError: boolean; content: { text?: string }[] })
      expect(results.map((r) => [r.toolName, r.isError])).toEqual([
        ['memory_list', false],
        ['memory_list', false],
        ['memory_list', false],
      ])
      const [found, none, operator] = results.map((r) => r.content.map((c) => c.text ?? '').join(''))
      expect(found).toContain('docker docker docker')
      expect(found).toContain('deploys with docker and kubernetes')
      expect(found).not.toContain('docker swarm')
      expect(found!.match(/<entry /g)).toHaveLength(2)
      expect(none).toBe('No memories match "kubernetes".')
      expect(operator).toContain('NEAR(alpha beta)')
      const requests = (await readFile(requestLog, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LoggedMessage[])
      const declared = requests[0]!.flatMap((m) => m.toolsAdded ?? []).find((t) => t.name === 'memory_list')
      expect(declared?.description).toMatch(/search first: pass a query/)
      expect(await sidecar.stop()).toEqual({ code: 0, signal: null })

      // 模式与日志一致：降级时记 warn，FTS5 时不记（证明两组用例确实走了不同的路径；日志在停止时写完）。
      const log = await readFile(join(dirs.logDir, 'sidecar.jsonl'), 'utf8')
      expect(log.includes('memory search falls back to LIKE')).toBe(!fts)
    },
  )
})
