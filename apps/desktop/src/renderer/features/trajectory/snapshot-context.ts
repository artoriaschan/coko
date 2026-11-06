import type { ModelRequestSnapshot } from '@coko/protocol'

export type SystemPromptSnapshot = Pick<ModelRequestSnapshot, 'system' | 'tools'>

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
const text = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : Array.isArray(value)
      ? value
          .flatMap((block) => {
            const item = object(block)
            return item?.type === 'text' && typeof item.text === 'string' ? [item.text] : []
          })
          .join('\n')
      : ''

/** Replay the SDK's named section updates; preserve opaque snapshots when their provenance is unavailable. */
export function snapshotContext(snapshot: ModelRequestSnapshot): { prompt: SystemPromptSnapshot; contexts: ReadonlyMap<string, string> } {
  let leading: string | undefined
  const sections = new Map<string, string>()
  const appended = new Map<string, string>()
  for (const value of snapshot.messages) {
    const message = object(value)
    if (message?.role !== 'system') continue
    const content = text(message.content)
    if (leading === undefined) leading = content
    else if (content !== '') appended.set(`system-message:${appended.size + 1}`, content)
    for (const [name, value] of Object.entries(object(message.sections) ?? {})) {
      if (value === null) sections.delete(name)
      else if (typeof value === 'string') sections.set(name, value)
    }
  }
  if (leading === undefined) return { prompt: { system: snapshot.system, tools: snapshot.tools }, contexts: new Map() }
  const system = [leading, sections.get('coko.base') ?? ''].filter(Boolean).join('\n\n')
  const contexts = new Map(appended)
  for (const [name, value] of sections) if (name !== 'coko.base' && value !== '') contexts.set(name, value)
  return { prompt: { system, tools: snapshot.tools }, contexts }
}
