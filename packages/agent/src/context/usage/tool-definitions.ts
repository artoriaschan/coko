import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { getCurrentTools, getToolStateChanges, resolveTranscriptTools, type Model, type Tool } from '@earendil-works/pi-ai'
import { usesIncrementalTools } from '../../models/registry.ts'

const definitionChars = (tools: readonly Tool[]) =>
  tools.reduce((chars, tool) => chars + JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }).length, 0)

/** Canonical Coko schema chars, with pi deciding which native declarations stay on the wire. */
export function toolDefinitionChars(model: Model<any> | undefined, tools: readonly Tool[], messages: readonly AgentMessage[]): number {
  if (!model || !usesIncrementalTools(model)) return definitionChars(tools)
  const system = messages.filter((message) => message.role === 'system')
  const touched = new Set(system.flatMap((message) => [...(message.toolsAdded ?? []), ...(message.toolsRemoved ?? [])].map((tool) => tool.name)))
  const transcript: AgentMessage[] = system[0]?.toolsAdded
    ? [...messages]
    : [{ role: 'system', content: '', timestamp: 0, toolsAdded: tools.filter((tool) => !touched.has(tool.name)) }, ...messages]
  // Preview the same pending change pi will declare before the next request, without persisting it.
  const change = getToolStateChanges(getCurrentTools(transcript), [...tools])
  if (change.toolsAdded.length || change.toolsRemoved.length) transcript.push({ role: 'system', content: '', timestamp: 0, ...change })
  const split = resolveTranscriptTools(transcript, model.api === 'openai-completions' ? 'additions' : 'changes')
  const additions = transcript
    .filter((message) => message.role === 'system')
    .slice(split.foldedSystemMessages)
    .flatMap((message) => message.toolsAdded ?? [])
  return definitionChars([...split.requestTools, ...additions])
}
