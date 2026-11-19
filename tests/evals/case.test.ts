// 评测用例的预置记忆（docs/subsystems/tracing.md#评测）：加载时校验 memories 的格式与 faux 脚本中的 {{memory:N}} 引用，预置后替换为实际 id。
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, onTestFinished } from 'vitest'
import { memorySummary, tierMemories } from '@coko/agent'
import { createPayloadRegistry } from '@coko/session'
import { createMemoryStore } from '@coko/session/memory'
import { fillMemoryIds, loadCases, type EvalCase } from './case.ts'

async function casesWith(spec: Record<string, unknown>) {
  const dir = await mkdtemp(join(tmpdir(), 'coko-eval-cases-'))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, 'c'))
  await writeFile(join(dir, 'c', 'case.json'), JSON.stringify({ prompt: 'p', expect: {}, ...spec }))
  return dir
}

const readFirst = { content: [{ type: 'toolCall', name: 'memory_list', id: 'r', arguments: { ids: ['{{memory:0}}'] } }] }

describe('预置记忆', () => {
  it('合法的 memories 与引用：加载成功', async () => {
    const dir = await casesWith({ memories: [{ content: 'a' }, { content: 'b', scope: 'user' }], faux: [readFirst] })
    const [loaded] = await loadCases(dir)
    expect(loaded!.spec.memories).toEqual([{ content: 'a' }, { content: 'b', scope: 'user' }])
  })

  it.each([
    ['不是数组', { memories: { content: 'a' }, faux: [] }, 'memories: expected [{ content: string, scope?: "user" }]'],
    ['正文为空', { memories: [{ content: '' }], faux: [] }, 'memories: expected [{ content: string, scope?: "user" }]'],
    ['多余字段', { memories: [{ content: 'a', id: 'x' }], faux: [] }, 'memories: expected [{ content: string, scope?: "user" }]'],
    ['workspace 作用域', { memories: [{ content: 'a', scope: 'workspace' }], faux: [] }, 'memories: expected [{ content: string, scope?: "user" }]'],
    ['引用越界', { memories: [{ content: 'a' }], faux: [readFirst, { content: '{{memory:1}}' }] }, 'faux: {{memory:1}} refers to no seeded memory'],
    ['没有预置却引用', { faux: [readFirst] }, 'faux: {{memory:0}} refers to no seeded memory'],
    ['引用不是序号', { memories: [{ content: 'a' }], faux: [{ content: '{{memory:first}}' }] }, 'faux: {{memory:first}} refers to no seeded memory'],
  ])('%s：加载时报错并给出原因', async (_name, spec, reason) => {
    await expect(loadCases(await casesWith(spec))).rejects.toThrow(`cases/c/case.json: ${reason}`)
  })

  it('占位符按序号替换为实际 id，其余内容不变', () => {
    expect(fillMemoryIds([readFirst, { content: 'see {{memory:1}} and {{memory:0}}' }], ['id-a', 'id-b'])).toEqual([
      { content: [{ type: 'toolCall', name: 'memory_list', id: 'r', arguments: { ids: ['id-a'] } }] },
      { content: 'see id-b and id-a' },
    ])
  })
})

// 两个记忆用例的构造：预置条目（服务端 id 为 UUID，由旧到新）使答案条目落在预期的层；检索用例的 query 严格匹配为空、近似匹配命中答案条目。
// 内存实现与 SQLite 的检索语义相同（同一组契约测试）。
describe('记忆用例的构造', async () => {
  const cases = Object.fromEntries((await loadCases()).map(({ spec }) => [spec.name, spec])) as Record<string, EvalCase>
  // 答案条目是 memories[0]（最旧），正文含期望写入文件的答案。
  const layout = (spec: EvalCase, answerText: string) => {
    expect(spec.memories![0]!.content).toContain(answerText)
    const entries = spec.memories!.map((m, i) => ({ id: randomUUID(), scope: 'user' as const, source: 'user' as const, content: m.content, updatedAt: i }))
    const { full, summary } = tierMemories(entries)
    const answer = entries[0]!
    return full.includes(answer) ? 'full' : summary.includes(answer) ? 'summary' : 'omitted'
  }

  it('reads-summarized-memory：答案条目在摘要层，摘要行不含答案，faux 按 id 读取它', () => {
    const spec = cases['reads-summarized-memory']!
    expect(layout(spec, 'BLUE-HERON-42')).toBe('summary')
    expect(memorySummary(spec.memories![0]!.content)).not.toContain('BLUE-HERON-42')
    expect(JSON.stringify(spec.faux)).toContain('"ids":["{{memory:0}}"]')
  })

  it('finds-memory-by-search：答案条目在检索层，query 严格匹配为空、近似匹配命中', async () => {
    const spec = cases['finds-memory-by-search']!
    expect(layout(spec, 'HERON-STACK-7')).toBe('omitted')
    const query = JSON.stringify(spec.faux).match(/"query":"([^"]+)"/)![1]!
    const store = createMemoryStore({ payloads: createPayloadRegistry([]) })
    for (const { content } of spec.memories!) await store.memories.create({ scope: 'user', content, source: 'user' })
    expect(await store.memories.search(query)).toEqual([])
    expect((await store.memories.similar(query)).map((m) => m.content)).toContain(spec.memories![0]!.content)
  })
})
