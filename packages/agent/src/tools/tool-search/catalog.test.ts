import { expect, it } from 'vitest'
import { renderOnDemandCatalog } from './index.ts'
import { estimateCatalogTokens } from './catalog.ts'

const tool = (server: string, name: string, description = 'Read application logs. More detail.') => ({
  name: `mcp__${server}__${name}`,
  server,
  description,
  parameters: { secretSchemaMarker: true },
})

it('announces only added definitions and removed names after the first catalog', () => {
  expect(renderOnDemandCatalog([tool('new', 'read'), tool('stable', 'keep')], { previousNames: ['mcp__old__read', 'mcp__stable__keep'] })).toBe(
    'On-demand tool catalog update. Use tool_search to load a tool before calling it directly.\n\nAdded:\nnew (1 tools):\n- mcp__new__read: Read application logs\n\nRemoved:\n- mcp__old__read',
  )
})

it('uniformly shortens descriptions to fit the context-window budget before removing descriptions', () => {
  const catalog = [tool('demo', 'a', 'a'.repeat(80)), tool('demo', 'b', 'b'.repeat(80))]
  const text = renderOnDemandCatalog(catalog, { contextWindow: 2_400 })
  // 2.5% of 2400 tokens is 60 tokens (240 ASCII characters).
  expect(text.length).toBeLessThanOrEqual(240)
  const descriptions = [...text.matchAll(/: ([ab]+)…/g)].map((match) => match[1]!.length)
  expect(descriptions).toHaveLength(2)
  expect(descriptions[0]).toBe(descriptions[1])
  expect(descriptions[0]).toBeGreaterThanOrEqual(24)
  expect(descriptions[0]).toBeLessThan(60)
  expect(text).not.toContain('secretSchemaMarker')
})

it('removes descriptions from the longest server group first', () => {
  const text = renderOnDemandCatalog([tool('long', 'a', 'a'.repeat(80)), tool('long', 'b', 'b'.repeat(80)), tool('short', 'c', 'Short')], {
    contextWindow: 2_100,
  })
  expect(text.length).toBeLessThanOrEqual(210)
  expect(text).toContain('- mcp__long__a\n- mcp__long__b')
  expect(text).toContain('- mcp__short__c: Short')
})

it('reduces the longest name-only groups to server names and counts when needed', () => {
  const text = renderOnDemandCatalog([tool('long', 'a'), tool('long', 'b'), tool('short', 'c', '')], { contextWindow: 1_350 })
  expect(text.length).toBeLessThanOrEqual(135)
  expect(text).toContain('long (2 tools)')
  expect(text).not.toContain('mcp__long__')
  expect(text).toContain('- mcp__short__c')
  expect(text).not.toContain('secretSchemaMarker')
})

it('counts CJK characters as tokens, applies the 5000-token cap, and retains 60 characters when budget allows', () => {
  expect(estimateCatalogTokens('日志abかな가')).toBe(5.5)
  const small = renderOnDemandCatalog([tool('demo', 'a', '中'.repeat(80))])
  expect(small).toContain(`: ${'中'.repeat(60)}…`)
  const text = renderOnDemandCatalog(
    Array.from({ length: 100 }, (_, index) => tool('demo', String(index), '中'.repeat(80))),
    {
      contextWindow: 1_000_000,
    },
  )
  expect(estimateCatalogTokens(text)).toBeLessThanOrEqual(5_000)
  expect(text).toContain('mcp__demo__99: ')
  expect(text).not.toContain('secretSchemaMarker')
})

it('budgets removal-only deltas using server counts after names no longer fit', () => {
  const text = renderOnDemandCatalog([], {
    contextWindow: 2_500,
    previousNames: Array.from({ length: 100 }, (_, index) => `mcp__gone__tool_${index}`),
  })
  expect(text.length).toBeLessThanOrEqual(250)
  expect(text).toContain('Removed:\ngone (100 tools)')
  expect(text).not.toContain('mcp__gone__')
})

it('keeps descriptions at the exact 60 and 24 character boundaries before degrading to names', () => {
  const catalog = [tool('demo', 'a', 'a'.repeat(80)), tool('demo', 'b', 'b'.repeat(80))]
  expect(renderOnDemandCatalog(catalog, { contextWindow: 2_550 })).toContain(`: ${'a'.repeat(60)}…`)
  expect(renderOnDemandCatalog(catalog, { contextWindow: 2_540 })).toContain(`: ${'a'.repeat(59)}…`)
  expect(renderOnDemandCatalog(catalog, { contextWindow: 1_830 })).toContain(`: ${'a'.repeat(24)}…`)
  expect(renderOnDemandCatalog(catalog, { contextWindow: 1_820 })).not.toContain(': a')
})
