// Actual configured protocol → Sidecar → SQLite → Electron. Only the remote model service is controlled.
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionEntryRecord } from '@coko/protocol'
import { expect, it, onTestFailed, onTestFinished } from 'vitest'
import { createProjectDraft, launchApp, waitConnected, type LaunchedApp } from './harness.ts'

const sse = (event: object) => `data: ${JSON.stringify(event)}\n\n`
const chunk = (delta: object, finish: string | null, usage?: object) =>
  sse({
    id: 'protocol-reply',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'metered',
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  })
const reply = (text: string, usage: object) => chunk({ role: 'assistant', content: text }, null) + chunk({}, 'stop', usage) + 'data: [DONE]\n\n'
const isChildRequest = (body: string) =>
  (JSON.parse(body) as { messages: { role: string; content: unknown }[] }).messages.some(
    (message) => message.role === 'user' && JSON.stringify(message.content).includes('CHILD_PROTOCOL'),
  )

async function protocolServer() {
  const requests: string[] = []
  let turn = 0
  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8').on('data', (part: string) => (body += part))
    req.on('end', () => {
      requests.push(body)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      if (body.includes('COKO_SESSION_TITLE')) return res.end(reply('Protocol check', { prompt_tokens: 1000, completion_tokens: 20 }))
      if (isChildRequest(body)) return res.end(reply('Child protocol result.', { prompt_tokens: 100, completion_tokens: 50 }))
      turn++
      if (turn === 1)
        return res.end(
          sse({
            id: 'failed',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'metered',
            choices: [],
            usage: { prompt_tokens: 11, completion_tokens: 3 },
          }) + sse({ error: { message: '503 Service unavailable', type: 'server_error', code: 'server_error' } }),
        )
      if (turn === 2)
        return res.end(
          chunk(
            {
              role: 'assistant',
              tool_calls: [
                { index: 0, id: 'read-one', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: 'notes.txt' }) } },
                {
                  index: 1,
                  id: 'child-one',
                  type: 'function',
                  function: {
                    name: 'agent',
                    arguments: JSON.stringify({ description: 'inspect context', prompt: 'CHILD_PROTOCOL', subagent_type: 'explore' }),
                  },
                },
              ],
            },
            null,
          ) +
            chunk({}, 'tool_calls', { prompt_tokens: 20, completion_tokens: 5 }) +
            'data: [DONE]\n\n',
        )
      if (turn === 3)
        return res.end(
          reply('**First protocol answer** with `raw code`.', {
            prompt_tokens: 30,
            completion_tokens: 8,
            prompt_tokens_details: { cached_tokens: 10 },
            completion_tokens_details: { reasoning_tokens: 2 },
          }),
        )
      if (turn === 4) return res.end(reply('Second protocol answer.', { prompt_tokens: 10, completion_tokens: 2 }))
      return res.end(reply('Branch protocol answer.', { prompt_tokens: 5, completion_tokens: 1 }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  return { requests, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` }
}

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
const entries = (app: LaunchedApp, id: string) =>
  app.window.evaluate(async (sessionId) => (await (await fetch(`/api/sessions/${sessionId}`)).json()).entries as SessionEntryRecord[], id)
const activeId = (app: LaunchedApp) => app.window.locator('[data-session-id][aria-current="page"]').getAttribute('data-session-id')
const footer = (app: LaunchedApp, index: number) => app.window.locator('[data-slot="assistant-footer"]').nth(index)

async function installProvider(app: LaunchedApp, baseUrl: string) {
  const saved = await app.window.evaluate(
    async (url) =>
      window.coko!.saveProvider({
        mode: 'create',
        secret: 'protocol-fixture-key',
        provider: {
          id: 'protocol',
          name: 'Protocol fixture',
          api: 'openai-completions',
          baseUrl: url,
          models: [
            {
              id: 'metered',
              name: 'Metered',
              contextWindow: 128000,
              maxTokens: 8192,
              input: ['text'],
              reasoning: false,
              thinkingLevels: [{ level: 'off' }],
              price: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
            },
          ],
        },
      }),
    baseUrl,
  )
  expect(saved.ok).toBe(true)
  await app.window.reload()
  await app.window.getByRole('heading', { level: 1 }).waitFor()
}

async function send(app: LaunchedApp, text: string, answer: string, count: number) {
  await composer(app).fill(text)
  await composer(app).press('Enter')
  await app.window.locator('[data-slot="assistant-message-body"]').filter({ hasText: answer }).waitFor({ timeout: 30_000 })
  await app.window.locator('[data-action="send"]').waitFor({ timeout: 30_000 })
  await expect.poll(() => app.window.locator('[data-slot="assistant-footer"]').count()).toBe(count)
}

it('actual protocol attempts reach Electron details, exclude title/history, branch with effective context and survive restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-protocol-footers-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'notes.txt'), 'source file stays current\n')
  const model = await protocolServer()
  let app = await launchApp({}, { dir: root })
  onTestFinished(() => app.dispose())
  // The empty workbench has no connection indicator until a Session exists.
  await app.window.getByRole('heading', { level: 1 }).waitFor()
  await installProvider(app, model.baseUrl)
  await createProjectDraft(app, workspace)
  await send(app, 'protocol first', 'First protocol answer', 1)
  const source = (await activeId(app))!
  const sourceRecords = await entries(app, source)
  const agentStart = sourceRecords.find((entry) => entry.kind === 'agent_start')!
  expect(agentStart).toBeDefined()
  const childId = (agentStart.payload as { agentId: string }).agentId
  const childRequests = (await entries(app, childId)).filter((entry) => entry.kind === 'model_request')
  expect(childRequests).toHaveLength(1)
  expect(childRequests[0]!.payload).toMatchObject({ usage: { total: 150 } })
  await expect.poll(() => footer(app, 0).getAttribute('data-tokens')).toBe('77')
  expect(await footer(app, 0).locator('[data-action="run-usage"]').textContent()).toContain('77 tokens')
  expect(await footer(app, 0).textContent()).toMatch(/Incomplete|不完整/)
  await footer(app, 0).locator('[data-action="run-usage"]').click()
  const details = app.window.locator('[data-slot="run-usage-details"]')
  await details.waitFor()
  for (const [part, value] of [
    ['input', '51'],
    ['cacheRead', '10'],
    ['cacheWrite', '0'],
    ['output', '16'],
    ['reasoning', '2'],
    ['total', '77'],
  ])
    expect(await details.locator(`[data-usage-part="${part}"] dd`).textContent()).toBe(value)
  expect(await details.textContent()).not.toMatch(/\$|Unpriced|未定价/)
  await app.window.keyboard.press('Escape')
  await details.waitFor({ state: 'detached' })
  await expect
    .poll(
      async () =>
        (await entries(app, source)).filter((entry) => entry.kind === 'model_request' && (entry.payload as { purpose?: string }).purpose === 'title').length,
    )
    .toBe(1)
  await expect.poll(() => app.window.locator('[data-slot="session-cost"]').getAttribute('data-tokens')).toBe('1097')
  await send(app, 'protocol second', 'Second protocol answer', 2)
  expect(await footer(app, 1).getAttribute('data-tokens')).toBe('12')
  expect(await footer(app, 1).textContent()).not.toMatch(/Incomplete|不完整/)
  await composer(app).fill('source unsent draft')
  const before = await entries(app, source)
  const originalTime = await footer(app, 0).locator('time').getAttribute('datetime')
  await footer(app, 0).hover()
  await footer(app, 0).locator('[data-action="branch-reply"]').click()
  await expect.poll(() => activeId(app)).not.toBe(source)
  const target = (await activeId(app))!
  await expect.poll(() => composer(app).textContent()).toBe('')
  expect(await footer(app, 0).getAttribute('data-tokens')).toBe('77')
  expect(await footer(app, 0).locator('time').getAttribute('datetime')).toBe(originalTime)
  expect(await app.window.locator('[data-slot="session-cost"]').count()).toBe(0)
  expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('source file stays current\n')
  await send(app, 'branch followup', 'Branch protocol answer', 2)
  const branchRequest = model.requests.filter((body) => !body.includes('COKO_SESSION_TITLE')).at(-1)!
  expect(branchRequest).toContain('protocol first')
  expect(branchRequest).toContain('First protocol answer')
  expect(branchRequest).toContain('source file stays current')
  expect(branchRequest).toContain('Child protocol result.')
  expect(branchRequest).not.toContain('protocol second')
  expect(branchRequest).not.toContain('Second protocol answer')
  expect(await app.window.locator('[data-slot="session-cost"]').getAttribute('data-tokens')).toBe('6')
  expect(await entries(app, source)).toEqual(before)
  await app.window.locator(`[data-session-id="${source}"]`).click()
  await expect.poll(() => composer(app).textContent()).toBe('source unsent draft')
  expect(await app.window.locator('[data-slot="session-cost"]').getAttribute('data-tokens')).toBe('1109')
  await app.window.locator(`[data-session-id="${target}"]`).click()
  const targetRecords = await entries(app, target)
  await app.dispose()
  app = await launchApp({}, { dir: root })
  await waitConnected(app.window)
  await app.window.locator(`[data-session-id="${target}"]`).click()
  await footer(app, 1).waitFor()
  expect(await footer(app, 0).getAttribute('data-tokens')).toBe('77')
  expect(await footer(app, 1).getAttribute('data-tokens')).toBe('6')
  expect(await footer(app, 0).locator('time').getAttribute('datetime')).toBe(originalTime)
  expect(await entries(app, target)).toEqual(targetRecords)
  expect(await app.window.locator('[data-slot="session-cost"]').getAttribute('data-tokens')).toBe('6')
  expect(model.requests.filter((body) => body.includes('COKO_SESSION_TITLE'))).toHaveLength(1)
  expect(model.requests.filter((body) => !body.includes('COKO_SESSION_TITLE') && !isChildRequest(body))).toHaveLength(5)
  expect(model.requests.filter(isChildRequest)).toHaveLength(1)
})

it('actual cancellation and failed/successful compaction retain reported usage in terminal footers after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-protocol-ended-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  let conversationCalls = 0
  let summaries = 0
  const requested: string[] = []
  let releasePartial: (() => void) | undefined
  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8').on('data', (part: string) => (body += part))
    req.on('end', () => {
      requested.push(body)
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      if (body.includes('COKO_SESSION_TITLE')) return res.end(reply('Partial protocol check', { prompt_tokens: 1000, completion_tokens: 20 }))
      if (body.includes('You are a context summarization assistant.') && ++summaries === 1)
        return res.end(
          sse({
            id: 'summary-failed',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'metered',
            choices: [],
            usage: { prompt_tokens: 30, completion_tokens: 7 },
          }) + sse({ error: { message: 'Invalid API key', type: 'invalid_request_error', code: 'invalid_api_key' } }),
        )
      if (body.includes('You are a context summarization assistant.'))
        return res.end(reply('# Saved protocol context', { prompt_tokens: 40, completion_tokens: 9 }))
      conversationCalls++
      if (conversationCalls === 1) {
        releasePartial = () => {
          res.write(
            sse({
              id: 'partial',
              object: 'chat.completion.chunk',
              created: 1,
              model: 'metered',
              choices: [],
              usage: { prompt_tokens: 31, completion_tokens: 4 },
            }),
          )
          res.write(sse({ id: 'partial', object: 'chat.completion.chunk', created: 1, model: 'metered', choices: [], usage: { completion_tokens: 7 } }))
          // Ordered content is an observable barrier: both usage events have reached the real adapter first.
          res.write(chunk({ role: 'assistant', content: '**Partial protocol**' }, null))
        }
        return
      }
      res.end(reply(`Continuation ${conversationCalls}.`, { prompt_tokens: 1, completion_tokens: 1 }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  let app = await launchApp({}, { dir: root })
  onTestFinished(() => app.dispose())
  const subscriptions = new Set<string>()
  app.window.on('websocket', (socket) =>
    socket.on('framereceived', (frame) => {
      const message = JSON.parse(String(frame.payload)) as { type: string; sessionId?: string }
      if (message.type === 'subscribed' && message.sessionId) subscriptions.add(message.sessionId)
    }),
  )
  onTestFailed(async () => {
    console.error('protocol terminal diagnostics', {
      conversationCalls,
      summaries,
      requests: requested.map((body) =>
        body.includes('COKO_SESSION_TITLE') ? 'title' : body.includes('You are a context summarization assistant.') ? 'summary' : 'turn',
      ),
    })
  })
  await app.window.getByRole('heading', { level: 1 }).waitFor()
  await installProvider(app, `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`)
  await createProjectDraft(app, workspace)
  await composer(app).fill('cancel protocol')
  await composer(app).press('Enter')
  // First-send opens/subscribes the new Session after its API response. Start the controlled stream only after its committed user row arrives.
  await app.window.locator('[data-slot="user-bubble"]').filter({ hasText: 'cancel protocol' }).waitFor()
  await expect.poll(async () => subscriptions.has((await activeId(app))!)).toBe(true)
  await expect.poll(() => releasePartial !== undefined).toBe(true)
  releasePartial!()
  await app.window.locator('[data-slot="assistant-message-body"]').filter({ hasText: 'Partial protocol' }).waitFor({ timeout: 30_000 })
  expect(await app.window.locator('[data-slot="assistant-footer"]').count()).toBe(0)
  await app.window.locator('[data-action="stop"]').click()
  await footer(app, 0).waitFor()
  await expect.poll(() => footer(app, 0).getAttribute('data-tokens')).toBe('38')
  expect(await footer(app, 0).locator('[data-action="run-usage"]').textContent()).toContain('38 tokens')
  expect(await footer(app, 0).textContent()).toMatch(/Incomplete|不完整/)
  expect(await footer(app, 0).locator('[data-action="copy-message"]').count()).toBe(1)
  expect(await footer(app, 0).locator('[data-action="branch-reply"]').count()).toBe(0)
  const source = (await activeId(app))!
  for (const [index, text] of ['a'.repeat(100_000), 'b'.repeat(100_000)].entries()) {
    const status = await app.window.evaluate(
      async ({ id, message }) => (await fetch(`/api/sessions/${id}/messages`, { method: 'POST', body: JSON.stringify({ text: message }) })).status,
      { id: source, message: text },
    )
    expect(status).toBe(202)
    await expect.poll(async () => (await entries(app, source)).filter((entry) => entry.kind === 'run_end').length, { timeout: 30_000 }).toBe(index + 2)
  }
  const compact = await app.window.evaluate(
    async (id) => (await fetch(`/api/sessions/${id}/messages`, { method: 'POST', body: JSON.stringify({ text: '/compact' }) })).status,
    source,
  )
  expect(compact).toBe(202)
  await expect.poll(() => app.window.locator('[data-slot="assistant-footer"]').count(), { timeout: 30_000 }).toBe(4)
  expect(await footer(app, 3).getAttribute('data-tokens')).toBe('37')
  expect(await footer(app, 3).locator('[data-action="run-usage"]').textContent()).toContain('37 tokens')
  expect(await footer(app, 3).textContent()).toMatch(/Incomplete|不完整/)
  expect(await footer(app, 3).textContent()).not.toMatch(/\$|Unpriced|未定价/)
  expect(await footer(app, 3).locator('[data-action="copy-message"], [data-action="branch-reply"]').count()).toBe(0)
  const compactAgain = await app.window.evaluate(
    async (id) => (await fetch(`/api/sessions/${id}/messages`, { method: 'POST', body: JSON.stringify({ text: '/compact' }) })).status,
    source,
  )
  expect(compactAgain).toBe(202)
  await expect.poll(() => app.window.locator('[data-slot="assistant-footer"]').count(), { timeout: 30_000 }).toBe(5)
  expect(await footer(app, 4).getAttribute('data-tokens')).toBe('49')
  expect(await footer(app, 4).locator('[data-action="run-usage"]').textContent()).toContain('49 tokens')
  expect(await footer(app, 4).textContent()).not.toMatch(/Incomplete|不完整/)
  const records = await entries(app, source)
  expect(records.filter((entry) => entry.kind === 'compaction')).toHaveLength(1)
  const failed = records.filter((entry) => entry.kind === 'model_request' && (entry.payload as { purpose?: string }).purpose === 'compaction')
  expect(failed).toHaveLength(2)
  expect(failed[0]!.payload).toMatchObject({ usage: { input: 30, output: 7, total: 37 }, usageReport: { complete: false } })
  const endTimes = await app.window.locator('[data-slot="assistant-footer"] time').evaluateAll((times) => times.map((time) => time.getAttribute('datetime')))
  await app.dispose()
  app = await launchApp({}, { dir: root })
  await waitConnected(app.window)
  await footer(app, 4).waitFor()
  expect(await app.window.locator('[data-slot="assistant-footer"]').evaluateAll((footers) => footers.map((el) => el.getAttribute('data-tokens')))).toEqual([
    '38',
    '2',
    '2',
    '37',
    '49',
  ])
  expect(await app.window.locator('[data-slot="assistant-footer"] time').evaluateAll((times) => times.map((time) => time.getAttribute('datetime')))).toEqual(
    endTimes,
  )
  expect(await entries(app, source)).toEqual(records)
})

it('actual pending request crash keeps the completed request as an incomplete lower bound after recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'coko-protocol-crash-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  await writeFile(join(workspace, 'notes.txt'), 'crash boundary\n')
  let turns = 0
  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8').on('data', (part: string) => (body += part))
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      if (body.includes('COKO_SESSION_TITLE')) return res.end(reply('Crash boundary', { prompt_tokens: 1, completion_tokens: 1 }))
      turns++
      if (turns === 1)
        res.end(
          chunk(
            {
              role: 'assistant',
              content: 'Before the pending request.',
              tool_calls: [
                { index: 0, id: 'read-before-crash', type: 'function', function: { name: 'read', arguments: JSON.stringify({ path: 'notes.txt' }) } },
              ],
            },
            null,
          ) +
            chunk({}, 'tool_calls', { prompt_tokens: 11, completion_tokens: 3 }) +
            'data: [DONE]\n\n',
        )
      // The second real HTTP request remains open: it cannot produce a terminal measurement.
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  let app = await launchApp({}, { dir: root })
  onTestFinished(() => app.dispose())
  await app.window.getByRole('heading', { level: 1 }).waitFor()
  await installProvider(app, `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`)
  await createProjectDraft(app, workspace)
  await composer(app).fill('crash after the second request starts')
  await composer(app).press('Enter')
  await expect.poll(() => turns, { timeout: 30_000 }).toBe(2)
  const source = (await activeId(app))!
  const before = await entries(app, source)
  const recorded = before.filter((entry) => entry.kind === 'model_request' && entry.runId !== null)
  expect(recorded).toHaveLength(1)
  expect(recorded[0]!.payload).toMatchObject({ usage: { total: 14 }, usageReport: { complete: true } })
  expect(before.some((entry) => entry.kind === 'run_end')).toBe(false)
  const pids = await app.sidecarPids()
  expect(pids).toHaveLength(1)
  process.kill(pids[0]!, 'SIGKILL')
  await app.dispose()
  app = await launchApp({}, { dir: root })
  await waitConnected(app.window)
  await footer(app, 0).waitFor()
  expect(await footer(app, 0).getAttribute('data-tokens')).toBe('14')
  expect(await footer(app, 0).textContent()).toMatch(/Incomplete|不完整/)
  expect(await footer(app, 0).locator('time, [data-action="branch-reply"]').count()).toBe(0)
  await footer(app, 0).locator('[data-action="run-usage"]').click()
  const details = app.window.locator('[data-slot="run-usage-details"]')
  await details.waitFor()
  expect(await details.locator('[data-usage-part="input"] dd').textContent()).toBe('≥ 11')
  expect(await details.locator('[data-usage-part="cacheRead"] dd').textContent()).toBe('—')
  await app.window.keyboard.press('Escape')
  const recovered = await entries(app, source)
  expect(recovered.filter((entry) => entry.kind === 'model_request' && entry.runId !== null)).toEqual(recorded)
  expect(recovered.filter((entry) => entry.kind === 'run_end').at(-1)?.payload).toMatchObject({ status: 'interrupted' })
  expect(turns).toBe(2)
})
