import type { OnDemandTool } from './index.ts'

function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens = [...lower.matchAll(/[a-z0-9]+/g)].map((match) => match[0])
  for (const [run] of lower.matchAll(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]+/g)) {
    if (run.length === 1) tokens.push(run)
    else for (let i = 0; i + 1 < run.length; i++) tokens.push(run.slice(i, i + 2))
  }
  return tokens
}

export function parseToolSearchQuery(query: string): { selectNames: string[]; keywords: string; requiredTerms: string[] } {
  const trimmed = query.trim()
  if (/^select:/i.test(trimmed)) {
    return {
      selectNames: [
        ...new Set(
          trimmed
            .slice(7)
            .split(/[,\s]+/)
            .filter(Boolean),
        ),
      ],
      keywords: '',
      requiredTerms: [],
    }
  }
  const requiredTerms: string[] = []
  const keywords = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (part.length > 1 && part.startsWith('+')) {
        requiredTerms.push(part.slice(1))
        return part.slice(1)
      }
      return part
    })
  return { selectNames: [], keywords: keywords.join(' '), requiredTerms }
}

function searchText(tool: OnDemandTool): string {
  const schema = tool.parameters
  const properties = typeof schema === 'object' && schema !== null && 'properties' in schema ? schema.properties : undefined
  const parameterNames = typeof properties === 'object' && properties !== null ? Object.keys(properties).join(' ') : ''
  return `${tool.name.replace(/[_.\-:]+/g, ' ')} ${tool.description} ${parameterNames}`
}

export function searchOnDemandTools(catalog: readonly OnDemandTool[], query: string, limit: number): OnDemandTool[] {
  const parsed = parseToolSearchQuery(query)
  const queryTokens = tokenize(parsed.keywords)
  if (queryTokens.length === 0 || limit <= 0) return []
  const requiredTokens = parsed.requiredTerms.flatMap(tokenize)
  const candidates = catalog
    .map((tool) => ({ tool, tokens: tokenize(searchText(tool)) }))
    .filter(({ tokens }) => {
      const owned = new Set(tokens)
      return requiredTokens.every((token) => owned.has(token))
    })
  if (candidates.length === 0) return []
  const frequencies = new Map<string, number>()
  let totalLength = 0
  for (const { tokens } of candidates) {
    totalLength += tokens.length
    for (const token of new Set(tokens)) frequencies.set(token, (frequencies.get(token) ?? 0) + 1)
  }
  const averageLength = totalLength / candidates.length
  const k1 = 1.5
  const b = 0.75
  const scored = candidates
    .map(({ tool, tokens }) => {
      const counts = new Map<string, number>()
      for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
      let score = 0
      for (const token of queryTokens) {
        const df = frequencies.get(token) ?? 0
        const tf = counts.get(token) ?? 0
        if (df === 0 || tf === 0) continue
        const idf = Math.log(1 + (candidates.length - df + 0.5) / (df + 0.5))
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * tokens.length) / Math.max(averageLength, 1))))
      }
      return { tool, score }
    })
    .filter(({ score }) => score > 0)
  if (scored.length === 0) {
    const needle = parsed.keywords.toLowerCase()
    for (const { tool } of candidates) if (needle && tool.name.toLowerCase().includes(needle)) scored.push({ tool, score: 0.1 })
  }
  return scored
    .sort((a, b) => b.score - a.score || a.tool.server.localeCompare(b.tool.server, 'en') || a.tool.name.localeCompare(b.tool.name, 'en'))
    .slice(0, limit)
    .map(({ tool }) => tool)
}
