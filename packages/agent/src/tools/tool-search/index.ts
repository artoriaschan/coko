import { Type } from 'typebox'
import type { CokoTool } from '../types.ts'
import { parseToolSearchQuery, searchOnDemandTools } from './search.ts'

/** A frozen Run catalog. It contains definitions, never a connection or a Session store. */
export interface OnDemandTool {
  name: string
  server: string
  description: string
  parameters: unknown
}

export function renderOnDemandCatalog(catalog: readonly OnDemandTool[]): string {
  const groups = new Map<string, OnDemandTool[]>()
  for (const tool of [...catalog].sort((a, b) => a.server.localeCompare(b.server) || a.name.localeCompare(b.name))) {
    const group = groups.get(tool.server) ?? []
    group.push(tool)
    groups.set(tool.server, group)
  }
  return [
    'On-demand tool catalog. Use tool_search to load a tool before calling it directly.',
    ...[...groups].map(
      ([server, tools]) =>
        `${server} (${tools.length} tools):\n${tools
          .map((tool) => {
            const sentence = tool.description.split(/[.!?。！？]\s*|\n/)[0] ?? ''
            const description = sentence.length > 60 ? `${sentence.slice(0, 60).trimEnd()}…` : sentence
            return `- ${tool.name}${description ? `: ${description}` : ''}`
          })
          .join('\n')}`,
    ),
  ].join('\n\n')
}

const parameters = Type.Object({
  query: Type.String({
    description:
      "Keywords describing the capability you need (e.g. 'query application logs'), or `select:<exact-tool-name>` (comma-separated for several) when the tool name is already listed in the on-demand tool catalog. Prefix a term with `+` to require it.",
  }),
  limit: Type.Optional(Type.Integer({ description: 'Maximum number of tools to return and load. Defaults to 5.' })),
})

export function createToolSearch(options: {
  catalog: readonly OnDemandTool[]
  regularNames: readonly string[]
  loadedNames(): ReadonlySet<string>
  /** Host-only channel, not tool result metadata. The runtime commits the load after the tool result. */
  onLoad?(toolCallId: string, names: string[]): void
}): CokoTool<typeof parameters> {
  return {
    name: 'tool_search',
    label: 'Find tools',
    effect: 'read',
    parameters,
    description:
      'Load the parameter schema for an on-demand tool (MCP) so you can call it. The on-demand tool catalog at the start of this conversation already lists every such tool by name and purpose — this tool is how you get its parameters, not how you discover that it exists. When you already see the exact name in that catalog, call this with `select:<name>` instead of keywords. Returns each match with its full parameter schema and loads it, so from the NEXT turn on you call the tool directly by its own name — do not route later calls back through this tool. Tools already present in your tools list never need to be searched.',
    async execute(id, { query, limit }) {
      const result = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload) }], details: {} })
      if (!query.trim())
        return result({ error: 'query is required', hint: 'Pass keywords, or `select:<exact-tool-name>` for a tool listed in the on-demand tool catalog.' })
      if (options.catalog.length === 0)
        return result({
          query,
          totalOnDemand: 0,
          matches: [],
          hint: 'No on-demand tools are attached to this session. Everything available is already in your tools list.',
        })
      const names = parseToolSearchQuery(query).selectNames
      const byName = new Map(options.catalog.map((tool) => [tool.name, tool]))
      const matched = names.length
        ? names.flatMap((name) => (byName.has(name) ? [byName.get(name)!] : []))
        : searchOnDemandTools(options.catalog, query, Number.isFinite(limit) ? Math.max(1, Math.min(20, Math.floor(limit!))) : 5)
      const regular = names.filter((name) => !byName.has(name) && options.regularNames.includes(name))
      const unknown = names.filter((name) => !byName.has(name) && !options.regularNames.includes(name))
      const loaded = options.loadedNames()
      const added = matched.filter((tool) => !loaded.has(tool.name)).map((tool) => tool.name)
      if (added.length) options.onLoad?.(id, added)
      let schemaChars = 0
      const payload: Record<string, unknown> = {
        query,
        totalOnDemand: options.catalog.length,
        matches: matched.map((tool) => {
          const base = { name: tool.name, server: tool.server, description: tool.description, alreadyAvailable: loaded.has(tool.name) }
          if (tool.parameters === undefined) return base
          let serialized = ''
          try {
            serialized = JSON.stringify(tool.parameters) ?? ''
          } catch {
            /* Schema text is optional; the registered tool still loads. */
          }
          if (schemaChars + serialized.length > 8000)
            return {
              ...base,
              parametersOmitted:
                'Parameter schema omitted to stay within the result budget. The tool is loaded — its schema is in your tools list from the next turn on.',
            }
          schemaChars += serialized.length
          return { ...base, parameters: tool.parameters }
        }),
      }
      if (regular.length) {
        payload.alreadyAvailable = regular
        payload.alreadyAvailableHint =
          'These are regular tools that are already in your tools list; they are not on-demand and never need tool_search. Call them directly by name — do not conclude they are unavailable.'
      }
      if (unknown.length) {
        payload.unknownNames = unknown
        payload.unknownHint =
          'These names are neither in the on-demand tool catalog nor registered as a regular tool in this session. Check the spelling against the catalog, or search by keywords instead.'
      }
      if (matched.length === 0 && !(names.length > 0 && unknown.length === 0 && regular.length > 0)) {
        const counts = new Map<string, number>()
        for (const tool of options.catalog) counts.set(tool.server, (counts.get(tool.server) ?? 0) + 1)
        payload.availableServers = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([server, count]) => ({ name: server, toolCount: count }))
        if (!names.length)
          payload.hint =
            'No lexical match. The tool groups above are available in this session — retry with the group name plus a concrete action or object before concluding the capability is unavailable.'
      } else {
        payload.loaded = added
        payload.note = 'Loaded. From the next turn on, call these tools directly by name; do not go through tool_search again.'
      }
      return result(payload)
    },
  }
}
