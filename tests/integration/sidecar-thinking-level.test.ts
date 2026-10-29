// 会话中的 Thinking Level（模型服务 MS-34、MS-35、MS-36）：可选档位、按 Session 保存、请求参数与 Run 进行中不能切换。
// 模型服务替身记录每个请求的 JSON 正文并返回不可重试的 400，Run 以模型错误结束；hold 时先挂起，直到测试放行。
import { createServer } from 'node:http'
import { describe, expect, it, onTestFinished } from 'vitest'
import { API_ROUTES, apiPaths, type ProviderFields } from '@coko/protocol'
import {
  answerDecrypts,
  catalogModel,
  client,
  connect,
  customProvider,
  exchange,
  isRunEnd,
  saveProvider,
  sidecarDirs,
  startSidecar,
  tempDir,
  type Sidecar,
} from './sidecar-harness.ts'

async function recordingModelServer() {
  const bodies: Record<string, any>[] = []
  let gate: Promise<void> | undefined
  const server = createServer((req, res) => {
    let text = ''
    req.setEncoding('utf8').on('data', (chunk: string) => (text += chunk))
    req.on('end', async () => {
      bodies.push(JSON.parse(text) as Record<string, any>)
      await gate
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end('{"error":{"message":"recorded","type":"invalid_request_error"}}')
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
  return {
    bodies,
    baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
    /** 之后的请求挂起，直到调用返回的 release。 */
    hold() {
      let release!: () => void
      gate = new Promise((resolve) => (release = resolve))
      return () => {
        gate = undefined
        release()
      }
    },
  }
}

const reasoner = (id: string, levels: [string, string][]) =>
  catalogModel(id, { reasoning: true, thinkingLevels: [{ level: 'off' }, ...levels.map(([level, value]) => ({ level, value }) as never)] })

/** 一个 IPC 模式的 Sidecar（answerDecrypts 应答解密），以及带 cookie 的客户端与已订阅的 Session 流。 */
async function open(sidecar: Sidecar) {
  answerDecrypts(sidecar)
  const cookie = await exchange(sidecar)
  const api = client(sidecar, cookie)
  const stream = await connect(sidecar, cookie)
  const subscribed = new Set<string>()
  /** 发一条消息，等到 Run 结束，返回本次模型请求的正文。 */
  const send = async (sessionId: string, server: { bodies: Record<string, any>[] }) => {
    if (!subscribed.has(sessionId)) {
      subscribed.add(sessionId)
      stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
      await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    }
    const before = stream.entries(sessionId).filter((e) => e.kind === 'run_end').length
    const requests = server.bodies.length
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'hello' })).status).toBe(202)
    await stream.waitFor(() => stream.entries(sessionId).filter((e) => e.kind === 'run_end').length > before, 30_000)
    expect(server.bodies.length).toBe(requests + 1)
    return server.bodies.at(-1)!
  }
  return { api, stream, send }
}

async function sessionWith(api: ReturnType<typeof client>, model: { providerId: string; modelId: string }, extra: object = {}) {
  const ws = await api.post(API_ROUTES.workspaces, { path: await tempDir() })
  return api.post(API_ROUTES.sessions, { workspaceId: ws.body.id, model, ...extra })
}

