// 获取可用模型（ADR 0010）：main 经 provider.models 请 Sidecar 按表单中的协议与地址请求供应商的模型列表。新建时用表单中的 Key，
// 只用于这一次请求；编辑且 Key 留空时用已保存的 Credential（即使地址已改为其他主机）；provider.models.cancel 中止请求。
// 供应商是本测试启动的 loopback 服务，记录收到的鉴权头。
import { createServer, type IncomingMessage } from 'node:http'
import { describe, expect, it, onTestFinished } from 'vitest'
import { answerDecrypts, customProvider, fetchModels, saveProvider, sidecarDirs, startSidecar } from './sidecar-harness.ts'

/** 返回固定模型列表的供应商；hold 为 true 时不回答（用于取消）。记录每个请求的路径与鉴权头。 */
async function listingProvider(models: string[], options: { hold?: boolean } = {}) {
  const seen: { url: string | undefined; auth: string | undefined; closed: boolean }[] = []
  const server = createServer((req: IncomingMessage, res) => {
    const entry = { url: req.url, auth: req.headers.authorization ?? (req.headers['x-api-key'] as string | undefined), closed: false }
    seen.push(entry)
    req.on('close', () => (entry.closed = true))
    if (options.hold) return
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'list', data: models.map((id) => ({ id, object: 'model' })) }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  )
  return { baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, seen }
}

const SAVED = 'sk-saved-provider-key-4410'
const FORM = 'sk-form-only-key-9921'

describe('获取可用模型', () => {
  it('新建：用表单中的 Key 请求 <地址>/models，按返回顺序回答模型 ID；Anthropic 协议用 x-api-key', async () => {
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs })
    const provider = await listingProvider(['custom-model-3', 'custom-model-1', 'custom-model-2'])
    expect(await fetchModels(sidecar, { baseUrl: provider.baseUrl, secret: FORM })).toEqual({
      type: 'provider.models.result',
      requestId: expect.any(Number),
      ok: true,
      models: ['custom-model-3', 'custom-model-1', 'custom-model-2'],
    })
    expect(provider.seen.map((s) => [s.url, s.auth])).toEqual([['/v1/models', `Bearer ${FORM}`]])

    const anthropic = await listingProvider(['custom-model-a'])
    const origin = anthropic.baseUrl.replace(/\/v1$/, '')
    expect(await fetchModels(sidecar, { api: 'anthropic-messages', baseUrl: origin, secret: FORM })).toMatchObject({ ok: true, models: ['custom-model-a'] })
    expect(anthropic.seen.map((s) => [s.url, s.auth])).toEqual([['/v1/models?limit=1000', FORM]])
  })

  it('编辑：Key 留空时用已保存的 Credential，即使地址改为其他主机；填写了新 Key 时用新 Key，且不替换已保存 Key 的缓存', async () => {
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs })
    const decrypts = answerDecrypts(sidecar)
    const original = await listingProvider(['custom-model-1'])
    expect(await saveProvider(sidecar, customProvider('custom-provider-1', original.baseUrl, ['custom-model-1']), { secret: SAVED })).toMatchObject({
      ok: true,
    })

    const moved = await listingProvider(['custom-model-1', 'custom-model-2'])
    expect(await fetchModels(sidecar, { baseUrl: moved.baseUrl, providerId: 'custom-provider-1' })).toMatchObject({
      ok: true,
      models: ['custom-model-1', 'custom-model-2'],
    })
    expect(await fetchModels(sidecar, { baseUrl: moved.baseUrl, providerId: 'custom-provider-1', secret: FORM })).toMatchObject({ ok: true })
    expect(await fetchModels(sidecar, { baseUrl: moved.baseUrl, providerId: 'custom-provider-1' })).toMatchObject({ ok: true })
    expect(moved.seen.map((s) => s.auth)).toEqual([`Bearer ${SAVED}`, `Bearer ${FORM}`, `Bearer ${SAVED}`])
    // 已保存的 Key 只解密一次（缓存的是它，不是表单中的 Key）。
    expect(decrypts).toHaveLength(1)
    expect(original.seen).toEqual([])
  })

  it('编辑时没有已保存的 Key、或 Provider 不存在：no-credential，不发请求', async () => {
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs })
    const provider = await listingProvider(['custom-model-1'])
    for (const providerId of ['missing-provider', undefined])
      expect(await fetchModels(sidecar, { baseUrl: provider.baseUrl, ...(providerId ? { providerId } : {}) })).toMatchObject({
        ok: false,
        error: { code: 'no-credential' },
      })
    expect(provider.seen).toEqual([])
  })

  it('取消：provider.models.cancel 中止对供应商的请求，以 cancelled 回答', async () => {
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs })
    const provider = await listingProvider([], { hold: true })
    let requestId = 0
    const pending = fetchModels(sidecar, { baseUrl: provider.baseUrl, secret: FORM }, { onSent: (id) => (requestId = id) })
    await expect.poll(() => provider.seen.length).toBe(1)
    sidecar.send({ type: 'provider.models.cancel', requestId })
    expect(await pending).toMatchObject({ ok: false, error: { code: 'cancelled' } })
    await expect.poll(() => provider.seen[0]!.closed).toBe(true)
  })

  it('供应商返回错误：upstream-error 带状态码，回显的 Key 被替换；地址不是 http(s) 时 bad-request', async () => {
    const dirs = await sidecarDirs()
    const sidecar = await startSidecar({ dirs })
    const server = createServer((req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${String(req.headers.authorization).replace('Bearer ', '')}` } }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
    const result = await fetchModels(sidecar, { baseUrl, secret: FORM })
    expect(result).toMatchObject({ ok: false, error: { code: 'upstream-error', status: 401, message: expect.stringContaining('Incorrect API key') } })
    expect(JSON.stringify(result)).not.toContain(FORM)
    expect(await fetchModels(sidecar, { baseUrl: 'ftp://gateway.example/v1', secret: FORM })).toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })
})
