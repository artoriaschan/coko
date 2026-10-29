// 设置、Provider 与 Credential：真实 Electron + 真实 Sidecar。Provider 草稿与 Key 经 preload → main safeStorage → 一条
// provider.save 控制消息一次存入 Sidecar（ADR 0010），调用模型时经控制 IPC 解密；模型服务是本地的 OpenAI 兼容假服务，
// 断言其收到的 Authorization 与库文件内容。
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
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

async function launch(dir: string): Promise<LaunchedApp> {
  const app = await launchApp({}, { dir })
  apps.push(app)
  await waitConnected(app.window)
  return app
}

/** OpenAI Chat Completions 的流式假服务：记录请求头，回复固定文本。 */
async function fakeOpenAI(reply: string) {
  const requests: { path: string; headers: IncomingHttpHeaders; body: string }[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8').on('data', (chunk: string) => (body += chunk))
    req.on('end', () => {
      requests.push({ path: req.url ?? '', headers: req.headers, body })
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const chunk = (delta: object, finish: string | null) =>
        `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'm1', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      const words = reply.split(/(?<= )/)
      res.write(chunk({ role: 'assistant', content: '' }, null))
      for (const word of words) res.write(chunk({ content: word }, null))
      res.write(chunk({}, 'stop'))
      res.write(
        `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 0, model: 'm1', choices: [], usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 } })}\n\n`,
      )
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
  const { port } = server.address() as { port: number }
  return { requests, baseUrl: `http://127.0.0.1:${port}/v1` }
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => [])
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name))
}

async function addWorkspace(app: LaunchedApp, path: string) {
  await stubDirectoryPicker(app.app, [path])
  await app.window
    .getByRole('button', { name: /^(Add workspace|添加工作区)$/ })
    .first()
    .click()
  await app.window.getByRole('heading', { level: 1, name: /^(New session|新会话)$/ }).waitFor()
}

const composer = (app: LaunchedApp) => app.window.getByRole('textbox', { name: /Give Coko a task|向 Coko 布置任务/ })
const dialog = (app: LaunchedApp) => app.window.getByRole('dialog')

/** 在已打开的模型服务分区中，用列表底部的表单新建自定义 Provider（默认协议 OpenAI Chat Completions）。 */
async function addCustomProvider(app: LaunchedApp, options: { id: string; name: string; baseUrl: string; models: string; secret: string }) {
  await dialog(app)
    .getByRole('button', { name: /^(Add model provider|添加模型供应商)$/ })
    .click()
  const form = app.window.locator('[data-provider-form]')
  await form.locator('input[name="providerId"]').fill(options.id)
  await form.locator('input[name="name"]').fill(options.name)
  await form.locator('input[name="baseUrl"]').fill(options.baseUrl)
  await form.locator('input[name="models"]').fill(options.models)
  await form.locator('input[name="credential"]').fill(options.secret)
  await form.locator('button[type="submit"]').click()
  await form.waitFor({ state: 'detached', timeout: 15_000 })
}