describe('会话中的 Thinking Level', () => {
  it(
    'OpenAI Responses：可选档位为 off 与已配置档位；新建为 off（effort none）；选 high 发送其参数值；换到不支持的模型回到 off；重启后读回',
    { timeout: 120_000 },
    async () => {
      const server = await recordingModelServer()
      const dirs = await sidecarDirs()
      const provider: ProviderFields = customProvider(
        'custom-provider-1',
        server.baseUrl,
        [
          reasoner('custom-model-1', [
            ['high', 'deep'],
            ['medium', 'medium'],
          ]),
          reasoner('custom-model-2', [['low', 'low']]),
          catalogModel('custom-model-3', { reasoning: false, thinkingLevels: [{ level: 'off' }, { level: 'high', value: 'high' }] }),
          reasoner('custom-model-4', [['high', 'h4']]),
        ],
        'openai-responses',
      )
      const first = await startSidecar({ dirs })
      expect(await saveProvider(first, provider, { secret: 'sk-thinking-key-0001' })).toMatchObject({ ok: true })
      const { api, send } = await open(first)

      // 未配置的档位与推理开关关闭的模型不出现档位；顺序固定。
      const models = (await api.get(API_ROUTES.models)).body.models as { modelId: string; thinkingLevels: string[] }[]
      expect(models.map((m) => [m.modelId, m.thinkingLevels])).toEqual([
        ['custom-model-1', ['off', 'medium', 'high']],
        ['custom-model-2', ['off', 'low']],
        ['custom-model-3', ['off']],
        ['custom-model-4', ['off', 'high']],
      ])

      const created = await sessionWith(api, { providerId: 'custom-provider-1', modelId: 'custom-model-1' })
      expect(created).toMatchObject({ status: 201, body: { thinkingLevel: 'off' } })
      const sessionId = created.body.id as string
      expect((await send(sessionId, server)).reasoning).toMatchObject({ effort: 'none' })

      const high = await api.put(apiPaths.sessionModel(sessionId), {
        model: { providerId: 'custom-provider-1', modelId: 'custom-model-1' },
        thinkingLevel: 'high',
      })
      expect(high).toMatchObject({ status: 200, body: { thinkingLevel: 'high' } })
      expect((await send(sessionId, server)).reasoning).toMatchObject({ effort: 'deep' })

      // 该模型没有配置的档位：拒绝，原档位不变。
      const rejected = await api.put(apiPaths.sessionModel(sessionId), {
        model: { providerId: 'custom-provider-1', modelId: 'custom-model-1' },
        thinkingLevel: 'low',
      })
      expect(rejected.status).toBe(400)
      expect((await api.get(apiPaths.session(sessionId))).body.session.thinkingLevel).toBe('high')

      // 换到同样配置了 high 的模型时保留；换到未配置 high 的模型时回到 off。
      const kept = await api.put(apiPaths.sessionModel(sessionId), { model: { providerId: 'custom-provider-1', modelId: 'custom-model-4' } })
      expect(kept.body).toMatchObject({ model: { modelId: 'custom-model-4' }, thinkingLevel: 'high' })
      expect((await send(sessionId, server)).reasoning).toMatchObject({ effort: 'h4' })
      const switched = await api.put(apiPaths.sessionModel(sessionId), { model: { providerId: 'custom-provider-1', modelId: 'custom-model-2' } })
      expect(switched.body).toMatchObject({ model: { modelId: 'custom-model-2' }, thinkingLevel: 'off' })
      expect((await send(sessionId, server)).reasoning).toMatchObject({ effort: 'none' })

      // 推理开关关闭的模型只有 off：请求不带 reasoning。
      expect(
        (await api.put(apiPaths.sessionModel(sessionId), { model: { providerId: 'custom-provider-1', modelId: 'custom-model-3' }, thinkingLevel: 'high' }))
          .status,
      ).toBe(400)
      await api.put(apiPaths.sessionModel(sessionId), { model: { providerId: 'custom-provider-1', modelId: 'custom-model-3' } })
      expect((await send(sessionId, server)).reasoning).toBeUndefined()

      // 选择写入会话记录：重启 Sidecar 后读回，请求仍带该档位的参数值。
      await api.put(apiPaths.sessionModel(sessionId), { model: { providerId: 'custom-provider-1', modelId: 'custom-model-1' }, thinkingLevel: 'medium' })
      expect((await first.stop()).code).toBe(0)
      const second = await startSidecar({ dirs })
      const again = await open(second)
      expect((await again.api.get(apiPaths.session(sessionId))).body.session).toMatchObject({ model: { modelId: 'custom-model-1' }, thinkingLevel: 'medium' })
      expect((await again.send(sessionId, server)).reasoning).toMatchObject({ effort: 'medium' })

      // 新建时可直接给出档位（草稿中选择）；该模型不支持时拒绝。
      expect((await sessionWith(again.api, { providerId: 'custom-provider-1', modelId: 'custom-model-1' }, { thinkingLevel: 'high' })).body.thinkingLevel).toBe(
        'high',
      )
      expect((await sessionWith(again.api, { providerId: 'custom-provider-1', modelId: 'custom-model-2' }, { thinkingLevel: 'high' })).status).toBe(400)
    },
  )

  it('OpenAI Chat Completions：off 不带 reasoning_effort，high 发送其参数值', { timeout: 60_000 }, async () => {
    const server = await recordingModelServer()
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    const provider = customProvider('custom-provider-2', server.baseUrl, [reasoner('custom-model-1', [['high', 'deep']])])
    expect(await saveProvider(sidecar, provider, { secret: 'sk-thinking-key-0002' })).toMatchObject({ ok: true })
    const { api, send } = await open(sidecar)
    const model = { providerId: 'custom-provider-2', modelId: 'custom-model-1' }
    const sessionId = (await sessionWith(api, model)).body.id as string
    expect(await send(sessionId, server)).not.toHaveProperty('reasoning_effort')
    await api.put(apiPaths.sessionModel(sessionId), { model, thinkingLevel: 'high' })
    expect((await send(sessionId, server)).reasoning_effort).toBe('deep')
  })

  it('Anthropic Messages：off 按协议默认方式关闭思考（thinking disabled）', { timeout: 60_000 }, async () => {
    const server = await recordingModelServer()
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    const provider = customProvider(
      'custom-provider-3',
      server.baseUrl.replace(/\/v1$/, ''),
      [reasoner('custom-model-1', [['high', 'high']])],
      'anthropic-messages',
    )
    expect(await saveProvider(sidecar, provider, { secret: 'sk-thinking-key-0003' })).toMatchObject({ ok: true })
    const { api, send } = await open(sidecar)
    const sessionId = (await sessionWith(api, { providerId: 'custom-provider-3', modelId: 'custom-model-1' })).body.id as string
    expect((await send(sessionId, server)).thinking).toEqual({ type: 'disabled' })
  })

  it('Run 进行中不能切换档位（与切换模型一致），档位不变', { timeout: 60_000 }, async () => {
    const server = await recordingModelServer()
    const sidecar = await startSidecar({ dirs: await sidecarDirs() })
    const provider = customProvider('custom-provider-4', server.baseUrl, [reasoner('custom-model-1', [['high', 'high']])], 'openai-responses')
    expect(await saveProvider(sidecar, provider, { secret: 'sk-thinking-key-0004' })).toMatchObject({ ok: true })
    const { api, stream } = await open(sidecar)
    const model = { providerId: 'custom-provider-4', modelId: 'custom-model-1' }
    const sessionId = (await sessionWith(api, model)).body.id as string
    stream.send({ type: 'subscribe', sessionId, afterSeq: 0 })
    await stream.waitFor((m) => m.type === 'subscribed' && m.sessionId === sessionId)
    const release = server.hold()
    expect((await api.post(apiPaths.sessionMessages(sessionId), { text: 'hello' })).status).toBe(202)
    await expect.poll(() => server.bodies.length, { timeout: 20_000 }).toBe(1)
    const busy = await api.put(apiPaths.sessionModel(sessionId), { model, thinkingLevel: 'high' })
    expect(busy).toMatchObject({ status: 409, body: { error: { code: 'run-in-progress' } } })
    release()
    await stream.waitFor(isRunEnd(sessionId), 30_000)
    expect((await api.get(apiPaths.session(sessionId))).body.session.thinkingLevel).toBe('off')
  })
})
