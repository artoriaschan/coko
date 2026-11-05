import { expect, it } from 'vitest'
import { registerSecretValues } from '@coko/logging'
import { ConfigService } from '../config.ts'
import { createContextAssembly } from './index.ts'

it('compares the redacted structured values already delivered to the model', async () => {
  const release = registerSecretValues(() => ['private-current-value'])
  try {
    const assembly = createContextAssembly({
      config: new ConfigService(),
      cokoHome: '',
      contributions: [{ name: 'todo', stateValues: async () => ({ todo_list: 'private-current-value' }) }],
    })
    const scope = await assembly.scope({ workspaceId: 'w', sessionId: 's', cwd: '/w' })
    const first = await assembly.stateUpdates(scope, async () => [])
    expect(first?.entries[0]?.payload.value).toBe('[REDACTED:secret]')
    expect(first?.blocks[0]?.text).not.toContain('private-current-value')
    expect(
      await assembly.stateUpdates(scope, async () => [
        { seq: 1, runId: 'r', ...first!.entries[0]! },
        { seq: 2, kind: 'message', runId: 'r', payload: { role: 'user', content: first!.blocks } },
      ]),
    ).toBeUndefined()
  } finally {
    release()
  }
})

it.each(['domain', 'entries'])('a %s read failure withholds all updates without rejecting the Run hook', async (failure) => {
  const assembly = createContextAssembly({
    config: new ConfigService(),
    cokoHome: '',
    contributions: [
      {
        name: 'todo',
        stateValues: async () => {
          if (failure === 'domain') throw new Error('unavailable')
          return { todo_list: 'current' }
        },
      },
    ],
  })
  const scope = await assembly.scope({ workspaceId: 'w', sessionId: 's', cwd: '/w' })
  expect(
    await assembly.stateUpdates(scope, async () => {
      throw new Error('unavailable')
    }),
  ).toBeUndefined()
})
