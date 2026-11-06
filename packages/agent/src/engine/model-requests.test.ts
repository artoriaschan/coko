import type { StreamFn } from '@earendil-works/pi-agent-core'
import { createAssistantMessageEventStream, normalizeContext, type Context } from '@earendil-works/pi-ai'
import { expect, it } from 'vitest'
import { createFauxModels, fauxAssistantMessage } from '../testing/faux.ts'
import { createRequestMeter } from './model-requests.ts'

it('freezes request input before provider code can mutate messages or tool definitions', async () => {
  const { model } = createFauxModels()
  const context: Context = {
    systemPrompt: 'Original system',
    messages: [{ role: 'user', content: 'Original question', timestamp: 1 }],
    tools: [{ name: 'inspect', description: 'Original definition', parameters: { type: 'object', properties: {} } }],
  }
  const inner: StreamFn = (_model, input) => {
    input.messages.push({ role: 'user', content: 'Appended later', timestamp: 2 })
    context.tools![0]!.description = 'Changed later'
    const stream = createAssistantMessageEventStream()
    const final = fauxAssistantMessage('Done')
    stream.push({ type: 'done', reason: 'stop', message: final })
    stream.end(final)
    return stream
  }
  const meter = createRequestMeter()
  const stream = await meter.wrap(inner)(model, normalizeContext(context))
  await stream.result()
  expect(meter.take()?.snapshot).toMatchObject({
    system: 'Original system',
    messages: [expect.objectContaining({ role: 'system' }), { role: 'user', content: 'Original question', timestamp: 1 }],
    tools: [{ name: 'inspect', description: 'Original definition' }],
  })
})