describe('设置：Provider 与 Credential', () => {
  it('未配置时引导到设置；一次提交新建带 Key 的 Provider 后只显示末四位；列表项内编辑并留空 Key 保存，原 Key 仍用于对话；HTTP 不能创建 Provider；库文件不含明文', async () => {
    const root = await tempDir('coko-settings-')
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const secret = 'sk-e2e-secret-key-7f3a9c4821'
    const model = await fakeOpenAI('Hello from the fake model.')
    const app = await launch(root)
    await addWorkspace(app, workspace)

    // 没有 Provider：发送入口变为"配置模型"，Enter 也引导到设置的 Models 分区，草稿保留。
    await composer(app).click()
    await composer(app).fill('say hello')
    await app.window.locator('[data-action="setup"]').waitFor({ timeout: 15_000 })
    await composer(app).press('Enter')
    await dialog(app).waitFor()
    expect(await dialog(app).locator('[data-section="models"]').getAttribute('aria-current')).toBe('page')

    await addCustomProvider(app, { id: 'local-fake', name: 'Local fake', baseUrl: model.baseUrl, models: 'm1', secret })
    const card = dialog(app).locator('[data-provider-id]')
    await expect.poll(() => card.locator('[data-credential-status]').getAttribute('data-credential-status')).toBe('configured')
    expect(await card.locator('[data-credential-status]').textContent()).toMatch(/4821$/)
    expect(await app.window.evaluate(() => document.body.innerText)).not.toContain(secret)
    expect(await app.window.evaluate(() => [...document.querySelectorAll('input')].some((i) => i.value.includes('sk-e2e')))).toBe(false)

    // 列表项内编辑：ID 为静态文本，Key 输入框为空；只改显示名称并保存，Key 留空不覆盖原 Credential（规格 4.3）。
    await card.getByRole('button', { name: /^(Edit|编辑)$/ }).click()
    const editForm = card.locator('[data-provider-form="edit"]')
    await editForm.waitFor()
    expect(await editForm.locator('input[name="providerId"]').count()).toBe(0)
    expect(await editForm.locator('[data-provider-static-id]').textContent()).toBe('local-fake')
    expect(await editForm.locator('input[name="credential"]').inputValue()).toBe('')
    await editForm.locator('input[name="name"]').fill('Local fake edited')
    await editForm.locator('button[type="submit"]').click()
    await editForm.waitFor({ state: 'detached', timeout: 15_000 })
    await expect.poll(() => card.locator('[data-user-content]').first().textContent()).toBe('Local fake edited')
    expect(await card.locator('[data-credential-status]').textContent()).toMatch(/4821$/)

    await app.window.keyboard.press('Escape')
    await dialog(app).waitFor({ state: 'detached' })
    expect(await composer(app).textContent()).toBe('say hello')
    await app.window.locator('[data-action="send"]').waitFor()
    expect(await app.window.locator('[data-model-picker]').getAttribute('data-model')).toMatch(/\/m1$/)
    await composer(app).press('Enter')

    await expect.poll(() => app.window.getByRole('article', { name: 'Coko' }).last().textContent(), { timeout: 30_000 }).toBe('Hello from the fake model.')
    expect(model.requests).toHaveLength(1)
    expect(model.requests[0]).toMatchObject({ path: '/v1/chat/completions', headers: { authorization: `Bearer ${secret}` } })

    // 设置接口不回传密钥；HTTP 不再提供 Provider 的创建与更新（ADR 0010）。
    const providers = await app.window.evaluate(() => fetch('/api/providers').then((r) => r.text()))
    expect(providers).not.toContain(secret)
    expect(providers).toContain('"hint":"4821"')
    expect(providers).toContain('"name":"Local fake edited"')
    const viaHttp = await app.window.evaluate(async () => {
      const body = JSON.stringify({ id: 'via-http', name: 'x', api: 'openai-completions', baseUrl: 'http://127.0.0.1:9/v1', models: [] })
      const post = await fetch('/api/providers', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      const patch = await fetch('/api/providers/local-fake', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"name":"x"}' })
      return [post.status, patch.status]
    })
    expect(viaHttp).toEqual([404, 404])
    expect(await app.window.evaluate(() => fetch('/api/providers').then((r) => r.text()))).toBe(providers)

    await app.dispose()
    // 关闭后检查用户数据目录（SQLite 库与 WAL、日志、Chromium 存储）的每个文件都不含明文。
    const files = await filesUnder(join(root, 'user-data'))
    expect(files.some((f) => f.endsWith('coko.db'))).toBe(true)
    const leaking: string[] = []
    for (const file of files) if ((await readFile(file)).includes(secret)) leaking.push(file)
    expect(leaking).toEqual([])
  })

  it('主题与语言在重启后保留；revision 冲突时提示并保留选择', async () => {
    const root = await tempDir('coko-settings-')
    const first = await launch(root)
    await first.window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    // 选与系统语言不同的界面语言，确认保存的是用户的选择而不是默认值。
    const target = (await first.window.evaluate(() => document.documentElement.lang)) === 'en' ? 'zh' : 'en'
    await dialog(first).locator('[data-theme-option="dark"]').click()
    await dialog(first)
      .getByRole('radio', { name: target === 'zh' ? '中文' : 'English' })
      .click()
    await expect
      .poll(() => first.window.evaluate(() => fetch('/api/settings').then((r) => r.json())))
      .toMatchObject({
        settings: expect.arrayContaining([expect.objectContaining({ key: 'theme', value: 'dark' }), expect.objectContaining({ key: 'locale', value: target })]),
      })

    // 另一处写入 theme 使 revision 前进；界面再切换时以旧 revision 保存，得到冲突。
    await first.window.evaluate(async () => {
      const { settings } = (await fetch('/api/settings').then((r) => r.json())) as { settings: { key: string; revision: number }[] }
      const revision = settings.find((s) => s.key === 'theme')!.revision
      await fetch('/api/settings/theme', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 'dark', expectedRevision: revision }),
      })
    })
    await dialog(first).locator('[data-theme-option="light"]').click()
    await first.window
      .getByText(/^(This setting was changed elsewhere\. Your choice is not saved yet\.|设置已在别处更改，你的选择尚未保存)$/)
      .waitFor({ timeout: 10_000 })
    expect(await dialog(first).locator('[data-theme-option="light"]').getAttribute('data-state')).toBe('on')
    expect(await first.window.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false)
    // 服务端仍是另一处写入的值。
    expect(await first.window.evaluate(() => fetch('/api/settings').then((r) => r.json()))).toMatchObject({
      settings: expect.arrayContaining([expect.objectContaining({ key: 'theme', value: 'dark', revision: 2 })]),
    })
    // 重试以当前选择保存。
    await first.window.getByRole('button', { name: /^(Retry|重试)$/ }).click()
    await expect
      .poll(() => first.window.evaluate(() => fetch('/api/settings').then((r) => r.json())))
      .toMatchObject({
        settings: expect.arrayContaining([expect.objectContaining({ key: 'theme', value: 'light', revision: 3 })]),
      })
    // 再切回深色，作为重启后应看到的值。
    await dialog(first).locator('[data-theme-option="dark"]').click()
    await expect
      .poll(() => first.window.evaluate(() => fetch('/api/settings').then((r) => r.json())))
      .toMatchObject({
        settings: expect.arrayContaining([expect.objectContaining({ key: 'theme', value: 'dark', revision: 4 })]),
      })
    await first.dispose()

    const second = await launch(root)
    await expect.poll(() => second.window.evaluate(() => document.documentElement.classList.contains('dark')), { timeout: 15_000 }).toBe(true)
    await expect.poll(() => second.window.evaluate(() => document.documentElement.lang)).toBe(target === 'zh' ? 'zh-CN' : 'en')
    await second.window.getByRole('button', { name: target === 'zh' ? '设置' : 'Settings', exact: true }).waitFor()
  })

  // 真实模型：仅在测试宿主提供 DEEPSEEK_API_KEY 时运行。密钥由测试读取后经界面输入，与用户路径一致；Sidecar 不读取该变量
  // （harness 从子进程环境中剔除它），不写入日志或断言输出。
  it.skipIf(!process.env.DEEPSEEK_API_KEY)('真实 DeepSeek 凭据：经自定义 Provider 一次对话成功', async () => {
    const root = await tempDir('coko-real-')
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    const app = await launch(root)
    await addWorkspace(app, workspace)
    await app.window.getByRole('button', { name: /^(Settings|设置)$/ }).click()
    await dialog(app).locator('[data-section="models"]').click()
    await addCustomProvider(app, {
      id: 'deepseek',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      models: 'deepseek-chat',
      secret: process.env.DEEPSEEK_API_KEY!,
    })
    await app.window.keyboard.press('Escape')
    await composer(app).click()
    await composer(app).fill('Reply with the single word: pong')
    await composer(app).press('Enter')
    await app.window.locator('[data-run-status], [data-action="send"]').last().waitFor({ timeout: 90_000 })
    await expect.poll(() => app.window.getByRole('article', { name: 'Coko' }).count(), { timeout: 90_000 }).toBeGreaterThan(0)
    expect(await app.window.locator('[data-run-status="error"]').count()).toBe(0)
  })
})
