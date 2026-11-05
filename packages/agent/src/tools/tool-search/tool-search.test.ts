import { describe, expect, it } from 'vitest'
import { Type } from 'typebox'
import { createToolSearch, renderOnDemandCatalog } from './index.ts'

const catalog = [
  { name: 'mcp__demo__echo', server: 'demo', description: 'Echo a value. Second sentence.', parameters: Type.Object({ value: Type.String() }) },
  { name: 'mcp__demo__sum', server: 'demo', description: 'Add two numbers.', parameters: Type.Object({ a: Type.Number(), b: Type.Number() }) },
]

describe('on-demand tool catalog', () => {
  it('loads every exact selection while keeping host authorization out of the result', async () => {
    const loads: { id: string; names: string[] }[] = []
    const tool = createToolSearch({
      catalog,
      regularNames: ['read'],
      loadedNames: () => new Set(),
      onLoad: (id, names) => {
        loads.push({ id, names })
      },
    })
    const result = await tool.execute('search-1', { query: 'select:mcp__demo__echo,mcp__demo__sum,read,unknown', limit: 1 })
    const text = result.content.find((c) => c.type === 'text')!
    const payload = JSON.parse(text.text)
    expect(payload.matches.map((m: { name: string }) => m.name)).toEqual(['mcp__demo__echo', 'mcp__demo__sum'])
    expect(payload.alreadyAvailable).toEqual(['read'])
    expect(payload.unknownNames).toEqual(['unknown'])
    expect(payload.loaded).toEqual(['mcp__demo__echo', 'mcp__demo__sum'])
    expect(loads).toEqual([{ id: 'search-1', names: ['mcp__demo__echo', 'mcp__demo__sum'] }])
    expect(result.details).toEqual({})
  })

  it('renders only names and first-sentence descriptions, without schemas', () => {
    expect(renderOnDemandCatalog(catalog)).toContain('- mcp__demo__echo: Echo a value')
    expect(renderOnDemandCatalog(catalog)).not.toContain('Second sentence')
    expect(renderOnDemandCatalog(catalog)).not.toContain('properties')
  })
})
