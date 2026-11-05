import { expect, it } from 'vitest'
import { createAgentRuntime } from './runtime.ts'
import { createFauxModels, fauxAssistantMessage } from '../testing/faux.ts'
import { createTempWorkspace } from '../testing/workspace.ts'
import type { RunEntry } from './types.ts'

it.each(['submit', 'goal', 'schedule', 'subagent'] as const)('places state before host notifications and input for %s', async (trigger) => {
  const workspace = await createTempWorkspace()
  try {
    const { models, model, faux } = createFauxModels()
    faux.setResponses([fauxAssistantMessage('done')])
    const entries: RunEntry[] = []
    const runtime = createAgentRuntime({
      models,
      model,
      cwd: workspace.cwd,
      commit: async (entry) => {
        entries.push(entry)
      },
      context: {
        stateUpdates: async () => ({
          entries: [{ kind: 'state_update', payload: { name: 'todo_list', value: null } }],
          blocks: [{ type: 'text', text: '<state_update name="todo_list">\nclear\n</state_update>' }],
        }),
      },
    })
    await runtime.run({
      trigger,
      text: 'input',
      content: [
        { type: 'text', text: '<job-notification>done</job-notification>' },
        { type: 'text', text: 'input' },
      ],
      before: [{ kind: 'job_notification', payload: { jobIds: ['j'] } }],
    })
    expect(entries.slice(0, 4).map((entry) => entry.kind)).toEqual(['run_start', 'state_update', 'job_notification', 'message'])
    const message = entries[3]!
    expect(message.kind === 'message' && message.payload.role === 'user' && message.payload.content).toEqual([
      { type: 'text', text: '<state_update name="todo_list">\nclear\n</state_update>' },
      { type: 'text', text: '<job-notification>done</job-notification>' },
      { type: 'text', text: 'input' },
    ])
  } finally {
    await workspace.dispose()
  }
})
