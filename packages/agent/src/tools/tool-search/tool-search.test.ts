import { describe, expect, it } from 'vitest'
import { Type } from 'typebox'
import { createToolSearch, renderOnDemandCatalog } from './index.ts'
import type { OnDemandTool } from './index.ts'

const catalog = [
  { name: 'mcp__demo__echo', server: 'demo', description: 'Echo a value. Second sentence.', parameters: Type.Object({ value: Type.String() }) },
  { name: 'mcp__demo__sum', server: 'demo', description: 'Add two numbers.', parameters: Type.Object({ a: Type.Number(), b: Type.Number() }) },
]

async function search(query: string, entries: readonly OnDemandTool[] = catalog, limit?: number) {
  const result = await createToolSearch({ catalog: entries, regularNames: ['read'], loadedNames: () => new Set() }).execute('query', { query, limit })
  const content = result.content.find((item) => item.type === 'text')!
  return JSON.parse(content.text)
}

describe('on-demand tool catalog', () => {
  it('searches descriptions and first-level parameter names by keywords', async () => {
    const tool = createToolSearch({ catalog, regularNames: [], loadedNames: () => new Set() })
    const result = await tool.execute('search-keywords', { query: 'numbers a', limit: 1 })
    expect(JSON.parse(result.content[0]!.type === 'text' ? result.content[0]!.text : '').matches).toEqual([
      {
        name: 'mcp__demo__sum',
        server: 'demo',
        description: 'Add two numbers.',
        alreadyAvailable: false,
        parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] },
      },
    ])
  })

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

  it('indexes CJK bigrams and Latin tokens without translating or descending into schemas', async () => {
    const entries = [
      { name: 'mcp__cn__query', server: 'cn', description: '查询应用日志', parameters: { properties: { ticketId: { type: 'string' } } } },
      {
        name: 'mcp__en__query',
        server: 'en',
        description: 'Search application logs',
        parameters: { properties: { filter: { properties: { nestedneedle: {} } } } },
      },
    ]
    expect((await search('应用日志', entries)).matches.map((tool: OnDemandTool) => tool.name)).toEqual(['mcp__cn__query'])
    expect((await search('ticketid', entries)).matches.map((tool: OnDemandTool) => tool.name)).toEqual(['mcp__cn__query'])
    expect((await search('nestedneedle', entries)).matches).toEqual([])
    expect((await search('ｌｏｇｓ', entries)).matches).toEqual([])
  })

  it('filters required terms before computing corpus statistics and ranks by BM25', async () => {
    const entries = [
      { name: 'mcp__s__a', server: 's', description: 'eligible rare', parameters: {} },
      { name: 'mcp__s__b', server: 's', description: 'eligible common common common', parameters: {} },
      { name: 'mcp__s__c', server: 's', description: 'common '.repeat(100), parameters: {} },
    ]
    expect((await search('+eligible rare common', entries, 1)).matches.map((tool: OnDemandTool) => tool.name)).toEqual(['mcp__s__b'])
    expect((await search('+missing common', entries)).matches).toEqual([])
  })

  it('sorts ties by server then name and falls back to the complete name substring only without positive scores', async () => {
    const entries = [
      { name: 'mcp__z__alphabet', server: 'z', description: 'lookup', parameters: {} },
      { name: 'mcp__a__beta', server: 'a', description: 'lookup', parameters: {} },
      { name: 'mcp__a__alpha', server: 'a', description: 'lookup', parameters: {} },
    ]
    expect((await search('lookup', entries)).matches.map((tool: OnDemandTool) => tool.name)).toEqual(['mcp__a__alpha', 'mcp__a__beta', 'mcp__z__alphabet'])
    expect((await search('phabet', entries)).matches.map((tool: OnDemandTool) => tool.name)).toEqual(['mcp__z__alphabet'])
    expect((await search('phabet unknown', entries)).matches).toEqual([])
  })

  it('uses five results by default and clamps limits to one through twenty', async () => {
    const entries = Array.from({ length: 25 }, (_, index) => ({ name: `mcp__s__tool${index}`, server: 's', description: 'lookup', parameters: {} }))
    expect((await search('lookup', entries)).matches).toHaveLength(5)
    expect((await search('lookup', entries, 50)).matches).toHaveLength(20)
    expect((await search('lookup', entries, 0)).matches).toHaveLength(1)
  })

  it('loads all selected tools while omitting schemas that exceed the cumulative result budget', async () => {
    const entries = [
      { name: 'mcp__s__first', server: 's', description: 'one', parameters: { description: 'a'.repeat(7900) } },
      { name: 'mcp__s__second', server: 's', description: 'two', parameters: { description: 'b'.repeat(100) } },
      { name: 'mcp__s__third', server: 's', description: 'three', parameters: {} },
    ]
    const result = await search('select:mcp__s__first,mcp__s__second,mcp__s__third', entries, 1)
    expect(result.loaded).toEqual(['mcp__s__first', 'mcp__s__second', 'mcp__s__third'])
    expect(result.matches[0].parameters).toEqual(entries[0]!.parameters)
    expect(result.matches[1]).toEqual({
      name: 'mcp__s__second',
      server: 's',
      description: 'two',
      alreadyAvailable: false,
      parametersOmitted:
        'Parameter schema omitted to stay within the result budget. The tool is loaded — its schema is in your tools list from the next turn on.',
    })
    expect(result.matches[2].parameters).toEqual({})
  })
})
