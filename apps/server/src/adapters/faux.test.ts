import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModelRegistry, InMemoryCredentialStore, resolveModel } from '@coko/agent'
import { describe, expect, it, onTestFinished } from 'vitest'
import { installFauxProvider, pickResponse } from './faux.ts'

const titleContext = {
  systemPrompt: 'COKO_SESSION_TITLE\nSummarize the user intent.',
  messages: [{ role: 'user', content: JSON.stringify({ text: 'hello', filenames: [] }) }],
}

describe('faux response routing', () => {
  it('does not consume an ordinary matched response while generating a title from the same user text', () => {
    const responses = [{ match: 'hello', content: 'Ready.' }, { content: 'next' }]
    const used = [false, false]
    expect(pickResponse(responses, used, titleContext)).toBeUndefined()
    expect(pickResponse(responses, used, { messages: [{ role: 'user', content: 'hello' }] })).toBe(0)
    expect(pickResponse(responses, used, { messages: [{ role: 'user', content: 'another task' }] })).toBe(1)
  })
  it('routes titles only to the explicit title response even when an earlier match appears in the title data', () => {
    const responses = [
      { match: 'hello', content: 'Ready.' },
      { match: 'COKO_SESSION_TITLE', content: 'Greeting' },
    ]
    const used = [false, false]
    expect(pickResponse(responses, used, titleContext)).toBe(1)
    expect(pickResponse(responses, used, titleContext)).toBeUndefined()
    expect(pickResponse(responses, used, { messages: [{ role: 'user', content: 'hello' }] })).toBe(0)
  })
})

it('records every actual request including a title without a scripted response', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-faux-log-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const requestLog = join(root, 'requests.jsonl')
  const requestDetailsLog = join(root, 'details.jsonl')
  const path = join(root, 'faux.json')
  await writeFile(path, JSON.stringify({ requestLog, requestDetailsLog, responses: [{ match: 'hello', content: 'Ready.' }] }))
  const registry = createModelRegistry({ credentials: new InMemoryCredentialStore() })
  const spec = await installFauxProvider(registry, path)
  const model = resolveModel(registry, spec.providerId, spec.modelId)
  const title = await registry.models
    .streamSimple(model, {
      ...titleContext,
      messages: [{ role: 'user', content: JSON.stringify({ text: 'hello', filenames: [] }), timestamp: 0 }],
    })
    .result()
  expect(title.stopReason).toBe('error')
  const reply = await registry.models.streamSimple(model, { messages: [{ role: 'user', content: 'hello', timestamp: 0 }] }).result()
  expect(reply.content).toEqual([{ type: 'text', text: 'Ready.' }])
  const messages = (await readFile(requestLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  const details = (await readFile(requestDetailsLog, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(messages).toHaveLength(2)
  expect(details).toHaveLength(2)
  expect(JSON.stringify(details[0].messages)).toContain('COKO_SESSION_TITLE')
  expect(details[1].messages).toEqual([{ role: 'user', content: 'hello', timestamp: 0 }])
})

it('forwards explicit scripted bucket reports and leaves omitted reports unknown', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-faux-report-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'faux.json')
  const report = { complete: false, known: ['input', 'output'] }
  await writeFile(
    path,
    JSON.stringify({
      responses: [
        { content: 'Reported.', usage: { input: 20, output: 5, report } },
        { content: 'Unknown.', usage: { input: 20, output: 5 } },
      ],
    }),
  )
  const registry = createModelRegistry({ credentials: new InMemoryCredentialStore() })
  const spec = await installFauxProvider(registry, path)
  const model = resolveModel(registry, spec.providerId, spec.modelId)
  const context = { messages: [{ role: 'user' as const, content: 'count', timestamp: 0 }] }
  const first = await registry.models.streamSimple(model, context).result()
  expect(first.usage).toMatchObject({ input: 20, output: 5, totalTokens: 25, report })
  const second = await registry.models.streamSimple(model, context).result()
  expect(second.usage).not.toHaveProperty('report')
})
