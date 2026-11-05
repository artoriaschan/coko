import type { OnDemandTool } from './index.ts'

export interface CatalogRenderOptions {
  contextWindow?: number
  previousNames?: readonly string[]
}

interface CatalogGroup {
  server: string
  tools: { name: string; description: string }[]
  removed: boolean
  mode: 'descriptions' | 'names' | 'count'
}

/** CJK characters count as one token; other characters use chars/4. */
export function estimateCatalogTokens(text: string): number {
  let tokens = 0
  for (const character of text) tokens += /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character) ? 1 : 0.25
  return tokens
}

export function renderOnDemandCatalog(catalog: readonly OnDemandTool[], options: CatalogRenderOptions = {}): string {
  const previous = options.previousNames === undefined ? undefined : new Set(options.previousNames)
  const current = new Set(catalog.map((tool) => tool.name))
  const added = new Map<string, CatalogGroup>()
  for (const tool of [...catalog].sort((a, b) => a.server.localeCompare(b.server) || a.name.localeCompare(b.name))) {
    if (previous?.has(tool.name)) continue
    const group = added.get(tool.server) ?? { server: tool.server, tools: [], removed: false, mode: 'descriptions' }
    group.tools.push({ name: tool.name, description: tool.description.split(/[.!?。！？]\s*|\n/)[0] ?? '' })
    added.set(tool.server, group)
  }
  const removed = new Map<string, CatalogGroup>()
  for (const name of [...(previous ?? [])].filter((name) => !current.has(name)).sort()) {
    const server = name.split('__')[1] ?? name
    const group = removed.get(server) ?? { server, tools: [], removed: true, mode: 'names' }
    group.tools.push({ name, description: '' })
    removed.set(server, group)
  }
  const groups = [...added.values(), ...removed.values()]
  let descriptionLength = 60
  const renderGroup = (group: CatalogGroup): string => {
    const title = `${group.server} (${group.tools.length} tools)`
    if (group.mode === 'count') return title
    const lines = group.tools
      .map((tool) => {
        const sentence = tool.description
        const description = group.mode === 'names' ? '' : sentence.length > descriptionLength ? `${sentence.slice(0, descriptionLength).trimEnd()}…` : sentence
        return `- ${tool.name}${description ? `: ${description}` : ''}`
      })
      .join('\n')
    return group.removed ? lines : `${title}:\n${lines}`
  }
  const render = () => {
    const additions = [...added.values()].map(renderGroup).join('\n\n')
    const removals = [...removed.values()].map(renderGroup).join('\n\n')
    return [
      `On-demand tool catalog${previous ? ' update' : ''}. Use tool_search to load a tool before calling it directly.`,
      ...(additions ? [previous ? `Added:\n${additions}` : additions] : []),
      ...(removals ? [`Removed:\n${removals}`] : []),
    ].join('\n\n')
  }
  const budget = Math.min(5000, options.contextWindow === undefined ? 5000 : Math.max(0, options.contextWindow) * 0.025)
  let text = render()
  while (estimateCatalogTokens(text) > budget && descriptionLength > 24) {
    descriptionLength--
    text = render()
  }
  const longestFirst = () =>
    [...groups].sort((a, b) => estimateCatalogTokens(renderGroup(b)) - estimateCatalogTokens(renderGroup(a)) || a.server.localeCompare(b.server))
  for (const group of longestFirst()) {
    if (estimateCatalogTokens(text) <= budget) break
    if (group.mode !== 'descriptions') continue
    group.mode = 'names'
    text = render()
  }
  for (const group of longestFirst()) {
    if (estimateCatalogTokens(text) <= budget) break
    group.mode = 'count'
    text = render()
  }
  return text
}
