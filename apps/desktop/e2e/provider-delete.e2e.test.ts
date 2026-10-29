// 删除供应商（MS-32、MS-33）：真实 Electron + 真实 Sidecar。经界面新建两个 Provider 并用其中一个对话，删除时确认框写明引用数量；
// 确认后重新读取持久化状态：Provider 已不在、引用它的 Session 模型为空；会话在下次运行前提示重新选择模型。用相同 ID 重新创建后
// 原 Session 仍没有模型，重新选择后才运行。模型服务是本地的 OpenAI 兼容假服务。
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, onTestFinished } from 'vitest'
import { launchApp, stubDirectoryPicker, waitConnected, type LaunchedApp } from './harness.ts'

const apps: LaunchedApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.dispose()
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  onTestFinished(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** OpenAI Chat Completions 的流式假服务：记录请求头，回复固定文本。 */
async function fakeOpenAI(reply: string) {
  const requests: { headers: IncomingHttpHeaders }[] = []
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      requests.push({ headers: req.headers })
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const chunk = (delta: object, finish: string | null) =>
        `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      res.write(chunk({ role: 'assistant', content: '' }, null))
      res.write(chunk({ content: reply }, null))
      res.write(chunk({}, 'stop'))
      res.end('data: [DONE]\n\n')
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
const dialog = (app: LaunchedApp) => app.window.getByRole('dialog')
const api = <T>(app: LaunchedApp, path: string) => app.window.evaluate((p) => fetch(p).then((r) => r.json()), path) as Promise<T>
type Sessions = { sessions: { id: string; model: { providerId: string; modelId: string } | null }[] }

async function addCustomProvider(app: LaunchedApp, options: { id: string; baseUrl: string; models: string; secret: string }) {
  await dialog(app)
    .getByRole('button', { name: /^(Add model provider|添加模型供应商)$/ })
    .click()
  const form = app.window.locator('[data-provider-form]')
  await form.locator('input[name="providerId"]').fill(options.id)
  await form.locator('input[name="name"]').fill(options.id)
  await form.locator('input[name="baseUrl"]').fill(options.baseUrl)
  // 目录逐行添加：新增一行后填写模型 ID。
  await form.locator('[data-model-add]').click()
  await form.locator('[data-model-row] input[name="modelId"]').fill(options.models)
  await form.locator('input[name="credential"]').fill(options.secret)
  await form.locator('button[type="submit"]').click()
  await form.waitFor({ state: 'detached', timeout: 15_000 })
}

it('删除被会话引用的供应商：确认框写明引用数量，确认后会话下次运行前提示重新选择模型；用相同 ID 重新创建不会接回原会话', async () => {
  const root = await tempDir('coko-provider-delete-')
  const workspace = join(root, 'workspace')
  await mkdir(workspace)
  const model = await fakeOpenAI('Hello from the fake model.')
  const app = await launchApp({}, { dir: root })
  apps.push(app)
  await waitConnected(app.window)
  await stubDirectoryPicker(app.app, [workspace])
  await app.window
    .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
    .first()
    .click()

  // 没有 Provider：Enter 引导到设置的模型服务分区，在那里新建两个供应商。
  await composer(app).click()
  await composer(app).fill('say hello')
  await app.window.locator('[data-action="setup"]').waitFor({ timeout: 15_000 })
  await composer(app).press('Enter')
  await dialog(app).waitFor()
  await addCustomProvider(app, { id: 'local-one', baseUrl: model.baseUrl, models: 'm1', secret: 'sk-e2e-one-key-1111' })
  await addCustomProvider(app, { id: 'local-two', baseUrl: model.baseUrl, models: 'm2', secret: 'sk-e2e-two-key-2222' })
  await app.window.keyboard.press('Escape')
  await dialog(app).waitFor({ state: 'detached' })
  await app.window.locator('[data-action="send"]').waitFor()
  await composer(app).press('Enter')
  await expect.poll(() => app.window.getByRole('article', { name: 'Coko' }).last().textContent(), { timeout: 30_000 }).toBe('Hello from the fake model.')
  const [session] = (await api<Sessions>(app, '/api/sessions')).sessions
  expect(session?.model).toEqual({ providerId: 'local-one', modelId: 'm1' })

  // 删除 local-one：确认框写明 1 个会话在使用它。
  await app.window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
  await dialog(app).locator('[data-section="models"]').click()
  await dialog(app).locator('[data-provider-id="local-one"] [data-provider-delete]').click()
  const confirm = app.window.getByRole('alertdialog')
  await confirm.locator('[data-provider-references="ready"]').waitFor()
  expect(await confirm.locator('[data-provider-references]').textContent()).toMatch(/^(有 1 个会话|1 session\(s\))/)
  await confirm.getByRole('button', { name: /^(Delete|删除)$/ }).click()
  await confirm.waitFor({ state: 'detached' })
  await dialog(app).locator('[data-provider-id="local-one"]').waitFor({ state: 'detached' })

  // 重新读取持久化状态：Provider 已删除，引用它的会话模型为空。
  expect((await api<{ providers: { id: string }[] }>(app, '/api/providers')).providers.map((p) => p.id)).toEqual(['local-two'])
  expect((await api<Sessions>(app, '/api/sessions')).sessions.find((s) => s.id === session!.id)?.model).toBeNull()

  // 用相同 ID 重新创建：原会话不会接到新供应商上。
  await addCustomProvider(app, { id: 'local-one', baseUrl: model.baseUrl, models: 'm1', secret: 'sk-e2e-new-key-3333' })
  expect((await api<Sessions>(app, '/api/sessions')).sessions.find((s) => s.id === session!.id)?.model).toBeNull()
  await app.window.keyboard.press('Escape')
  await dialog(app).waitFor({ state: 'detached' })

  // 下次运行前提示重新选择模型：输入区上方有提示，发送被拒绝且没有请求发出。
  await app.window.locator('[data-slot="model-required"]').waitFor()
  expect(await app.window.locator('[data-model-picker]').getAttribute('data-model')).toBeNull()
  await composer(app).click()
  await composer(app).fill('again')
  await composer(app).press('Enter')
  await app.window.getByText(/^(Choose a model for this session first|请先为这个会话选择模型)$/).waitFor()
  expect(model.requests).toHaveLength(1)

  // 选择模型后提示消失，可以运行，请求使用所选供应商的 Key。
  await app.window.locator('[data-model-picker]').click()
  await app.window.getByRole('menuitemradio', { name: 'm2' }).click()
  await app.window.locator('[data-slot="model-required"]').waitFor({ state: 'detached' })
  await composer(app).click()
  await composer(app).fill('again')
  await composer(app).press('Enter')
  await expect.poll(() => model.requests.length, { timeout: 30_000 }).toBe(2)
  expect(model.requests[1]?.headers.authorization).toBe('Bearer sk-e2e-two-key-2222')
})
